import { randomInt } from 'node:crypto'
import { passkey } from '@better-auth/passkey'
import { APP_NAME, LEGAL_VERSIONS, type LegalDocument } from '@game/config'
import {
  accounts,
  type Database,
  deviceCodes,
  passkeys,
  rateLimits,
  sessions,
  twoFactors,
  users,
  verifications,
} from '@game/db'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import {
  anonymous,
  bearer,
  captcha,
  deviceAuthorization,
  twoFactor,
  username,
} from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { type AppConfig, allowedOrigins } from '../config.ts'
import type { EmailSender } from '../email/sender.ts'
import {
  accountExistsEmail,
  resetPasswordEmail,
  signInLockedEmail,
  verificationEmail,
} from '../email/templates.ts'
import { hashIp } from '../http/client-ip.ts'
import { recordAcceptances } from '../legal/acceptances.ts'
import { LEGAL_PENDING_COOKIE, pendingCoversCurrent, readGate } from '../legal/gate.ts'
import { type Logger, scrubMessage } from '../logger.ts'
import { isNameHeld } from '../moderation/reserved-names.ts'
import {
  GUEST_INTENT_COOKIE,
  GUEST_INTENT_MAX_AGE_S,
  mergeGuestInto,
  readStamped,
  recordPendingGuestLink,
  SIGNUP_BROWSER_COOKIE,
  SIGNUP_BROWSER_MAX_AGE_S,
  signStamped,
  takePendingGuestLink,
} from './guest-link.ts'
import { NAME_UNAVAILABLE } from './name-filter.ts'
import { generateGuestName, generatePlayerName, type NamePolicy } from './name-policy.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { claimSecurityNotice } from './security-notice.ts'
import {
  clearFailures,
  lockedForSeconds,
  recordFailure,
  THROTTLE,
  throttleKey,
} from './throttle.ts'

export const AUTH_BASE_PATH = '/api/auth'

/** Paths that require a Turnstile token in the `x-captcha-response` header. */
export const CAPTCHA_ENDPOINTS = [
  '/sign-up/email',
  '/sign-in/email',
  '/sign-in/username',
  '/sign-in/anonymous',
  '/sign-in/social',
  '/request-password-reset',
  '/send-verification-email',
]

/**
 * Client ids allowed to start a device-authorization (user code) sign-in: the desktop (Unity)
 * client and the mobile apps (docs/MOBILE.md §2).
 */
export const DEVICE_CLIENT_IDS = ['game-unity-client', 'game-mobile-client']

/** Paths checked early (before password hashing) for the age screen and clickwrap. */
const CLICKWRAP_PATHS = new Set(['/sign-up/email', '/sign-in/anonymous'])

/** Password sign-in paths covered by the per-account throttle. */
const PASSWORD_PATHS = new Set(['/sign-in/email', '/sign-in/username'])

/**
 * Sensitive actions (deleting the account, adding a passkey, changing two-step on a
 * passwordless account) need a session created within this window, or a step-up. Same as
 * Better Auth's default `session.freshAge` (1 day), which guards passkey registration.
 */
export const FRESH_SESSION_MS = 24 * 60 * 60 * 1000

/** Whether `session` was created within FRESH_SESSION_MS. */
export function isFreshSession(session: { createdAt: Date | string }): boolean {
  return Date.now() - new Date(session.createdAt).getTime() <= FRESH_SESSION_MS
}

/**
 * Two-step management endpoints. With `allowPasswordless`, Better Auth guards them with a
 * session only; an account without a password must use a fresh session instead, or a stale
 * session could read the TOTP secret or mint backup codes and then use them as the step-up
 * for deleting the account (and enrolling swaps the stale session for a brand-new one).
 */
const TWO_FACTOR_MANAGE_PATHS = new Set([
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/get-totp-uri',
  '/two-factor/generate-backup-codes',
])

/**
 * Interactive sign-ins after which a guest's history moves into the signed-in account, when
 * the guest asked for it (signed guest_upgrade cookie). 2FA steps are included because the
 * session is created there, not at the password step.
 */
const LINK_PATH =
  /^\/(sign-in\/(email|username)|callback\/|passkey\/verify-authentication|two-factor\/verify-|verify-email)/

const ageRequired = (status: 'FORBIDDEN' | 'BAD_REQUEST') =>
  APIError.from(status, {
    code: 'AGE_CONFIRMATION_REQUIRED',
    message: 'Please confirm your date of birth first.',
  })

