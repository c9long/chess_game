/**
 * JSON wire contract of the rules engine (crates/rules-wasm/src/dto.rs).
 *
 * Shared by the browser and the server, which relays and persists these
 * objects, so keep them stable. Conventions:
 * - object keys are camelCase;
 * - enum values are snake_case string literals (same as rules-core's serde);
 * - squares are names, 'a1' to 'l12';
 * - per-seat tuples are in turn order South, West, North, East (see `SEATS`);
 * - the board has 144 entries, index `rank * 12 + file` (a1 = 0, l12 = 143).
 *
 * The tests in contract.test.ts check every value produced by the engine
 * against these types, key by key.
 */

/** Seats in turn order (clockwise). Index = position in per-seat tuples. */
export const SEATS = ['south', 'west', 'north', 'east'] as const
export type Seat = (typeof SEATS)[number]

export const TEAMS = ['south_north', 'west_east'] as const
export type Team = (typeof TEAMS)[number]

export const GAME_MODES = ['ffa', 'teams'] as const
export type GameMode = (typeof GAME_MODES)[number]

export const PIECE_KINDS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const
export type PieceKind = (typeof PIECE_KINDS)[number]

export const SEAT_STATUSES = ['active', 'defeated', 'frozen', 'removed'] as const
export type SeatStatus = (typeof SEAT_STATUSES)[number]

export const DEFEAT_REASONS = [
  'leader_captured',
  'stalemate',
  'timeout',
  'abandon',
  'resign',
] as const
export type DefeatReason = (typeof DEFEAT_REASONS)[number]

export const MOVE_FLAGS = ['normal', 'double_step', 'castle', 'en_passant'] as const
export type MoveFlag = (typeof MOVE_FLAGS)[number]

/** Civ ids (same slugs as `CIVILIZATIONS` in @game/config). */
export const CIV_IDS = [
  'canada',
  'usa',
  'china',
  'japan',
  'germany',
  'russia',
  'england',
  'france',
  'mali',
] as const
export type CivId = (typeof CIV_IDS)[number]

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'] as const
export type File = (typeof FILES)[number]
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12'
/** A square name, 'a1' to 'l12'. */
export type Square = `${File}${Rank}`

/** One value per seat, in `SEATS` order. */
export type SeatTuple<T> = readonly [T, T, T, T]

/** Notation of an automatic pass in move logs. */
export const PASS_NOTATION = '--'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** A civ and the version of its definition used for a game. */
export interface CivSpec {
  readonly id: CivId
  readonly version: number
}

/** A civ in a config: a slug (latest version) or an exact version. */
export type CivInput = CivId | CivSpec

/** Input to `Game.create`. Only `mode` is required. */
export interface GameConfigInput {
  readonly mode: GameMode
  /** Default: Canada v1 for every seat (civs are cosmetic in v1). */
  readonly civs?: SeatTuple<CivInput>
  /** En passant (provisional rule). Default true. */
  readonly enPassant?: boolean
  /** No-progress rounds before the game ends. Default 25. */
  readonly moveLimitRounds?: number
  /** Must equal the engine's rules version when given. */
  readonly rulesVersion?: number
}

