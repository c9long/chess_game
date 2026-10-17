import { accounts, type Database, passkeys } from '@game/db'
import { fromNodeHeaders } from 'better-auth/node'
import { and, eq } from 'drizzle-orm'
import type { Request } from 'express'
import type { Auth } from '../auth/auth.ts'
import { clearFailures, takeAttempt } from '../auth/throttle.ts'
import type { AppConfig } from '../config.ts'

/**
 * Step-up re-authentication for sensitive account actions (deleting the account) when the
 * session is older than the freshness window: the current password, a passkey assertion, or a
 * two-step code (TOTP or an unused backup code). Each method is checked by Better Auth; this
 * module only decides which ones an account has and that the proof is for the session's user.
 */
type PasskeyAssertion = NonNullable<
  Parameters<Auth['api']['verifyPasskeyAuthentication']>[0]
>['body']['response']

export type StepUpMethod = 'password' | 'passkey' | 'totp'

export interface StepUpProof {
  password?: string | undefined
  /** WebAuthn assertion (`AuthenticationResponseJSON`) for a challenge from
   * `GET /api/auth/passkey/generate-authenticate-options`. */
  passkey?: Record<string, unknown> | undefined
  /** 6-digit code from the authenticator app. */
  totpCode?: string | undefined
  /** One of the account's backup codes (used up by this). */
  backupCode?: string | undefined
}

export type StepUpResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string; retryAfter?: number }

/** Methods this account can step up with, in the order the web app offers them. */
export async function stepUpMethods(
  db: Database,
  user: { id: string; twoFactorEnabled?: boolean | null | undefined },
): Promise<StepUpMethod[]> {
  const [credential] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')))
    .limit(1)
  const [key] = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
    .limit(1)
  const methods: StepUpMethod[] = []
  if (credential) methods.push('password')
  if (key) methods.push('passkey')
  if (user.twoFactorEnabled) methods.push('totp')
  return methods
}

/** The proof's method, when it carries exactly one. */
function methodOf(proof: StepUpProof): StepUpMethod | 'backup' | 'none' | 'many' {
  const given = [
    proof.password ? 'password' : null,
    proof.passkey ? 'passkey' : null,
    proof.totpCode ? 'totp' : null,
    proof.backupCode ? 'backup' : null,
  ].filter((m): m is StepUpMethod | 'backup' => m !== null)
  if (given.length === 0) return 'none'
  if (given.length > 1) return 'many'
  return given[0] as StepUpMethod | 'backup'
}

const fail = (status: number, error: string, message: string): StepUpResult => ({
  ok: false,
  status,
  error,
  message,
})

/** Only the passkey challenge cookie: no session or guest-intent cookies reach the verifier. */
function challengeCookie(cookie: string | undefined): string {
  return (cookie ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => /^(__Secure-)?better-auth\.better-auth-passkey=/.test(c))
    .join('; ')
}

/**
 * Verifies a step-up proof for the session's user. Every attempt counts toward a per-account
 * budget (the password throttle's limits, under its own key) until one succeeds, since checks
 * made through the server API skip Better Auth's per-IP limiter (and, in-session, its 2FA
 * lockout).
 */
export async function verifyStepUp(deps: {
  auth: Auth
  db: Database
  config: AppConfig
  req: Request
  user: { id: string; twoFactorEnabled?: boolean | null | undefined }
  proof: StepUpProof
}): Promise<StepUpResult> {
  const { auth, db, config, req, user, proof } = deps
  const method = methodOf(proof)
  if (method === 'none') return fail(403, 'SESSION_NOT_FRESH', 'Confirm it’s you first.')
  if (method === 'many') return fail(400, 'ONE_METHOD', 'Confirm with one method at a time.')

  const methods = await stepUpMethods(db, user)
  const needed: StepUpMethod = method === 'backup' ? 'totp' : method
  if (!methods.includes(needed)) {
    return fail(400, 'METHOD_UNAVAILABLE', 'This account can’t confirm it that way.')
  }

  // Counted on arrival (not after a wrong answer), so a burst of parallel guesses can't all
  // be checked before the first failure is recorded. A success clears the count.
  const key = `stepup:${user.id}`
  const attempt = await takeAttempt(db, key)
  if (!attempt.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'STEP_UP_LOCKED',
      message: 'Too many failed attempts. Try again later.',
      retryAfter: attempt.retryAfter,
    }
  }

  const headers = fromNodeHeaders(req.headers)
  let ok = false
  let wrong: StepUpResult = fail(403, 'STEP_UP_FAILED', 'That didn’t work. Try again.')
  try {
    if (method === 'password') {
      wrong = fail(403, 'INVALID_PASSWORD', 'That password is incorrect.')
      await auth.api.verifyPassword({ body: { password: proof.password as string }, headers })
      ok = true
    } else if (method === 'totp') {
      wrong = fail(403, 'INVALID_CODE', 'That code didn’t work. Check your authenticator app.')
      await auth.api.verifyTOTP({
        body: { code: (proof.totpCode as string).replace(/\s/g, '') },
        headers,
      })
      ok = true
    } else if (method === 'backup') {
      wrong = fail(403, 'INVALID_BACKUP_CODE', 'That backup code didn’t work.')
      await auth.api.verifyBackupCode({
        body: { code: proof.backupCode as string, disableSession: true },
        headers,
      })
      ok = true
    } else {
      wrong = fail(403, 'PASSKEY_FAILED', 'That passkey couldn’t be verified. Try again.')
      // Better Auth's passkey sign-in check (challenge cookie, signature, counter). It opens a
      // session for the passkey's owner, which is closed again right away: only the proof is
      // wanted here, and it must be this account's passkey.
      const result = await auth.api.verifyPasskeyAuthentication({
        body: { response: proof.passkey as unknown as PasskeyAssertion },
        headers: new Headers({
          cookie: challengeCookie(req.headers.cookie),
          origin: config.webOrigin,
        }),
      })
      const ctx = await auth.$context
      await ctx.internalAdapter.deleteSession(result.session.token)
      if (result.user.id !== user.id) {
        wrong = fail(403, 'PASSKEY_MISMATCH', 'That passkey belongs to a different account.')
      } else ok = true
    }
  } catch {
    ok = false
  }
  if (!ok) return wrong
  await clearFailures(db, key)
  return { ok: true }
}
