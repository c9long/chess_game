/**
 * Friends, presence and challenges (PLAN §3 "Friends"): REST bodies and responses, the
 * `social` room's server messages, and the limits. REST does every action (so polling works
 * too); the `social` room pushes notifications and friends' online status. See README.md.
 */

import { GAME_MODES, TIME_CONTROL_IDS } from './constants.ts'
import { seatSchema } from './messages.ts'
import type { BlockedUser } from './moderation.ts'
import type { RatingEntry } from './rest.ts'
import { z } from './zod.ts'

/** Accepted friends per player (both sides are checked when a request is accepted). */
export const FRIENDS_MAX = 50
/** Outgoing friend requests a player may have pending at once. */
export const FRIEND_REQUESTS_OUTGOING_MAX = 10
/** Friend requests a player may send per hour (attempts, successful or not). */
export const FRIEND_REQUESTS_PER_HOUR = 20
/** Friends one challenge may invite. */
export const CHALLENGE_MAX_INVITEES = 3
/** A challenge expires after this long (or earlier, when its lobby starts or closes). */
export const CHALLENGE_TTL_MS = 5 * 60_000
/** Challenges a player may send per 10 minutes. */
export const CHALLENGES_PER_10_MIN = 10
/** Player search: shortest query (search-as-you-type starts at this many characters). */
export const PLAYER_SEARCH_MIN_CHARS = 3
/** Player search: most results per query. */
export const PLAYER_SEARCH_MAX_RESULTS = 10
/** Player searches a signed-in user may run per minute. */
export const PLAYER_SEARCHES_PER_MIN = 30
/** Public profiles a signed-in user may open per minute. */
export const PROFILE_VIEWS_PER_MIN = 60
/** Finished games a public profile lists when its owner shows their recent games. */
export const PROFILE_RECENT_GAMES = 10

/**
 * "Who can send me friend requests" (Account page): `anyone` (the default) or `played_with`
 * (only players you are playing or have finished a game with). A refusal never says which.
 */
export const FRIEND_REQUEST_POLICIES = ['anyone', 'played_with'] as const
export type FriendRequestPolicy = (typeof FRIEND_REQUEST_POLICIES)[number]

/**
 * Error codes of the social REST endpoints (`{ error: <code>, message }`):
 * - ACCOUNT_REQUIRED (403): guests can't have friends
 * - NOT_ELIGIBLE (403): "We couldn't send that request." One neutral answer for every refusal
 *   that is about the other player: no such username, a guest, a bot, a deleted or suspended
 *   account, a seat in a lobby that never started or an aborted game, a player who blocked
 *   you, or a player who only takes requests from people they played with. It never says
 *   which (caps and limits about the sender have their own codes below)
 * - SELF (400): that seat (or username) is you
 * - FRIEND_CAP (409): you already have FRIENDS_MAX friends
 * - TARGET_FRIEND_CAP (409): the other player already has FRIENDS_MAX friends
 * - OUTGOING_CAP (409): FRIEND_REQUESTS_OUTGOING_MAX requests are already waiting
 * - ALREADY_FRIENDS (409), ALREADY_REQUESTED (409)
 * - NOT_FRIENDS (403): a challenge may only invite your friends
 * - ALREADY_IN_ROOM (409): leave your current lobby or game before challenging
 * - CHALLENGE_CLOSED (409): the challenge expired, started or was closed
 * - BLOCKED (409): you blocked that player (unblock them first). A player who blocked you gets
 *   the usual NOT_ELIGIBLE / NOT_FRIENDS answer instead, so a block is never revealed
 * - BLOCK_CAP (409): you already block BLOCKS_MAX players
 * - ALREADY_REPORTED (409): you have an open report about that player (for that game)
 * - FORBIDDEN (403): admin endpoints, for anyone not in ADMIN_USER_IDS
 * - NOT_FOUND (404), BAD_REQUEST (400), RATE_LIMITED (429), MAINTENANCE (503)
 */
export const SOCIAL_ERROR_CODES = [
  'ACCOUNT_REQUIRED',
  'NOT_ELIGIBLE',
  'SELF',
  'FRIEND_CAP',
  'TARGET_FRIEND_CAP',
  'OUTGOING_CAP',
  'ALREADY_FRIENDS',
  'ALREADY_REQUESTED',
  'NOT_FRIENDS',
  'ALREADY_IN_ROOM',
  'CHALLENGE_CLOSED',
  'BLOCKED',
  'BLOCK_CAP',
  'ALREADY_REPORTED',
  'FORBIDDEN',
  'NOT_FOUND',
  'BAD_REQUEST',
  'RATE_LIMITED',
  'MAINTENANCE',
] as const
export type SocialErrorCode = (typeof SOCIAL_ERROR_CODES)[number]

