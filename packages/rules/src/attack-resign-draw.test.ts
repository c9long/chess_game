// Adversarial, spec-derived tests for resignation and draw by agreement through the
// WASM/TS layer: the wrapper must expose exactly what the Rust engine decides.
import { beforeAll, describe, expect, it } from 'vitest'
import { Game, type GameEvent, initRulesSync, type Seat, type Snapshot } from './index.ts'
import { validateEvents, validateSnapshot } from './test/validate.ts'

beforeAll(() => {
  initRulesSync()
})

const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']

function snap(game: Game): Snapshot {
  const s = game.snapshot()
  validateSnapshot(s)
  return s
}

function act(events: GameEvent[]): GameEvent[] {
  validateEvents(events)
  return events
}

/** The position string restores the exact state (hash, outcome, voters). */
function expectRoundTrip(game: Game): void {
  const back = Game.fromPosition(game.positionString())
  const a = snap(game)
  const b = snap(back)
  expect(b.hash).toBe(a.hash)
  expect(b.outcome).toEqual(a.outcome)
  expect(b.statuses).toEqual(a.statuses)
  expect(b.defeats).toEqual(a.defeats)
  expect(b.epTargets).toEqual(a.epTargets)
  expect(back.drawVoters()).toEqual(game.drawVoters())
  expect(back.positionString()).toBe(game.positionString())
  back.free()
}

function voters(s: Snapshot): boolean[] {
  if (s.isOver) return [false, false, false, false]
  return s.statuses.map((st) => st === 'active' || st === 'defeated')
}

// South's only move is b4xc5 en passant on West's pawn (d5, skipped c5). En passant exists only
// in rules version 2 (replays of older games), hence `rv=2` below.
const EP_TRAP_BOARD =
  '10nK5/16/16/16/16/wK14eK/16/16/16/16/16/1eR1wP12/1sP14/sBsP1eN12/sPsP1sP12/sKsRsB13'

