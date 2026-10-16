import { Game, initRulesSync, type Snapshot } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  allAccepted,
  BOT_DRAW_ACCEPT_RATIO,
  botAcceptsDraw,
  initialVotes,
  lapseReason,
  materialBySeat,
  turnsPlayed,
} from './draw-logic.ts'

beforeAll(() => {
  initRulesSync()
})

/** Board field of a position string from square -> piece ('sK', 'wQ', ...). */
function board(pieces: Record<string, string>): string {
  const rows: string[] = []
  for (let r = 12; r >= 1; r--) {
    let row = ''
    let empty = 0
    for (const f of 'abcdefghijkl') {
      const p = pieces[`${f}${r}`]
      if (!p) {
        empty++
        continue
      }
      if (empty) row += empty
      empty = 0
      row += p
    }
    if (empty) row += empty
    rows.push(row)
  }
  return rows.join('/')
}

function snapshotOf(position: string): Snapshot {
  const game = Game.fromPosition(position)
  try {
    return game.snapshot()
  } finally {
    game.free()
  }
}

/** An FFA position: four leaders in the corners plus `extra` pieces. */
function ffa(extra: Record<string, string>, statuses = 'AAAA', defeats = '-'): Snapshot {
  const kings: Record<string, string> = { a1: 'sK', a12: 'wK', l12: 'nK', l1: 'eK' }
  if (statuses[1] === 'R') delete kings.a12
  return snapshotOf(`ffa ${board({ ...kings, ...extra })} S ${statuses} - - 0 0 def=${defeats}`)
}

describe('material', () => {
  it('counts P1 N3 B3 R5 Q9 per seat, leaders excluded', () => {
    const game = Game.create({ mode: 'ffa' })
    // 8 pawns, 2 knights, 2 bishops, 2 rooks, 1 queen = 8 + 6 + 6 + 10 + 9.
    expect(materialBySeat(game.snapshot())).toEqual([39, 39, 39, 39])
    game.free()
    expect(materialBySeat(ffa({ b2: 'sP', c2: 'sN', b11: 'wQ', k11: 'nR', k2: 'eB' }))).toEqual([
      4, 9, 5, 3,
    ])
  })
})

describe('bot draw answers', () => {
  it('declines in the even starting position (FFA and Teams)', () => {
    for (const mode of ['ffa', 'teams'] as const) {
      const game = Game.create({ mode })
      const snap = game.snapshot()
      for (const seat of [0, 1, 2, 3]) expect(botAcceptsDraw(snap, seat)).toBe(false)
      game.free()
    }
  })

  it('FFA: accepts only when clearly behind the strongest other player', () => {
    const snap = ffa({ b2: 'sP', c2: 'sP', b11: 'wQ', k11: 'nR' })
    // South 2 vs the strongest (West, 9): clearly losing.
    expect(botAcceptsDraw(snap, 0)).toBe(true)
    // West is the strongest: declines.
    expect(botAcceptsDraw(snap, 1)).toBe(false)
    // North 5 <= 0.8 x 9: accepts. East has nothing: accepts.
    expect(botAcceptsDraw(snap, 2)).toBe(true)
    expect(botAcceptsDraw(snap, 3)).toBe(true)
  })

  it('FFA: the 80% threshold is inclusive', () => {
    expect(BOT_DRAW_ACCEPT_RATIO).toBe(0.8)
    // South 8 (rook + 3 pawns) vs West 10 (two rooks): 8 <= 8, accepts.
    const atLimit = ffa({ b2: 'sR', c2: 'sP', d2: 'sP', e2: 'sP', b11: 'wR', c11: 'wR' })
    expect(botAcceptsDraw(atLimit, 0)).toBe(true)
    // South 9 vs 10: declines.
    const above = ffa({ b2: 'sQ', b11: 'wR', c11: 'wR' })
    expect(botAcceptsDraw(above, 0)).toBe(false)
  })

  it('FFA: removed players do not count as rivals', () => {
    // West is out (no pieces); South 3 vs North 3 and East 3: even, declines.
    const snap = ffa({ b2: 'sN', k11: 'nB', k2: 'eN' }, 'ARAA', 'Wr')
    expect(botAcceptsDraw(snap, 0)).toBe(false)
  })

  it('Teams: compares team totals, frozen pieces excluded', () => {
    const game = Game.create({ mode: 'teams' })
    game.applyAbandon('north') // North freezes: its 39 points stay on the board but can't move.
    const snap = game.snapshot()
    expect(snap.statuses).toEqual(['active', 'active', 'frozen', 'active'])
    // South alone (39) vs West + East (78): South accepts; West and East decline.
    expect(botAcceptsDraw(snap, 0)).toBe(true)
    expect(botAcceptsDraw(snap, 1)).toBe(false)
    expect(botAcceptsDraw(snap, 3)).toBe(false)
    // A frozen seat is not a voter: it never accepts.
    expect(botAcceptsDraw(snap, 2)).toBe(false)
    game.free()
  })

  it('never accepts once the game is over', () => {
    const game = Game.create({ mode: 'ffa' })
    game.applyAgreedDraw()
    expect(botAcceptsDraw(game.snapshot(), 0)).toBe(false)
    game.free()
  })
})

describe('offer bookkeeping', () => {
  it('starts with the offerer accepted and the other voters pending', () => {
    expect(initialVotes([true, true, true, true], 2)).toEqual([0, 0, 1, 0])
    expect(initialVotes([true, false, true, true], 0)).toEqual([1, -1, 0, 0])
    expect(allAccepted([1, -1, 0, 0])).toBe(false)
    expect(allAccepted([1, -1, 1, 1])).toBe(true)
  })

  it('lapses when the voters change', () => {
    const votes = [1, 0, 0, 0]
    expect(lapseReason(votes, [true, true, true, false], 0, 1, new Set())).toBe('voters_changed')
    expect(lapseReason(votes, [true, true, true, true], 0, 1, new Set())).toBeNull()
  })

  it('lapses after a full round: every other voter moved and the turn is back', () => {
    const votes = [0, 0, 1, 0]
    const all = [true, true, true, true] as const
    // Offered by North while South was to move: South and West moved, North's turn again,
    // but East has not had a turn yet.
    expect(lapseReason(votes, all, 2, 2, new Set([0, 1]))).toBeNull()
    // North moved, East moved, ... South and West again: back to North, round complete.
    expect(lapseReason(votes, all, 2, 2, new Set([0, 1, 2, 3]))).toBe('round')
    // Everyone else moved but it isn't North's turn yet.
    expect(lapseReason(votes, all, 2, 1, new Set([0, 1, 3]))).toBeNull()
    // Non-voters don't need a turn.
    expect(lapseReason([1, -1, 0, 0], [true, false, true, true], 0, 0, new Set([2, 3]))).toBe(
      'round',
    )
  })
})

describe('turnsPlayed (cooldowns)', () => {
  it('counts the mover of a move and every seat that passed automatically', () => {
    expect(turnsPlayed('move', 1, [])).toEqual([1])
    expect(
      turnsPlayed('move', 1, [
        { type: 'pass', seat: 'north' },
        { type: 'pass', seat: 'south' },
      ] as never),
    ).toEqual([1, 2, 0])
  })

  it('counts no mover for other actions, only their passes', () => {
    expect(turnsPlayed('timeout', 0, [])).toEqual([])
    expect(turnsPlayed('resign', 3, [{ type: 'pass', seat: 'south' }] as never)).toEqual([0])
  })
})