// ---------------------------------------------------------------------------
// REST bodies
// ---------------------------------------------------------------------------

/** A username as typed (any case): the username charset, at most 20 characters. */
export const usernameQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_]+$/)

/**
 * `POST /api/friends/requests`: ask a player to be friends, either the player in `seat` of
 * match `matchId` (one you are playing or finished together), or by exact `username` (any
 * case). User ids are never needed to add someone.
 */
export const friendRequestBodySchema = z.union([
  z.strictObject({ matchId: z.uuid(), seat: seatSchema }),
  z.strictObject({ username: usernameQuerySchema }),
])
export type FriendRequestBody = z.input<typeof friendRequestBodySchema>

/**
 * A search needs 3 letters or digits in a row. pg_trgm splits words at `_`, so a query such
 * as `___`, `a__` or `x_t` gives its "contains" match no usable trigram (or only one shared by
 * a large share of names), and Postgres scans every user instead of the index: 50-120 ms on
 * 50k users, against 5-20 ms for a query with a 3-character run.
 */
export const PLAYER_SEARCH_NEEDS = /[A-Za-z0-9]{3}/

/**
 * `GET /api/players?q=`: 3-20 username characters including 3 letters or digits in a row
 * (prefix and fuzzy match).
 */
export const playerSearchQuerySchema = z.strictObject({
  q: usernameQuerySchema.pipe(z.string().min(PLAYER_SEARCH_MIN_CHARS).regex(PLAYER_SEARCH_NEEDS)),
})

/**
 * `PUT /api/friends/settings`: the settings to change (at least one); the others keep their
 * value, so a client that only knows `friendRequests` never resets `publicHistory`.
 */
export const socialSettingsBodySchema = z
  .strictObject({
    friendRequests: z.enum(FRIEND_REQUEST_POLICIES).optional(),
    publicHistory: z.boolean().optional(),
  })
  .refine((b) => b.friendRequests !== undefined || b.publicHistory !== undefined, {
    message: 'Nothing to change',
  })
export type SocialSettingsBody = z.input<typeof socialSettingsBodySchema>

/**
 * `POST /api/challenges`: invite 1-3 friends to a new invite-only lobby, casual by default.
 * `ranked: true` makes it a ranked lobby (every ranked rule: registered accounts only, no bots,
 * Elo-rated, spectators see it late), which needs CHALLENGE_MAX_INVITEES friends since bots
 * can't fill a seat (`BAD_REQUEST` otherwise). With `roomId` (the challenge lobby you host,
 * still before the game, after its invitation ended), invites them to that lobby again
 * instead; `mode`, `timeControl` and `ranked` are then the lobby's own.
 */
export const challengeBodySchema = z.strictObject({
  friendIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(CHALLENGE_MAX_INVITEES)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate friend'),
  mode: z.enum(GAME_MODES),
  timeControl: z.enum(TIME_CONTROL_IDS as [string, ...string[]]),
  ranked: z.boolean().optional(),
  roomId: z.string().min(1).max(64).optional(),
})
export type ChallengeBody = z.input<typeof challengeBodySchema>

// ---------------------------------------------------------------------------
// Shapes shared by REST responses and social messages
// ---------------------------------------------------------------------------

/** Another registered player, as friends features show them. */
export const socialUserSchema = z.object({
  /** Stable id for the REST paths (friends and people with requests to or from you only). */
  userId: z.string(),
  username: z.string(),
})
export type SocialUser = z.infer<typeof socialUserSchema>

export const CHALLENGE_INVITEE_STATUSES = ['pending', 'declined', 'joined', 'expired'] as const
export type ChallengeInviteeStatus = (typeof CHALLENGE_INVITEE_STATUSES)[number]

export const CHALLENGE_CLOSE_REASONS = [
  'expired',
  'started',
  'closed',
  'cancelled',
  'answered',
] as const
export type ChallengeCloseReason = (typeof CHALLENGE_CLOSE_REASONS)[number]

export const challengeSchema = z.object({
  id: z.string(),
  from: socialUserSchema,
  /** The invite-only lobby: `joinById(roomId, { protocolVersion })` (no password needed). */
  roomId: z.string(),
  mode: z.enum(GAME_MODES),
  timeControl: z.string(),
  /** A ranked lobby: Elo-rated, registered accounts only, no bots. */
  ranked: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  /**
   * Everyone invited. In an invitee's view, `user.userId` is left out for co-invitees who
   * aren't that invitee's friends (only the name is shown); the challenger sees every id.
   */
  invitees: z.array(
    z.object({
      user: socialUserSchema.extend({ userId: z.string().optional() }),
      status: z.enum(CHALLENGE_INVITEE_STATUSES),
    }),
  ),
})
export type Challenge = z.infer<typeof challengeSchema>

// ---------------------------------------------------------------------------
// REST responses
// ---------------------------------------------------------------------------

