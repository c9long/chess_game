import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** Cloudflare's documented always-pass Turnstile test keys (dev/test only). */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA'

/** Local, gitignored file holding development emails. */
const DEFAULT_DEV_MAILBOX_FILE = fileURLToPath(new URL('../.dev-mailbox.json', import.meta.url))

const DEV_SECRET = 'dev-only-secret-do-not-use-in-production-0123456789'

const bool = z.enum(['true', 'false', '1', '0', '']).transform((v) => v === 'true' || v === '1')

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))

const url = z.url({ protocol: /^https?$/ })

const envSchema = z.object({
  /** Required: a missing NODE_ENV must never fall back to development secrets. */
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    error: 'NODE_ENV must be set explicitly to development, test or production',
  }),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: url.or(z.string().startsWith('postgres')),
  BETTER_AUTH_SECRET: optionalString,
  /** Public base URL of the API as the browser reaches it (dev: the Vite proxy). */
  API_PUBLIC_URL: url.optional(),
  /** The only origin allowed to call the API with credentials. */
  WEB_ORIGIN: url.optional(),
  /**
   * Extra origins of the mobile app shells (Capacitor WebViews), comma-separated, e.g.
   * `capacitor://localhost,https://localhost`. Empty (the default) changes nothing.
   */
  NATIVE_ORIGINS: z.string().default(''),
  PASSKEY_RP_ID: optionalString,
  TRUST_CLOUDFLARE: bool.default(false),
  RATE_LIMIT_ENABLED: bool.default(true),
  TURNSTILE_SITE_KEY: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
  TURNSTILE_SITEVERIFY_URL: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  IP_HASH_SECRET: optionalString,
  DEV_MAIL_ENDPOINT: bool.optional(),
  /** Development only: file that keeps dev emails across restarts ('' = memory only). */
  DEV_MAILBOX_FILE: z.string().optional(),
  GUEST_INACTIVE_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Abort matches left in_progress by a previous process at startup (default on). Off only for
   * a second test server sharing a database with a running one (E2E restart spec), where those
   * matches belong to the other server. Must stay on in production.
   */
  ABORT_ORPHANED_MATCHES: bool.default(true),
  GUEST_PURGE_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(24 * 60),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
  MICROSOFT_CLIENT_ID: optionalString,
  MICROSOFT_CLIENT_SECRET: optionalString,
  MICROSOFT_TENANT_ID: z.string().default('common'),
  /** bot-service base URL (e.g. http://127.0.0.1:7700). Unset: bots play quick local moves. */
  BOT_SERVICE_URL: z.preprocess((v) => (v === '' ? undefined : v), url.optional()),
  BOT_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
  /**
   * Bot pacing: a bot's move is applied no earlier than this long after the previous game
   * action (longer after a defeat), so clients can play each move's animation. 0 = off.
   */
  BOT_MIN_MOVE_MS: z.coerce.number().int().nonnegative().max(10_000).default(700),
  /** Reconnect grace for disconnected players, in game and in lobbies (PLAN §2: 60 s). */
  RECONNECT_GRACE_SECONDS: z.coerce.number().positive().default(60),
  /** Pre-game countdown after the host starts. */
  COUNTDOWN_MS: z.coerce.number().int().nonnegative().default(3_000),
  /** Graceful shutdown: how long running games may continue before they are aborted. */
  SHUTDOWN_DRAIN_MAX_SECONDS: z.coerce
    .number()
    .nonnegative()
    .default(45 * 60),
  /** How often queued match events are written to the database. */
  EVENT_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(250),
  /** Periodic clock resync broadcast during games. */
  CLOCK_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  /** Upper bound on concurrent lobby/game rooms. */
  MAX_MATCH_ROOMS: z.coerce.number().int().positive().default(500),
  /** Development/test only: replaces every time control's base time (ms). */
  DEV_CLOCK_BASE_MS: z.coerce.number().int().positive().optional(),
  /** User ids allowed to use the moderation review queue, comma-separated ('' = nobody). */
  ADMIN_USER_IDS: z.string().default(''),
})

