/**
 * Bearer-token mode for the mobile apps: on only when `isNative()` (a Capacitor shell, or a
 * VITE_NATIVE build). The web app in a browser keeps using the HttpOnly session cookie and
 * never reads or sends a token.
 */
import { isNative } from './platform.ts'
import { bearerToken, clearBearerToken } from './token-store.ts'

/** Whether requests authenticate with the stored bearer token instead of the cookie. */
export function bearerMode(): boolean {
  return isNative()
}

/** The token to send, or undefined (browser, or no token yet). */
export function activeBearerToken(): string | undefined {
  if (!bearerMode()) return undefined
  return bearerToken() ?? undefined
}

/**
 * `credentials` for requests to the API: the browser sends its session cookie; the apps send
 * none (they authenticate with the bearer token, and the server's CORS grant for the app
 * origins carries no credentials, so a cookie session can't be set or used there).
 */
export function fetchCredentials(): RequestCredentials {
  return bearerMode() ? 'omit' : 'include'
}

/** `Authorization` header for our own API calls, or {} when there is nothing to send. */
export function authHeaders(): Record<string, string> {
  const token = activeBearerToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

/**
 * Better Auth client `fetchOptions.auth` (bearer plugin form). The token is read on every
 * request, so a sign-in or sign-out takes effect without rebuilding the client.
 */
export function betterAuthBearer(): {
  auth?: { type: 'Bearer'; token: () => string | undefined }
} {
  if (!bearerMode()) return {}
  return { auth: { type: 'Bearer', token: () => activeBearerToken() } }
}

/** Wipes the token on sign-out or account deletion (no-op in the browser). */
export function endBearerSession(): void {
  if (bearerMode()) clearBearerToken()
}
