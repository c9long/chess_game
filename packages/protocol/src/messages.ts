import type { GameEvent, GameResult } from '@game/rules'
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
  UNTIMED,
} from './constants.ts'
import { z } from './zod.ts'

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

const lobbyNameSchema = z.string().trim().min(LOBBY_NAME_MIN).max(LOBBY_NAME_MAX)

/** `client.create('match', options)` for a multiplayer lobby (`kind` absent or 'lobby'). */
export const createLobbyOptionsSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.literal('lobby').default('lobby'),
  name: lobbyNameSchema,
  mode: z.enum(GAME_MODES),
  /** '10+0' or '3+2' ('untimed' is for solo games only). */
  timeControl: z.enum(TIME_CONTROL_IDS as [string, ...string[]]),
  /** Empty or absent = public lobby. Hashed (argon2id) in server memory, never stored. */
  password: z.string().max(LOBBY_PASSWORD_MAX).optional(),
  /** Only 'blind' is playable; 'draft' is answered with `not_implemented`. */
  pickMode: z.enum(PICK_MODES).default('blind'),
  /**
   * Ranked lobby: Elo-rated, registered accounts only (guests get `account_required` when
   * creating or joining) and no bots (`addBot` answers `ranked_no_bots`). Casual lobbies
   * (the default) are never rated.
   */
  ranked: z.boolean().default(false),
})
export type CreateLobbyOptions = z.input<typeof createLobbyOptionsSchema>

/**
 * `client.create('match', options)` for a singleplayer game: the creator plays South with
 * `civ`; three bots at `botLevel` take West, North and East with random civs. Untimed,
 * never listed, never rated; the game starts by itself.
 */
export const createSoloOptionsSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.literal('solo'),
  /** Optional; the server names the room `SOLO_DEFAULT_NAME` when absent. */
  name: lobbyNameSchema.optional(),
  mode: z.enum(GAME_MODES),
  timeControl: z.literal(UNTIMED),
  /** The player's civ (must be enabled). */
  civ: civSchema,
  /** Strength of all three bots. */
  botLevel: botLevelSchema,
})
export type CreateSoloOptions = z.input<typeof createSoloOptionsSchema>

/** `client.create('match', options)`: a lobby or a solo game. */
export const createOptionsSchema = z.union([createLobbyOptionsSchema, createSoloOptionsSchema])
export type CreateOptions = z.input<typeof createOptionsSchema>
export type ParsedCreateOptions = z.output<typeof createOptionsSchema>

/** `client.joinById(roomId, options)` */
export const joinOptionsSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  password: z.string().max(LOBBY_PASSWORD_MAX).optional(),
  /**
   * Watch instead of taking a seat (read-only spectator, see ROOM_NAMES.watch). Matchmaking
   * answers with a seat in the match's watch room (its `roomId` differs from the match
   * room's). Public lobbies and games: anyone signed in; password lobbies: the password;
   * challenge lobbies: the invited players and the host's friends. Refused with
   * `already_seated` for the room's own players and `spectators_full` past SPECTATORS_MAX.
   */
  spectate: z.boolean().optional(),
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
  /** Ranked lobby (Elo-rated, registered accounts only, no bots). */
  ranked: z.boolean(),
  /**
   * Civ slug per seat (South, West, North, East), '' for an open seat or one whose civ isn't
   * chosen yet. An additive field within protocol v1.
   */
  civs: z.array(z.string()).length(4),
  /**
   * Whether each seat (South, West, North, East) is taken by a human or a bot, so the lobby
   * browser can show which seats are free. An additive field within protocol v1.
   */
  occupied: z.array(z.boolean()).length(4),
  /** Spectators watching right now. An additive field within protocol v1. */
  spectators: z.number().int().optional(),
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
  /**
   * Resign: any seat still taking turns, at any time in game (not only on its turn).
   * - FFA: the army is removed at once.
   * - Teams: proposes resigning to the teammate (see `respondResign` and `resignEvent`). If
   *   the teammate agrees, the whole team resigns and the game ends with the other team
   *   winning; if they decline, both play on. A teammate who no longer takes turns can't be
   *   asked, so the team resigns at once. Sending `resign` while your teammate's proposal is
   *   pending agrees to it. Refused with `resign_proposal_pending` while your own proposal
   *   waits, and with `resign_proposal_cooldown` for TEAM_RESIGN_COOLDOWN_MOVES moves after
   *   it lapsed or was declined.
   */
  resign: empty,
  /**
   * Offer a draw: a draw voter (a seat still taking turns), when no offer is pending and the
   * cooldown after an earlier lapsed or declined offer has passed.
   */
  offerDraw: empty,
  /** Answer the pending draw offer (voters still pending only). */
  respondDraw: z.strictObject({ accept: z.boolean() }),
  /**
   * Teams: answer your teammate's pending proposal to resign. `accept: true` resigns the
   * whole team (the game ends, the other team wins); `false` declines and both play on.
   */
  respondResign: z.strictObject({ accept: z.boolean() }),
  /** Asks for an immediate `clock` message (e.g. after the tab was in the background). */
  syncClock: empty,
  // after the game (phase `finished`, seated humans)
  /**
   * Propose a rematch: the same players, mode, time control, seats, civs and bots in a fresh
   * lobby. Your own vote counts as accepted; every other seated human still in the room must
   * answer (`respondRematch`) within REMATCH_TIMEOUT_MS. See `rematchEvent`.
   */
  proposeRematch: empty,
  /** Answer the pending rematch proposal. */
  respondRematch: z.strictObject({ accept: z.boolean() }),
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

