import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearReconnectToken,
  loadReconnectToken,
  parseSaved,
  SAVED_TOKEN_MAX_AGE_MS,
  saveReconnectToken,
} from './reconnect-store.ts'
import { memoryStorage } from './test-storage.ts'

let local: Storage
let session: Storage
beforeEach(() => {
  local = memoryStorage()
  session = memoryStorage()
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('sessionStorage', session)
})
afterEach(() => vi.unstubAllGlobals())

describe('reconnection tokens', () => {
  it('keeps the token in both storages, keyed per match', () => {
    saveReconnectToken('roomA', 'roomA:tok1', 1_000)
    saveReconnectToken('roomB', 'roomB:tok2', 1_000)
    expect(session.getItem('match:reconnect:roomA')).toBe('roomA:tok1')
    expect(JSON.parse(local.getItem('match:reconnect:roomA') ?? '')).toEqual({
      token: 'roomA:tok1',
      savedAt: 1_000,
    })
    expect(loadReconnectToken('roomA', 2_000)).toBe('roomA:tok1')
    expect(loadReconnectToken('roomB', 2_000)).toBe('roomB:tok2')
  })

  it('survives the tab dying (sessionStorage gone): the app was killed in the background', () => {
    saveReconnectToken('roomA', 'roomA:tok1', 1_000)
    session.clear()
    expect(loadReconnectToken('roomA', 5_000)).toBe('roomA:tok1')
  })

  it('ignores and prunes stale or malformed entries', () => {
    saveReconnectToken('old', 'old:t', 0)
    local.setItem('match:reconnect:junk', 'not json')
    session.clear()
    const later = SAVED_TOKEN_MAX_AGE_MS + 10
    expect(loadReconnectToken('old', later)).toBeNull()
    saveReconnectToken('new', 'new:t', later)
    expect(local.getItem('match:reconnect:old')).toBeNull()
    expect(local.getItem('match:reconnect:junk')).toBeNull()
    expect(local.getItem('match:reconnect:new')).not.toBeNull()
    expect(parseSaved(JSON.stringify({ token: '', savedAt: 1 }), 2)).toBeNull()
  })

  it('clears both copies, or only the long-lived one at game end', () => {
    saveReconnectToken('roomA', 'roomA:t', 1)
    clearReconnectToken('roomA', 'persistent')
    expect(local.getItem('match:reconnect:roomA')).toBeNull()
    expect(session.getItem('match:reconnect:roomA')).toBe('roomA:t')
    clearReconnectToken('roomA')
    expect(loadReconnectToken('roomA', 2)).toBeNull()
  })

  it('works without storage (private modes throw)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    vi.stubGlobal('localStorage', throwing)
    vi.stubGlobal('sessionStorage', throwing)
    expect(() => saveReconnectToken('r', 'r:t')).not.toThrow()
    expect(loadReconnectToken('r')).toBeNull()
    expect(() => clearReconnectToken('r')).not.toThrow()
  })
})
