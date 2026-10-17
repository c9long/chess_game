import { type Database, reports } from '@game/db'
import { and, lt, ne } from 'drizzle-orm'

/** Resolved and dismissed reports are kept this long after resolution (Privacy Policy). */
export const REPORT_RETENTION_DAYS = 365

/**
 * Nightly (with the guest purge): deletes reports resolved or dismissed more than
 * `retentionDays` ago. Open reports stay until reviewed. Returns how many were deleted.
 */
export async function purgeOldReports(
  db: Database,
  { now = new Date(), retentionDays = REPORT_RETENTION_DAYS } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60_000)
  const rows = await db
    .delete(reports)
    .where(and(ne(reports.status, 'open'), lt(reports.resolvedAt, cutoff)))
    .returning({ id: reports.id })
  return rows.length
}