const legalRequired = (status: 'FORBIDDEN' | 'BAD_REQUEST') =>
  APIError.from(status, {
    code: 'LEGAL_ACCEPTANCE_REQUIRED',
    message: 'Please accept the Terms of Service and Privacy Policy first.',
  })

const badRequest = (code: string, message: string) =>
  APIError.from('BAD_REQUEST', { code, message })

/**
 * Moderation (profanity, reserved names) answers with its own neutral code and message, before
 * the username plugin's generic "invalid username"; format problems are left to the plugin.
 */
function refuseUnavailableName(namePolicy: NamePolicy, name: string) {
  const verdict = namePolicy.check(name)
  if (!verdict.ok && verdict.code === 'USERNAME_UNAVAILABLE') {
    throw badRequest('USERNAME_UNAVAILABLE', verdict.reason)
  }
}

/** A username a moderator reset is held for a while (moderation/reserved-names.ts). */
async function refuseHeldName(db: Database, name: string) {
  if (await isNameHeld(db, name)) throw badRequest('USERNAME_UNAVAILABLE', NAME_UNAVAILABLE)
}

/** The name passes the policy's format rules (length, charset), moderation aside. */
function formatOk(namePolicy: NamePolicy, name: string) {
  const verdict = namePolicy.check(name)
  return verdict.ok || verdict.code === 'USERNAME_UNAVAILABLE'
}

export interface AuthDeps {
  config: AppConfig
  db: Database
  email: EmailSender
  logger: Logger
  namePolicy: NamePolicy
  /** Told after a session row is deleted (sign-out, revoke, password reset): realtime
   * channels opened with that session close. */
  onSessionDeleted?: (sessionId: string) => void
}

function headerOf(
  ctx: { headers?: Headers | undefined; request?: Request | undefined } | null,
  name: string,
) {
  return ctx?.headers?.get(name) ?? ctx?.request?.headers.get(name) ?? null
}

/** Email claim of a verification token the endpoint has already verified. */
function emailFromVerifiedToken(token: unknown): string | undefined {
  if (typeof token !== 'string') return undefined
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined
  } catch {
    return undefined
  }
}

/** Backup codes: unambiguous upper-case alphabet (no I/L/O/U/0/1), XXXXX-XXXXX. */
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
/** How many backup codes a set has (enabling two-step, or creating new codes). */
export const BACKUP_CODE_COUNT = 10
export function generateBackupCodes(amount = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: amount }, () => {
    let s = ''
    for (let i = 0; i < 10; i++) s += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]
    return `${s.slice(0, 5)}-${s.slice(5)}`
  })
}

/** Typed backup code → stored form: trims, drops spaces, upper-cases, restores the hyphen. */
export function normalizeBackupCode(code: string): string {
  const compact = code.replace(/[\s-]/g, '').toUpperCase()
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : code.trim()
}

/**
 * Marks `session` as the request's current session for the hooks that run after ours. The
 * anonymous plugin's after-hook looks up "the current session"; without this it would look
 * up the request's old guest cookie, find that guest gone (merged), and append a cookie
 * deletion that wipes out the session cookie just issued.
 */
function settle(ctx: { context: { session: unknown } }, session: unknown) {
  ctx.context.session = session
}

function socialProviders(config: AppConfig): BetterAuthOptions['socialProviders'] {
  const p: NonNullable<BetterAuthOptions['socialProviders']> = {}
  const { google, discord, github, microsoft } = config.oauth
  if (google) p.google = { ...google }
  if (discord) p.discord = { ...discord }
  if (github) p.github = { ...github }
  if (microsoft) p.microsoft = { ...microsoft, tenantId: config.microsoftTenantId }
  return p
}

