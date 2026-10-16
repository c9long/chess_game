import { create } from 'zustand'

/** Per-browser board preferences (remembered in localStorage when available). */
export interface BoardPrefs {
  sound: boolean
  showAttackedLeaderGlow: boolean
  colorblindPatterns: boolean
  reducedMotion: boolean
}

const KEY = 'board:prefs'

function load(): BoardPrefs {
  const defaults: BoardPrefs = {
    sound: true,
    // Open rules question (TODO.md): the glow's default. Off keeps players watchful.
    showAttackedLeaderGlow: false,
    colorblindPatterns: false,
    reducedMotion:
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  }
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<BoardPrefs>) } : defaults
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
