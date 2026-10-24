import type { Challenge } from '@game/protocol'
import { describe, expect, it } from 'vitest'
import {
  challengeBlocker,
  challengeLine,
  RANKED_CHALLENGE_HINT,
  rankedNeedsFriends,
} from './challenges.ts'

function challenge(over: Partial<Challenge> = {}): Challenge {
  return {
    id: 'c1',
    from: { userId: 'host', username: 'Hostess' },
    roomId: 'room1',
    mode: 'ffa',
    timeControl: '10+0',
    ranked: false,
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T10:05:00.000Z',
    invitees: [
      { user: { userId: 'me', username: 'Me' }, status: 'pending' },
      { user: { username: 'Ada' }, status: 'pending' },
    ],
    ...over,
  }
}

describe('challengeLine', () => {
  it('says casual or ranked, and names the other invitees (not the viewer)', () => {
    expect(challengeLine(challenge(), 'me')).toBe('Free-for-all, 10+0, casual. Also invited: Ada.')
    expect(
      challengeLine(challenge({ ranked: true, mode: 'teams', timeControl: '3+2' }), 'me'),
    ).toBe('Teams 2v2, 3+2, ranked. Also invited: Ada.')
    expect(challengeLine(challenge({ invitees: [] }), 'me')).toBe('Free-for-all, 10+0, casual.')
    // The challenger's own view lists the invitees separately.
    expect(challengeLine(challenge({ ranked: true }))).toBe('Free-for-all, 10+0, ranked.')
  })
})

describe('challengeBlocker', () => {
  it('needs one friend for a casual challenge', () => {
    expect(challengeBlocker(0, false, 1)).toBe('Pick at least one friend.')
    expect(challengeBlocker(1, false, 1)).toBeNull()
  })

  it('needs a full table of three friends for a ranked challenge (no bots)', () => {
    expect(challengeBlocker(0, true, 5)).toBe('Pick 3 more friends.')
    expect(challengeBlocker(1, true, 5)).toBe('Pick 2 more friends.')
    expect(challengeBlocker(2, true, 5)).toBe('Pick 1 more friend.')
    expect(challengeBlocker(3, true, 5)).toBeNull()
  })

  it('says so plainly when there are not enough friends to pick from', () => {
    expect(challengeBlocker(1, true, 1)).toBe('A ranked challenge needs 3 friends. You have 1.')
    expect(challengeBlocker(2, true, 2)).toBe('A ranked challenge needs 3 friends. You have 2.')
    expect(challengeBlocker(1, false, 1)).toBeNull()
  })
})

describe('rankedNeedsFriends', () => {
  it('only blocks below a full table', () => {
    expect(rankedNeedsFriends(0)).toBe('A ranked challenge needs 3 friends. You have 0.')
    expect(rankedNeedsFriends(3)).toBeNull()
  })
})

describe('RANKED_CHALLENGE_HINT', () => {
  it('states the repeat limit and its window', () => {
    expect(RANKED_CHALLENGE_HINT).toContain('up to 3 games in 24 hours')
  })
})
