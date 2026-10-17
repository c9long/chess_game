/**
 * Blocking (PLAN §3 "Moderation"): registered accounts can block other registered accounts.
 * A block removes any friendship or friend request between the two, and while it lasts the
 * blocked player can't send the blocker friend requests or challenges (they get the same
 * answer as for any ineligible player, so the block isn't revealed). Presence goes to friends
 * only, so neither sees the other online. A block never removes anyone from a running game.
 */

import { blocks, type Database, type Executor, friendships, users } from '@game/db'
import { BLOCKS_MAX, type BlockedUser } from '@game/protocol'
import { and, count, desc, eq, inArray, or } from 'drizzle-orm'
import { lockPair, pairOf, SocialError, usernameOf } from './friends.ts'

/** Whether either of `a` and `b` blocked the other. */
export async function blockedEitherWay(db: Executor, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ one: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** Whether `blocker` blocked `blocked`. */
export async function hasBlocked(db: Executor, blocker: string, blocked: string) {
  const [row] = await db
    .select({ one: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, blocker), eq(blocks.blockedId, blocked)))
    .limit(1)
  return Boolean(row)
}

/** Which of `others` `me` blocked. */
export async function blockedAmong(db: Executor, me: string, others: string[]) {
  if (others.length === 0) return new Set<string>()
  const rows = await db
    .select({ id: blocks.blockedId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, me), inArray(blocks.blockedId, [...new Set(others)])))
  return new Set(rows.map((r) => r.id))
}

/**
 * Which of `others` blocked `me`. Their seats are shown to `me` like any ineligible seat (no
 * "Add friend" that would always fail), so the block isn't revealed.
 */
export async function blockedByAmong(db: Executor, me: string, others: string[]) {
  if (others.length === 0) return new Set<string>()
  const rows = await db
    .select({ id: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockedId, me), inArray(blocks.blockerId, [...new Set(others)])))
  return new Set(rows.map((r) => r.id))
}

/** Players `me` blocked, newest first. */
export async function blockedList(db: Executor, me: string): Promise<BlockedUser[]> {
  const rows = await db
    .select({
      userId: users.id,
      displayUsername: users.displayUsername,
      username: users.username,
      name: users.name,
      createdAt: blocks.createdAt,
    })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(eq(blocks.blockerId, me))
    .orderBy(desc(blocks.createdAt))
  return rows.map((r) => ({
    userId: r.userId,
    username: usernameOf(r),
    since: r.createdAt.toISOString(),
  }))
}

/**
 * `me` blocks `target` (both live registered accounts). Removes the pair's friendship or
 * pending request in the same transaction. Returns whether there was a friendship row
 * (`hadRow`), so the caller can tell the other side their list changed. Blocking twice is
 * fine (nothing changes).
 */
export async function block(
  db: Database,
  me: string,
  target: string,
  maxBlocks = BLOCKS_MAX,
): Promise<{ hadRow: boolean }> {
  if (me === target) throw new SocialError('SELF', 400, 'You can’t block yourself.')
  return db.transaction(async (tx) => {
    await lockPair(tx, me, target)
    if (await hasBlocked(tx, me, target)) return { hadRow: false }
    const [mine] = await tx.select({ n: count() }).from(blocks).where(eq(blocks.blockerId, me))
    if ((mine?.n ?? 0) >= maxBlocks) {
      throw new SocialError(
        'BLOCK_CAP',
        409,
        `You already block ${maxBlocks} players. Unblock someone to block another.`,
      )
    }
    const [lo, hi] = pairOf(me, target)
    const removed = await tx
      .delete(friendships)
      .where(and(eq(friendships.userA, lo), eq(friendships.userB, hi)))
      .returning({ a: friendships.userA })
    await tx.insert(blocks).values({ blockerId: me, blockedId: target })
    return { hadRow: removed.length > 0 }
  })
}

/** Lifts `me`'s block on `other`; false when there was none. */
export async function unblock(db: Executor, me: string, other: string): Promise<boolean> {
  const rows = await db
    .delete(blocks)
    .where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, other)))
    .returning({ id: blocks.blockedId })
  return rows.length > 0
}

/** Export: who `userId` blocked (usernames only). */
export async function blocksForExport(db: Executor, userId: string) {
  return (await blockedList(db, userId)).map((b) => ({ username: b.username, since: b.since }))
}
