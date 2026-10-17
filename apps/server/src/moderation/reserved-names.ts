import { type Database, type Executor, reservedNames } from '@game/db'
import { and, eq, gt, sql } from 'drizzle-orm'

/**
 * How long a username reset by a moderator (the `rename` action) stays unavailable to
 * everyone, the renamed player included (Privacy Policy).
 */
export const RESET_NAME_HOLD_DAYS = 365

const DAY_MS = 24 * 60 * 60_000

/** Holds `username` (case-insensitive) for `days`; a longer existing hold is kept. */
export async function holdName(
  tx: Executor,
  username: string,
  { now = new Date(), days = RESET_NAME_HOLD_DAYS } = {},
): Promise<void> {
  const until = new Date(now.getTime() + days * DAY_MS)
  await tx
    .insert(reservedNames)
    .values({ name: username.toLowerCase(), reservedUntil: until })
    .onConflictDoUpdate({
      target: reservedNames.name,
      set: {
        reservedUntil: sql`greatest(${reservedNames.reservedUntil}, excluded.reserved_until)`,
      },
    })
}

/** Whether `username` (case-insensitive) is held after a moderator reset. */
export async function isNameHeld(db: Database, username: string, now = new Date()) {
  const [row] = await db
    .select({ name: reservedNames.name })
    .from(reservedNames)
    .where(
      and(eq(reservedNames.name, username.toLowerCase()), gt(reservedNames.reservedUntil, now)),
    )
    .limit(1)
  return Boolean(row)
}