describe('resign (WASM/TS)', () => {
  it('FFA off-turn resign removes the army and keeps the turn', () => {
    const game = Game.create({ mode: 'ffa' })
    act(game.applyMove('e2e4'))
    const ev = act(game.applyResign('east'))
    expect(ev).toEqual([
      { type: 'defeat', seat: 'east', reason: 'resign' },
      { type: 'army_removed', seat: 'east' },
    ])
    const s = snap(game)
    expect(s.statuses).toEqual(['active', 'active', 'active', 'removed'])
    expect(s.seatToMove).toBe('west')
    expect(s.ply).toBe(1)
    expect(s.noProgress).toBe(0)
    expect(s.moveLimit).toBe(75)
    expect(s.board.filter((p) => p?.owner === 'east')).toHaveLength(0)
    expect(s.castling[3]).toEqual({ long: false, short: false })
    expect(s.defeats).toEqual([{ seat: 'east', reason: 'resign' }])
    expect(game.drawVoters()).toEqual([true, true, true, false])
    expect(game.positionString()).toContain(' AAAR ')
    expect(game.positionString()).toContain('def=Er')
    expectRoundTrip(game)
    expect(() => game.applyResign('east')).toThrow()
    game.free()
  })

  it('own-turn resign equals a timeout except for the reason (FFA)', () => {
    for (const mode of ['ffa'] as const) {
      const a = Game.create({ mode })
      const b = a.clone()
      const ea = act(a.applyResign('south'))
      const eb = act(b.applyTimeout('south'))
      expect(ea.map((e) => (e.type === 'defeat' ? { ...e, reason: 'timeout' } : e))).toEqual(eb)
      expect(snap(a).hash).toBe(snap(b).hash)
      expect(snap(a).seatToMove).toBe('west')
      a.free()
      b.free()
    }
  })

  it('Teams off-turn abandon clears only the leaver en passant target', () => {
    // A single Teams seat leaving is an abandon (a resignation takes the whole team out).
    const game = Game.create({ mode: 'teams', rulesVersion: 2 })
    act(game.applyMove('e2e4'))
    act(game.applyMove('b7d7'))
    act(game.applyMove('f15f13'))
    expect(snap(game).seatToMove).toBe('east')
    const ev = act(game.applyAbandon('west'))
    expect(ev).toEqual([
      { type: 'defeat', seat: 'west', reason: 'abandon' },
      { type: 'frozen', seat: 'west' },
    ])
    const s = snap(game)
    expect(s.epTargets[1]).toBeNull()
    expect(s.epTargets[0]).toEqual({ skipped: 'e3', pawn: 'e4' })
    expect(s.epTargets[2]).toEqual({ skipped: 'f14', pawn: 'f13' })
    expect(s.board.filter((p) => p?.owner === 'west')).toHaveLength(16)
    expect(game.drawVoters()).toEqual([true, false, true, true])
    expectRoundTrip(game)
    game.free()
  })

  it('Teams off-turn abandon can force an automatic pass of a defeated seat on move', () => {
    const game = Game.fromPosition(`teams ${EP_TRAP_BOARD} S DAAA - Wc5 7 30 def=Sl rv=2`)
    expect(game.legalMoveNotations()).toEqual(['b4c5'])
    const ev = act(game.applyAbandon('west'))
    expect(ev).toEqual([
      { type: 'defeat', seat: 'west', reason: 'abandon' },
      { type: 'frozen', seat: 'west' },
      { type: 'pass', seat: 'south', notation: '--' },
    ])
    const s = snap(game)
    expect(s.seatToMove).toBe('north')
    expect(s.ply).toBe(31)
    expect(s.noProgress).toBe(1)
    expectRoundTrip(game)
    game.free()
  })

  it('FFA off-turn resign of the en passant victim stalemates the seat on move', () => {
    const game = Game.fromPosition(`ffa ${EP_TRAP_BOARD} S AAAA - Wc5 0 0 rv=2`)
    const ev = act(game.applyResign('west'))
    expect(ev).toEqual([
      { type: 'defeat', seat: 'west', reason: 'resign' },
      { type: 'army_removed', seat: 'west' },
      { type: 'defeat', seat: 'south', reason: 'stalemate' },
      { type: 'army_removed', seat: 'south' },
    ])
    expect(snap(game).seatToMove).toBe('north')
    // Agreed draw now: West out first (4th), South second (3rd).
    const end = act(game.applyAgreedDraw())
    expect(end).toEqual([
      {
        type: 'game_ended',
        outcome: {
          result: { type: 'ffa_agreed_draw', survivors: [false, false, true, true] },
          placements: [3, 4, 1, 1],
        },
      },
    ])
    expectRoundTrip(game)
    game.free()
  })

  it('a Teams resignation by a defeated seat still playing resigns its team', () => {
    // North lost its leader but still plays; South is active. North resigns off turn.
    const game = Game.fromPosition(
      'teams 8nR7/16/16/16/16/16/16/wK14eK/16/16/16/16/16/16/16/8sK7 W AADA - - 0 0 def=Nl',
    )
    const ev = act(game.applyResign('north'))
    expect(ev.slice(0, 3)).toEqual([
      { type: 'frozen', seat: 'north' },
      { type: 'defeat', seat: 'south', reason: 'resign' },
      { type: 'frozen', seat: 'south' },
    ])
    expect(ev.at(-1)).toEqual({
      type: 'game_ended',
      outcome: { result: { type: 'teams_winner', team: 'west_east' }, placements: [2, 1, 2, 1] },
    })
    // North took part in the resignation, so its record now says resign (first place kept).
    expect(snap(game).defeats).toEqual([
      { seat: 'north', reason: 'resign' },
      { seat: 'south', reason: 'resign' },
    ])
    expectRoundTrip(game)
    game.free()
  })

  it('a Teams resignation with a frozen partner ends the game at once', () => {
    const game = Game.create({ mode: 'teams' })
    act(game.applyAbandon('north'))
    expect(game.drawVoters()).toEqual([true, true, false, true])
    const ev = act(game.applyResign('south'))
    const last = ev.at(-1)
    expect(last).toEqual({
      type: 'game_ended',
      outcome: { result: { type: 'teams_winner', team: 'west_east' }, placements: [2, 1, 2, 1] },
    })
    const s = snap(game)
    expect(s.isOver).toBe(true)
    expect(s.board.filter((p) => p?.owner === 'south' || p?.owner === 'north')).toHaveLength(0)
    expect(game.drawVoters()).toEqual([false, false, false, false])
    for (const seat of SEATS) expect(() => game.applyResign(seat)).toThrow(/over/)
    expect(() => game.applyAgreedDraw()).toThrow(/over/)
    expectRoundTrip(game)
    game.free()
  })

  it('rejects an invalid seat name', () => {
    const game = Game.create({ mode: 'ffa' })
    expect(() => game.applyResign('up' as Seat)).toThrow()
    expect(snap(game).statuses).toEqual(['active', 'active', 'active', 'active'])
    game.free()
  })
})

