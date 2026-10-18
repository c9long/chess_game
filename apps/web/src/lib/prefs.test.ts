import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './test-storage.ts'

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
})
afterEach(() => vi.unstubAllGlobals())

async function prefs() {
  return (await import('./prefs.ts')).usePrefs
}

describe('board preferences', () => {
  it('announces every move by default', async () => {
    expect((await prefs()).getState().announceMoves).toBe('all')
  })

  it('remembers the announcement setting', async () => {
    const usePrefs = await prefs()
    usePrefs.getState().set({ announceMoves: 'own' })
    vi.resetModules()
    expect((await prefs()).getState().announceMoves).toBe('own')
  })

  it('keeps known keys with valid values only', async () => {
    localStorage.setItem(
      'board:prefs',
      JSON.stringify({ announceMoves: 'loud', sound: 'no', attackGlow: true, vibration: false }),
    )
    const state = (await prefs()).getState()
    expect(state.announceMoves).toBe('all')
    expect(state.sound).toBe(true)
    expect(state.vibration).toBe(false)
    expect('attackGlow' in state).toBe(false)
  })
})
