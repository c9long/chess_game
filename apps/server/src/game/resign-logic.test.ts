import { Game, initRulesSync } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { botAcceptsTeamResign, resignLapseReason, teammateOf, teamOf } from './resign-logic.ts'

beforeAll(() => {
  initRulesSync()
})

describe('teams', () => {
  it('pairs South with North and West with East', () => {
    expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1])
    expect([0, 1, 2, 3].map(teammateOf)).toEqual([2, 3, 0, 1])
  })
})

describe('proposal lapse', () => {
  const all = [true, true, true, true] as const

  it('lapses when the proposer or its teammate stops taking turns', () => {
    expect(resignLapseReason(0, [true, true, false, true], 1, new Set())).toBe('voters_changed')
    expect(resignLapseReason(0, [false, true, true, true], 1, new Set())).toBe('voters_changed')
    // An opponent leaving does not change the team's vote.
    expect(resignLapseReason(0, [true, false, true, true], 2, new Set())).toBeNull()
  })

  it('lapses after a full round: every other seat moved and the turn is back', () => {
    // North proposed while South was to move: South and West moved, North's turn again,
    // but East has not had a turn yet.
    expect(resignLapseReason(2, all, 2, new Set([0, 1]))).toBeNull()
    expect(resignLapseReason(2, all, 2, new Set([0, 1, 3]))).toBe('round')
    // Everyone else moved but it isn't North's turn yet.
    expect(resignLapseReason(2, all, 1, new Set([0, 1, 3]))).toBeNull()
    // The proposer's own automatic pass counts as its turn coming round.
    expect(resignLapseReason(2, all, 3, new Set([0, 1, 3, 2]))).toBe('round')
    // Seats no longer taking turns don't need a turn.
    expect(resignLapseReason(0, [true, false, true, true], 0, new Set([2, 3]))).toBe('round')
  })
})

describe('bot teammate', () => {
  it('declines in an even position and in FFA', () => {
    const teams = Game.create({ mode: 'teams' })
    for (const seat of [0, 1, 2, 3])
      expect(botAcceptsTeamResign(teams.snapshot(), seat)).toBe(false)
    teams.free()
    const ffa = Game.create({ mode: 'ffa' })
    ffa.applyAbandon('west')
    // Even a clearly losing FFA bot is never asked to resign a team.
    expect(botAcceptsTeamResign(ffa.snapshot(), 0)).toBe(false)
    ffa.free()
  })

  it('agrees when its team is clearly losing (team material at most 80% of the enemy team)', () => {
    // South (a lone king) and North (a rook, 5) against West and East (two queens, 18).
    const losing = Game.fromPosition(
      'teams nR5nK5/12/12/12/12/wK10eK/wQ10eQ/12/12/12/12/6sK5 S AAAA - - 0 0',
    )
    expect(botAcceptsTeamResign(losing.snapshot(), 2)).toBe(true)
    expect(botAcceptsTeamResign(losing.snapshot(), 0)).toBe(true)
    // The winning side never agrees.
    expect(botAcceptsTeamResign(losing.snapshot(), 1)).toBe(false)
    losing.free()
    // 5 + 9 = 14 vs 18: at most 0.8 x 18 = 14.4, still clearly losing; 9 + 9 vs 18 is even.
    const close = Game.fromPosition(
      'teams nR5nK5/12/12/12/12/wK10eK/wQ10eQ/12/12/12/12/sQ5sK5 S AAAA - - 0 0',
    )
    expect(botAcceptsTeamResign(close.snapshot(), 2)).toBe(true)
    close.free()
    const even = Game.fromPosition(
      'teams nQ5nK5/12/12/12/12/wK10eK/wQ10eQ/12/12/12/12/sQ5sK5 S AAAA - - 0 0',
    )
    expect(botAcceptsTeamResign(even.snapshot(), 2)).toBe(false)
    even.free()
  })
})