describe('agreed draw (WASM/TS)', () => {
  it('FFA with no defeats: everyone 1st; the game is finished', () => {
    const game = Game.create({ mode: 'ffa' })
    const ev = act(game.applyAgreedDraw())
    expect(ev).toEqual([
      {
        type: 'game_ended',
        outcome: {
          result: { type: 'ffa_agreed_draw', survivors: [true, true, true, true] },
          placements: [1, 1, 1, 1],
        },
      },
    ])
    expect(game.legalMoves()).toEqual([])
    expect(game.positionString().endsWith(' end=draw')).toBe(true)
    expect(() => game.applyMove('e2e4')).toThrow()
    expect(() => game.applyTimeout('south')).toThrow()
    expect(() => game.applyAbandon('west')).toThrow()
    expectRoundTrip(game)
    game.free()
  })

  it('Teams with a defeated-still-playing seat and a frozen seat: everyone 1st', () => {
    const game = Game.fromPosition(
      'teams 8nK7/16/16/16/16/16/16/wR14eK/16/16/16/16/16/16/16/8sK7 S ADAA - - 3 9 def=Wl',
    )
    act(game.applyAbandon('north'))
    expect(game.drawVoters()).toEqual([true, true, false, true])
    const ev = act(game.applyAgreedDraw())
    expect(ev).toEqual([
      {
        type: 'game_ended',
        outcome: { result: { type: 'teams_agreed_draw' }, placements: [1, 1, 1, 1] },
      },
    ])
    const s = snap(game)
    expect(s.statuses).toEqual(['active', 'defeated', 'frozen', 'active'])
    expect(s.board.filter((p) => p !== null)).toHaveLength(4)
    expectRoundTrip(game)
    game.free()
  })

  it('drawVoters tracks statuses through random play with resigns', () => {
    let seed = 0x2545f491
    const rnd = (n: number) => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) % n
    }
    for (let g = 0; g < 30; g++) {
      const game = Game.create({ mode: g % 2 === 0 ? 'ffa' : 'teams' })
      for (let i = 0; i < 200 && !snap(game).isOver; i++) {
        const before = snap(game)
        expect(game.drawVoters()).toEqual(voters(before))
        const r = rnd(40)
        if (r === 0) {
          const seat = SEATS[rnd(4)] as Seat
          const idx = SEATS.indexOf(seat)
          const status = before.statuses[idx]
          if (status === 'active' || status === 'defeated') {
            const ev = act(game.applyResign(seat))
            expect(ev[0]).toEqual(
              status === 'active'
                ? { type: 'defeat', seat, reason: 'resign' }
                : { type: 'frozen', seat },
            )
            const after = snap(game)
            expect(after.statuses[idx]).toBe(before.config.mode === 'ffa' ? 'removed' : 'frozen')
            if (before.config.mode === 'teams') {
              // The whole team resigned: the other team wins at once.
              expect(after.outcome?.result).toEqual({
                type: 'teams_winner',
                team: idx % 2 === 0 ? 'west_east' : 'south_north',
              })
            }
          } else {
            expect(() => game.applyResign(seat)).toThrow()
            expect(snap(game).hash).toBe(before.hash)
          }
        } else if (r === 1 && rnd(5) === 0) {
          const ev = act(game.applyAgreedDraw())
          const o = ev[0]?.type === 'game_ended' ? ev[0].outcome : null
          expect(o?.result.type).toBe(
            before.config.mode === 'ffa' ? 'ffa_agreed_draw' : 'teams_agreed_draw',
          )
        } else {
          const moves = game.legalMoveNotations()
          act(game.applyMove(moves[rnd(moves.length)] as string))
        }
        expectRoundTrip(game)
      }
      game.free()
    }
  })
})
