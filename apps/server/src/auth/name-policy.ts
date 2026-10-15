/**
 * Pluggable username policy (PLAN §3 "Moderation"). v1 checks length and charset only;
 * the profanity filter and reserved/impersonation names plug in here before release.
 */
export type NameCheck = { ok: true } | { ok: false; reason: string }

export interface NamePolicy {
  readonly minLength: number
  readonly maxLength: number
  /** Human-readable rule, shown next to the username field. */
  readonly description: string
  check(username: string): NameCheck
  /**
   * Lobby names (shown in the public lobby browser). Same moderation hook as usernames;
   * returns the normalized name on success.
   */
  checkLobbyName(name: string): { ok: true; name: string } | { ok: false; reason: string }
}

/** Lobby names: letters (any script), digits, spaces and common punctuation. */
const LOBBY_CHARSET = /^[\p{L}\p{N} _.,!?'&()+:#-]+$/u
export const LOBBY_NAME_MIN = 3
export const LOBBY_NAME_MAX = 40

const CHARSET = /^[A-Za-z0-9_]+$/

/**
 * v1: 3–20 characters, letters, digits and underscores. Hyphens, spaces and "#" are
 * excluded, so no registered name can look like "Guest-4821" or "Deleted player #7".
 */
export const lengthCharsetPolicy: NamePolicy = {
  minLength: 3,
  maxLength: 20,
  description: '3–20 characters: letters, numbers and underscores',
  check(username) {
    if (username.length < this.minLength) {
      return { ok: false, reason: `Usernames need at least ${this.minLength} characters.` }
    }
    if (username.length > this.maxLength) {
      return { ok: false, reason: `Usernames can have at most ${this.maxLength} characters.` }
    }
    if (!CHARSET.test(username)) {
      return { ok: false, reason: 'Use only letters, numbers and underscores.' }
    }
    return { ok: true }
  },
  checkLobbyName(raw) {
    const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
    if (name.length < LOBBY_NAME_MIN || name.length > LOBBY_NAME_MAX) {
      return {
        ok: false,
        reason: `Lobby names need ${LOBBY_NAME_MIN}–${LOBBY_NAME_MAX} characters.`,
      }
    }
    if (!LOBBY_CHARSET.test(name)) {
      return { ok: false, reason: 'Use letters, numbers, spaces and simple punctuation.' }
    }
    return { ok: true, name }
  },
}

/**
 * Placeholder display name for an account created through OAuth until the player picks a
 * username, e.g. "Player-4821". The provider's name (often a real full name) is never used.
 */
export function generatePlayerName(random: () => number = Math.random): string {
  return `Player-${String(Math.floor(random() * 9000) + 1000)}`
}

/** Generated guest display name, e.g. "Guest-4821". Not unique; guests have no username. */
export function generateGuestName(random: () => number = Math.random): string {
  return `Guest-${String(Math.floor(random() * 9000) + 1000)}`
}
