import { randomInt, randomUUID } from 'node:crypto'
import {
  type Database,
  deletionLog,
  eloRatings,
  legalAcceptances,
  matchPlayers,
  ratings,
  reports,
  type Transaction,
  users,
  verifications,
} from '@game/db'
import { and, eq, exists, isNull, or, sql } from 'drizzle-orm'
import { repointUserRows } from '../auth/guest-link.ts'
import { deleteAllOf as deleteFriendships } from '../social/friends.ts'

export type DeletionReason = 'user_request' | 'guest_purge'

export interface AnonymizeResult {
  /** Placeholder name the deleted account's past games now show. */
  label: string
}

/**
 * "Deleted player #<random>". The number is random, not the deletion_log sequence, so the
 * label can't be joined back to the deletion log (and from there to the original id).
 */
export const deletedLabel = () => `Deleted player #${randomInt(100_000, 1_000_000)}`

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/** Whether the user still has match history or ratings (rows other players rely on). */
async function hasSharedHistory(tx: Transaction, userId: string) {
  const [row] = await tx
    .select({ one: sql`1` })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        or(
          exists(tx.select().from(matchPlayers).where(eq(matchPlayers.userId, userId))),
          exists(tx.select().from(ratings).where(eq(ratings.userId, userId))),
          exists(tx.select().from(eloRatings).where(eq(eloRatings.userId, userId))),
          exists(
            tx
              .select()
              .from(reports)
              .where(or(eq(reports.reporterId, userId), eq(reports.reportedUserId, userId))),
          ),
        ),
      ),
    )
  return Boolean(row)
}

/**
 * The deletion itself (PLAN §5), inside the caller's transaction:
 * - `rekey`: match_players, ratings, elo_ratings and legal_acceptances move to a fresh
 *   placeholder user
 *   with a random id, which is never written to deletion_log or logs; IP hashes on the
 *   acceptances are cleared. Opponents' histories stay intact under "Deleted player #…".
 * - `erase`: the user's acceptances and ratings (OpenSkill and Elo) are deleted outright
 *   (guests with no games).
 * In both modes the user's friendships, friend requests and blocks are deleted (personal, not
 * shared history). Reports filed by or about the user are re-keyed with the shared history
 * (moderation records), and the reported name is cleared on reports about the user.
 * Then the original users row is deleted, which cascades to sessions, credentials, passkeys,
 * 2FA secrets and device codes.
 */
async function removeUser(
  tx: Transaction,
  userId: string,
  mode: 'rekey' | 'erase',
  now: Date,
): Promise<string | undefined> {
  let label: string | undefined
  // Friends and friend requests are personal: deleted, never re-keyed to the placeholder.
  // Blocks go with the users row (ON DELETE CASCADE).
  await deleteFriendships(tx, userId)
  // Reports stay (re-keyed below) for the review queue, without the name they were about.
  await tx.update(reports).set({ reportedName: null }).where(eq(reports.reportedUserId, userId))
  if (mode === 'rekey') {
    label = deletedLabel()
    const placeholderId = randomUUID()
    // Day-granular timestamps so the placeholder can't be matched to the deletion_log row
    // by its exact time.
    const day = startOfUtcDay(now)
    await tx.insert(users).values({
      id: placeholderId,
      name: label,
      displayUsername: label,
      username: null,
      email: `${placeholderId}@deleted.invalid`,
      emailVerified: false,
      isAnonymous: false,
      createdAt: day,
      updatedAt: day,
      deletedAt: day,
    })
    await repointUserRows(tx, userId, placeholderId)
    await tx
      .update(legalAcceptances)
      .set({ ipHash: null })
      .where(eq(legalAcceptances.userId, placeholderId))
  } else {
    await tx.delete(legalAcceptances).where(eq(legalAcceptances.userId, userId))
    await tx.delete(ratings).where(eq(ratings.userId, userId))
    await tx.delete(eloRatings).where(eq(eloRatings.userId, userId))
  }
  // Password-reset and similar tokens store the user id as their value.
  await tx.delete(verifications).where(eq(verifications.value, userId))
  await tx.delete(users).where(eq(users.id, userId))
  return label
}

/**
 * Deletes an account in one transaction: logs the original id in deletion_log (for
 * re-applying after a backup restore), re-keys its shared history to a fresh random id, and
 * deletes the account row with every credential, session, passkey and 2FA secret.
 */
export async function anonymizeUser(
  db: Database,
  userId: string,
  reason: DeletionReason,
  now: Date = new Date(),
): Promise<AnonymizeResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .for('update')
    if (!user) throw new Error('user not found')
    await tx.insert(deletionLog).values({ userId, reason, deletedAt: now })
    const label = (await removeUser(tx, userId, 'rekey', now)) as string
    return { label }
  })
}

/** Deletes a guest that has no games (nightly purge), logging it for restores. */
export async function eraseGuest(db: Database, userId: string, now: Date = new Date()) {
  await db.transaction(async (tx) => {
    await tx.insert(deletionLog).values({ userId, reason: 'guest_purge', deletedAt: now })
    if (await hasSharedHistory(tx, userId)) await removeUser(tx, userId, 'rekey', now)
    else await removeUser(tx, userId, 'erase', now)
  })
}

/**
 * Re-applies deletion_log after a backup restore (PLAN §8): every logged account that a
 * restore brought back is deleted again the same way, without a new log row. Returns the ids
 * that were removed again.
 */
export async function reapplyDeletionLog(db: Database, now: Date = new Date()): Promise<string[]> {
  const restored = await db
    .selectDistinct({ id: users.id, reason: deletionLog.reason })
    .from(users)
    .innerJoin(deletionLog, eq(deletionLog.userId, users.id))
  const reasons = new Map<string, Set<string>>()
  for (const r of restored) reasons.set(r.id, (reasons.get(r.id) ?? new Set()).add(r.reason))
  for (const [id, why] of reasons) {
    await db.transaction(async (tx) => {
      // Accounts deleted on request keep re-keyed acceptance records; purged guests without
      // games are erased, as they were originally.
      const rekey = why.has('user_request') || (await hasSharedHistory(tx, id))
      await removeUser(tx, id, rekey ? 'rekey' : 'erase', now)
    })
  }
  return [...reasons.keys()]
}
