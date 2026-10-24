/** Match history, ratings and the leaderboard (REST, for the web and later Unity). */
import { TIME_CONTROLS } from '@game/config'
import {
  civilizations,
  type Database,
  eloRatings,
  matchEvents,
  matches,
  matchPlayers,
  users,
} from '@game/db'
import {
  type FriendGame,
  type FriendGamesResponse,
  GAME_MODES,
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
  LEADERBOARD_MIN_GAMES,
  type LeaderboardResponse,
  type MatchDetailResponse,
  type MatchListItem,
  type MatchListResponse,
  type MatchReplayResponse,
  type RatingsResponse,
} from '@game/protocol'
import { isSupportedRulesVersion } from '@game/rules'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm'
import { type Request, Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth.ts'
import { fixedWindowLimiter } from '../http/security.ts'
import { requireSession, sessionOf } from '../http/session.ts'
import { requireCurrentAcceptance } from '../legal/routes.ts'
import { blockedAmong, blockedByAmong } from '../social/blocks.ts'
import { friendIdsOf, relationsOf } from '../social/friends.ts'
import { MatchRoom } from './match-room.ts'
import { loadReplay, playReplay } from './persistence.ts'

const leaderboardQuery = z.object({
  mode: z.enum(GAME_MODES).default('ffa'),
  // An unencoded '+' in a query string arrives as a space: accept '10 0' for '10+0'.
  tc: z
    .string()
    .max(20)
    .default('10+0')
    .transform((v) => v.replace(' ', '+'))
    .pipe(z.enum(Object.keys(TIME_CONTROLS) as [string, ...string[]])),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LEADERBOARD_MAX_LIMIT)
    .default(LEADERBOARD_DEFAULT_LIMIT),
})

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().max(200).optional(),
})

function encodeCursor(startedAt: Date, id: string) {
  return Buffer.from(`${startedAt.toISOString()}|${id}`).toString('base64url')
}

function decodeCursor(cursor: string): { startedAt: Date; id: string } | null {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|')
  const startedAt = new Date(ts ?? '')
  if (!id || Number.isNaN(startedAt.getTime()) || !z.uuid().safeParse(id).success) return null
  return { startedAt, id }
}

