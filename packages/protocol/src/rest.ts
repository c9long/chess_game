/** JSON shapes of the match-history REST endpoints (apps/server/src/game/routes.ts). */

export interface MatchListOpponent {
  seat: number
  /** Display name; 'Bot 1500' for bots; 'Deleted player' for deleted accounts. */
  name: string
  civ: string
  botLevel: string | null
  isGuest: boolean
}

export interface MatchListItem {
  id: string
  status: 'in_progress' | 'finished' | 'aborted'
  startedAt: string
  endedAt: string | null
  mode: 'ffa' | 'teams'
  timeControl: string
  rated: boolean
  endReason: string | null
  /** The current user's seat, civ and result. */
  seat: number
  civ: string
  placement: number | null
  ratingBefore: number | null
  ratingAfter: number | null
  ratingDelta: number | null
  opponents: MatchListOpponent[]
}

/** GET /api/matches?limit=&before= */
export interface MatchListResponse {
  matches: MatchListItem[]
  /** Pass as `before` for the next page, or null at the end. */
  nextCursor: string | null
}

export interface MatchDetailPlayer {
  seat: number
  team: number | null
  name: string
  isGuest: boolean
  isYou: boolean
  botLevel: string | null
  civ: string
  civVersion: number
  finalStatus: string | null
  placement: number | null
  defeatReason: string | null
  defeatSeq: number | null
  ratingBefore: number | null
  ratingAfter: number | null
}

export interface MatchDetailEvent {
  seq: number
  seat: number | null
  type: string
  payload: unknown
  clockRemainingMs: number | null
  serverTs: string
}

/** GET /api/matches/:id */
export interface MatchDetailResponse {
  id: string
  status: 'in_progress' | 'finished' | 'aborted'
  mode: 'ffa' | 'teams'
  timeControl: string
  rated: boolean
  rulesVersion: number
  startedAt: string
  endedAt: string | null
  endReason: string | null
  players: MatchDetailPlayer[]
  events: MatchDetailEvent[]
}

export interface RatingEntry {
  mode: 'ffa' | 'teams'
  timeControl: string
  /** Elo-like display number (see docs/RATINGS in the server README). */
  rating: number
  mu: number
  sigma: number
  gamesPlayed: number
}

/** GET /api/ratings/me (public ratings only; shadow ratings are never exposed). */
export interface RatingsResponse {
  ratings: RatingEntry[]
}
