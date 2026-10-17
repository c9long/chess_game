/**
 * Whether the neutral date-of-birth screen should show (PLAN §8), as a pure function so the
 * rules are unit-tested.
 *
 * - A signed-in account whose stored age confirmation is true is never asked (nor refused),
 *   whatever the cookies say: accounts are confirmed when they are created.
 * - A signed-in account that is not confirmed is asked once; the answer is stored on it.
 * - A signed-out visitor is asked before playing as a guest or creating an account, unless
 *   this browser already answered (the signed `age_ok` cookie, reported by /api/legal/status).
 * - The screen is never the result of not knowing: while the session or the legal status is
 *   loading, refetching or failing, the gate keeps the previous answer for the same visitor or
 *   shows a loading state, and only says the server is unreachable after repeated failures.
 */

export type AgeGateState =
  /** Not known yet: show a spinner, never the DOB screen. */
  | 'loading'
  /** Let the page through. */
  | 'ok'
  /** Show the neutral DOB screen. */
  | 'ask'
  /** This browser gave an under-13 answer recently: neutral refusal. */
  | 'blocked'
  /** Nothing known and the server keeps failing (requests are still retried). */
  | 'unreachable'

/** After this many failed attempts in a row with nothing to show, say the server is down. */
export const UNREACHABLE_AFTER_FAILURES = 3

export interface AgeGateInput {
  /** The signed-in user as the client knows it, or null when signed out (or not known yet). */
  user: { id: string; ageConfirmed?: boolean | null } | null
  /**
   * True while the client can't tell whether anyone is signed in: the first session fetch, a
   * refetch while signed out, or a session fetch that failed for a reason other than "not
   * signed in" (server restarting, network down).
   */
  sessionUnsettled: boolean
  /** The latest legal status that arrived, if any. */
  legal: { ageConfirmed: boolean; blocked: boolean } | undefined
  /**
   * Whom `legal` describes: the user id it was requested for, null for a signed-out request,
   * undefined when there is no answer.
   */
  legalFor: string | null | undefined
  /** Failed legal-status attempts in a row for the current visitor. */
  failures: number
  /**
   * False on the sign-in and recovery pages: they don't need the DOB screen (existing accounts
   * were confirmed at creation), only the under-13 block.
   */
  requireAge: boolean
}

export function ageGateState(i: AgeGateInput): AgeGateState {
  if (i.user?.ageConfirmed) return 'ok'
  // Signed out, or not known yet: decide from an answer for a signed-out visitor, kept across
  // refetches; with none yet, wait.
  const key = i.user ? i.user.id : null
  if (!i.user && i.sessionUnsettled && i.legalFor !== null) return waiting(i)
  if (i.legalFor !== key || !i.legal) return waiting(i)
  if (i.legal.blocked) return 'blocked'
  if (!i.requireAge) return 'ok'
  return i.legal.ageConfirmed ? 'ok' : 'ask'
}

function waiting(i: AgeGateInput): AgeGateState {
  return i.failures >= UNREACHABLE_AFTER_FAILURES ? 'unreachable' : 'loading'
}

/** Retry delay after `failures` failed attempts: 1 s, 2 s, 4 s, then every 5 s. */
export function retryDelayMs(failures: number): number {
  return Math.min(5000, 1000 * 2 ** Math.max(0, failures - 1))
}

/**
 * Whether a session fetch error means "can't tell right now" rather than "signed out". Better
 * Auth clears the session itself on a 401; anything else (a 502 from the dev proxy while the
 * API restarts, a network error) leaves the answer unknown.
 */
export function isTransientSessionError(error: unknown): boolean {
  if (!error) return false
  const status = (error as { status?: unknown }).status
  return status !== 401 && status !== 403
}
