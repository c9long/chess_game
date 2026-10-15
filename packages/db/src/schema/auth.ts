/**
 * Identity tables managed by Better Auth. Property names are the field names Better Auth
 * expects (camelCase, mapped by the Drizzle adapter); column names are snake_case.
 * Regenerate the field list with `getAuthTables()` from `better-auth/db` when plugins change.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/** Age bands from the neutral age screen (PLAN §5/§8). The birth date itself is never stored. */
export const AGE_BANDS = ['13-15', '16-17', '18+'] as const
export type AgeBand = (typeof AGE_BANDS)[number]
export const ageBand = pgEnum('age_band', AGE_BANDS)

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    /** username plugin: normalized (lowercase) unique username. Null for guests. */
    username: text('username').unique(),
    /** username plugin: username as the player typed it. */
    displayUsername: text('display_username'),
    /** anonymous plugin's `isAnonymous` field, stored as is_guest. */
    isAnonymous: boolean('is_guest').notNull().default(false),
    /** twoFactor plugin. */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /** Neutral age screen result: only "confirmed 13+", the age band and when; never the birth date. */
    ageConfirmed: boolean('age_confirmed').notNull().default(false),
    ageBand: ageBand('age_band'),
    ageConfirmedAt: ts('age_confirmed_at'),
    /** Set on the placeholder row that holds a deleted account's re-keyed history. */
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('users_guest_updated_idx').on(t.updatedAt).where(sql`${t.isAnonymous}`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    /** argon2id PHC string for the "credential" provider. */
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const passkeys = pgTable(
  'passkeys',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: ts('created_at'),
    aaguid: text('aaguid'),
  },
  (t) => [
    index('passkeys_user_id_idx').on(t.userId),
    index('passkeys_credential_id_idx').on(t.credentialID),
  ],
)

export const twoFactors = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    /** TOTP secret, encrypted at rest by Better Auth. */
    secret: text('secret').notNull(),
    /** Backup codes, encrypted at rest by Better Auth. */
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
  },
  (t) => [
    index('two_factor_secret_idx').on(t.secret),
    index('two_factor_user_id_idx').on(t.userId),
  ],
)

/** Device authorization grant (Unity / CLI sign-in with a user code). */
export const deviceCodes = pgTable('device_codes', {
  id: text('id').primaryKey(),
  deviceCode: text('device_code').notNull().unique(),
  userCode: text('user_code').notNull().unique(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  status: text('status').notNull(),
  lastPolledAt: ts('last_polled_at'),
  pollingInterval: integer('polling_interval'),
  clientId: text('client_id'),
  scope: text('scope'),
})

/** Better Auth rate limiter (database storage), keyed by `<ip>|<path>`. */
export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

/**
 * Guest → account binding recorded when a signed-in guest submits the signup form. When the
 * new account's email is verified (in any browser) the guest's rows move to it. Only the
 * guest's own authenticated signup request can create a row, so a verification link sent to
 * someone else can never pull that person's guest history into another account.
 */
export const pendingGuestLinks = pgTable(
  'pending_guest_links',
  {
    newUserId: text('new_user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    guestId: text('guest_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('pending_guest_links_guest_idx').on(t.guestId)],
)

/**
 * Per-account failed password sign-in counter (in addition to the per-IP limiter), keyed by
 * user id, or by the normalized identifier when no account matches.
 */
export const signInThrottle = pgTable('sign_in_throttle', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  windowStartedAt: ts('window_started_at').notNull().defaultNow(),
  lockedUntil: ts('locked_until'),
})
