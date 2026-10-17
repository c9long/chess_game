import { WasmGame } from '../wasm/rules_wasm.js'
import { assertRulesReady } from './init.ts'
import type {
  GameConfigInput,
  GameEvent,
  MoveView,
  Seat,
  SeatTuple,
  Snapshot,
  Square,
} from './types.ts'

/**
 * A game, backed by the Rust rules engine. Every rule decision is made by the
 * engine; this class only parses its JSON results into typed objects.
 *
 * Errors (illegal moves, bad input, game over, ...) are thrown as `Error`s
 * carrying the engine's message, e.g. `illegal move c2c5`.
 *
 * Call `free()` when done with a game (a finalizer frees forgotten ones
 * eventually, but servers holding many games should free them promptly).
 */
export class Game {
  #inner: WasmGame

  private constructor(inner: WasmGame) {
    this.#inner = inner
  }

  /** A new game in the starting position, South to move. */
  static create(config: GameConfigInput): Game {
    assertRulesReady()
    return new Game(new WasmGame(JSON.stringify(config)))
  }

  /** A game from a position string (see `positionString()`). */
  static fromPosition(position: string): Game {
    assertRulesReady()
    return new Game(WasmGame.fromPosition(position))
  }

  /** An independent copy. */
  clone(): Game {
    return new Game(this.#inner.clone())
  }

  /** Legal moves of the seat to move (empty once the game is over). */
  legalMoves(): MoveView[] {
    return JSON.parse(this.#inner.legalMoves()) as MoveView[]
  }

  /** Notations of the legal moves (cheaper than `legalMoves()`). */
  legalMoveNotations(): string[] {
    return this.#inner.legalMoveNotations()
  }

  /** Validates and applies a move ('e2e4', 'e8e9q'); returns what happened, in order. */
  applyMove(notation: string): GameEvent[] {
    return JSON.parse(this.#inner.applyMove(notation)) as GameEvent[]
  }

  /** The seat to move ran out of time (FFA: removed; Teams: frozen). */
  applyTimeout(seat: Seat): GameEvent[] {
    return JSON.parse(this.#inner.applyTimeout(seat)) as GameEvent[]
  }

  /** A seat that still takes turns abandoned the game (treated like a timeout). */
  applyAbandon(seat: Seat): GameEvent[] {
    return JSON.parse(this.#inner.applyAbandon(seat)) as GameEvent[]
  }

  /**
   * A seat that still takes turns resigns. Allowed at any time, not only on its turn.
   * FFA: same effect as a timeout (the army is removed), with defeat reason 'resign'.
   * Teams: the seat's whole team resigns and the game ends at once, the other team winning
   * (each team seat still taking turns freezes; an active one is recorded as defeated with
   * reason 'resign'). The engine applies it as asked: the caller collects the partner's
   * consent first (the server runs the teammate vote). Throws once the game is over or for
   * a removed/frozen seat.
   */
  applyResign(seat: Seat): GameEvent[] {
    return JSON.parse(this.#inner.applyResign(seat)) as GameEvent[]
  }

  /**
   * Ends the game in a draw by agreement ('ffa_agreed_draw' / 'teams_agreed_draw').
   * The caller must first collect the agreement of every seat in `drawVoters()`.
   * Throws once the game is over.
   */
  applyAgreedDraw(): GameEvent[] {
    return JSON.parse(this.#inner.applyAgreedDraw()) as GameEvent[]
  }

  /**
   * Per seat: whether its agreement is needed for a draw. These are the seats still taking
   * turns (removed and frozen seats don't vote); all false once the game is over.
   */
  drawVoters(): SeatTuple<boolean> {
    return JSON.parse(this.#inner.drawVoters()) as SeatTuple<boolean>
  }

  /** Full view of the position. */
  snapshot(): Snapshot {
    return JSON.parse(this.#inner.snapshot()) as Snapshot
  }

  /** Compact position string; `Game.fromPosition` restores the exact state. */
  positionString(): string {
    return this.#inner.positionString()
  }

  /** Whether an ACTIVE seat's leader is attacked (information only; self-check is legal). */
  leaderUnderAttack(seat: Seat): boolean {
    return this.#inner.leaderUnderAttack(seat)
  }

  /**
   * Squares of `seat`'s leader pieces (its civ's leader role, not necessarily a king), in square
   * order, whatever its status. Also in `snapshot().leaderSquares`.
   */
  leaderSquares(seat: Seat): Square[] {
    return this.#inner.leaderSquares(seat) as Square[]
  }

  /** Engine-side perft (move-tree leaf count), depth at most 6. For tests and benchmarks. */
  perft(depth: number): number {
    return this.#inner.perft(depth)
  }

  /** Releases the engine memory. The game must not be used afterwards. */
  free(): void {
    this.#inner.free()
  }
}
