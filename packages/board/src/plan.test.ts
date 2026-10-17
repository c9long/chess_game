import { Game, type GameEvent, initRules, type Snapshot } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { indexOf } from './geometry.ts'
import { type AnimationPlan, planTransition, soundCues } from './plan.ts'
import { CASTLE_READY, EN_PASSANT_READY, KING_HUNT, TO_PROMOTION } from './test/positions.ts'

beforeAll(async () => {
  await initRules()
})

/** Applies `act` and returns the plan, built with and without the events. */
function step(
  g: Game,
  act: (g: Game) => GameEvent[],
): { withEvents: AnimationPlan; diffOnly: AnimationPlan; prev: Snapshot; next: Snapshot } {
  const prev = g.snapshot()
  const events = act(g)
  const next = g.snapshot()
  return {
    withEvents: planTransition(prev, next, events),
    diffOnly: planTransition(prev, next),
    prev,
    next,
  }
}

const moves = (p: AnimationPlan) =>
  p.moves.map((m) => ({
    from: m.from,
    to: m.to,
    kind: m.piece.kind,
    promoteTo: m.promoteTo,
    rook: m.castleRook,
  }))

describe('planTransition', () => {
  it('slides a quiet move', () => {
    const g = Game.create({ mode: 'ffa' })
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('e2e4'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('e2'), to: indexOf('e4'), kind: 'pawn', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([])
      expect(p.dissolves).toEqual([])
      expect(p.appears).toEqual([])
      expect(p.seatToMoveChanged).toBe(true)
      expect(p.incremental).toBe(true)
      expect(soundCues(p)).toEqual(['move'])
    }
    g.free()
  })

  it('captures on the destination', () => {
    const g = Game.create({ mode: 'ffa' })
    g.applyMove('e1a1') // South's rook into the corner
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('a5a1'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('a5'), to: indexOf('a1'), kind: 'rook', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([
        { square: indexOf('a1'), piece: { kind: 'rook', owner: 'south' }, onDestination: true },
      ])
      expect(soundCues(p)[0]).toBe('capture')
    }
    g.free()
  })

  it('moves both pieces of a castle, leader first', () => {
    const g = Game.fromPosition(CASTLE_READY)
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('i1k1'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('i1'), to: indexOf('k1'), kind: 'king', promoteTo: null, rook: false },
        { from: indexOf('l1'), to: indexOf('j1'), kind: 'rook', promoteTo: null, rook: true },
      ])
      expect(p.captures).toEqual([])
      expect(p.incremental).toBe(true)
      expect(soundCues(p)).toEqual(['castle'])
    }
    g.free()
  })

  it('removes the right pawn en passant', () => {
    const g = Game.fromPosition(EN_PASSANT_READY)
    g.applyMove('e2e4')
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('d4e3'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('d4'), to: indexOf('e3'), kind: 'pawn', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([
        { square: indexOf('e4'), piece: { kind: 'pawn', owner: 'south' }, onDestination: false },
      ])
    }
    g.free()
  })

  it('promotes the moving pawn', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_PROMOTION) g.applyMove(m)
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('e8e9q'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('e8'), to: indexOf('e9'), kind: 'pawn', promoteTo: 'queen', rook: false },
      ])
      expect(soundCues(p)).toEqual(['move', 'promotion'])
    }
    g.free()
  })

  it('dissolves an army removed by an FFA timeout', () => {
    const g = Game.create({ mode: 'ffa' })
    const { withEvents, diffOnly } = step(g, (x) => x.applyTimeout('south'))
    for (const p of [withEvents, diffOnly]) {
      expect(p.moves).toEqual([])
      expect(p.captures).toEqual([])
      expect(p.dissolves).toHaveLength(16)
      expect(p.dissolves.every((d) => d.piece.owner === 'south')).toBe(true)
      expect(p.statusChanges).toEqual([{ seat: 'south', status: 'removed' }])
      expect(soundCues(p)).toEqual(['defeat'])
    }
    g.free()
  })

  it('captures a leader and dissolves the rest of that army (FFA)', () => {
    const g = Game.fromPosition(KING_HUNT)
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('i1i16'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('i1'), to: indexOf('i16'), kind: 'queen', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([
        { square: indexOf('i16'), piece: { kind: 'king', owner: 'north' }, onDestination: true },
      ])
      expect(p.dissolves).toEqual([
        { square: indexOf('e15'), piece: { kind: 'pawn', owner: 'north' } },
      ])
      expect(p.statusChanges).toEqual([{ seat: 'north', status: 'removed' }])
      expect(soundCues(p)).toEqual(['capture', 'defeat'])
    }
    g.free()
  })

  it('freezes a Teams seat that times out without touching the board', () => {
    const g = Game.create({ mode: 'teams' })
    const { withEvents, diffOnly } = step(g, (x) => x.applyTimeout('south'))
    for (const p of [withEvents, diffOnly]) {
      expect(p.moves).toEqual([])
      expect(p.captures).toEqual([])
      expect(p.dissolves).toEqual([])
      expect(p.statusChanges).toEqual([{ seat: 'south', status: 'frozen' }])
      expect(soundCues(p)).toEqual(['freeze'])
    }
    g.free()
  })

  it('reports a position jump as non-incremental appearances', () => {
    const start = Game.create({ mode: 'ffa' })
    const other = Game.fromPosition(KING_HUNT)
    const p = planTransition(start.snapshot(), other.snapshot())
    expect(p.incremental).toBe(false)
    expect(p.appears.length + p.moves.length).toBeGreaterThan(0)
    start.free()
    other.free()
  })
})