export type OAuthProviderId = 'google' | 'discord' | 'github' | 'microsoft'

export interface OAuthCredentials {
  clientId: string
  clientSecret: string
}

export interface AppConfig {
  env: 'development' | 'test' | 'production'
  isProduction: boolean
  host: string
  port: number
  logLevel: string
  databaseUrl: string
  authSecret: string
  apiPublicUrl: string
  webOrigin: string
  /**
   * Mobile app WebView origins (NATIVE_ORIGINS), allowed next to `webOrigin` for CORS, Better
   * Auth's trusted origins and the WebSocket origin check. Empty by default.
   */
  nativeOrigins: string[]
  passkeyRpId: string
  trustCloudflare: boolean
  rateLimitEnabled: boolean
  turnstile: { siteKey: string; secretKey: string; siteVerifyUrl: string | undefined }
  email: { resendApiKey: string | undefined; from: string }
  ipHashSecret: string
  devMailEndpoint: boolean
  /** Development only: where the dev mailbox is saved, or undefined to keep it in memory. */
  devMailboxFile: string | undefined
  guestInactiveDays: number
  guestPurgeIntervalMinutes: number
  /** Abort matches a previous process left in_progress at startup (see ABORT_ORPHANED_MATCHES). */
  abortOrphanedMatches: boolean
  oauth: Partial<Record<OAuthProviderId, OAuthCredentials>>
  microsoftTenantId: string
  game: GameConfig
  /** Moderation admins (ADMIN_USER_IDS); empty = nobody can open the review queue. */
  adminUserIds: string[]
}

export interface GameConfig {
  botServiceUrl: string | undefined
  botRequestTimeoutMs: number
  /** Bot pacing (see BOT_MIN_MOVE_MS). */
  botMinMoveMs: number
  reconnectGraceMs: number
  countdownMs: number
  shutdownDrainMaxMs: number
  eventFlushIntervalMs: number
  clockSyncIntervalMs: number
  maxMatchRooms: number
  devClockBaseMs: number | undefined
}

export class ConfigError extends Error {}

function pair(id: string | undefined, secret: string | undefined): OAuthCredentials | undefined {
  return id && secret ? { clientId: id, clientSecret: secret } : undefined
}

/** Whether `rpId` equals `host` or is a parent domain of it (WebAuthn rpID rule). */
function isRegistrableSuffix(rpId: string, host: string): boolean {
  return host === rpId || host.endsWith(`.${rpId}`)
}

/**
 * Parses NATIVE_ORIGINS: a comma-separated list of bare origins (`scheme://host[:port]`, no
 * path, no wildcard). `new URL().origin` is "null" for custom schemes such as `capacitor:`, so
 * origins are compared as normalized strings. Plain http is for development live reload only.
 */
export function parseNativeOrigins(
  raw: string,
  isProduction: boolean,
): { origins: string[]; problems: string[] } {
  const origins: string[] = []
  const problems: string[] = []
  for (const entry of raw.split(',')) {
    const value = entry.trim()
    if (!value) continue
    const m = /^([a-z][a-z0-9+.-]*):\/\/([a-z0-9.-]+(?::\d{1,5})?)\/?$/i.exec(value)
    if (!m) {
      problems.push(
        `NATIVE_ORIGINS entry "${value}" must be a bare origin like capacitor://localhost`,
      )
      continue
    }
    const scheme = (m[1] as string).toLowerCase()
    // Browsers leave the scheme's default port out of Origin, so drop it here too (an entry
    // with `:443` would otherwise never match).
    const defaultPort = scheme === 'https' ? ':443' : scheme === 'http' ? ':80' : undefined
    let authority = (m[2] as string).toLowerCase()
    if (defaultPort && authority.endsWith(defaultPort)) {
      authority = authority.slice(0, -defaultPort.length)
    }
    const origin = `${scheme}://${authority}`
    if (isProduction && origin.startsWith('http://')) {
      problems.push(`NATIVE_ORIGINS entry "${value}" must not use plain http in production`)
      continue
    }
    if (!origins.includes(origin)) origins.push(origin)
  }
  return { origins, problems }
}

