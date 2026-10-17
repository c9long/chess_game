import { type Executor, securityNotices } from '@game/db'
import { sql } from 'drizzle-orm'

/** At most one email of a kind per account in this interval. */
export const SECURITY_NOTICE_INTERVAL_MS = 60 * 60_000

/**
 * Claims the right to send `kind` to `userId` now: true (and the time is recorded) when no
 * such email went out within the interval. Atomic, so concurrent triggers send one email.
 */
export async function claimSecurityNotice(
  db: Executor,
  userId: string,
  kind: string,
  now = new Date(),
  intervalMs = SECURITY_NOTICE_INTERVAL_MS,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - intervalMs).toISOString()
  const rows = await db
    .insert(securityNotices)
    .values({ userId, kind, sentAt: now })
    .onConflictDoUpdate({
      target: [securityNotices.userId, securityNotices.kind],
      set: { sentAt: now },
      setWhere: sql`${securityNotices.sentAt} <= ${cutoff}::timestamptz`,
    })
    .returning({ userId: securityNotices.userId })
  return rows.length > 0
}
