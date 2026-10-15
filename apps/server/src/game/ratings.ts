/**
 * OpenSkill ratings (PLAN §5), Plackett–Luce model over placements (ties allowed: a tie is
 * rated as the average over the strict orders of the tied players).
 *
 * - Public pool ('public'): rated games only, i.e. all four seats registered humans.
 * - Shadow pool ('shadow', hidden): casual games with at least one bot. Registered humans'
 *   shadow ratings move; bots are fixed anchors (`bot_level_anchors`), guests a fresh default.
 *   Never shown to players; used to calibrate bot labels.
 * - Guests are never rated. Each mode x time control is a separate rating.
 *
 * Display rating ("Elo-like"): round(900 + 30 * (mu - 3 * sigma)), i.e. a conservative
 * estimate (mu - 3 sigma, 0 for a new player) scaled so that 400 points is roughly a 10:1
 * win ratio between two established players: P(win) = 1 / (1 + e^(-d/c)) with
 * c = sqrt(2 beta^2 + 2 sigma^2) ~ 5.9 mu, so 10:1 odds ~ 13.6 mu ~ 400 points at 30/mu.
 * A new player shows 900 and rises as sigma shrinks; an average regular sits near 1500.
 */
import type { BotLevel } from '@game/config'
import { BOT_LEVELS } from '@game/config'
import { botLevelAnchors, type Executor, ratings, users } from '@game/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ordinal, type Rating, rate, rating } from 'openskill'
import { plackettLuce } from 'openskill/models'

export const DISPLAY_BASE = 900
export const DISPLAY_SCALE = 30
export const ANCHOR_SIGMA = 1

export type RatingPool = 'public' | 'shadow'

export function displayRating(r: Rating): number {
  return Math.round(DISPLAY_BASE + DISPLAY_SCALE * ordinal(r, { z: 3 }))
}

export function defaultRating(): Rating {
  return rating()
}

/** Anchor for a bot level when the table has no row: the inverse of `displayRating`. */
export function defaultBotAnchor(level: string): Rating {
  const numeric = level === 'max' ? 2700 : Number(level)
  return {
    mu: (numeric - DISPLAY_BASE) / DISPLAY_SCALE + 3 * ANCHOR_SIGMA,
    sigma: ANCHOR_SIGMA,
  }
}

export interface RatingEntrant {
  seat: number
  /** Teams: 0 = South+North, 1 = West+East. Ignored in FFA. */
  team: number
  placement: number
  rating: Rating
}

/**
 * All strict orders consistent with `ranks` (lower = better): tied entries are permuted.
 * Returns permutations of indices, best first.
 */
function strictOrders(ranks: number[]): number[][] {
  const groups = [...new Set(ranks)]
    .sort((a, b) => a - b)
    .map((r) => ranks.flatMap((x, i) => (x === r ? [i] : [])))
  const permute = (xs: number[]): number[][] =>
    xs.length <= 1
      ? [xs]
      : xs.flatMap((x, i) => permute([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]))
  return groups.reduce<number[][]>(
    (acc, g) => acc.flatMap((prefix) => permute(g).map((p) => [...prefix, ...p])),
    [[]],
  )
}

/**
 * Plackett–Luce update for ranked teams. Ties are rated as the average over every strict
 * order of the tied teams (openskill's own tie handling lets e.g. 3rd place in a 1-1-3-4
 * finish gain as much as the tied winners).
 */
function ratePlackettLuce(teams: Rating[][], ranks: number[]): Rating[][] {
  const orders = strictOrders(ranks)
  const sums = teams.map((t) => t.map(() => ({ mu: 0, sigma: 0 })))
  for (const order of orders) {
    const position = new Array<number>(teams.length)
    order.forEach((teamIndex, pos) => {
      position[teamIndex] = pos + 1
    })
    const result = rate(teams, { model: plackettLuce, rank: position })
    result.forEach((team, i) => {
      team.forEach((r, j) => {
        const acc = sums[i]?.[j]
        if (acc) {
          acc.mu += r.mu
          acc.sigma += r.sigma
        }
      })
    })
  }
  return sums.map((t) =>
    t.map((r) => ({ mu: r.mu / orders.length, sigma: r.sigma / orders.length })),
  )
}

/**
 * Rates one game. FFA: four one-player teams ranked by placement. Teams: two teams ranked
 * by their (shared) placement; a draw gives both rank 1. Returns the new rating per seat.
 */
