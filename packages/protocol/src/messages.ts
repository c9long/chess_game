import type { GameEvent, GameResult } from '@game/rules'
import { z } from 'zod'
import {
  BOT_LEVEL_LABELS,
  CIV_SLUGS,
  ERROR_CODES,
  GAME_MODES,
  LOBBY_NAME_MAX,
  LOBBY_NAME_MIN,
  LOBBY_PASSWORD_MAX,
  PICK_MODES,
  PROTOCOL_VERSION,
  TIME_CONTROL_IDS,
} from './constants.ts'

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export const seatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
export const civSchema = z.enum(CIV_SLUGS)
export const botLevelSchema = z.enum(BOT_LEVEL_LABELS)
export const errorCodeSchema = z.enum(ERROR_CODES)

// ---------------------------------------------------------------------------
// Join options (sent with matchmaking requests)
// ---------------------------------------------------------------------------

/** `client.create('match', options)` */
export const createOptionsSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  name: z.string().trim().min(LOBBY_NAME_MIN).max(LOBBY_NAME_MAX),
  mode: z.enum(GAME_MODES),
  timeControl: z.enum(TIME_CONTROL_IDS as [string, ...string[]]),
  /** Empty or absent = public lobby. Hashed (argon2id) in server memory, never stored. */
  password: z.string().max(LOBBY_PASSWORD_MAX).optional(),
  /** Only 'blind' is playable; 'draft' is answered with `not_implemented`. */
  pickMode: z.enum(PICK_MODES).default('blind'),
})
export type CreateOptions = z.input<typeof createOptionsSchema>

/** `client.joinById(roomId, options)` */
export const joinOptionsSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  password: z.string().max(LOBBY_PASSWORD_MAX).optional(),
})
export type JoinOptions = z.input<typeof joinOptionsSchema>

/** Room-listing metadata of a `match` room, as shown in the lobby browser. */
export const lobbyMetadataSchema = z.object({
  name: z.string(),
  mode: z.enum(GAME_MODES),
  timeControl: z.enum(TIME_CONTROL_IDS as [string, ...string[]]),
  /** Seats taken by humans or bots (0..4). */
  seatsFilled: z.number().int(),
  /** Password-protected (the lock icon). Not Colyseus' own `locked` (= full). */
  locked: z.boolean(),
  phase: z.string(),
  pickMode: z.enum(PICK_MODES),
})
export type LobbyMetadata = z.infer<typeof lobbyMetadataSchema>

// ---------------------------------------------------------------------------
// Client -> server messages
// ---------------------------------------------------------------------------

const empty = z.strictObject({})

/** Message type -> payload schema. Every payload is a JSON object. */
export const clientMessageSchemas = {
  // lobby (any seated human)
  setCiv: z.strictObject({ civ: civSchema }),
  setReady: z.strictObject({ ready: z.boolean() }),
  // lobby (host only)
  addBot: z.strictObject({ seat: seatSchema, level: botLevelSchema }),
  removeBot: z.strictObject({ seat: seatSchema }),
  setBotCiv: z.strictObject({ seat: seatSchema, civ: civSchema }),
  kick: z.strictObject({ seat: seatSchema }),
  swapSeats: z.strictObject({ a: seatSchema, b: seatSchema }),
  startGame: empty,
  // game
  move: z.strictObject({ move: z.string().min(4).max(8) }),
  /** Asks for an immediate `clock` message (e.g. after the tab was in the background). */
  syncClock: empty,
} as const

export type ClientMessageType = keyof typeof clientMessageSchemas
export type ClientMessages = {
  [K in ClientMessageType]: z.input<(typeof clientMessageSchemas)[K]>
}

/**
 * Reserved for designed-later features (PLAN §3). The server answers each with an `error`
 * message `{ code: 'not_implemented', requestType }`. Any type starting with `takeback` or
 * `chat.` is reserved too.
 */
export const RESERVED_MESSAGE_TYPES = [
  'resign',
  'offerDraw',
  'respondDraw',
  'takebackRequest',
  'takebackRespond',
  'chat.send',
  'chat.emote',
] as const

export function isReservedMessageType(type: string): boolean {
  return (
    (RESERVED_MESSAGE_TYPES as readonly string[]).includes(type) ||
    type.startsWith('takeback') ||
    type.startsWith('chat.')
  )
}

// ---------------------------------------------------------------------------
// Server -> client messages
// ---------------------------------------------------------------------------

const seatOrNone = z.union([seatSchema, z.literal(-1)])

/** Authoritative clock snapshot. */
export const clockSyncSchema = z.object({
  /** Remaining time per seat (S, W, N, E) at `serverTimestamp`. */
  remainingMs: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Seat whose clock is running, or -1. */
  runningSeat: seatOrNone,
  /** Server time (ms since epoch) the values were taken at. */
  serverTimestamp: z.number(),
  /** When the running seat's turn began (server ms since epoch), or 0. */
  turnStartedAt: z.number(),
})
export type ClockSync = z.infer<typeof clockSyncSchema>

/** One `@game/rules` GameEvent (see packages/rules/src/types.ts for the exact union). */
const gameEventSchema = z.looseObject({ type: z.string() })

export const serverMessageSchemas = {
  /** Sent to a client right after it joins (and after a reconnect). */
  welcome: z.object({
    protocolVersion: z.number().int(),
    roomId: z.string(),
    sessionId: z.string(),
    /** Seat of this client, or -1. */
    seat: seatOrNone,
    isHost: z.boolean(),
  }),
  /** The result of one game action (a move, a timeout or an abandon). */
  events: z.object({
    /** Action number in this game, from 1. */
    seq: z.number().int(),
    action: z.enum(['move', 'timeout', 'abandon']),
    seat: seatSchema,
    /** The move notation for `move` actions, else null. */
    notation: z.string().nullable(),
    /** Rules-engine events in order (moves, captures, passes, defeats, game end). */
    events: z.array(gameEventSchema),
    /** Position after the action (feed to `Game.fromPosition` for snapshot + legal moves). */
    positionString: z.string(),
    seatToMove: seatOrNone,
    clock: clockSyncSchema,
  }),
  /** Clock resync: on every turn change, every few seconds in game and on `syncClock`. */
  clock: clockSyncSchema,
  /** Final result, sent once persistence and ratings are done. */
  gameOver: z.object({
    matchId: z.string(),
    result: z.looseObject({ type: z.string() }),
    placements: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    endReason: z.string(),
    rated: z.boolean(),
    /** Per seat: display rating before/after (rated games, registered humans), else null. */
    ratings: z.array(z.object({ before: z.number(), after: z.number() }).nullable()),
  }),
  /** A request was refused, or a server-side problem. */
  error: z.object({
    code: errorCodeSchema,
    message: z.string().optional(),
    /** The client message type this answers, when it answers one. */
    requestType: z.string().optional(),
  }),
  /** Sent before the server closes a kicked client's connection. */
  kicked: z.object({ reason: z.string() }),
} as const

export type ServerMessageType = keyof typeof serverMessageSchemas
type Inferred = { [K in ServerMessageType]: z.infer<(typeof serverMessageSchemas)[K]> }

/** Server -> client payloads, with the rules-engine types filled in. */
export type ServerMessages = Omit<Inferred, 'events' | 'gameOver'> & {
  events: Omit<Inferred['events'], 'events'> & { events: GameEvent[] }
  gameOver: Omit<Inferred['gameOver'], 'result'> & { result: GameResult }
}
