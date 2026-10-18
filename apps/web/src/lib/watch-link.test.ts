import { describe, expect, it } from 'vitest'
import { watchLinkNote, watchUrl } from './watch-link.ts'

describe('watch link', () => {
  it('points at the watch page of the match room', () => {
    expect(watchUrl('https://example.test', 'AbC123')).toBe('https://example.test/watch/AbC123')
  })

  it('says who may watch, as the server decides it', () => {
    const base = { inviteOnly: false, hasPassword: false, ranked: false }
    expect(watchLinkNote(base)).toBe('Anyone signed in can watch.')
    expect(watchLinkNote({ ...base, hasPassword: true })).toBe('Watchers need the lobby password.')
    expect(watchLinkNote({ ...base, inviteOnly: true, hasPassword: true })).toBe(
      'Only the invited players and the host’s friends can watch.',
    )
    expect(watchLinkNote({ ...base, ranked: true })).toBe(
      'Anyone signed in can watch. Ranked games are shown 2 rounds behind.',
    )
  })
})