export function createAuth({ config, db, email, logger, namePolicy, onSessionDeleted }: AuthDeps) {
  const log = logger.child({ component: 'better-auth' })
  const send = (message: Parameters<EmailSender['send']>[0]) => {
    // Not awaited (avoids leaking account existence through timing); failures are logged.
    email.send(message).catch((err: unknown) => {
      log.error({ kind: message.kind, err: (err as Error).message }, 'email delivery failed')
    })
  }
  /**
   * The per-account throttle just locked password sign-in: tell the owner, at most once an
   * hour. Run detached from the request so the response time is the same whether or not an
   * email goes out (the requester can't learn anything about the account from it).
   */
  const notifyLocked = async (userId: string, lockedUntil: Date) => {
    const [u] = await db
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        isAnonymous: users.isAnonymous,
        deletedAt: users.deletedAt,
        twoFactorEnabled: users.twoFactorEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
    // Only a verified address: an unverified one may belong to someone else.
    if (!u?.emailVerified || u.isAnonymous || u.deletedAt) return
    if (!(await claimSecurityNotice(db, userId, 'sign-in-locked'))) return
    send(
      signInLockedEmail(u.email, {
        unlocksAt: lockedUntil,
        lockMinutes: Math.round(THROTTLE.lockMs / 60_000),
        twoFactorEnabled: Boolean(u.twoFactorEnabled),
        resetLink: `${config.webOrigin}/forgot-password`,
        securityLink: `${config.webOrigin}/account#two-step`,
      }),
    )
    log.info({ event: 'sign_in_locked_notice' }, 'sign-in lock notice sent')
  }
  const cookieAttrs = (maxAge: number) => ({
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  })

  return betterAuth({
    appName: APP_NAME,
    baseURL: config.apiPublicUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
    // The mobile app WebViews (NATIVE_ORIGINS) are trusted next to the web origin.
    trustedOrigins: allowedOrigins(config),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        passkey: passkeys,
        twoFactor: twoFactors,
        deviceCode: deviceCodes,
        rateLimit: rateLimits,
      },
    }),
    telemetry: { enabled: false },
    logger: {
      level: config.logLevel === 'debug' || config.logLevel === 'trace' ? 'debug' : 'warn',
      log(level, message, ...args) {
        // Library messages can carry request details; only the scrubbed text is logged. The
        // failure itself goes as `err` (type, message and stack only, scrubbed by the logger).
        const err = args.find((a) => a instanceof Error)
        log[level === 'debug' ? 'debug' : level](err ? { err } : {}, scrubMessage(message))
      },
    },
    user: {
      additionalFields: {
        ageConfirmed: { type: 'boolean', input: false, required: false, defaultValue: false },
        ageBand: { type: 'string', input: false, required: false },
        ageConfirmedAt: { type: 'date', input: false, required: false },
        deletedAt: { type: 'date', input: false, required: false },
      },
    },
    // Reset-password, 2FA-challenge and similar tokens are stored only as SHA-256 hashes.
    verification: { storeIdentifier: 'hashed' },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      accountLinking: { enabled: true, allowDifferentEmails: true },
      // OAuth access/refresh tokens are encrypted at rest with the auth secret.
      encryptOAuthTokens: true,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
      async sendResetPassword({ user, token }) {
        const link = `${config.webOrigin}/reset-password?token=${encodeURIComponent(token)}`
        send(resetPasswordEmail(user.email, link))
      },
      async onPasswordReset({ user }) {
        await clearFailures(db, `u:${user.id}`)
      },
      // Sign-up with an address that already has an account: the requester gets the usual
      // "check your email" response; the owner gets a heads-up with sign-in/reset links.
      async onExistingUserSignUp({ user }) {
        const u = user as typeof user & { isAnonymous?: boolean | null; deletedAt?: Date | null }
        if (u.isAnonymous || u.deletedAt) return
        send(
          accountExistsEmail(
            user.email,
            `${config.webOrigin}/sign-in`,
            `${config.webOrigin}/forgot-password`,
          ),
        )
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in with the right password to an unverified account sends a fresh link.
      sendOnSignIn: true,
      // Never sign in whoever opens a verification link (login CSRF): the after-hook below
      // signs in only the browser that submitted the signup form.
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60 * 24,
      async sendVerificationEmail({ user, token }) {
        const link = `${config.webOrigin}/verify-email?token=${encodeURIComponent(token)}`
        send(verificationEmail(user.email, link))
      },
      // Guest upgrade: the guest bound to this account at signup moves in now, whichever
      // browser or device opens the link.
      async afterEmailVerification(user) {
        const guestId = await takePendingGuestLink(db, user.id)
        if (guestId && (await mergeGuestInto(db, guestId, user.id))) {
          log.info({ event: 'guest_upgraded', via: 'signup' }, 'guest rows moved to new account')
        }
      },
    },
    socialProviders: socialProviders(config),
    rateLimit: {
      enabled: config.rateLimitEnabled,
      storage: 'database',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/anonymous': { window: 60, max: 5 },
        '/get-session': false,
      },
    },
    disabledPaths: ['/delete-anonymous-user', '/delete-user'],
    advanced: {
      // Explicit so test runs exercise the real origin/CSRF checks (Better Auth skips them
      // under NODE_ENV=test by default).
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: config.isProduction },
      ipAddress: {
        ipAddressHeaders: config.trustCloudflare ? ['cf-connecting-ip'] : ['x-forwarded-for'],
      },
    },
    hooks: {
      // User hooks run before plugin hooks (captcha, username, ...).
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>

        // Age screen + clickwrap, checked before any work (password hashing, user lookup).
        if (CLICKWRAP_PATHS.has(ctx.path)) {
          const gate = readGate(config, headerOf(ctx, 'cookie'))
          if (gate.blocked || !gate.ageOk) throw ageRequired('FORBIDDEN')
          if (!pendingCoversCurrent(gate.pending)) throw legalRequired('FORBIDDEN')
        }

        // Name policy: the shown name is always the username (case may differ), never a
        // free-form `name`, so nobody can pose as "Guest-4821" or "Deleted player #7".
        if (ctx.path === '/sign-up/email') {
          const name = body.username
          if (typeof name !== 'string' || !name) {
            throw badRequest('USERNAME_REQUIRED', 'Choose a username.')
          }
          const shown = body.displayUsername ?? name
          if (typeof shown !== 'string' || shown.toLowerCase() !== name.toLowerCase()) {
            throw badRequest(
              'INVALID_DISPLAY_USERNAME',
              'The display name must match the username.',
            )
          }
          refuseUnavailableName(namePolicy, name)
          // The shown spelling too: whole words are found from its case ("BigWord").
          refuseUnavailableName(namePolicy, shown)
          await refuseHeldName(db, name)
          return { context: { body: { ...body, name: shown, displayUsername: shown } } }
        }

        if (ctx.path === '/update-user') {
          const current = await getSessionFromCtx(ctx, { disableRefresh: true })
          if (!current) return // the endpoint answers 401
          if ('name' in body) {
            throw badRequest('NAME_CHANGE_NOT_ALLOWED', 'Your display name is your username.')
          }
          if ('image' in body && body.image !== null) {
            throw badRequest('IMAGE_NOT_SUPPORTED', 'Profile pictures are not supported.')
          }
          const u = current.user as typeof current.user & { username?: string | null }
          let name = u.username ?? undefined
          if ('username' in body) {
            // A username is chosen once (accounts created through OAuth start without one);
            // guests never get one. Changing it is a moderation-policy decision (TODO.md).
            if (u.isAnonymous || u.username) {
              throw badRequest('USERNAME_CHANGE_NOT_ALLOWED', 'Usernames cannot be changed.')
            }
            if (typeof body.username !== 'string') throw badRequest('INVALID_USERNAME', 'Invalid.')
            name = body.username
            refuseUnavailableName(namePolicy, name)
            await refuseHeldName(db, name)
          }
          if ('displayUsername' in body) {
            const shown = body.displayUsername
            if (!name || typeof shown !== 'string' || shown.toLowerCase() !== name.toLowerCase()) {
              throw badRequest(
                'INVALID_DISPLAY_USERNAME',
                'The display name must match the username.',
              )
            }
            refuseUnavailableName(namePolicy, shown)
          }
          if ('username' in body && name) {
            const shown = (body.displayUsername as string | undefined) ?? name
            return { context: { body: { ...body, name: shown, displayUsername: shown } } }
          }
          return
        }

        // A device session counts as freshly signed in (native apps use the device flow as the
        // step-up for deleting the account), so only a fresh session may approve one: a stale
        // session must not mint a fresh one.
        if (ctx.path === '/device/approve') {
          const current = await getSessionFromCtx(ctx, { disableRefresh: true })
          if (current && !isFreshSession(current.session)) {
            throw APIError.from('FORBIDDEN', {
              code: 'SESSION_NOT_FRESH',
              message: 'For your security, sign in again before approving a device.',
            })
          }
        }

        if (TWO_FACTOR_MANAGE_PATHS.has(ctx.path)) {
          const current = await getSessionFromCtx(ctx, { disableRefresh: true })
          if (!current) return // the endpoint answers 401
          if (!isFreshSession(current.session)) {
            const [credential] = await db
              .select({ id: accounts.id })
              .from(accounts)
              .where(
                and(eq(accounts.userId, current.user.id), eq(accounts.providerId, 'credential')),
              )
              .limit(1)
            if (!credential) {
              throw APIError.from('FORBIDDEN', {
                code: 'SESSION_NOT_FRESH',
                message: 'For your security, sign in again before changing two-step verification.',
              })
            }
          }
        }

        if (ctx.path === '/two-factor/verify-backup-code' && typeof body.code === 'string') {
          return { context: { body: { ...body, code: normalizeBackupCode(body.code) } } }
        }

        if (PASSWORD_PATHS.has(ctx.path)) {
          const key = await throttleKey(db, ctx.path, body)
          const wait = key ? await lockedForSeconds(db, key) : 0
          if (wait > 0) {
            throw new APIError(
              'TOO_MANY_REQUESTS',
              {
                code: 'ACCOUNT_LOCKED',
                message:
                  'Too many wrong passwords for this account. Try again later, or reset your password.',
                retryAfter: wait,
              },
              { 'X-Retry-After': String(wait) },
            )
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const cookie = headerOf(ctx, 'cookie')
        const returned = ctx.context.returned

        if (PASSWORD_PATHS.has(ctx.path)) {
          const key = await throttleKey(db, ctx.path, ctx.body)
          if (key) {
            if (isAPIError(returned) && returned.statusCode === 401) {
              const { lockedNow, lockedUntil } = await recordFailure(db, key)
              if (lockedNow && lockedUntil && key.startsWith('u:')) {
                notifyLocked(key.slice(2), lockedUntil).catch((err: unknown) => {
                  log.error({ err: (err as Error).message }, 'sign-in lock notice failed')
                })
              }
            } else if (!isAPIError(returned)) await clearFailures(db, key)
          }
        }

        // Email verified in the browser that signed up: sign it in. Anyone else who opens
        // the link (another device, or someone it was sent to) just gets a verified address.
        if (ctx.path === '/verify-email' && !isAPIError(returned)) {
          const userId = readStamped(
            config,
            'signup-browser',
            cookie,
            SIGNUP_BROWSER_COOKIE,
            SIGNUP_BROWSER_MAX_AGE_S,
          )
          const tokenEmail = emailFromVerifiedToken(ctx.query?.token)
          const user = userId ? await ctx.context.internalAdapter.findUserById(userId) : null
          if (user?.emailVerified && tokenEmail && user.email === tokenEmail) {
            const session = await ctx.context.internalAdapter.createSession(user.id)
            if (session) {
              await setSessionCookie(ctx, { session, user })
              settle(ctx, { session, user })
            }
            ctx.setCookie(SIGNUP_BROWSER_COOKIE, '', cookieAttrs(0))
          }
        }

        // Guest upgrade by sign-in: only when the guest explicitly asked for it.
        const newSession = ctx.context.newSession
        if (LINK_PATH.test(ctx.path) && newSession && !newSession.user.isAnonymous) {
          const guestId = readStamped(
            config,
            'guest-intent',
            cookie,
            GUEST_INTENT_COOKIE,
            GUEST_INTENT_MAX_AGE_S,
          )
          if (guestId) {
            if (await mergeGuestInto(db, guestId, newSession.user.id)) {
              log.info({ event: 'guest_upgraded', via: 'sign-in' }, 'guest rows moved to account')
              settle(ctx, newSession)
            }
            ctx.setCookie(GUEST_INTENT_COOKIE, '', cookieAttrs(0))
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(user, ctx) {
            if (!ctx) return // server-side creation (scripts, tests)
            // Every creation path with a request (email signup, guest, OAuth callback, future
            // Steam) needs the age screen and the clickwrap first. 400, not 403: sign-up
            // turns a 403 here into its generic anti-enumeration success response.
            const gate = readGate(config, headerOf(ctx, 'cookie'))
            if (gate.blocked || !gate.ageOk) throw ageRequired('BAD_REQUEST')
            if (!pendingCoversCurrent(gate.pending)) throw legalRequired('BAD_REQUEST')
            const data = {
              ...user,
              ageConfirmed: true,
              ageBand: gate.ageOk.band,
              ageConfirmedAt: new Date(gate.ageOk.at),
            }
            if (!CLICKWRAP_PATHS.has(ctx.path)) {
              // OAuth: never show the provider's (often real, full) name or photo; the web
              // asks the player to choose a username next.
              data.name = generatePlayerName()
              data.image = null
            }
            return { data }
          },
          async after(user, ctx) {
            if (!ctx) return
            const gate = readGate(config, headerOf(ctx, 'cookie'))
            if (gate.pending && pendingCoversCurrent(gate.pending)) {
              const ip = config.trustCloudflare
                ? headerOf(ctx, 'cf-connecting-ip')
                : headerOf(ctx, 'x-forwarded-for')
              await recordAcceptances(
                db,
                user.id,
                (Object.keys(LEGAL_VERSIONS) as LegalDocument[]).map((document) => ({
                  document,
                  version: LEGAL_VERSIONS[document],
                })),
                // Server time of account creation (the signed cookie time is only used to
                // check that the acceptance is recent).
                new Date(),
                hashIp(ip ?? undefined, config.ipHashSecret),
              )
              ctx.setCookie(LEGAL_PENDING_COOKIE, '', cookieAttrs(0))
            }
            if (ctx.path === '/sign-up/email') {
              // A signed-in guest signing up is upgrading: bind the guest to the new account
              // now, while the request is authenticated as that guest.
              const current = await getSessionFromCtx(ctx, { disableRefresh: true }).catch(
                () => null,
              )
              if (current?.user.isAnonymous) {
                await recordPendingGuestLink(db, current.user.id, user.id)
              }
              ctx.setCookie(
                SIGNUP_BROWSER_COOKIE,
                signStamped(config, 'signup-browser', user.id),
                cookieAttrs(SIGNUP_BROWSER_MAX_AGE_S),
              )
            }
          },
        },
      },
      session: {
        create: {
          async before(session) {
            const [row] = await db
              .select({ deletedAt: users.deletedAt, suspendedAt: users.suspendedAt })
              .from(users)
              .where(eq(users.id, session.userId))
            if (row?.deletedAt) return false
            // Moderation: a suspended account can't sign in by any method (password, passkey,
            // OAuth, 2FA, device code) until an admin lifts the suspension.
            if (row?.suspendedAt) {
              throw APIError.from('FORBIDDEN', {
                code: 'ACCOUNT_SUSPENDED',
                message: 'This account has been suspended.',
              })
            }
          },
        },
        delete: {
          async after(session) {
            onSessionDeleted?.(session.id)
          },
        },
      },
    },
    plugins: [
      username({
        minUsernameLength: namePolicy.minLength,
        maxUsernameLength: namePolicy.maxLength,
        // Format only: moderation refuses new names in the before-hook (sign-up, choosing a
        // username), but must never lock an existing account out of username sign-in, which
        // runs this validator too.
        usernameValidator: (name) => formatOk(namePolicy, name),
        displayUsernameValidator: (name) => formatOk(namePolicy, name),
      }),
      anonymous({
        emailDomainName: 'guest.invalid',
        generateName: () => generateGuestName(),
        // Guests are merged (and then deleted) only by mergeGuestInto, on an explicit
        // upgrade: never because a sign-in or a verification link happened in their browser.
        disableDeleteAnonymousUser: true,
      }),
      twoFactor({
        issuer: APP_NAME,
        allowPasswordless: true,
        backupCodeOptions: { customBackupCodesGenerate: () => generateBackupCodes() },
      }),
      passkey({ rpID: config.passkeyRpId, rpName: APP_NAME, origin: config.webOrigin }),
      // Lets native clients authenticate with `Authorization: Bearer` using the token from
      // the device flow. The `set-auth-token` response header is stripped in app.ts so page
      // scripts never see a session token.
      bearer(),
      deviceAuthorization({
        verificationUri: `${config.webOrigin}/device`,
        expiresIn: '10m',
        validateClient: (clientId) => DEVICE_CLIENT_IDS.includes(clientId),
      }),
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: config.turnstile.secretKey,
        endpoints: CAPTCHA_ENDPOINTS,
        ...(config.turnstile.siteVerifyUrl
          ? { siteVerifyURLOverride: config.turnstile.siteVerifyUrl }
          : {}),
        // Tokens must have been solved on our web origin.
        ...(config.isProduction ? { allowedHostnames: [new URL(config.webOrigin).hostname] } : {}),
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
