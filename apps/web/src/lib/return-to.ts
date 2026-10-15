/**
 * Where to go after signing in: the page that sent the user to /sign-in (path + query), but
 * only same-origin relative paths, never "//evil.example" or "https://…" (open redirect).
 */
export function safeReturnTo(from: unknown, fallback = '/'): string {
  if (typeof from !== 'string' || !from.startsWith('/')) return fallback
  if (from.startsWith('//') || from.startsWith('/\\') || /[\r\n]/.test(from)) return fallback
  if (from.startsWith('/sign-in') || from.startsWith('/two-factor')) return fallback
  return from
}

/** Router state carrying the return path. */
export type ReturnState = { from?: string } | null
