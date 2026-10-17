/**
 * Moderation (PLAN §3 "Moderation"): blocks between players and reports for the review queue.
 * Suspensions are columns on `users` (suspended_at / suspended_by).
 */
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { matches } from './game.ts'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/**
 * `blocker` blocked `blocked` (registered accounts). One row per direction; blocking removes
 * any friendship or request between the two, and hides each from the other's friends features.
 *
 * Personal data: deleted with either account (cascade), included in the blocker's export.
 */
export const blocks = pgTable(
  'blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('blocks_blocked_idx').on(t.blockedId),
    check('blocks_not_self', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
)

export const REPORT_REASONS = ['offensive_username', 'harassment', 'cheating', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const reportReason = pgEnum('report_reason', REPORT_REASONS)

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export const reportStatus = pgEnum('report_status', REPORT_STATUSES)

/** What a moderator did when resolving a report. */
export const REPORT_ACTIONS = ['warn', 'rename', 'suspend'] as const
export type ReportAction = (typeof REPORT_ACTIONS)[number]
export const reportAction = pgEnum('report_action', REPORT_ACTIONS)

/**
 * A player's report about another player, for the admin review queue. The reporter's
 * identity is never shown to the reported player. `reported_name` is the name shown when the
 * report was made (a later rename doesn't hide what was reported).
 *
 * Retention: open reports are kept until reviewed; resolved and dismissed reports are
 * deleted one year after resolution (jobs/moderation-purge.ts). On account deletion the
 * rows are re-keyed with the rest of the account's shared history (repointUserRows), and
 * `reported_name` is cleared on reports about the deleted account.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reportedUserId: text('reported_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reportedName: text('reported_name'),
    matchId: uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
    reason: reportReason('reason').notNull(),
    /** Optional, at most 500 characters. */
    note: text('note'),
    status: reportStatus('status').notNull().default('open'),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** Admin user id (audit; plain text so it survives that admin's account deletion). */
    resolvedBy: text('resolved_by'),
    resolvedAt: ts('resolved_at'),
    /** Set when resolved (not when dismissed). */
    action: reportAction('action'),
  },
  (t) => [
    index('reports_status_created_idx').on(t.status, t.createdAt),
    index('reports_reported_idx').on(t.reportedUserId),
    index('reports_reporter_created_idx').on(t.reporterId, t.createdAt),
    // One open report per reporter, target and match (or no match).
    uniqueIndex('reports_one_open_idx')
      .on(t.reporterId, t.reportedUserId, sql`coalesce(${t.matchId}::text, '')`)
      .where(sql`${t.status} = 'open'`),
    check('reports_note_length', sql`char_length(${t.note}) <= 500`),
    check('reports_not_self', sql`${t.reporterId} <> ${t.reportedUserId}`),
    check('reports_resolution', sql`(${t.status} = 'open') = (${t.resolvedAt} is null)`),
    check('reports_action', sql`${t.action} is null or ${t.status} = 'resolved'`),
  ],
)
