import { WasmGame } from '../wasm/rules_wasm.js'
import { assertRulesReady } from './init.ts'
import type { GameConfigInput, GameEvent, MoveView, Seat, Snapshot } from './types.ts'

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

  /** Validates and applies a move ('c2c4', 'c6c7q'); returns what happened, in order. */
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

  /** Engine-side perft (move-tree leaf count), depth at most 6. For tests and benchmarks. */
  perft(depth: number): number {
    return this.#inner.perft(depth)
  }

  /** Releases the engine memory. The game must not be used afterwards. */
  free(): void {
    this.#inner.free()
  }
}
