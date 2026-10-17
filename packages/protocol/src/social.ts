/**
 * Friends, presence and challenges (PLAN §3 "Friends"): REST bodies and responses, the
 * `social` room's server messages, and the limits. REST does every action (so polling works
 * too); the `social` room pushes notifications and friends' online status. See README.md.
 */
import { z } from 'zod'
import { GAME_MODES, TIME_CONTROL_IDS } from './constants.ts'
import { seatSchema } from './messages.ts'

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

/**
 * Error codes of the social REST endpoints (`{ error: <code>, message }`):
 * - ACCOUNT_REQUIRED (403): guests can't have friends
 * - NOT_ELIGIBLE (403): you can only add players you are playing or have finished a game with
 *   (not bots, guests or deleted accounts; a lobby that never started doesn't count)
 * - SELF (400): that seat is you
 * - FRIEND_CAP (409): you already have FRIENDS_MAX friends
 * - TARGET_FRIEND_CAP (409): the other player already has FRIENDS_MAX friends
 * - OUTGOING_CAP (409): FRIEND_REQUESTS_OUTGOING_MAX requests are already waiting
 * - ALREADY_FRIENDS (409), ALREADY_REQUESTED (409)
 * - NOT_FRIENDS (403): a challenge may only invite your friends
 * - ALREADY_IN_ROOM (409): leave your current lobby or game before challenging
 * - CHALLENGE_CLOSED (409): the challenge expired, started or was closed
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
  'NOT_FOUND',
  'BAD_REQUEST',
  'RATE_LIMITED',
  'MAINTENANCE',
] as const
export type SocialErrorCode = (typeof SOCIAL_ERROR_CODES)[number]

// ---------------------------------------------------------------------------
// REST bodies
// ---------------------------------------------------------------------------

/**
 * `POST /api/friends/requests`: ask the player in `seat` of match `matchId` (one you are
 * playing or finished together) to be friends. User ids are never needed to add someone.
 */
export const friendRequestBodySchema = z.strictObject({
  matchId: z.uuid(),
  seat: seatSchema,
})
export type FriendRequestBody = z.input<typeof friendRequestBodySchema>

/**
 * `POST /api/challenges`: invite 1-3 friends to a new invite-only casual lobby. With `roomId`
 * (the challenge lobby you host, still before the game, after its invitation ended), invites
 * them to that lobby again instead; `mode` and `timeControl` are then the lobby's own.
 */
export const challengeBodySchema = z.strictObject({
  friendIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(CHALLENGE_MAX_INVITEES)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate friend'),
  mode: z.enum(GAME_MODES),
  timeControl: z.enum(TIME_CONTROL_IDS as [string, ...string[]]),
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
  limits: { maxFriends: number; maxOutgoing: number }
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
  /** `self` for your seat; `ineligible` for bots, guests, deleted accounts, aborted games. */
  seats: { seat: number; relation: FriendRelation | 'self' | 'ineligible' }[]
}

/** `POST /api/friends/requests` (also `.../accept`): the relation afterwards. */
export interface FriendRequestResponse {
  /** `friends` when the other player had already asked you (accepted at once). */
  relation: 'outgoing' | 'friends'
  user: SocialUser
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