/** Every origin a browser or app WebView may call the API from: the web app, then the apps. */
export function allowedOrigins(config: Pick<AppConfig, 'webOrigin' | 'nativeOrigins'>): string[] {
  return [config.webOrigin, ...config.nativeOrigins]
}

/** Parses and validates configuration from environment variables. Throws ConfigError. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new ConfigError(`invalid configuration:\n  ${issues.join('\n  ')}`)
  }
  const e = parsed.data
  const isProduction = e.NODE_ENV === 'production'
  const problems: string[] = []
  const DEV_ORIGIN = 'http://localhost:5173'
  const native = parseNativeOrigins(e.NATIVE_ORIGINS, isProduction)
  problems.push(...native.problems)

  const authSecret = e.BETTER_AUTH_SECRET ?? (isProduction ? undefined : DEV_SECRET)
  if (!authSecret || authSecret.length < 32) {
    problems.push('BETTER_AUTH_SECRET must be set to at least 32 characters')
  }
  if (isProduction && authSecret === DEV_SECRET) {
    problems.push('BETTER_AUTH_SECRET must not be the development default')
  }
  const turnstileSecret =
    e.TURNSTILE_SECRET_KEY ?? (isProduction ? undefined : TURNSTILE_TEST_SECRET_KEY)
  const turnstileSite = e.TURNSTILE_SITE_KEY ?? (isProduction ? undefined : TURNSTILE_TEST_SITE_KEY)
  if (!turnstileSecret || !turnstileSite) {
    problems.push('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required in production')
  }
  if (isProduction && turnstileSecret === TURNSTILE_TEST_SECRET_KEY) {
    problems.push('TURNSTILE_SECRET_KEY must not be the always-pass test key in production')
  }
  if (isProduction && !e.RESEND_API_KEY) {
    problems.push('RESEND_API_KEY is required in production')
  }
  if (isProduction && !e.ABORT_ORPHANED_MATCHES) {
    problems.push('ABORT_ORPHANED_MATCHES cannot be disabled in production')
  }
  if (isProduction && e.DEV_MAIL_ENDPOINT) {
    problems.push('DEV_MAIL_ENDPOINT cannot be enabled in production')
  }
  // Production fails closed: every security-relevant setting must be explicit and safe.
  if (isProduction) {
    for (const [name, value] of [
      ['API_PUBLIC_URL', e.API_PUBLIC_URL],
      ['WEB_ORIGIN', e.WEB_ORIGIN],
    ] as const) {
      if (!value) problems.push(`${name} is required in production`)
      else if (!value.startsWith('https://')) problems.push(`${name} must be an https URL`)
    }
    if (!e.PASSKEY_RP_ID) problems.push('PASSKEY_RP_ID is required in production')
    else if (
      e.WEB_ORIGIN &&
      !isRegistrableSuffix(e.PASSKEY_RP_ID, new URL(e.WEB_ORIGIN).hostname)
    ) {
      problems.push('PASSKEY_RP_ID must be the WEB_ORIGIN host or a parent domain of it')
    }
    if (e.TURNSTILE_SITEVERIFY_URL) {
      problems.push('TURNSTILE_SITEVERIFY_URL cannot be overridden in production')
    }
    if (!e.RATE_LIMIT_ENABLED) problems.push('RATE_LIMIT_ENABLED cannot be false in production')
    if (!e.TRUST_CLOUDFLARE) {
      // Behind Caddy without Cloudflare trust every client shares the proxy's IP, so the
      // per-IP limits would become one site-wide bucket.
      problems.push('TRUST_CLOUDFLARE must be true in production (the API runs behind Cloudflare)')
    }
    if (!e.IP_HASH_SECRET || e.IP_HASH_SECRET.length < 32) {
      problems.push('IP_HASH_SECRET must be set to at least 32 characters in production')
    } else if (e.IP_HASH_SECRET === authSecret) {
      problems.push('IP_HASH_SECRET must differ from BETTER_AUTH_SECRET')
    }
    if (e.DEV_CLOCK_BASE_MS !== undefined) {
      problems.push('DEV_CLOCK_BASE_MS cannot be set in production')
    }
  }
  const adminUserIds = [
    ...new Set(
      e.ADMIN_USER_IDS.split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ]
  for (const id of adminUserIds) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      problems.push(`ADMIN_USER_IDS entry "${id}" is not a user id`)
    }
  }
  if (problems.length > 0 || !authSecret || !turnstileSecret || !turnstileSite) {
    throw new ConfigError(`invalid configuration:\n  ${problems.join('\n  ')}`)
  }

  const oauth: AppConfig['oauth'] = {}
  const providers: [OAuthProviderId, OAuthCredentials | undefined][] = [
    ['google', pair(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET)],
    ['discord', pair(e.DISCORD_CLIENT_ID, e.DISCORD_CLIENT_SECRET)],
    ['github', pair(e.GITHUB_CLIENT_ID, e.GITHUB_CLIENT_SECRET)],
    ['microsoft', pair(e.MICROSOFT_CLIENT_ID, e.MICROSOFT_CLIENT_SECRET)],
  ]
  for (const [id, creds] of providers) if (creds) oauth[id] = creds

  return {
    env: e.NODE_ENV,
    isProduction,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    authSecret,
    apiPublicUrl: (e.API_PUBLIC_URL ?? DEV_ORIGIN).replace(/\/$/, ''),
    webOrigin: new URL(e.WEB_ORIGIN ?? DEV_ORIGIN).origin,
    nativeOrigins: native.origins,
    passkeyRpId: e.PASSKEY_RP_ID ?? 'localhost',
    trustCloudflare: e.TRUST_CLOUDFLARE,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    turnstile: {
      siteKey: turnstileSite,
      secretKey: turnstileSecret,
      siteVerifyUrl: e.TURNSTILE_SITEVERIFY_URL,
    },
    email: {
      resendApiKey: e.RESEND_API_KEY,
      from: e.EMAIL_FROM ?? 'noreply@localhost',
    },
    // Development/test only: production requires a separate IP_HASH_SECRET (checked above).
    ipHashSecret: e.IP_HASH_SECRET ?? `${authSecret}:ip-hash`,
    devMailEndpoint:
      e.NODE_ENV === 'development' || e.NODE_ENV === 'test' ? (e.DEV_MAIL_ENDPOINT ?? true) : false,
    devMailboxFile:
      e.NODE_ENV === 'development'
        ? e.DEV_MAILBOX_FILE === undefined
          ? DEFAULT_DEV_MAILBOX_FILE
          : e.DEV_MAILBOX_FILE || undefined
        : undefined,
    guestInactiveDays: e.GUEST_INACTIVE_DAYS,
    guestPurgeIntervalMinutes: e.GUEST_PURGE_INTERVAL_MINUTES,
    abortOrphanedMatches: e.ABORT_ORPHANED_MATCHES,
    oauth,
    microsoftTenantId: e.MICROSOFT_TENANT_ID,
    game: {
      botServiceUrl: e.BOT_SERVICE_URL?.replace(/\/$/, ''),
      botRequestTimeoutMs: e.BOT_REQUEST_TIMEOUT_MS,
      botMinMoveMs: e.BOT_MIN_MOVE_MS,
      reconnectGraceMs: Math.round(e.RECONNECT_GRACE_SECONDS * 1000),
      countdownMs: e.COUNTDOWN_MS,
      shutdownDrainMaxMs: Math.round(e.SHUTDOWN_DRAIN_MAX_SECONDS * 1000),
      eventFlushIntervalMs: e.EVENT_FLUSH_INTERVAL_MS,
      clockSyncIntervalMs: e.CLOCK_SYNC_INTERVAL_MS,
      maxMatchRooms: e.MAX_MATCH_ROOMS,
      devClockBaseMs: isProduction ? undefined : e.DEV_CLOCK_BASE_MS,
    },
    adminUserIds,
  }
}
