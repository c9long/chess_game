import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const friendshipStatus = pgEnum('friendship_status', ['pending', 'accepted'])

/**
 * Friends and friend requests (PLAN §3 "Friends"), one row per pair of registered users,
 * stored in canonical order (`user_a < user_b`) so a pair can only have one row. `pending`
 * rows are requests from `requested_by` to the other user; `accepted` rows are friendships.
 * Declined, cancelled and removed rows are deleted (nothing is kept).
 *
 * Personal data: on account deletion the user's rows are deleted, never re-keyed (anonymize.ts).
 */
export const friendships = pgTable(
  'friendships',
  {
    userA: text('user_a')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    userB: text('user_b')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: friendshipStatus('status').notNull().default('pending'),
    /** Who sent the request (user_a or user_b). */
    requestedBy: text('requested_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    acceptedAt: ts('accepted_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userA, t.userB] }),
    index('friendships_user_b_idx').on(t.userB),
    // Byte order (as JavaScript compares strings), whatever the database's default collation.
    check('friendships_ordered_pair', sql`${t.userA} < ${t.userB} collate "C"`),
    check(
      'friendships_requester_in_pair',
      sql`${t.requestedBy} = ${t.userA} or ${t.requestedBy} = ${t.userB}`,
    ),
    check(
      'friendships_accepted_at',
      sql`(${t.status} = 'accepted') = (${t.acceptedAt} is not null)`,
    ),
  ],
)
