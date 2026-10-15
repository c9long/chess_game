import { bigserial, index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

/** Terms are `accepted`; the Privacy Policy is `acknowledged` (PLAN §5). */
export const legalAcceptanceKind = pgEnum('legal_acceptance_kind', ['accepted', 'acknowledged'])

/** One row per accepted legal document version (clickwrap). */
export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** 'terms' | 'privacy' (see LEGAL_VERSIONS in @game/config). */
    document: text('document').notNull(),
    version: text('version').notNull(),
    kind: legalAcceptanceKind('kind').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Keyed HMAC of the client IP; cleared on account deletion. */
    ipHash: text('ip_hash'),
  },
  (t) => [index('legal_acceptances_user_idx').on(t.userId, t.document)],
)

/**
 * Append-only record of deleted accounts (user request or guest purge). Re-applied after any
 * backup restore so deleted accounts never come back. Deliberately has no foreign key, and it
 * never stores the random id the deleted account's history was re-keyed to.
 */
export const deletionLog = pgTable(
  'deletion_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
    /** 'user_request' | 'guest_purge'. */
    reason: text('reason').notNull().default('user_request'),
  },
  (t) => [index('deletion_log_user_idx').on(t.userId)],
)
