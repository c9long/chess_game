import { checkLobbyNameFormat } from '@game/protocol'
import { isProfane, moderateUsername, NAME_UNAVAILABLE } from './name-filter.ts'

/**
 * Pluggable username policy (PLAN §3 "Moderation"): length and charset, then the profanity
 * filter and reserved/impersonation names (name-filter.ts).
 */
export type NameCheck =
  | { ok: true }
  | {
      ok: false
      reason: string
      /** `USERNAME_UNAVAILABLE`: refused by moderation (the reason is deliberately neutral). */
      code?: 'USERNAME_UNAVAILABLE'
    }

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
    // Format rule shared with the web form (@game/protocol); moderation (profanity, reserved
    // names) plugs in here later.
    return checkLobbyNameFormat(raw)
  },
}

/**
 * The default policy: `lengthCharsetPolicy`, plus moderation. Usernames that are profane or
 * reserved ("admin", "Moderator_1", "Guest4821", "Bot_1500", the app's name) get the neutral
 * NAME_UNAVAILABLE answer; lobby names are checked for profanity.
 */
export const defaultNamePolicy: NamePolicy = {
  minLength: lengthCharsetPolicy.minLength,
  maxLength: lengthCharsetPolicy.maxLength,
  description: lengthCharsetPolicy.description,
  check(username) {
    const format = lengthCharsetPolicy.check(username)
    if (!format.ok) return format
    if (!moderateUsername(username).ok) {
      return { ok: false, reason: NAME_UNAVAILABLE, code: 'USERNAME_UNAVAILABLE' }
    }
    return { ok: true }
  },
  checkLobbyName(raw) {
    const format = checkLobbyNameFormat(raw)
    if (!format.ok) return format
    if (isProfane(format.name)) {
      return { ok: false, reason: 'That lobby name isn’t allowed. Try another.' }
    }
    return format
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