export interface Friend extends SocialUser {
  /** Connected to the `social` room right now (on any device). */
  online: boolean
  /** When the request was accepted (ISO). */
  since: string
}

export interface FriendRequest {
  user: SocialUser
  createdAt: string
}

/** `GET /api/friends` */
export interface FriendsResponse {
  friends: Friend[]
  /** Requests to you, newest first. */
  incoming: FriendRequest[]
  /** Your requests waiting for an answer, newest first. */
  outgoing: FriendRequest[]
  /** Players you blocked, newest first. */
  blocked: BlockedUser[]
  limits: { maxFriends: number; maxOutgoing: number; maxBlocked: number }
}

/** Your relation to another player: what an "Add friend" button shows. */
export type FriendRelation = 'none' | 'outgoing' | 'incoming' | 'friends'

/** `GET /api/friends/match/:matchId` (participants only): relation per seat of that match. */
export interface MatchRelationsResponse {
  matchId: string
  /** You have FRIENDS_MAX friends: new requests are refused. */
  capReached: boolean
  /** You have FRIEND_REQUESTS_OUTGOING_MAX requests waiting. */
  outgoingFull: boolean
  /**
   * `self` for your seat; `ineligible` for bots, guests, deleted accounts, aborted games, and
   * players who blocked you (shown like any other ineligible seat, so the block isn't revealed).
   * `blocked`: you blocked this player (registered players only; "Unblock" in the menu).
   * `blockable`: another registered player, so the menu offers Block or Unblock.
   */
  seats: {
    seat: number
    relation: FriendRelation | 'self' | 'ineligible'
    blocked: boolean
    blockable: boolean
  }[]
}

/** `POST /api/friends/requests` (also `.../accept`): the relation afterwards. */
export interface FriendRequestResponse {
  /** `friends` when the other player had already asked you (accepted at once). */
  relation: 'outgoing' | 'friends'
  user: SocialUser
}

/**
 * Your relation to a player in search results and on their profile: a `FriendRelation`, or
 * `unavailable` ("can't add") when you can't send a new request yourself (you have
 * FRIENDS_MAX friends, or FRIEND_REQUESTS_OUTGOING_MAX requests waiting; see the flags).
 * It never reflects the other player's blocks or privacy setting: those refuse the request
 * with the neutral NOT_ELIGIBLE instead.
 */
export type PlayerRelation = FriendRelation | 'unavailable'

/** One player in `GET /api/players?q=`. */
export interface PlayerSearchResult {
  username: string
  /** Their Elo in the mode x time control they played most (ranked), or null. */
  rating: { rating: number; mode: 'ffa' | 'teams'; timeControl: string } | null
  /** Finished games (any mode). */
  gamesPlayed: number
  relation: PlayerRelation
  /**
   * Only when there is a friendship or a request either way (the id the Friends page already
   * shows you, for Accept and Challenge).
   */
  userId?: string
}

/**
 * `GET /api/players?q=` (signed-in registered accounts, PLAYER_SEARCHES_PER_MIN per minute):
 * up to PLAYER_SEARCH_MAX_RESULTS live registered players whose username starts with or
 * resembles `q`; prefix matches first, then by similarity. Never lists yourself, guests,
 * deleted or suspended accounts, or players you blocked. Players who blocked you are listed
 * like anyone else (their profile is public, so hiding them would reveal the block); a
 * request to them fails with the neutral NOT_ELIGIBLE.
 */
export interface PlayerSearchResponse {
  query: string
  results: PlayerSearchResult[]
  /** You have FRIENDS_MAX friends. */
  capReached: boolean
  /** You have FRIEND_REQUESTS_OUTGOING_MAX requests waiting. */
  outgoingFull: boolean
}

/** One public Elo rating on a profile (the numbers the leaderboard shows). */
export interface ProfileRating extends RatingEntry {
  /** Fewer ranked games than the leaderboard needs (`LEADERBOARD_MIN_GAMES`). */
  provisional: boolean
}

/**
 * Another seat of a game on a public profile. `kind` says how it is named: `player` is a
 * registered account (`name` is its username), `guest` reads "Guest", `deleted` reads
 * "Deleted player" and `bot` reads "Bot <level>" (no guest names or deletion numbers).
 */
export interface ProfileGamePlayer {
  seat: number
  team: number | null
  kind: 'player' | 'guest' | 'deleted' | 'bot'
  name: string
  /**
   * The username to link to (`/u/<username>`): every registered account that keeps its
   * username. Suspended accounts read the same (their profile answers the same 404 as an
   * unknown name), so the list never tells who is suspended.
   */
  username?: string
  civ: string
  placement: number | null
}

