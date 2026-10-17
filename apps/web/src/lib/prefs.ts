import { create } from 'zustand'

/** Per-browser board preferences (remembered in localStorage when available). */
export interface BoardPrefs {
  sound: boolean
  /** Short vibrations on moves, captures, check, your turn and game end (where supported). */
  vibration: boolean
  colorblindPatterns: boolean
  reducedMotion: boolean
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
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Record<string, unknown>
    // Known keys only: settings that no longer exist (e.g. the old attacked-leader glow,
    // replaced by the check indicator) are dropped.
    const prefs = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof BoardPrefs)[]) {
      if (typeof saved[key] === 'boolean') prefs[key] = saved[key]
    }
    return prefs
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
