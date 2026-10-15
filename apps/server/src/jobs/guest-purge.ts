import { type Database, matchPlayers, sessions, users } from '@game/db'
import { and, eq, exists, gte, isNull, lt, not } from 'drizzle-orm'
import { anonymizeUser, eraseGuest } from '../account/anonymize.ts'

export interface GuestPurgeResult {
  anonymized: string[]
  deleted: string[]
}

/**
 * Nightly job (PLAN §5): guests inactive for `inactiveDays` are de-identified like an
 * account deletion if they played matches (history re-keyed, opponents' records intact) and
 * deleted outright otherwise. Both are written to deletion_log so a restore re-applies them.
 */
export async function purgeInactiveGuests(
  db: Database,
  { now = new Date(), inactiveDays = 30 }: { now?: Date; inactiveDays?: number } = {},
): Promise<GuestPurgeResult> {
  const cutoff = new Date(now.getTime() - inactiveDays * 24 * 60 * 60 * 1000)
  const recentSession = db
    .select({ one: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, users.id), gte(sessions.updatedAt, cutoff)))
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isAnonymous, true),
        isNull(users.deletedAt),
        lt(users.updatedAt, cutoff),
        not(exists(recentSession)),
      ),
    )

  const result: GuestPurgeResult = { anonymized: [], deleted: [] }
  for (const { id } of candidates) {
    const [played] = await db
      .select({ one: matchPlayers.seat })
      .from(matchPlayers)
      .where(eq(matchPlayers.userId, id))
      .limit(1)
    if (played) {
      await anonymizeUser(db, id, 'guest_purge', now)
      result.anonymized.push(id)
    } else {
      await eraseGuest(db, id, now)
      result.deleted.push(id)
    }
  }
  return result
}
