/**
 * Where the mobile apps keep their session (bearer) token. The apps can't use the session
 * cookie (the WebView origin is cross-site to the API), so they send
 * `Authorization: Bearer <token>` instead (docs/MOBILE.md §2).
 *
 * The store is pluggable: today a localStorage stub; the app shell will install a
 * Keychain/Keystore-backed store (`setTokenStore`) before the first request. The token is
 * cached in memory, so reads are synchronous for the fetch helpers.
 */

export interface TokenStore {
  get(): string | null
  set(token: string): void
  clear(): void
}

const KEY = 'auth:bearer'

/** Stub store for development builds of the apps (to be replaced by secure storage). */
export const localStorageTokenStore: TokenStore = {
  get() {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  },
  set(token) {
    try {
      localStorage.setItem(KEY, token)
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(KEY)
    } catch {}
  },
}

let store: TokenStore = localStorageTokenStore
let cached: string | null | undefined

/** Installs another store (the app shell's secure storage). */
export function setTokenStore(next: TokenStore): void {
  store = next
  cached = undefined
}

/** The saved bearer token, or null. */
export function bearerToken(): string | null {
  if (cached === undefined) cached = store.get() || null
  return cached
}

/** Saves a token from the device flow (`access_token`). */
export function saveBearerToken(token: string): void {
  cached = token
  store.set(token)
}

/** Forgets the token (sign-out, account deletion, or the server no longer accepts it). */
export function clearBearerToken(): void {
  cached = null
  store.clear()
}
