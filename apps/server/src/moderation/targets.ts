/**
 * Resolves who a block or a report is about. Clients never need arbitrary user ids: a target is
 * "the player in seat N of a game you played in", the id of someone already on your Friends
 * page (a friend, a request either way, or a player you blocked), or the username of a live
 * registered player (their public profile).
 */
import { blocks, type Executor, friendships, matchPlayers, users } from '@game/db'
import type { PlayerTarget } from '@game/protocol'
import { and, eq } from 'drizzle-orm'
import { pairOf, SocialError, usernameOf } from '../social/friends.ts'
import { findByUsername } from '../social/profiles.ts'

export interface ResolvedTarget {
  userId: string
  /** The name shown now. */
  name: string
  isGuest: boolean
  /** A live registered account (has a username, not deleted). */
  registered: boolean
  /** The game the target came from, if any. */
  matchId: string | null
}

const notFound = () => new SocialError('NOT_FOUND', 404, 'That player was not found.')

async function userRow(db: Executor, userId: string) {
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      displayUsername: users.displayUsername,
      isGuest: users.isAnonymous,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
  return u
}

export async function resolveTarget(
  db: Executor,
  me: string,
  target: PlayerTarget,
): Promise<ResolvedTarget> {
  let userId: string
  let matchId: string | null = null
  if ('matchId' in target) {
    const seats = await db
      .select({ seat: matchPlayers.seat, userId: matchPlayers.userId })
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, target.matchId))
    if (!seats.some((s) => s.userId === me)) throw notFound()
    const seat = seats.find((s) => s.seat === target.seat)
    if (!seat?.userId) throw notFound() // a bot, or an empty seat
    if (seat.userId === me) throw new SocialError('SELF', 400, 'That seat is you.')
    userId = seat.userId
    matchId = target.matchId
  } else if ('username' in target) {
    // Public profiles: any live registered player (suspended accounts read as not found).
    const found = await findByUsername(db, target.username)
    if (!found) throw notFound()
    if (found.id === me) throw new SocialError('SELF', 400, 'That is you.')
    userId = found.id
  } else {
    userId = target.userId
    if (userId === me) throw new SocialError('SELF', 400, 'That is you.')
    // Only ids the Friends page shows you: a friendship or request, or a block of yours.
    const [lo, hi] = pairOf(me, userId)
    const [row] = await db
      .select({ a: friendships.userA })
      .from(friendships)
      .where(and(eq(friendships.userA, lo), eq(friendships.userB, hi)))
    const [blocked] = row
      ? [true]
      : await db
          .select({ a: blocks.blockerId })
          .from(blocks)
          .where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, userId)))
    if (!row && !blocked) throw notFound()
  }
  const u = await userRow(db, userId)
  if (!u || u.deletedAt) throw notFound()
  return {
    userId: u.id,
    name: u.isGuest ? u.name : usernameOf(u),
    isGuest: u.isGuest,
    registered: !u.isGuest && Boolean(u.username),
    matchId,
  }
}
