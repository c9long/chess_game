import { Game, initRulesSync, type Snapshot, seatIndex } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { type CheckPosition, INITIAL_CHECK, nextCheck } from './check-indicator.ts'

// England (civ v2) has four leaders, the Prime Ministers. The check indicator is driven by the
// engine's snapshot: it shows when any of them is attacked, and the board rings only the
// attacked ones (`attackedLeaderSquares`).

beforeAll(() => {
  initRulesSync()
})

/** The check position of a snapshot, as the game room builds it. */
const pos = (s: Snapshot): CheckPosition => ({
  ply: s.ply,
  seatToMove: seatIndex(s.seatToMove),
  isOver: s.isOver,
  leaderUnderAttack: s.leaderUnderAttack,
})

const ENGLAND_SOUTH = 'civ=england.2,canada.1,canada.1,canada.1'
const SOUTH = 0

describe('check indicator with several leaders', () => {
  it('warns when one of three Prime Ministers is attacked, ringing only that one', () => {
    // West's rook on m3 attacks the Prime Minister on c3; f1 and k1 are safe. South to move.
    const game = Game.fromPosition(
      `ffa wK14nK/16/16/16/16/16/16/16/16/16/16/16/16/2sM9wR3/16/5sM4sM4eK S AAAA - - 0 0 ${ENGLAND_SOUTH}`,
    )
    const s = game.snapshot()
    expect(s.leaderSquares[SOUTH]).toEqual(['f1', 'k1', 'c3'])
    expect(s.attackedLeaderSquares[SOUTH]).toEqual(['c3'])
    const first = nextCheck(INITIAL_CHECK, SOUTH, pos(s), null)
    expect(first.notice).toBe('check')
    // South steps the attacked one away: no warning any more.
    game.applyMove('c3c4')
    const after = game.snapshot()
    expect(after.attackedLeaderSquares[SOUTH]).toEqual([])
    expect(nextCheck(first.memo, SOUTH, pos(after), { seat: SOUTH, action: 'move' }).notice).toBe(
      'none',
    )
    game.free()
  })

  it('a self-check on one Prime Minister shows while the others are safe', () => {
    // South moves its k1 Prime Minister onto West's rook line (rank 3): legal, and flagged.
    const game = Game.fromPosition(
      `ffa wK14nK/16/16/16/16/16/16/16/16/16/16/16/16/9wR6/16/5sM4sM4eK S AAAA - - 0 0 ${ENGLAND_SOUTH}`,
    )
    const before = nextCheck(INITIAL_CHECK, SOUTH, pos(game.snapshot()), null)
    expect(before.notice).toBe('none')
    game.applyMove('k1l3')
    const s = game.snapshot()
    expect(s.attackedLeaderSquares[SOUTH]).toEqual(['l3'])
    expect(nextCheck(before.memo, SOUTH, pos(s), { seat: SOUTH, action: 'move' }).notice).toBe(
      'self_check',
    )
    game.free()
  })

  it('a non-ACTIVE England has no leaders to warn about', () => {
    // Teams: South (England) is DEFEATED but still holds two Prime Ministers.
    const game = Game.fromPosition(
      `teams wK14nK/16/16/16/16/16/16/16/16/16/16/16/16/2sM9wR3/16/5sM9eK S DAAA - - 0 0 def=Ss ${ENGLAND_SOUTH}`,
    )
    const s = game.snapshot()
    expect(s.leaderUnderAttack[SOUTH]).toBe(false)
    expect(s.attackedLeaderSquares[SOUTH]).toEqual([])
    expect(nextCheck(INITIAL_CHECK, SOUTH, pos(s), null).notice).toBe('none')
    game.free()
  })
})
