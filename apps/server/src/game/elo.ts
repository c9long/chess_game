/**
 * Elo for ranked games (PLAN §5). Pure functions only; persistence lives in `ratings.ts`.
 *
 * - Everyone starts at ELO_START (1200). Ratings are integers.
 * - K factor per player (FIDE): 40 until the player has 30 ranked games in that rating,
 *   then 20, and 10 once the player's rating has ever reached 2400 (its peak).
 * - Free-for-all (N players, N = 4): every pair (i, j) is a mini-game. S_ij = 1 if i placed
 *   better, 0.5 for a tie, 0 if worse; E_ij = 1 / (1 + 10^((R_j - R_i) / 400));
 *   delta_i = round(K_i / (N - 1) * sum_j (S_ij - E_ij)).
 * - Teams: a team's rating is the mean of its two players; standard Elo team against team
 *   (S = 1 win, 0.5 tie, 0 loss), and each player moves by round(K_i * (S - E)).
 * - Placements decide everything: an agreed draw or a move-limit tie shares a placement and
 *   counts as a tie. Aborted games are never rated (the caller doesn't get here).
 * - Each delta is rounded on its own, as specified: a game with ties or mixed K factors can
 *   be off zero-sum by a point or two (accepted; documented in PLAN §5).
 */

export const ELO_START = 1200
export const ELO_K_NEW = 40
export const ELO_K_REGULAR = 20
export const ELO_K_TOP = 10
/** Games played (in this mode x time control) before K drops from ELO_K_NEW. */
export const ELO_NEW_PLAYER_GAMES = 30
/** Peak rating from which K is ELO_K_TOP for good. */
export const ELO_TOP_THRESHOLD = 2400

export interface EloPlayer {
  rating: number
  /** Ranked games already played in this mode x time control (before this one). */
  games: number
  /** Highest rating reached so far (at least `rating`). */
  peak: number
}

export interface EloEntrant extends EloPlayer {
  seat: number
  /** Teams: 0 = South+North, 1 = West+East. Ignored in FFA. */
  team: number
  /** 1 = best; equal placements are a tie. */
  placement: number
}

export interface EloResult {
  seat: number
  before: number
  after: number
  delta: number
}

/** A fresh player's numbers. */
export function newEloPlayer(): EloPlayer {
  return { rating: ELO_START, games: 0, peak: ELO_START }
}

/** FIDE-style K: 40 for the first 30 games, then 20, or 10 once the peak reached 2400. */
export function kFactor(p: EloPlayer): number {
  if (p.games < ELO_NEW_PLAYER_GAMES) return ELO_K_NEW
  if (Math.max(p.peak, p.rating) >= ELO_TOP_THRESHOLD) return ELO_K_TOP
  return ELO_K_REGULAR
}

/** Expected score of a player rated `ra` against one rated `rb`. */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400))
}

/** Actual score of placement `a` against placement `b` (lower is better). */
export function pairScore(a: number, b: number): number {
  if (a < b) return 1
  if (a > b) return 0
  return 0.5
}

/** `Math.round` that rounds halves away from zero, so gains and losses round alike. */
function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

function result(e: EloEntrant, delta: number): EloResult {
  const d = roundHalfAway(delta) || 0
  return { seat: e.seat, before: e.rating, after: e.rating + d, delta: d }
}

/** Free-for-all: pairwise Elo, each pair weighted K_i / (N - 1). */
export function rateFfa(entrants: readonly EloEntrant[]): EloResult[] {
  const n = entrants.length
  if (n < 2) return entrants.map((e) => result(e, 0))
  return entrants.map((e) => {
    let sum = 0
    for (const o of entrants) {
      if (o === e) continue
      sum += pairScore(e.placement, o.placement) - expectedScore(e.rating, o.rating)
    }
    return result(e, (kFactor(e) / (n - 1)) * sum)
  })
}

/** Teams: team rating = mean of its players; each player moves by K_i * (S - E). */
export function rateTeams(entrants: readonly EloEntrant[]): EloResult[] {
  const members = [0, 1].map((t) => entrants.filter((e) => e.team === t))
  if (members.some((m) => m.length === 0)) return entrants.map((e) => result(e, 0))
  const mean = (xs: EloEntrant[]) => xs.reduce((s, x) => s + x.rating, 0) / xs.length
  const ratingOf = members.map(mean)
  const placeOf = members.map((m) => Math.min(...m.map((x) => x.placement)))
  return entrants.map((e) => {
    const t = e.team === 0 ? 0 : 1
    const o = 1 - t
    const s = pairScore(placeOf[t] as number, placeOf[o] as number)
    const exp = expectedScore(ratingOf[t] as number, ratingOf[o] as number)
    return result(e, kFactor(e) * (s - exp))
  })
}

/** Rates one finished game. Returns one result per entrant, in the entrants' order. */
export function rateElo(mode: 'ffa' | 'teams', entrants: readonly EloEntrant[]): EloResult[] {
  return mode === 'ffa' ? rateFfa(entrants) : rateTeams(entrants)
}
