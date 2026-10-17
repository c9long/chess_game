/**
 * Where a match seat's Colyseus reconnection token is kept, so the player can rejoin within
 * the server's reconnect grace (60 s) after a reload, or after a phone OS killed the app in
 * the background (docs/MOBILE.md phase 1 #6).
 *
 * sessionStorage covers a reload of the same tab; it dies with the tab or WebView, so the
 * token is also kept in localStorage (with the time it was saved; old entries are pruned).
 * Every storage access is guarded: private modes can throw, and then rejoining just isn't
 * possible after a reload.
 */

const PREFIX = 'match:reconnect:'
/** A seat can't outlive this without a fresh token (rejoins save a new one). */
export const SAVED_TOKEN_MAX_AGE_MS = 6 * 60 * 60_000

const key = (roomId: string) => `${PREFIX}${roomId}`

interface Saved {
  token: string
  savedAt: number
}

function local(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function session(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/** Parses a localStorage entry; null when malformed or older than the max age. */
export function parseSaved(raw: string | null, now: number): string | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<Saved>
    if (typeof v.token !== 'string' || !v.token || typeof v.savedAt !== 'number') return null
    if (now - v.savedAt > SAVED_TOKEN_MAX_AGE_MS || v.savedAt > now + 60_000) return null
    return v.token
  } catch {
    return null
  }
}

/** Drops every saved token that is too old (or unreadable), except `keep`. */
function prune(store: Storage, now: number, keep: string): void {
  const stale: string[] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (!k?.startsWith(PREFIX) || k === keep) continue
    if (parseSaved(store.getItem(k), now) === null) stale.push(k)
  }
  for (const k of stale) store.removeItem(k)
}

export function saveReconnectToken(roomId: string, token: string, now = Date.now()): void {
  try {
    session()?.setItem(key(roomId), token)
  } catch {}
  try {
    const store = local()
    if (!store) return
    store.setItem(key(roomId), JSON.stringify({ token, savedAt: now } satisfies Saved))
    prune(store, now, key(roomId))
  } catch {}
}

/** The saved token for a room: this tab's first, else the longer-lived copy. */
export function loadReconnectToken(roomId: string, now = Date.now()): string | null {
  try {
    const t = session()?.getItem(key(roomId))
    if (t) return t
  } catch {}
  try {
    return parseSaved(local()?.getItem(key(roomId)) ?? null, now)
  } catch {
    return null
  }
}

/**
 * Forgets a room's token. `scope: 'persistent'` keeps this tab's copy (a finished game).
 * With `onlyToken`, each copy goes only while it still holds that token: another tab (or the
 * app after a relaunch) may have taken the seat over and saved its own, or a newer connection
 * in this tab may have saved a fresh one while an older attempt was failing.
 */
export function clearReconnectToken(
  roomId: string,
  scope: 'all' | 'persistent' = 'all',
  onlyToken?: string,
): void {
  if (scope === 'all') {
    try {
      const store = session()
      const saved = store?.getItem(key(roomId))
      if (onlyToken === undefined || !saved || saved === onlyToken) store?.removeItem(key(roomId))
    } catch {}
  }
  try {
    const store = local()
    if (!store) return
    if (onlyToken !== undefined) {
      const saved = parseSaved(store.getItem(key(roomId)), Date.now())
      if (saved !== null && saved !== onlyToken) return
    }
    store.removeItem(key(roomId))
  } catch {}
}

/** Forgets every saved match token, in both storages (sign-out, account deletion). */
export function clearAllReconnectTokens(): void {
  for (const store of [session(), local()]) {
    try {
      if (!store) continue
      const keys: string[] = []
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)
        if (k?.startsWith(PREFIX)) keys.push(k)
      }
      for (const k of keys) store.removeItem(k)
    } catch {}
  }
}
