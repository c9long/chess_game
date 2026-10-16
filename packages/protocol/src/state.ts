/**
 * Synced state of a `match` room (Colyseus schema). Kept Unity-friendly: only strings,
 * numbers, booleans, nested schemas and arrays (no maps, no unions). Seats are always 4
 * entries in seat order (S, W, N, E). Field order is part of the wire format: append new
 * fields at the end of a schema and bump PROTOCOL_VERSION for incompatible changes.
 *
 * `schema-codegen packages/protocol/src/state.ts --csharp --output <dir>` generates the C#
 * classes for the Unity client.
 */
import { ArraySchema, type SchemaType, schema, t } from '@colyseus/schema'

export const SeatState = schema(
  {
    /** A human or a bot holds the seat. */
    occupied: t.boolean().default(false),
    /** Colyseus session of the seated human ('' for bots and empty seats). Lets a client find its seat. */
    sessionId: t.string().default(''),
    displayName: t.string().default(''),
    isGuest: t.boolean().default(false),
    isBot: t.boolean().default(false),
    /** BOT_LEVELS label ('600' ... '2400', 'max') for bots, else ''. */
    botLevel: t.string().default(''),
    /** Civ slug, '' until chosen. */
    civ: t.string().default(''),
    ready: t.boolean().default(false),
    connected: t.boolean().default(false),
    /** Reconnect deadline (server ms since epoch) while disconnected, else 0. */
    graceDeadline: t.float64().default(0),
    /** Teams: 0 = South+North, 1 = West+East; FFA: -1. */
    team: t.int8().default(-1),
    /** In game: the rules seat status (active, defeated, frozen, removed); '' before. */
    status: t.string().default(''),
  },
  'SeatState',
)
export type SeatState = SchemaType<typeof SeatState>

export const ClockState = schema(
  {
    /** Remaining ms per seat at `serverTimestamp`. */
    remainingMs: t.array('float64'),
    /** Seat whose clock runs, or -1. */
    runningSeat: t.int8().default(-1),
    serverTimestamp: t.float64().default(0),
    turnStartedAt: t.float64().default(0),
    incrementMs: t.float64().default(0),
  },
  'ClockState',
)
export type ClockState = SchemaType<typeof ClockState>

/** One rules-engine event of the latest action, flattened (unused fields are '' / -1). */
export const EventState = schema(
  {
    /** GameEvent type: move_made, capture, en_passant, promotion, castle, pass, defeat, army_removed, frozen, game_ended. */
    type: t.string(),
    seat: t.int8().default(-1),
    notation: t.string().default(''),
    from: t.string().default(''),
    to: t.string().default(''),
    /** capture / promotion square, or en passant captured square. */
    square: t.string().default(''),
    /** Moving piece kind (move_made), captured kind (capture) or new kind (promotion). */
    piece: t.string().default(''),
    /** Owner seat of the captured piece (capture), else -1. */
    pieceOwner: t.int8().default(-1),
    promotion: t.string().default(''),
    flag: t.string().default(''),
    /** Defeat reason. */
    reason: t.string().default(''),
  },
  'EventState',
)
export type EventState = SchemaType<typeof EventState>

export const ResultState = schema(
  {
    /**
     * '' until the game ends; then ffa_winner, ffa_move_limit_tie, ffa_agreed_draw,
     * teams_winner, teams_draw, teams_agreed_draw or aborted.
     */
    type: t.string().default(''),
    winnerSeat: t.int8().default(-1),
    /** Teams: 'south_north' or 'west_east'. */
    winnerTeam: t.string().default(''),
    /** last_standing, team_eliminated, move_limit, agreed_draw, server_shutdown, ... */
    endReason: t.string().default(''),
    /** Placement per seat (1 = best; ties share). */
    placements: t.array('uint8'),
  },
  'ResultState',
)
export type ResultState = SchemaType<typeof ResultState>