/** Kinds of game action in `events` messages (and their persisted match events). */
export const GAME_ACTIONS = ['move', 'timeout', 'abandon', 'resign', 'agreed_draw'] as const
export type GameAction = (typeof GAME_ACTIONS)[number]

/** Why a draw offer lapsed (see the `drawEvent` message). */
export const DRAW_LAPSE_REASONS = ['round', 'voters_changed'] as const
export type DrawLapseReason = (typeof DRAW_LAPSE_REASONS)[number]

/** Why a Teams resignation proposal lapsed (see the `resignEvent` message). */
export const RESIGN_LAPSE_REASONS = ['round', 'voters_changed'] as const
export type ResignLapseReason = (typeof RESIGN_LAPSE_REASONS)[number]

/** What happened to a Teams resignation proposal (see the `resignEvent` message). */
export const RESIGN_EVENT_TYPES = [
  'proposed',
  'accepted',
  'declined',
  'lapsed',
  'immediate',
] as const
export type ResignEventType = (typeof RESIGN_EVENT_TYPES)[number]

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
    /** A spectator in a watch room (read-only: every game message is refused). */
    spectator: z.boolean().optional(),
    /**
     * Spectators of a ranked game: how many full rounds late the room shows the game
     * (SPECTATOR_DELAY_ROUNDS); 0 or absent = live.
     */
    delayRounds: z.number().int().optional(),
  }),
  /** The result of one game action (a move, a timeout, an abandon, a resign or an agreed draw). */
  events: z.object({
    /** Action number in this game, from 1. */
    seq: z.number().int(),
    action: z.enum(GAME_ACTIONS),
    /** The acting seat (`agreed_draw`: the seat whose acceptance completed the agreement). */
    seat: seatSchema,
    /** The move notation for `move` actions, else null. */
    notation: z.string().nullable(),
    /** Rules-engine events in order (moves, captures, passes, defeats, game end). */
    events: z.array(gameEventSchema),
    /** Position after the action (feed to `Game.fromPosition` for snapshot + legal moves). */
    positionString: z.string(),
    seatToMove: seatOrNone,
    clock: clockSyncSchema,
    /**
     * The acting seat's time left right after the action (ms, increment included), for the
     * move log; null for untimed games and agreed draws. Optional: older servers omit it.
     */
    clockMs: z.number().nullable().optional(),
  }),
  /**
   * The game so far, for the move log: every action since the start, oldest first, in the
   * shape of the `events` message without its clock. Sent right after `welcome` (on join and
   * on every reconnect) once the game has started; the `events` messages that follow carry on
   * from its last `seq`. A client replaces its log with it.
   */
  moveLog: z.object({
    entries: z.array(
      z.object({
        seq: z.number().int(),
        action: z.enum(GAME_ACTIONS),
        seat: seatSchema,
        notation: z.string().nullable(),
        events: z.array(gameEventSchema),
        positionString: z.string(),
        /** As in the `events` message: the acting seat's time left after the action. */
        clockMs: z.number().nullable().optional(),
      }),
    ),
  }),
  /** Clock resync: on every turn change, every few seconds in game and on `syncClock`. */
  clock: clockSyncSchema,
  /** Final result, sent once persistence and ratings are done. */
  gameOver: z.object({
    matchId: z.string(),
    result: z.looseObject({ type: z.string() }),
    placements: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    endReason: z.string(),
    /** Elo was applied (ranked lobby, all four results recorded). */
    rated: z.boolean(),
    /** Per seat: Elo before/after when `rated`, else null. */
    ratings: z.array(z.object({ before: z.number(), after: z.number() }).nullable()),
  }),
  /**
   * A change to the draw offer, sent to everyone. The current offer itself is in the room
   * state (`drawOfferSeat`, `drawVotes`); this message says what happened, for toasts.
   * - `offered`: `seat` offered a draw (its own vote counts as accepted)
   * - `accepted`: `seat` accepted (when everyone has, an `events` message with action
   *   `agreed_draw` and the game end follow)
   * - `declined`: `seat` declined; the offer is over
   * - `lapsed`: the offer ended unanswered; `reason` is `round` (a full round passed: every
   *   other voter took a turn and the turn is back with the offerer) or `voters_changed` (a
   *   seat was defeated out of the game, removed or froze)
   */
  drawEvent: z.object({
    type: z.enum(['offered', 'accepted', 'declined', 'lapsed']),
    /** Who acted (for `lapsed`: the offerer). */
    seat: seatSchema,
    /** Who made the offer. */
    offerSeat: seatSchema,
    reason: z.enum(DRAW_LAPSE_REASONS).optional(),
  }),
  /**
   * Teams: a change to a proposal to resign the team, sent to everyone. The pending
   * proposals themselves are in the room state (`teamResignSeat`); this message says what
   * happened, for toasts.
   * - `proposed`: `seat` proposed resigning; its teammate must answer (`respondResign`)
   * - `accepted`: `seat` (the teammate) agreed; an `events` message with action `resign`
   *   (both seats out, the game over) follows
   * - `declined`: `seat` (the teammate) declined; both play on
   * - `lapsed`: the proposal ended unanswered; `seat` is the proposer, `reason` is `round`
   *   (a full round passed: every other seat still taking turns took a turn and the turn is
   *   back with the proposer) or `voters_changed` (the proposer or the teammate stopped
   *   taking turns; `outSeat` says which)
   * - `immediate`: `seat` resigned with a teammate who no longer takes turns (nobody to ask);
   *   the `events` message with action `resign` follows
   */
  resignEvent: z.object({
    type: z.enum(RESIGN_EVENT_TYPES),
    /** Who acted (for `lapsed` and `immediate`: the proposer). */
    seat: seatSchema,
    /** The team concerned: 0 = South+North, 1 = West+East. */
    team: z.union([z.literal(0), z.literal(1)]),
    reason: z.enum(RESIGN_LAPSE_REASONS).optional(),
    /**
     * `lapsed` with `voters_changed`: the seat (the proposer or its teammate) that stopped
     * taking turns. Sent with the event so clients can name it before the state patch that
     * marks the seat out arrives.
     */
    outSeat: seatSchema.optional(),
  }),
  /**
   * A change to the rematch proposal after the game, sent to everyone in the finished room.
   * The proposal itself is in the room state (`rematchSeat`, `rematchVotes`,
   * `rematchDeadline`, `rematchRoomId`); this message says what happened, for toasts.
   * - `proposed`: `seat` proposed a rematch (its own vote counts as accepted)
   * - `accepted` / `declined`: `seat` answered (`declined` also when a seat left the room)
   * - `ready`: the new lobby exists (`roomId`); players who accepted join it with
   *   `joinById(roomId)` and find their old seat and civ held for REMATCH_SEAT_HOLD_MS. It is
   *   ranked (`ranked`) only if the game was ranked and all four players accepted; otherwise
   *   casual, and a seat whose player declined is open to anyone.
   * - `cancelled`: no new lobby (`reason`: `proposer_left`, `nobody_accepted` or `failed`)
   */
  rematchEvent: z.object({
    type: z.enum(['proposed', 'accepted', 'declined', 'ready', 'cancelled']),
    seat: seatSchema.optional(),
    roomId: z.string().optional(),
    ranked: z.boolean().optional(),
    reason: z.enum(['proposer_left', 'nobody_accepted', 'failed']).optional(),
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
export type ServerMessages = Omit<Inferred, 'events' | 'gameOver' | 'moveLog'> & {
  events: Omit<Inferred['events'], 'events'> & { events: GameEvent[] }
  moveLog: { entries: MoveLogEntry[] }
  gameOver: Omit<Inferred['gameOver'], 'result'> & { result: GameResult }
}

/** One action in the `moveLog` message (an `events` message without its clock and turn). */
export type MoveLogEntry = Omit<Inferred['moveLog']['entries'][number], 'events'> & {
  events: GameEvent[]
}
