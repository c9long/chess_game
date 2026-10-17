/**
 * Friend requests and friendships in the database (PLAN §3 "Friends"). One `friendships` row
 * per pair, in canonical order (user_a < user_b). Every change runs in a transaction that
 * first locks both users' rows (in id order), so concurrent requests can't overshoot a cap.
 */
import {
  type Database,
  type Executor,
  friendships,
  matches,
  matchPlayers,
  type Transaction,
  users,
} from '@game/db'
import {
  FRIEND_REQUESTS_OUTGOING_MAX,
  FRIENDS_MAX,
  type FriendRelation,
  type SocialErrorCode,
  type SocialUser,
} from '@game/protocol'
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm'

/** A refused social action: the route answers `{ error: code, message }` with `status`. */
export class SocialError extends Error {
  readonly code: SocialErrorCode
  readonly status: number

  constructor(code: SocialErrorCode, status: number, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface SocialLimits {
  maxFriends: number
  maxOutgoing: number
}

export const DEFAULT_LIMITS: SocialLimits = {
  maxFriends: FRIENDS_MAX,
  maxOutgoing: FRIEND_REQUESTS_OUTGOING_MAX,
}

/** The pair in canonical (byte) order, as stored. */
export function pairOf(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

const pairWhere = (a: string, b: string) => {
  const [lo, hi] = pairOf(a, b)
  return and(eq(friendships.userA, lo), eq(friendships.userB, hi))
}

const involves = (userId: string) =>
  or(eq(friendships.userA, userId), eq(friendships.userB, userId))

/** The other side of a row. */
const otherSide = (userId: string) =>
  sql<string>`case when ${friendships.userA} = ${userId} then ${friendships.userB} else ${friendships.userA} end`

/** Shown name of a registered user (the username as typed). */
export function usernameOf(u: {
  displayUsername: string | null
  username: string | null
  name: string
}) {
  return u.displayUsername ?? u.username ?? u.name
}

export interface FriendRow extends SocialUser {
  status: 'pending' | 'accepted'
  requestedBy: string
  createdAt: Date
  acceptedAt: Date | null
}

/** Every row involving `userId`, with the other user's name. */
export async function rowsOf(db: Executor, userId: string): Promise<FriendRow[]> {
  const other = otherSide(userId)
  const rows = await db
    .select({
      userId: users.id,
      displayUsername: users.displayUsername,
      username: users.username,
      name: users.name,
      status: friendships.status,
      requestedBy: friendships.requestedBy,
      createdAt: friendships.createdAt,
      acceptedAt: friendships.acceptedAt,
    })
    .from(friendships)
    .innerJoin(users, eq(users.id, other))
    .where(involves(userId))
    .orderBy(asc(users.username))
  return rows.map((r) => ({
    userId: r.userId,
    username: usernameOf(r),
    status: r.status,
    requestedBy: r.requestedBy,
    createdAt: r.createdAt,
    acceptedAt: r.acceptedAt,
  }))
}

/** Ids of `userId`'s accepted friends. */
export async function friendIdsOf(db: Executor, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: otherSide(userId) })
    .from(friendships)
    .where(and(involves(userId), eq(friendships.status, 'accepted')))
  return rows.map((r) => r.id)
}

/** Your relation to each of `others` (missing ids: 'none'). */
export async function relationsOf(
  db: Executor,
  userId: string,
  others: string[],
): Promise<Map<string, FriendRelation>> {
  const out = new Map<string, FriendRelation>()
  const ids = [...new Set(others.filter((o) => o !== userId))]
  for (const id of ids) out.set(id, 'none')
  if (ids.length === 0) return out
  const rows = await db
    .select({
      other: otherSide(userId),
      status: friendships.status,
      requestedBy: friendships.requestedBy,
    })
    .from(friendships)
    .where(
      or(
        and(eq(friendships.userA, userId), inArray(friendships.userB, ids)),
        and(eq(friendships.userB, userId), inArray(friendships.userA, ids)),
      ),
    )
  for (const r of rows) {
    out.set(
      r.other,
      r.status === 'accepted' ? 'friends' : r.requestedBy === userId ? 'outgoing' : 'incoming',
    )
  }
  return out
}

export interface Counts {
  friends: number
  outgoing: number
}

export async function countsOf(db: Executor, userId: string): Promise<Counts> {
  const [friendsRow] = await db
    .select({ n: count() })
    .from(friendships)
    .where(and(involves(userId), eq(friendships.status, 'accepted')))
  const [outRow] = await db
    .select({ n: count() })
    .from(friendships)
    .where(and(eq(friendships.requestedBy, userId), eq(friendships.status, 'pending')))
  return { friends: friendsRow?.n ?? 0, outgoing: outRow?.n ?? 0 }
}

/** A registered, live (not deleted) account, or undefined. */
async function liveAccount(db: Executor, userId: string) {
  const [u] = await db
    .select({
      id: users.id,
      displayUsername: users.displayUsername,
      username: users.username,
      name: users.name,
      isGuest: users.isAnonymous,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
  if (!u || u.isGuest || u.deletedAt || !u.username) return undefined
  return u
}

export async function socialUser(db: Executor, userId: string): Promise<SocialUser | undefined> {
  const u = await liveAccount(db, userId)
  return u ? { userId: u.id, username: usernameOf(u) } : undefined
}

/**
 * Locks both users' rows (in id order) for the rest of the transaction, and checks both are
 * still live registered accounts (an account deletion may have committed while we waited).
 */
async function lockPair(tx: Transaction, a: string, b: string) {
  const [lo, hi] = pairOf(a, b)
  const rows = await tx
    .select({
      id: users.id,
      isGuest: users.isAnonymous,
      deletedAt: users.deletedAt,
      username: users.username,
    })
    .from(users)
    .where(inArray(users.id, [lo, hi]))
    .orderBy(asc(users.id))
    .for('update')
  const live = rows.filter((r) => !r.isGuest && !r.deletedAt && r.username)
  if (live.length !== 2) {
    throw new SocialError('NOT_FOUND', 404, 'That player is no longer there.')
  }
}

/** Match statuses where the players count as having played together. */
const SHARED_STATUSES = ['in_progress', 'finished'] as const

/**
 * Resolves "the player in `seat` of match `matchId`" for a friend request by `me`. Refuses
 * unless `me` played in that match, the match is running or finished (a lobby that never
 * started has no match), and the seat is another registered, live account.
 */
export async function eligibleTarget(
  db: Executor,
  me: string,
  matchId: string,
  seat: number,
): Promise<SocialUser> {
  const rows = await db
    .select({
      seat: matchPlayers.seat,
      userId: matchPlayers.userId,
      status: matches.status,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(eq(matchPlayers.matchId, matchId))
  const mine = rows.find((r) => r.userId === me)
  const target = rows.find((r) => r.seat === seat)
  if (!mine || !target) throw new SocialError('NOT_FOUND', 404, 'That game was not found.')
  if (target.userId === me) throw new SocialError('SELF', 400, 'That seat is you.')
  const notEligible = () =>
    new SocialError(
      'NOT_ELIGIBLE',
      403,
      'You can add players you are playing or have finished a game with (not bots or guests).',
    )
  if (!(SHARED_STATUSES as readonly string[]).includes(mine.status) || !target.userId) {
    throw notEligible()
  }
  const user = await socialUser(db, target.userId)
  if (!user) throw notEligible()
  return user
}

/**
 * The seats of a match with who sits there, for friend buttons. `shared` is whether the match
 * counts as played together (running or finished); `registered` whether the seat is a live
 * registered account (not a bot, a guest or a deleted account's placeholder).
 */
export async function matchSeatsOf(db: Executor, matchId: string) {
  const rows = await db
    .select({
      seat: matchPlayers.seat,
      userId: matchPlayers.userId,
      status: matches.status,
      isGuest: users.isAnonymous,
      deletedAt: users.deletedAt,
      username: users.username,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .leftJoin(users, eq(users.id, matchPlayers.userId))
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(asc(matchPlayers.seat))
  const status = rows[0]?.status
  return {
    shared: status !== undefined && (SHARED_STATUSES as readonly string[]).includes(status),
    seats: rows.map((r) => ({
      seat: r.seat,
      userId: r.userId,
      registered: Boolean(r.userId && !r.isGuest && !r.deletedAt && r.username),
    })),
  }
}

function capErrors(limits: SocialLimits, me: Counts, them: Counts) {
  if (me.friends >= limits.maxFriends) {
    return new SocialError(
      'FRIEND_CAP',
      409,
      `You already have ${limits.maxFriends} friends. Remove one to add another.`,
    )
  }
  if (them.friends >= limits.maxFriends) {
    return new SocialError(
      'TARGET_FRIEND_CAP',
      409,
      `That player already has ${limits.maxFriends} friends.`,
    )
  }
  return undefined
}

async function acceptRow(tx: Transaction, limits: SocialLimits, me: string, other: string) {
  const err = capErrors(limits, await countsOf(tx, me), await countsOf(tx, other))
  if (err) throw err
  await tx
    .update(friendships)
    .set({ status: 'accepted', acceptedAt: new Date() })
    .where(pairWhere(me, other))
}

/**
 * Sends a friend request from `me` to `target` (already checked eligible). A pending request
 * the other way is accepted instead. Returns the relation afterwards.
 */
export async function sendRequest(
  db: Database,
  limits: SocialLimits,
  me: string,
  target: string,
): Promise<'outgoing' | 'friends'> {
  return db.transaction(async (tx) => {
    await lockPair(tx, me, target)
    const [row] = await tx.select().from(friendships).where(pairWhere(me, target))
    if (row?.status === 'accepted') {
      throw new SocialError('ALREADY_FRIENDS', 409, 'You are already friends.')
    }
    if (row && row.requestedBy === me) {
      throw new SocialError('ALREADY_REQUESTED', 409, 'Your request is already waiting.')
    }
    if (row) {
      // They asked first: sending one back accepts theirs.
      await acceptRow(tx, limits, me, target)
      return 'friends'
    }
    const mine = await countsOf(tx, me)
    const err = capErrors(limits, mine, await countsOf(tx, target))
    if (err) throw err
    if (mine.outgoing >= limits.maxOutgoing) {
      throw new SocialError(
        'OUTGOING_CAP',
        409,
        `You have ${limits.maxOutgoing} friend requests waiting. Cancel one or wait for answers.`,
      )
    }
    const [lo, hi] = pairOf(me, target)
    await tx.insert(friendships).values({ userA: lo, userB: hi, requestedBy: me })
    return 'outgoing'
  })
}

/** Accepts `other`'s pending request to `me`. */
export async function acceptRequest(
  db: Database,
  limits: SocialLimits,
  me: string,
  other: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockPair(tx, me, other)
    const [row] = await tx.select().from(friendships).where(pairWhere(me, other))
    if (row?.status !== 'pending' || row.requestedBy !== other) {
      throw new SocialError('NOT_FOUND', 404, 'That friend request is no longer there.')
    }
    await acceptRow(tx, limits, me, other)
  })
}

/** Deletes the pair's row if it matches; false when there was nothing to delete. */
async function deleteRow(
  db: Executor,
  me: string,
  other: string,
  status: 'pending' | 'accepted',
  requestedBy?: string,
): Promise<boolean> {
  const rows = await db
    .delete(friendships)
    .where(
      and(
        pairWhere(me, other),
        eq(friendships.status, status),
        requestedBy ? eq(friendships.requestedBy, requestedBy) : undefined,
      ),
    )
    .returning({ a: friendships.userA })
  return rows.length > 0
}

export const declineRequest = (db: Executor, me: string, other: string) =>
  deleteRow(db, me, other, 'pending', other)
export const cancelRequest = (db: Executor, me: string, other: string) =>
  deleteRow(db, me, other, 'pending', me)
export const removeFriend = (db: Executor, me: string, other: string) =>
  deleteRow(db, me, other, 'accepted')

/** Account deletion: every friendship and request of the user goes (never re-keyed). */
export async function deleteAllOf(db: Executor, userId: string): Promise<void> {
  await db.delete(friendships).where(involves(userId))
}
