/** JSON shapes of the match-history REST endpoints (apps/server/src/game/routes.ts). */

export interface MatchListOpponent {
  seat: number
  /** Display name; 'Bot 1500' for bots; 'Deleted player' for deleted accounts. */
  name: string
  civ: string
  botLevel: string | null
  isGuest: boolean
  /**
   * Your friend relation to this opponent (what an "Add friend" button shows), or null when
   * they can't be added: bots, guests, deleted accounts, aborted games, or you are a guest.
   */
  friend: 'none' | 'outgoing' | 'incoming' | 'friends' | null
}

export interface MatchListItem {
  id: string
  status: 'in_progress' | 'finished' | 'aborted'
  startedAt: string
  endedAt: string | null
  mode: 'ffa' | 'teams'
  timeControl: string
  /** Elo-rated: a ranked game whose result and Elo were recorded. */
  rated: boolean
  /** Played in a ranked lobby (true even when it ended aborted or unrated). */
  ranked: boolean
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
  /** Played in a ranked lobby. */
  ranked: boolean
  rulesVersion: number
  startedAt: string
  endedAt: string | null
  endReason: string | null
  players: MatchDetailPlayer[]
  events: MatchDetailEvent[]
}

/** One Elo rating (ranked games), per mode x time control. */
export interface RatingEntry {
  mode: 'ffa' | 'teams'
  timeControl: string
  /** Elo (starts at 1200). */
  rating: number
  /** Ranked games played in this mode x time control. */
  gamesPlayed: number
  /** Highest Elo reached. */
  peak: number
}

/** GET /api/ratings/me: your Elo ratings (hidden shadow ratings are never exposed). */
export interface RatingsResponse {
  ratings: RatingEntry[]
}

export interface LeaderboardEntry {
  /** 1-based; players with the same rating share a rank. */
  rank: number
  username: string
  rating: number
  gamesPlayed: number
  peak: number
}

/**
 * GET /api/leaderboard?mode=ffa|teams&tc=10%2B0|3%2B2&limit= (public, no session needed):
 * the top registered players with at least `minGames` ranked games. Deleted accounts and
 * guests are never listed.
 */
export interface LeaderboardResponse {
  mode: 'ffa' | 'teams'
  timeControl: string
  minGames: number
  entries: LeaderboardEntry[]
}
