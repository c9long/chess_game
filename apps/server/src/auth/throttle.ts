import { type Database, type Executor, signInThrottle, users } from '@game/db'
import { eq, sql } from 'drizzle-orm'

/**
 * Per-account password throttle (in addition to Better Auth's per-IP limiter): after
 * MAX_FAILURES wrong passwords within WINDOW_MS, password sign-in to that account is locked
 * for LOCK_MS. Passkeys and password reset keep working, and a successful reset clears it.
 */
export const THROTTLE = {
  maxFailures: 10,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
} as const

/**
 * Throttle key for a sign-in attempt: the account id when the identifier matches one (so
 * email and username attempts share one budget), else the normalized identifier.
 */
export async function throttleKey(
  db: Executor,
  path: string,
  body: unknown,
): Promise<string | undefined> {
  const b = (body ?? {}) as { email?: unknown; username?: unknown }
  if (path === '/sign-in/email' && typeof b.email === 'string') {
    const email = b.email.trim().toLowerCase()
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    return u ? `u:${u.id}` : `e:${email}`
  }
  if (path === '/sign-in/username' && typeof b.username === 'string') {
    const username = b.username.trim().toLowerCase()
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, username))
    return u ? `u:${u.id}` : `n:${username}`
  }
  return undefined
}

/** Seconds until the lock ends, or 0 when not locked. */
export async function lockedForSeconds(db: Executor, key: string, now = new Date()) {
  const [row] = await db
    .select({ lockedUntil: signInThrottle.lockedUntil })
    .from(signInThrottle)
    .where(eq(signInThrottle.key, key))
  const until = row?.lockedUntil?.getTime() ?? 0
  return until > now.getTime() ? Math.ceil((until - now.getTime()) / 1000) : 0
}

/**
 * Counts one failed attempt. `lockedNow` is true only for the failure that started a lock
 * (row updates are atomic, so exactly one concurrent request sees the threshold reached).
 */
export async function recordFailure(
  db: Executor,
  key: string,
  now = new Date(),
): Promise<{ lockedNow: boolean; lockedUntil: Date | null }> {
  const t = (d: Date) => sql`${d.toISOString()}::timestamptz`
  const windowStart = t(new Date(now.getTime() - THROTTLE.windowMs))
  const stale = sql`${signInThrottle.windowStartedAt} < ${windowStart}`
  const [row] = await db
    .insert(signInThrottle)
    .values({ key, failures: 1, windowStartedAt: now, lockedUntil: null })
    .onConflictDoUpdate({
      target: signInThrottle.key,
      set: {
        failures: sql`case when ${stale} then 1 else ${signInThrottle.failures} + 1 end`,
        windowStartedAt: sql`case when ${stale} then ${t(now)} else ${signInThrottle.windowStartedAt} end`,
        lockedUntil: sql`case
          when not (${stale}) and ${signInThrottle.failures} + 1 >= ${THROTTLE.maxFailures}::int
            then ${t(new Date(now.getTime() + THROTTLE.lockMs))}
          else ${signInThrottle.lockedUntil} end`,
      },
    })
    .returning({ failures: signInThrottle.failures, lockedUntil: signInThrottle.lockedUntil })
  return {
    lockedNow: row?.failures === THROTTLE.maxFailures,
    lockedUntil: row?.lockedUntil ?? null,
  }
}

/**
 * Counts an attempt *before* it is checked, for checks made in-process (step-up), where a
 * burst of parallel requests would otherwise all pass a read-then-count gate. The row is
 * locked for the read-modify-write, so at most MAX_FAILURES attempts per window are allowed
 * through; a refused attempt doesn't extend the lock. The caller clears the row on success.
 */
export async function takeAttempt(
  db: Database,
  key: string,
  now = new Date(),
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  return db.transaction(async (tx) => {
    await tx
      .insert(signInThrottle)
      .values({ key, failures: 0, windowStartedAt: now, lockedUntil: null })
      .onConflictDoNothing()
    const [row] = await tx
      .select()
      .from(signInThrottle)
      .where(eq(signInThrottle.key, key))
      .for('update')
    if (!row) return { allowed: true }
    const until = row.lockedUntil?.getTime() ?? 0
    if (until > now.getTime()) {
      return { allowed: false, retryAfter: Math.ceil((until - now.getTime()) / 1000) }
    }
    const stale = row.windowStartedAt.getTime() < now.getTime() - THROTTLE.windowMs
    const failures = stale ? 1 : row.failures + 1
    await tx
      .update(signInThrottle)
      .set({
        failures,
        windowStartedAt: stale ? now : row.windowStartedAt,
        lockedUntil:
          failures >= THROTTLE.maxFailures ? new Date(now.getTime() + THROTTLE.lockMs) : null,
      })
      .where(eq(signInThrottle.key, key))
    return { allowed: true }
  })
}

export async function clearFailures(db: Executor, key: string) {
  await db.delete(signInThrottle).where(eq(signInThrottle.key, key))
}
