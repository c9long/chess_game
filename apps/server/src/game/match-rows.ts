/** The seats of recorded matches, as match history and public profiles read them. */
import { civilizations, type Executor, matchPlayers, users } from '@game/db'
import { asc, eq, inArray } from 'drizzle-orm'

export interface PlayerRow {
  matchId: string
  seat: number
  team: number | null
  userId: string | null
  botLevel: string | null
  civ: string
  civVersion: number
  finalStatus: string | null
  placement: number | null
  defeatReason: string | null
  defeatSeq: number | null
  ratingBefore: number | null
  ratingAfter: number | null
  name: string | null
  displayUsername: string | null
  isGuest: boolean | null
  username: string | null
  deletedAt: Date | null
}

/** Every seat of `matchIds`, by seat, with the account behind it (if any). */
export async function playersOf(db: Executor, matchIds: string[]): Promise<PlayerRow[]> {
  if (matchIds.length === 0) return []
  return db
    .select({
      matchId: matchPlayers.matchId,
      seat: matchPlayers.seat,
      team: matchPlayers.team,
      userId: matchPlayers.userId,
      botLevel: matchPlayers.botLevel,
      civ: civilizations.slug,
      civVersion: matchPlayers.civVersion,
      finalStatus: matchPlayers.finalStatus,
      placement: matchPlayers.placement,
      defeatReason: matchPlayers.defeatReason,
      defeatSeq: matchPlayers.defeatSeq,
      ratingBefore: matchPlayers.ratingBefore,
      ratingAfter: matchPlayers.ratingAfter,
      name: users.name,
      displayUsername: users.displayUsername,
      isGuest: users.isAnonymous,
      username: users.username,
      deletedAt: users.deletedAt,
    })
    .from(matchPlayers)
    .innerJoin(civilizations, eq(civilizations.id, matchPlayers.civId))
    .leftJoin(users, eq(users.id, matchPlayers.userId))
    .where(inArray(matchPlayers.matchId, matchIds))
    .orderBy(asc(matchPlayers.seat))
}

/**
 * A seat held by a registered account that still exists (suspended ones too): not a bot, a
 * guest or a deleted account.
 */
export function isRegisteredSeat(p: PlayerRow): p is PlayerRow & { userId: string } {
  return p.userId !== null && !p.isGuest && !p.deletedAt && Boolean(p.username)
}

/** The seat's Elo change in a rated game, or null. */
export function ratingDeltaOf(rated: boolean, p: PlayerRow | undefined): number | null {
  return rated && p?.ratingBefore != null && p.ratingAfter != null
    ? Math.round(p.ratingAfter - p.ratingBefore)
    : null
}
