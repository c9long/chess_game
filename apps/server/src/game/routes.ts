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
  GAME_MODES,
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
  LEADERBOARD_MIN_GAMES,
  type LeaderboardResponse,
  type MatchDetailResponse,
  type MatchListItem,
  type MatchListResponse,
  type RatingsResponse,
} from '@game/protocol'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth.ts'
import { requireSession, sessionOf } from '../http/session.ts'
import { requireCurrentAcceptance } from '../legal/routes.ts'

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
    })
    .from(matchPlayers)
    .innerJoin(civilizations, eq(civilizations.id, matchPlayers.civId))
    .leftJoin(users, eq(users.id, matchPlayers.userId))
    .where(inArray(matchPlayers.matchId, matchIds))
    .orderBy(asc(matchPlayers.seat))
}

export function gameRouter({ db, auth }: { db: Database; auth: Auth }) {
  const router = Router()
  const guard = [requireSession(auth), requireCurrentAcceptance(db)]

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
   * deleted accounts (their re-keyed placeholders) and guests are never listed.
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