interface PlayerRow {
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

/** Name shown for a seat. Deleted accounts show their "Deleted player #…" placeholder. */
function nameOf(p: PlayerRow): string {
  if (p.botLevel) return `Bot ${p.botLevel === 'max' ? 'Max' : p.botLevel}`
  if (!p.userId) return 'Removed player'
  return p.displayUsername ?? p.name ?? 'Player'
}

async function playersOf(db: Database, matchIds: string[]): Promise<PlayerRow[]> {
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

/** Re-simulated final positions of finished matches (they never change), newest last. */
const finalPositions = new Map<string, string>()
const FINAL_POSITIONS_MAX = 500

/** The re-simulated final position of a finished match, computed once per process. */
function cachedFinalPosition(matchId: string, compute: () => string): string {
  const hit = finalPositions.get(matchId)
  if (hit !== undefined) return hit
  const position = compute()
  finalPositions.set(matchId, position)
  if (finalPositions.size > FINAL_POSITIONS_MAX) {
    const oldest = finalPositions.keys().next().value
    if (oldest !== undefined) finalPositions.delete(oldest)
  }
  return position
}

const byUser = (req: Request) => (req.res?.locals.session?.user.id as string | undefined) ?? 'anon'

export function gameRouter({ db, auth }: { db: Database; auth: Auth }) {
  const router = Router()
  const guard = [requireSession(auth), requireCurrentAcceptance(db)]
  /**
   * Replays load every event of a game: a few per minute per player is plenty (the replay
   * page fetches once). Only answers with a replay count (not "not finished yet" polls).
   */
  const replayLimiter = fixedWindowLimiter({
    windowMs: 60_000,
    max: 30,
    key: byUser,
    countIf: (status) => status === 200,
  })

  /** The signed-in player's match history, newest first (finished and aborted games). */
  router.get('/matches', ...guard, async (req, res) => {
    const q = listQuery.safeParse(req.query)
    if (!q.success) {
      res.status(400).json({ error: 'BAD_REQUEST' })
      return
    }
    const me = sessionOf(res).user.id
    const cursor = q.data.before ? decodeCursor(q.data.before) : null
    if (q.data.before && !cursor) {
      res.status(400).json({ error: 'BAD_REQUEST' })
      return
    }
    const rows = await db
      .select({
        id: matches.id,
        status: matches.status,
        startedAt: matches.startedAt,
        endedAt: matches.endedAt,
        mode: matches.mode,
        timeControl: matches.timeControl,
        rated: matches.rated,
        ranked: matches.ranked,
        endReason: matches.endReason,
        rulesVersion: matches.rulesVersion,
        seat: matchPlayers.seat,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(
        and(
          eq(matchPlayers.userId, me),
          ne(matches.status, 'in_progress'),
          cursor
            ? or(
                lt(matches.startedAt, cursor.startedAt),
                and(eq(matches.startedAt, cursor.startedAt), lt(matches.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(matches.startedAt), desc(matches.id))
      .limit(q.data.limit + 1)
    const page = rows.slice(0, q.data.limit)
    const players = await playersOf(
      db,
      page.map((r) => r.id),
    )
    // Friend buttons: registered viewers, registered live opponents of finished games.
    const viewer = sessionOf(res).user as { isAnonymous?: boolean | null; username?: string | null }
    const canFriend = !viewer.isAnonymous && Boolean(viewer.username)
    const finished = new Set(page.filter((m) => m.status === 'finished').map((m) => m.id))
    const addable = (p: PlayerRow) =>
      canFriend &&
      finished.has(p.matchId) &&
      p.userId !== null &&
      p.userId !== me &&
      !p.isGuest &&
      !p.deletedAt &&
      Boolean(p.username)
    const relations = canFriend
      ? await relationsOf(
          db,
          me,
          players.filter(addable).map((p) => p.userId as string),
        )
      : new Map()
    // Block and report menus: registered viewers can block registered live opponents (any
    // game status); anyone can report a person (not a bot or a deleted account's placeholder).
    const blockable = (p: PlayerRow) =>
      canFriend &&
      p.userId !== null &&
      p.userId !== me &&
      !p.isGuest &&
      !p.deletedAt &&
      Boolean(p.username)
    const reportable = (p: PlayerRow) => p.userId !== null && p.userId !== me && !p.deletedAt
    const blocked = canFriend
      ? await blockedAmong(
          db,
          me,
          players.filter(blockable).map((p) => p.userId as string),
        )
      : new Set<string>()
    // Players who blocked the viewer look like any ineligible seat (the block isn't revealed).
    const blockedBy = canFriend
      ? await blockedByAmong(
          db,
          me,
          players.filter(addable).map((p) => p.userId as string),
        )
      : new Set<string>()
    const items: MatchListItem[] = page.map((m) => {
      const seats = players.filter((p) => p.matchId === m.id)
      const mine = seats.find((p) => p.seat === m.seat)
      const delta =
        mine?.ratingBefore != null && mine.ratingAfter != null
          ? Math.round(mine.ratingAfter - mine.ratingBefore)
          : null
      return {
        id: m.id,
        status: m.status,
        startedAt: m.startedAt.toISOString(),
        endedAt: m.endedAt?.toISOString() ?? null,
        mode: m.mode,
        timeControl: m.timeControl,
        rated: m.rated,
        ranked: m.ranked,
        endReason: m.endReason,
        rulesVersion: m.rulesVersion,
        seat: m.seat,
        civ: mine?.civ ?? '',
        placement: mine?.placement ?? null,
        ratingBefore: mine?.ratingBefore ?? null,
        ratingAfter: mine?.ratingAfter ?? null,
        ratingDelta: delta,
        opponents: seats
          .filter((p) => p.seat !== m.seat)
          .map((p) => ({
            seat: p.seat,
            name: nameOf(p),
            civ: p.civ,
            botLevel: p.botLevel,
            isGuest: Boolean(p.isGuest),
            friend:
              addable(p) && !blocked.has(p.userId as string) && !blockedBy.has(p.userId as string)
                ? (relations.get(p.userId as string) ?? 'none')
                : null,
            blocked: blockable(p) ? blocked.has(p.userId as string) : null,
            reportable: reportable(p),
          })),
      }
    })
    const last = page.at(-1)
    const body: MatchListResponse = {
      matches: items,
      nextCursor: rows.length > q.data.limit && last ? encodeCursor(last.startedAt, last.id) : null,
    }
    res.json(body)
  })

  /** One match with players and the full event log (participants only). */
  router.get('/matches/:id', ...guard, async (req, res) => {
    const id = z.uuid().safeParse(req.params.id)
    if (!id.success) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const me = sessionOf(res).user.id
    const [match] = await db.select().from(matches).where(eq(matches.id, id.data))
    const players = match ? await playersOf(db, [match.id]) : []
    if (!match || !players.some((p) => p.userId === me)) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const events = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, match.id))
      .orderBy(asc(matchEvents.seq))
    const body: MatchDetailResponse = {
      id: match.id,
      status: match.status,
      mode: match.mode,
      timeControl: match.timeControl,
      rated: match.rated,
      ranked: match.ranked,
      rulesVersion: match.rulesVersion,
      startedAt: match.startedAt.toISOString(),
      endedAt: match.endedAt?.toISOString() ?? null,
      endReason: match.endReason,
      players: players.map((p) => ({
        seat: p.seat,
        team: p.team,
        name: nameOf(p),
        isGuest: Boolean(p.isGuest),
        isYou: p.userId === me,
        botLevel: p.botLevel,
        civ: p.civ,
        civVersion: p.civVersion,
        finalStatus: p.finalStatus,
        placement: p.placement,
        defeatReason: p.defeatReason,
        defeatSeq: p.defeatSeq,
        ratingBefore: p.ratingBefore,
        ratingAfter: p.ratingAfter,
      })),
      events: events.map((e) => ({
        seq: e.seq,
        seat: e.seat,
        type: e.type,
        payload: e.payload,
        clockRemainingMs: e.clockRemainingMs,
        serverTs: e.serverTs.toISOString(),
      })),
    }
    res.json(body)
  })

  /**
   * A finished match's replay input: engine config, actions in order and the server's own
   * re-simulated final position (participants only, like the detail; public sharing of
   * replays is a TODO). Matches from another rules version (the old 12×12 board) answer 409.
   */
  router.get('/matches/:id/replay', ...guard, replayLimiter, async (req, res) => {
    const id = z.uuid().safeParse(req.params.id)
    if (!id.success) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const me = sessionOf(res).user.id
    const [match] = await db.select().from(matches).where(eq(matches.id, id.data))
    const [mine] = match
      ? await db
          .select({ seat: matchPlayers.seat })
          .from(matchPlayers)
          .where(and(eq(matchPlayers.matchId, match.id), eq(matchPlayers.userId, me)))
          .limit(1)
      : []
    if (!match || !mine) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    if (match.status !== 'finished') {
      res.status(409).json({ error: 'NOT_FINISHED' })
      return
    }
    if (!isSupportedRulesVersion(match.rulesVersion)) {
      res.status(409).json({ error: 'RULES_VERSION_UNSUPPORTED', rulesVersion: match.rulesVersion })
      return
    }
    const replay = await loadReplay(db, match.id)
    const body: MatchReplayResponse = {
      id: match.id,
      mode: match.mode,
      timeControl: match.timeControl,
      rulesVersion: match.rulesVersion,
      config: replay.config,
      actions: replay.actions,
      finalPosition: cachedFinalPosition(match.id, () => playReplay(replay)),
      endReason: match.endReason,
    }
    res.json(body)
  })

  /**
   * Games your friends are playing right now that you may watch (the Friends page "Watch"
   * buttons): running games only, filtered by the same rules as watching.
   */
  router.get('/live/friends', ...guard, async (_req, res) => {
    const session = sessionOf(res)
    const me = session.user.id
    const body: FriendGamesResponse = { games: [] }
    const rooms = MatchRoom.service?.rooms
    if ((session.user as { isAnonymous?: boolean | null }).isAnonymous || !rooms) {
      res.json(body)
      return
    }
    const friendIds = await friendIdsOf(db, me)
    if (friendIds.length === 0) {
      res.json(body)
      return
    }
    const friends = new Set(friendIds)
    for (const room of rooms) {
      if (!(room instanceof MatchRoom)) continue
      const s = room.state
      if (s.phase !== 'in_game') continue
      const playing = room.seatedPlayers().filter((p) => friends.has(p.userId))
      if (playing.length === 0 || !room.watchableBy(me, friendIds)) continue
      const game: FriendGame = {
        roomId: room.roomId,
        friends: playing.map((p) => p.displayName),
        name: s.name,
        mode: s.mode as FriendGame['mode'],
        timeControl: s.timeControl,
        ranked: s.ranked,
        solo: room.isSolo(),
        locked: s.hasPassword,
        spectators: s.spectators,
      }
      body.games.push(game)
    }
    res.json(body)
  })

  /** The signed-in player's Elo ratings (hidden shadow ratings are never exposed). */
  router.get('/ratings/me', ...guard, async (_req, res) => {
    const me = sessionOf(res).user.id
    const rows = await db
      .select()
      .from(eloRatings)
      .where(eq(eloRatings.userId, me))
      .orderBy(asc(eloRatings.mode), desc(eloRatings.timeControl))
    const body: RatingsResponse = {
      ratings: rows.map((r) => ({
        mode: r.mode,
        timeControl: r.timeControl,
        rating: r.rating,
        gamesPlayed: r.games,
        peak: r.peak,
      })),
    }
    res.json(body)
  })

  /**
   * Public leaderboard (no session needed): the top registered players by Elo in one
   * mode x time control, with at least LEADERBOARD_MIN_GAMES ranked games. Usernames only;
   * deleted accounts (their re-keyed placeholders), suspended accounts and guests are never
   * listed.
   */
  router.get('/leaderboard', async (req, res) => {
    const q = leaderboardQuery.safeParse(req.query)
    if (!q.success) {
      res.status(400).json({ error: 'BAD_REQUEST' })
      return
    }
    const { mode, tc, limit } = q.data
    const rows = await db
      .select({
        rating: eloRatings.rating,
        games: eloRatings.games,
        peak: eloRatings.peak,
        username: users.displayUsername,
        handle: users.username,
      })
      .from(eloRatings)
      .innerJoin(users, eq(users.id, eloRatings.userId))
      .where(
        and(
          eq(eloRatings.mode, mode),
          eq(eloRatings.timeControl, tc),
          gte(eloRatings.games, LEADERBOARD_MIN_GAMES),
          isNull(users.deletedAt),
          // Suspended accounts have no public profile (and no search result), so the board
          // leaves them out too: a listed name always opens its profile.
          isNull(users.suspendedAt),
          eq(users.isAnonymous, false),
          isNotNull(users.username),
        ),
      )
      .orderBy(desc(eloRatings.rating), desc(eloRatings.games), asc(users.username))
      .limit(limit)
    let rank = 0
    let prev: number | undefined
    const body: LeaderboardResponse = {
      mode,
      timeControl: tc,
      minGames: LEADERBOARD_MIN_GAMES,
      entries: rows.map((r, i) => {
        if (r.rating !== prev) rank = i + 1
        prev = r.rating
        return {
          rank,
          username: r.username ?? r.handle ?? '',
          rating: r.rating,
          gamesPlayed: r.games,
          peak: r.peak,
        }
      }),
    }
    res.set('cache-control', 'public, max-age=30')
    res.json(body)
  })

  return router
}