/** The configuration as reported by a snapshot (also valid `GameConfigInput`). */
export interface GameConfig {
  readonly mode: GameMode
  readonly civs: SeatTuple<CivSpec>
  readonly enPassant: boolean
  readonly moveLimitRounds: number
  readonly rulesVersion: number
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface Piece {
  readonly kind: PieceKind
  readonly owner: Seat
}

export interface CastlingRights {
  /** With the long-side rook (South: c1). */
  readonly long: boolean
  /** With the short-side rook (South: j1). */
  readonly short: boolean
}

export interface EpTarget {
  /** Square the pawn passed over (where an en passant capturer lands). */
  readonly skipped: Square
  /** Square of the double-stepped pawn. */
  readonly pawn: Square
}

export interface DefeatRecord {
  readonly seat: Seat
  readonly reason: DefeatReason
}

/**
 * How the game ended. Draws: 'ffa_move_limit_tie' / 'teams_draw' (move limit) and
 * 'ffa_agreed_draw' / 'teams_agreed_draw' (every seat still taking turns agreed). In
 * FFA draws the surviving (active) seats share the best remaining placement.
 */
export type GameResult =
  | { readonly type: 'ffa_winner'; readonly seat: Seat }
  | { readonly type: 'ffa_move_limit_tie'; readonly survivors: SeatTuple<boolean> }
  | { readonly type: 'teams_winner'; readonly team: Team }
  | { readonly type: 'teams_draw' }
  | { readonly type: 'ffa_agreed_draw'; readonly survivors: SeatTuple<boolean> }
  | { readonly type: 'teams_agreed_draw' }

export type GameResultType = GameResult['type']

export const GAME_RESULT_TYPES = [
  'ffa_winner',
  'ffa_move_limit_tie',
  'teams_winner',
  'teams_draw',
  'ffa_agreed_draw',
  'teams_agreed_draw',
] as const satisfies readonly GameResultType[]

export interface Outcome {
  readonly result: GameResult
  /** Placement per seat, 1 = best; ties share a value (1, 1, 3, 4). */
  readonly placements: SeatTuple<number>
}

/** Full view of a position. */
export interface Snapshot {
  readonly rulesVersion: number
  readonly config: GameConfig
  /** 144 squares, index `rank * 12 + file`; `null` = empty. */
  readonly board: readonly (Piece | null)[]
  readonly statuses: SeatTuple<SeatStatus>
  /** Seat on move (meaningless once `isOver`). */
  readonly seatToMove: Seat
  readonly castling: SeatTuple<CastlingRights>
  /** Live en passant target per seat. */
  readonly epTargets: SeatTuple<EpTarget | null>
  /** Turns since the last capture, pawn move or defeat. */
  readonly noProgress: number
  /** The `noProgress` value that ends the game. */
  readonly moveLimit: number
  /** Turns taken since the start (moves and passes). */
  readonly ply: number
  /** Defeat order, first defeated first. */
  readonly defeats: readonly DefeatRecord[]
  readonly outcome: Outcome | null
  readonly isOver: boolean
  /** Zobrist hash: 16 lowercase hex digits. */
  readonly hash: string
  /** Per seat: an ACTIVE seat's leader is attacked (information only). */
  readonly leaderUnderAttack: SeatTuple<boolean>
}

// ---------------------------------------------------------------------------
// Moves and events
// ---------------------------------------------------------------------------

/** A legal move of the seat to move. */
export interface MoveView {
  /** What `applyMove` takes, e.g. 'c2c4', 'a10a12', 'c6c7q'. */
  readonly notation: string
  /** Origin (castling: the leader's square). */
  readonly from: Square
  /** Destination (castling: the leader's destination; en passant: the skipped square). */
  readonly to: Square
  readonly promotion: PieceKind | null
  readonly flag: MoveFlag
  /** Kind of the moving piece. */
  readonly piece: PieceKind
  /** Whether the move captures (including en passant). */
  readonly capture: boolean
}

export interface MoveMadeEvent {
  readonly type: 'move_made'
  readonly seat: Seat
  readonly notation: string
  readonly from: Square
  readonly to: Square
  readonly promotion: PieceKind | null
  readonly flag: MoveFlag
  /** Moving piece kind (before promotion). */
  readonly piece: PieceKind
}

export interface CaptureEvent {
  readonly type: 'capture'
  readonly seat: Seat
  /** Where the captured piece stood. */
  readonly square: Square
  readonly captured: Piece
}

/** Follows the `capture` it qualifies. */
export interface EnPassantEvent {
  readonly type: 'en_passant'
  readonly seat: Seat
  readonly capturedSquare: Square
}

export interface PromotionEvent {
  readonly type: 'promotion'
  readonly seat: Seat
  readonly square: Square
  readonly kind: PieceKind
}

/** The leader's part of a castle is the preceding `move_made`. */
export interface CastleEvent {
  readonly type: 'castle'
  readonly seat: Seat
  readonly rookFrom: Square
  readonly rookTo: Square
}

/** A DEFEATED Teams seat had no legal move and passed automatically. */
export interface PassEvent {
  readonly type: 'pass'
  readonly seat: Seat
  readonly notation: typeof PASS_NOTATION
}

/** An ACTIVE seat was defeated. */
export interface DefeatEvent {
  readonly type: 'defeat'
  readonly seat: Seat
  readonly reason: DefeatReason
}

/** A seat's army was taken off the board (FFA defeats, losing Teams side at game end). */
export interface ArmyRemovedEvent {
  readonly type: 'army_removed'
  readonly seat: Seat
}

/** Teams: a seat became FROZEN. */
export interface FrozenEvent {
  readonly type: 'frozen'
  readonly seat: Seat
}

/** Always the last event of the action that ended the game. */
export interface GameEndedEvent {
  readonly type: 'game_ended'
  readonly outcome: Outcome
}

export type GameEvent =
  | MoveMadeEvent
  | CaptureEvent
  | EnPassantEvent
  | PromotionEvent
  | CastleEvent
  | PassEvent
  | DefeatEvent
  | ArmyRemovedEvent
  | FrozenEvent
  | GameEndedEvent

export type GameEventType = GameEvent['type']

export const GAME_EVENT_TYPES = [
  'move_made',
  'capture',
  'en_passant',
  'promotion',
  'castle',
  'pass',
  'defeat',
  'army_removed',
  'frozen',
  'game_ended',
] as const satisfies readonly GameEventType[]

// ---------------------------------------------------------------------------
// Board helpers (pure coordinate math, no rules)
// ---------------------------------------------------------------------------

export const BOARD_SIZE = 12
export const NUM_SQUARES = 144

/** Board index of a square name (`rank * 12 + file`). */
export function squareIndex(square: Square): number {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square.slice(1)) - 1
  return rank * BOARD_SIZE + file
}

/** Square name of a board index 0..143. */
export function squareName(index: number): Square {
  if (!Number.isInteger(index) || index < 0 || index >= NUM_SQUARES) {
    throw new RangeError(`square index out of range: ${index}`)
  }
  const file = FILES[index % BOARD_SIZE] as File
  return `${file}${Math.floor(index / BOARD_SIZE) + 1}` as Square
}

/** Index of a seat in per-seat tuples. */
export function seatIndex(seat: Seat): number {
  return SEATS.indexOf(seat)
}