export function rateGame(mode: 'ffa' | 'teams', entrants: RatingEntrant[]): Map<number, Rating> {
  const out = new Map<number, Rating>()
  if (mode === 'ffa') {
    const sorted = [...entrants].sort((a, b) => a.seat - b.seat)
    const result = ratePlackettLuce(
      sorted.map((e) => [e.rating]),
      sorted.map((e) => e.placement),
    )
    sorted.forEach((e, i) => {
      const r = result[i]?.[0]
      if (r) out.set(e.seat, r)
    })
    return out
  }
  const teams = [0, 1].map((t) => entrants.filter((e) => e.team === t))
  const ranks = teams.map((members) => Math.min(...members.map((m) => m.placement)))
  const result = ratePlackettLuce(
    teams.map((members) => members.map((m) => m.rating)),
    ranks,
  )
  teams.forEach((members, t) => {
    members.forEach((m, i) => {
      const r = result[t]?.[i]
      if (r) out.set(m.seat, r)
    })
  })
  return out
}

export interface RatedSeat {
  seat: number
  team: number
  placement: number
  userId: string | null
  isGuest: boolean
  botLevel: string | null
}

export interface RatingChange {
  seat: number
  pool: RatingPool
  before: number
  after: number
}

/** Which pool a game feeds, or null when it changes no rating. */
export function poolForGame(players: RatedSeat[]): RatingPool | null {
  const allRegistered = players.every((p) => p.userId && !p.isGuest && !p.botLevel)
  if (allRegistered) return 'public'
  const hasBot = players.some((p) => p.botLevel)
  const hasRegistered = players.some((p) => p.userId && !p.isGuest)
  return hasBot && hasRegistered ? 'shadow' : null
}

async function loadAnchors(db: Executor, levels: string[]): Promise<Map<string, Rating>> {
  const map = new Map<string, Rating>()
  if (levels.length === 0) return map
  const rows = await db
    .select()
    .from(botLevelAnchors)
    .where(inArray(botLevelAnchors.botLevel, levels))
  for (const r of rows) map.set(r.botLevel, { mu: r.mu, sigma: r.sigma })
  for (const l of levels) if (!map.has(l)) map.set(l, defaultBotAnchor(l))
  return map
}

/**
 * Applies a finished game's rating updates inside `tx` (call within the transaction that
 * marks the match finished). Returns the display-rating change per updated seat. Deleted
 * (de-identified) accounts keep their re-keyed rows but are not updated.
 */
export async function applyRatings(
  tx: Executor,
  game: { mode: 'ffa' | 'teams'; timeControl: string },
  players: RatedSeat[],
): Promise<RatingChange[]> {
  const pool = poolForGame(players)
  if (!pool) return []
  const humanIds = players
    .filter((p) => p.userId && !p.isGuest && !p.botLevel)
    .map((p) => p.userId as string)
  const live = humanIds.length
    ? await tx
        .select({ id: users.id, deletedAt: users.deletedAt })
        .from(users)
        .where(inArray(users.id, humanIds))
    : []
  const updatable = new Set(live.filter((u) => !u.deletedAt).map((u) => u.id))
  if (pool === 'public' && updatable.size !== 4) return []

  const existing = humanIds.length
    ? await tx
        .select()
        .from(ratings)
        .where(
          and(
            inArray(ratings.userId, humanIds),
            eq(ratings.mode, game.mode),
            eq(ratings.timeControl, game.timeControl),
            eq(ratings.kind, pool),
          ),
        )
        .for('update')
    : []
  const byUser = new Map(existing.map((r) => [r.userId, r]))
  const anchors = await loadAnchors(tx, [
    ...new Set(players.filter((p) => p.botLevel).map((p) => p.botLevel as string)),
  ])

  const entrants: RatingEntrant[] = players.map((p) => {
    let r: Rating = defaultRating()
    if (p.botLevel) r = anchors.get(p.botLevel) ?? defaultBotAnchor(p.botLevel)
    else if (p.userId && !p.isGuest) {
      const row = byUser.get(p.userId)
      if (row) r = { mu: row.mu, sigma: row.sigma }
    }
    return { seat: p.seat, team: p.team, placement: p.placement, rating: r }
  })
  const next = rateGame(game.mode, entrants)

  const changes: RatingChange[] = []
  for (const p of players) {
    if (!p.userId || p.isGuest || p.botLevel || !updatable.has(p.userId)) continue
    const before = entrants.find((e) => e.seat === p.seat)?.rating ?? defaultRating()
    const after = next.get(p.seat)
    if (!after) continue
    await tx
      .insert(ratings)
      .values({
        userId: p.userId,
        mode: game.mode,
        timeControl: game.timeControl,
        kind: pool,
        mu: after.mu,
        sigma: after.sigma,
        gamesPlayed: 1,
      })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.mode, ratings.timeControl, ratings.kind],
        set: {
          mu: after.mu,
          sigma: after.sigma,
          gamesPlayed: sql`${ratings.gamesPlayed} + 1`,
          updatedAt: new Date(),
        },
      })
    changes.push({
      seat: p.seat,
      pool,
      before: displayRating(before),
      after: displayRating(after),
    })
  }
  return changes
}

/** Whether a BOT_LEVELS label is valid. */
export function isBotLevel(level: string): level is `${BotLevel}` {
  return (BOT_LEVELS as readonly (string | number)[]).map(String).includes(level)
}