export const MatchState = schema(
  {
    protocolVersion: t.uint8().default(1),
    name: t.string().default(''),
    mode: t.string().default('ffa'),
    timeControl: t.string().default('10+0'),
    pickMode: t.string().default('blind'),
    hasPassword: t.boolean().default(false),
    /** Seat of the host, or -1. */
    hostSeat: t.int8().default(-1),
    phase: t.string().default('waiting'),
    /** Server ms since epoch when the countdown ends, else 0. */
    countdownEndsAt: t.float64().default(0),
    seats: t.array(SeatState),
    /** DB match id once the game started. */
    matchId: t.string().default(''),
    rated: t.boolean().default(false),
    /** rules-core position string; `Game.fromPosition()` rebuilds snapshot + legal moves. */
    positionString: t.string().default(''),
    seatToMove: t.int8().default(-1),
    /** Number of game actions so far (matches `events.seq`). */
    actionSeq: t.uint32().default(0),
    clock: ClockState,
    lastEvents: t.array(EventState),
    result: ResultState,
    /** Reconnect grace in ms (for client display). */
    reconnectGraceMs: t.float64().default(60_000),
    /**
     * Seat that made the pending draw offer, or -1. The offer lapses when anyone declines,
     * when the set of voters changes (a defeat, removal or freeze) or after one full round:
     * every other voter has taken a turn since the offer and the turn is back with this seat.
     */
    drawOfferSeat: t.int8().default(-1),
    /** Per seat while an offer is pending: -1 not a voter, 0 pending, 1 accepted (all -1 otherwise). */
    drawVotes: t.array('int8'),
    /** `actionSeq` when the pending offer was made (0 when none): tells offers apart. */
    drawOfferActionSeq: t.uint32().default(0),
    /**
     * Per seat: moves still to make before it may offer a draw again (set to
     * DRAW_OFFER_COOLDOWN_MOVES when its offer lapses or is declined).
     */
    drawCooldowns: t.array('uint8'),
    /**
     * Ranked lobby (set at create, never changes): Elo-rated, registered accounts only, no
     * bots. `rated` says whether the finished game was actually rated.
     */
    ranked: t.boolean().default(false),
  },
  'MatchState',
)
export type MatchState = SchemaType<typeof MatchState>

/** A fresh state with 4 empty seats. */
export function createMatchState(): MatchState {
  const state = new MatchState()
  state.seats = new ArraySchema<SeatState>(
    new SeatState(),
    new SeatState(),
    new SeatState(),
    new SeatState(),
  )
  state.clock = new ClockState()
  state.clock.remainingMs = new ArraySchema<number>(0, 0, 0, 0)
  state.result = new ResultState()
  state.result.placements = new ArraySchema<number>()
  state.lastEvents = new ArraySchema<EventState>()
  state.drawVotes = new ArraySchema<number>(-1, -1, -1, -1)
  state.drawCooldowns = new ArraySchema<number>(0, 0, 0, 0)
  return state
}

/** Plain-JSON shape of the decoded state (what `room.state.toJSON()` returns on clients). */
export interface MatchStateJson {
  protocolVersion: number
  name: string
  mode: 'ffa' | 'teams'
  timeControl: string
  pickMode: string
  hasPassword: boolean
  hostSeat: number
  phase: string
  countdownEndsAt: number
  seats: SeatStateJson[]
  matchId: string
  rated: boolean
  positionString: string
  seatToMove: number
  actionSeq: number
  clock: {
    remainingMs: number[]
    runningSeat: number
    serverTimestamp: number
    turnStartedAt: number
    incrementMs: number
  }
  lastEvents: Record<string, string | number>[]
  result: {
    type: string
    winnerSeat: number
    winnerTeam: string
    endReason: string
    placements: number[]
  }
  reconnectGraceMs: number
  drawOfferSeat: number
  drawVotes: number[]
  drawOfferActionSeq: number
  drawCooldowns: number[]
  ranked: boolean
}

export interface SeatStateJson {
  occupied: boolean
  sessionId: string
  displayName: string
  isGuest: boolean
  isBot: boolean
  botLevel: string
  civ: string
  ready: boolean
  connected: boolean
  graceDeadline: number
  team: number
  status: string
}