/** One finished game of the profile's owner (their recent games, newest first). */
export interface ProfileGame {
  /** Only when the viewer played in this game too (their /history/:id page). */
  id?: string
  /**
   * The day the game ended, `YYYY-MM-DD` (UTC). Only the day: an exact time would let anyone
   * follow when the other players in it were online.
   */
  playedOn: string
  mode: 'ffa' | 'teams'
  timeControl: string
  /** Played in a ranked lobby. */
  ranked: boolean
  /** Elo-rated: a ranked game whose Elo was applied (not past the repeat limit). */
  rated: boolean
  /** The rules version it was played under (older ones have details but no replay). */
  rulesVersion: number
  /** `MatchEndReason`, e.g. `checkmate` or `agreed_draw`. */
  endReason: string | null
  /** The owner's seat, team, civ and placement. */
  seat: number
  team: number | null
  civ: string
  placement: number | null
  /** The owner's Elo change in a rated game; null otherwise. */
  ratingDelta: number | null
  /** The other three seats, by seat. */
  others: ProfileGamePlayer[]
}

/**
 * `GET /api/players/:username` (signed in, PROFILE_VIEWS_PER_MIN per minute): a registered
 * player's public profile. 404 NOT_FOUND ("Player not found") for unknown, guest, deleted and
 * suspended accounts alike. Match history stays private (participants only) unless the owner
 * turned on `publicHistory`: then `recentGames` lists their last PROFILE_RECENT_GAMES finished
 * games. Replays stay participants only.
 */
export interface PublicProfileResponse {
  username: string
  /** Month the account was created, `YYYY-MM`. */
  memberSince: string
  /** Finished games (any mode). */
  gamesPlayed: number
  /** Elo per mode x time control with at least one ranked game. */
  ratings: ProfileRating[]
  /** The civ they played most in finished games, or null. */
  favoriteCiv: { slug: string; games: number } | null
  /** `self` on your own profile; guests viewing get `unavailable`. */
  relation: PlayerRelation | 'self'
  /** As in search results: only with a friendship or a request either way, or a block of yours. */
  userId?: string
  /** You blocked this player (Unblock in the menu; requests and challenges are off). */
  blockedByYou: boolean
  capReached: boolean
  outgoingFull: boolean
  /**
   * The owner's last finished games, or null: they didn't turn on `publicHistory`, the viewer
   * is a guest (registered viewers only, so a block can't be dodged with a guest session), or
   * either of you blocked the other (the same null either way, so a block isn't revealed).
   */
  recentGames: ProfileGame[] | null
}

/** `GET /api/friends/settings` and `PUT /api/friends/settings` */
export interface SocialSettingsResponse {
  friendRequests: FriendRequestPolicy
  /** Show my recent games on my public profile (off by default). */
  publicHistory: boolean
}

/** `GET /api/challenges`: open challenges to you and from you. */
export interface ChallengesResponse {
  incoming: Challenge[]
  outgoing: Challenge[]
}

/** `POST /api/challenges` */
export interface CreateChallengeResponse {
  challenge: Challenge
}

// ---------------------------------------------------------------------------
// `social` room: server -> client messages (no client messages; actions are REST)
// ---------------------------------------------------------------------------

export const socialMessageSchemas = {
  /** A friend came online or went offline (after a short grace for reconnects). */
  presence: z.object({ userId: z.string(), online: z.boolean() }),
  /** Someone asked you to be friends. */
  friendRequest: z.object({ user: socialUserSchema, createdAt: z.string() }),
  /** You and `user` are now friends (they accepted your request, or you theirs elsewhere). */
  friendAccepted: z.object({ user: socialUserSchema, online: z.boolean() }),
  /**
   * The friends list changed in a way without its own toast: a friend removed you, a request
   * to you was cancelled, a request of yours was declined, or another device of yours acted.
   * Refetch `GET /api/friends`.
   */
  friendsChanged: z.object({}),
  /** A friend challenged you: join with `joinById(roomId)` or decline over REST. */
  challenge: challengeSchema,
  /** To the challenger: an invitee declined or joined. */
  challengeUpdate: z.object({
    challengeId: z.string(),
    user: socialUserSchema,
    status: z.enum(CHALLENGE_INVITEE_STATUSES),
  }),
  /**
   * The challenge is over: `expired` (CHALLENGE_TTL_MS passed), `started` (its game began),
   * `closed` (the lobby closed), `cancelled` (the challenger withdrew it or sent a new one);
   * sent to the challenger and every invitee. `answered` goes only to an invitee whose other
   * tab or device declined or joined it (drop the prompt).
   */
  challengeClosed: z.object({
    challengeId: z.string(),
    reason: z.enum(CHALLENGE_CLOSE_REASONS),
  }),
} as const

export type SocialMessageType = keyof typeof socialMessageSchemas
export type SocialMessages = {
  [K in SocialMessageType]: z.infer<(typeof socialMessageSchemas)[K]>
}
