import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './test-storage.ts'

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { visibilityState: 'visible' })
})
afterEach(() => vi.unstubAllGlobals())

async function load() {
  const vibrate = vi.fn(() => true)
  vi.stubGlobal('navigator', { vibrate })
  const fb = await import('./feedback.ts')
  const { usePrefs } = await import('./prefs.ts')
  return { ...fb, usePrefs, vibrate }
}

describe('feedback', () => {
  it('vibrates by default, with a pattern per moment', async () => {
    const { feedback, usePrefs, vibrate, PATTERNS } = await load()
    expect(usePrefs.getState().vibration).toBe(true)
    feedback('capture')
    feedback('check')
    expect(vibrate).toHaveBeenNthCalledWith(1, PATTERNS.capture)
    expect(vibrate).toHaveBeenNthCalledWith(2, PATTERNS.check)
  })

  it('respects the Vibration preference and stays quiet in a hidden page', async () => {
    const { feedback, usePrefs, vibrate } = await load()
    usePrefs.getState().set({ vibration: false })
    feedback('move')
    expect(vibrate).not.toHaveBeenCalled()
    usePrefs.getState().set({ vibration: true })
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    feedback('yourTurn')
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('remembers the preference with the other board settings', async () => {
    const { usePrefs } = await load()
    usePrefs.getState().set({ vibration: false })
    expect(JSON.parse(localStorage.getItem('board:prefs') ?? '{}').vibration).toBe(false)
    vi.resetModules()
    const again = await import('./prefs.ts')
    expect(again.usePrefs.getState().vibration).toBe(false)
  })

  it('does nothing where vibration is missing, and routes to an installed driver', async () => {
    const { feedback, setFeedbackDriver, canVibrate } = await load()
    vi.stubGlobal('navigator', {})
    expect(canVibrate()).toBe(false)
    expect(() => feedback('move')).not.toThrow()
    const native = vi.fn()
    setFeedbackDriver(native)
    expect(canVibrate()).toBe(true)
    feedback('gameEnd')
    expect(native).toHaveBeenCalledWith('gameEnd')
    setFeedbackDriver(null)
  })

  it('picks the one moment worth feeling', async () => {
    const { feedbackFor } = await load()
    const move = [{ type: 'move_made', seat: 'south' }]
    const capture = [
      { type: 'move_made', seat: 'south' },
      { type: 'capture', seat: 'south', captured: { kind: 'pawn', owner: 'west' } },
    ]
    const none = { events: undefined, mySeat: 0, yourTurn: false, check: false, ended: false }
    expect(feedbackFor(none)).toBeNull()
    expect(feedbackFor({ ...none, events: move })).toBe('move')
    expect(feedbackFor({ ...none, events: capture })).toBe('capture')
    expect(feedbackFor({ ...none, events: [{ type: 'en_passant', seat: 'south' }] })).toBe(
      'capture',
    )
    expect(feedbackFor({ ...none, events: capture, yourTurn: true })).toBe('yourTurn')
    expect(feedbackFor({ ...none, events: move, yourTurn: true, check: true })).toBe('check')
    expect(feedbackFor({ ...none, events: [...capture, { type: 'game_ended' }] })).toBe('gameEnd')
    expect(feedbackFor({ ...none, ended: true, check: true })).toBe('gameEnd')
  })

  it("stays quiet for other players' routine moves, not for captures of your pieces", async () => {
    const { feedbackFor } = await load()
    const none = { events: undefined, mySeat: 2, yourTurn: false, check: false, ended: false }
    // The `events` message (seat names) and the synced state (seat indexes) both count.
    expect(feedbackFor({ ...none, events: [{ type: 'move_made', seat: 'south' }] })).toBeNull()
    expect(feedbackFor({ ...none, events: [{ type: 'move_made', seat: 0 }] })).toBeNull()
    const takesWest = { type: 'capture', seat: 'south', captured: { owner: 'west' } }
    expect(feedbackFor({ ...none, events: [takesWest] })).toBeNull()
    const takesMine = { type: 'capture', seat: 'south', captured: { owner: 'north' } }
    expect(feedbackFor({ ...none, events: [takesMine] })).toBe('capture')
    expect(feedbackFor({ ...none, events: [{ type: 'capture', seat: 0, pieceOwner: 2 }] })).toBe(
      'capture',
    )
    expect(feedbackFor({ ...none, events: [{ type: 'move_made', seat: 2 }] })).toBe('move')
    // Watching: only the moments that concern everyone.
    expect(feedbackFor({ ...none, mySeat: -1, events: [takesMine] })).toBeNull()
    expect(feedbackFor({ ...none, mySeat: -1, ended: true })).toBe('gameEnd')
  })
})
