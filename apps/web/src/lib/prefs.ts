import { create } from 'zustand'

/** Per-browser board preferences (remembered in localStorage when available). */
export interface BoardPrefs {
  sound: boolean
  /** Short vibrations on moves, captures, check, your turn and game end (where supported). */
  vibration: boolean
  colorblindPatterns: boolean
  reducedMotion: boolean
  /**
   * What the board's screen-reader announcements read: every move ('all'), or only your own
   * moves, moves that take your pieces, checks and results ('own').
   */
  announceMoves: 'all' | 'own'
}

/** Allowed values of the non-boolean preferences (anything else falls back to the default). */
const CHOICES: { [K in keyof BoardPrefs]?: readonly BoardPrefs[K][] } = {
  announceMoves: ['all', 'own'],
}

const KEY = 'board:prefs'

function load(): BoardPrefs {
  const defaults: BoardPrefs = {
    sound: true,
    vibration: true,
    colorblindPatterns: false,
    reducedMotion:
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    announceMoves: 'all',
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Record<string, unknown>
    // Known keys only: settings that no longer exist (e.g. the old attacked-leader glow,
    // replaced by the check indicator) are dropped.
    const prefs: Record<string, unknown> = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof BoardPrefs)[]) {
      const value = saved[key]
      const choices = CHOICES[key] as readonly unknown[] | undefined
      if (choices ? choices.includes(value) : typeof value === typeof defaults[key]) {
        prefs[key] = value
      }
    }
    return prefs as unknown as BoardPrefs
  } catch {
    return defaults
  }
}

interface PrefsStore extends BoardPrefs {
  set: (patch: Partial<BoardPrefs>) => void
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch)
    const { set: _omit, ...prefs } = { ...get(), ...patch }
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {}
  },
}))
