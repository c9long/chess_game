/** Match history and ratings (REST, for the web and later Unity). */
import {
  civilizations,
  type Database,
  matchEvents,
  matches,
  matchPlayers,
  ratings,
  users,
} from '@game/db'
import type {
  MatchDetailResponse,
  MatchListItem,
  MatchListResponse,
  RatingsResponse,
} from '@game/protocol'
import { and, asc, desc, eq, inArray, lt, ne, or } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth.ts'
import { requireSession, sessionOf } from '../http/session.ts'
import { requireCurrentAcceptance } from '../legal/routes.ts'
import { displayRating } from './ratings.ts'

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

  /** The signed-in player's public ratings (shadow ratings are never exposed here). */
  router.get('/ratings/me', ...guard, async (_req, res) => {
    const me = sessionOf(res).user.id
    const rows = await db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, me), eq(ratings.kind, 'public')))
      .orderBy(asc(ratings.mode), asc(ratings.timeControl))
    const body: RatingsResponse = {
      ratings: rows.map((r) => ({
        mode: r.mode,
        timeControl: r.timeControl,
        rating: displayRating({ mu: r.mu, sigma: r.sigma }),
        mu: r.mu,
        sigma: r.sigma,
        gamesPlayed: r.gamesPlayed,
      })),
    }
    res.json(body)
  })

  return router
}
