import { describe, expect, it } from 'vitest'
import { defeatReasonLabel, matchLine, resultLabel, UNRATED_REPEAT_NOTE } from './labels.ts'

describe('defeatReasonLabel', () => {
  it('names the leader kind for a seat that started with several leaders', () => {
    expect(defeatReasonLabel('leader_captured', 'prime_minister', 4)).toBe(
      'All Prime Ministers captured',
    )
  })

  it('keeps the standard labels otherwise', () => {
    expect(defeatReasonLabel('leader_captured', 'king', 1)).toBe('Leader captured')
    expect(defeatReasonLabel('leader_captured', null, 1)).toBe('Leader captured')
    expect(defeatReasonLabel('timeout', 'prime_minister', 4)).toBe('Out of time')
    expect(defeatReasonLabel('resign', 'prime_minister', 4)).toBe('Resigned')
  })
})

describe('resultLabel', () => {
  it('reads a win, a draw, a placement, or no placement', () => {
    expect(resultLabel(1, 'checkmate')).toEqual({ label: 'Victory', win: true })
    expect(resultLabel(1, 'agreed_draw')).toEqual({ label: 'Draw', win: false })
    expect(resultLabel(1, 'move_limit').label).toBe('Draw')
    expect(resultLabel(3, 'checkmate')).toEqual({ label: '3rd place', win: false })
    expect(resultLabel(null, null).label).toBe('Finished')
  })
})

describe('matchLine', () => {
  it('names the mode and time control, casual and unrated games', () => {
    const m = { mode: 'ffa', timeControl: '10+0', ranked: false, rated: false }
    expect(matchLine(m)).toBe('Free-for-all, 10+0, casual')
    expect(matchLine({ mode: 'teams', timeControl: '3+2', ranked: true, rated: true })).toBe(
      'Teams 2v2, 3+2',
    )
    expect(matchLine({ mode: 'ffa', timeControl: '3+2', ranked: true, rated: false })).toBe(
      'Free-for-all, 3+2, not rated',
    )
    expect(matchLine({ ...m, timeControl: 'untimed' })).toBe('Free-for-all, untimed, against bots')
  })
})

describe('UNRATED_REPEAT_NOTE', () => {
  it('states the repeat limit and its window', () => {
    expect(UNRATED_REPEAT_NOTE).toContain('3 rated games together in the last 24 hours')
  })
})
