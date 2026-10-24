import { describe, expect, it } from 'vitest'
import {
  defeatReasonLabel,
  matchLine,
  resultLabel,
  takeoverNotice,
  UNRATED_REPEAT_NOTE,
  unratedGameNote,
} from './labels.ts'

describe('takeoverNotice', () => {
  it('names the player and the bot standing in, and the player coming back', () => {
    const started = { type: 'started', seat: 1, name: 'Alice', botLevel: '1500' } as const
    expect(takeoverNotice(started)).toBe(
      'Alice didn’t reconnect in time, so Bot 1500 plays on for them.',
    )
    expect(takeoverNotice({ ...started, botLevel: 'max' })).toContain('Bot Max plays on')
    expect(takeoverNotice({ ...started, type: 'ended' })).toBe('Alice is back and plays on.')
  })
})

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

describe('unratedGameNote', () => {
  const game = { ranked: true, rated: false, phase: 'in_game', result: { type: '' } }

  it('explains a ranked game played unrated past the repeat limit', () => {
    expect(unratedGameNote(game, false)).toBe(
      'Not rated: you four have already played 3 rated games together in the last 24 hours.',
    )
    expect(unratedGameNote(game, true)).toContain('these four players have already played')
  })

  it('drops the reason once the game is over, which can also lose its Elo at the end', () => {
    expect(
      unratedGameNote({ ...game, phase: 'finished', result: { type: 'ffa_winner' } }, false),
    ).toBe('Not rated: nobody’s Elo changed.')
  })

  it('says nothing for rated, casual, cancelled or not yet started games', () => {
    expect(unratedGameNote({ ...game, rated: true }, false)).toBeNull()
    expect(unratedGameNote({ ...game, ranked: false }, false)).toBeNull()
    expect(unratedGameNote({ ...game, phase: 'countdown' }, false)).toBeNull()
    expect(
      unratedGameNote({ ...game, phase: 'finished', result: { type: 'aborted' } }, false),
    ).toBeNull()
  })
})
