import {
  type Database,
  type Executor,
  legalAcceptances,
  matchPlayers,
  pendingGuestLinks,
  ratings,
  users,
} from '@game/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { AppConfig } from '../config.ts'
import { parseCookieHeader, signValue, verifyValue } from '../legal/signed-cookie.ts'

/**
 * Moves every user-keyed row from one user id to another (guest upgrade, deletion
 * re-keying, future Steam merge). Runs on the caller's executor so it joins the caller's
 * transaction. Game tables reference users ON DELETE RESTRICT, so if this ever misses a
 * table the following user deletion fails instead of losing history.
 * Add future user-keyed tables (progression, unlocks, ...) here.
 */
export async function repointUserRows(tx: Executor, fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) return
  await tx
    .update(legalAcceptances)
    .set({ userId: toUserId })
    .where(eq(legalAcceptances.userId, fromUserId))
  await tx.update(matchPlayers).set({ userId: toUserId }).where(eq(matchPlayers.userId, fromUserId))
  // A rating bucket the target already has wins; the source's duplicate is dropped.
  await tx.execute(sql`
    delete from ${ratings} g using ${ratings} t
    where g.user_id = ${fromUserId} and t.user_id = ${toUserId}
      and g.mode = t.mode and g.time_control = t.time_control and g.kind = t.kind`)
  await tx.update(ratings).set({ userId: toUserId }).where(eq(ratings.userId, fromUserId))
}

/**
 * Guest upgrade (PLAN §5): moves the guest's rows to `userId` and deletes the guest (its
 * sessions cascade), in one transaction. Returns false, changing nothing, when the guest no
 * longer exists, isn't a guest, or is the same user.
 */
export async function mergeGuestInto(
  db: Database,
  guestId: string,
  userId: string,
): Promise<boolean> {
  if (guestId === userId) return false
  return db.transaction(async (tx) => {
    const [guest] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, guestId), eq(users.isAnonymous, true), isNull(users.deletedAt)))
      .for('update')
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isAnonymous, false), isNull(users.deletedAt)))
    if (!guest || !target) return false
    await repointUserRows(tx, guestId, userId)
    await tx.delete(users).where(eq(users.id, guestId))
    return true
  })
}

/** Records that the signed-in guest `guestId` created (unverified) account `newUserId`. */
export async function recordPendingGuestLink(db: Executor, guestId: string, newUserId: string) {
  await db
    .insert(pendingGuestLinks)
    .values({ guestId, newUserId })
    .onConflictDoUpdate({ target: pendingGuestLinks.newUserId, set: { guestId } })
}

/** Removes and returns the guest bound to `newUserId` at signup, if any. */
export async function takePendingGuestLink(db: Executor, newUserId: string) {
  const [row] = await db
    .delete(pendingGuestLinks)
    .where(eq(pendingGuestLinks.newUserId, newUserId))
    .returning({ guestId: pendingGuestLinks.guestId })
  return row?.guestId
}

/* Short-lived signed cookies used by the linking flow. */

/** Set by POST /api/account/guest-upgrade-intent: "move this guest into my next sign-in". */
export const GUEST_INTENT_COOKIE = 'guest_upgrade'
export const GUEST_INTENT_MAX_AGE_S = 30 * 60
/** Set on the signup response: only this browser is signed in when the email is verified. */
export const SIGNUP_BROWSER_COOKIE = 'signup_browser'
export const SIGNUP_BROWSER_MAX_AGE_S = 24 * 60 * 60

interface Stamped {
  id: string
  at: string
}

const secret = (config: AppConfig, purpose: string) => `${config.authSecret}:${purpose}`

export function signStamped(config: AppConfig, purpose: string, id: string, now = new Date()) {
  return signValue({ id, at: now.toISOString() } satisfies Stamped, secret(config, purpose))
}

/** Reads a signed {id, at} cookie, enforcing its lifetime from the signed timestamp. */
export function readStamped(
  config: AppConfig,
  purpose: string,
  cookieHeader: string | null | undefined,
  name: string,
  maxAgeS: number,
  now = new Date(),
): string | undefined {
  const v = verifyValue<Stamped>(parseCookieHeader(cookieHeader)[name], secret(config, purpose))
  if (!v || typeof v.id !== 'string' || typeof v.at !== 'string') return undefined
  const t = Date.parse(v.at)
  if (Number.isNaN(t) || t > now.getTime() + 5 * 60_000 || now.getTime() - t > maxAgeS * 1000) {
    return undefined
  }
  return v.id
}
