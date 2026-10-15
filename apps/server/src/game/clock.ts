import type { ClockSync } from '@game/protocol'

type SeatNum = 0 | 1 | 2 | 3

/** Monotonic milliseconds for clock bookkeeping (not comparable with Date.now()). */
export function monoNow(): number {
  return performance.now()
}

/**
 * Server-authoritative game clock (PLAN §2 "Clocks"). Only the seat to move's clock runs.
 * - a real move: the mover pays the elapsed time, then gains the increment;
 * - automatic passes happen inside the rules engine's turn walk and cost nothing;
 * - a timeout / abandon / stalemate ends a turn without increment;
 * - frozen or removed seats are never started again (the engine skips them).
 *
 * Durations are measured on a monotonic clock (`monoNow()`, i.e. performance.now()), so a
 * wall-clock step (NTP correction, VM resume) is never charged to the player to move; the
 * flag timer (setTimeout) runs on the same monotonic time base. Wall-clock time appears only
 * in what clients see (`serverTimestamp`, `turnStartedAt`).
 */
export class GameClock {
  readonly remaining: [number, number, number, number]
  /** Seat whose clock runs, or -1. */
  running: SeatNum | -1 = -1
  turnStartedAt = 0

  readonly incrementMs: number

  constructor(baseMs: number, incrementMs: number) {
    this.remaining = [baseMs, baseMs, baseMs, baseMs]
    this.incrementMs = incrementMs
  }

  /** Starts `seat`'s turn at `now` (any running turn must have been ended first). */
  startTurn(seat: SeatNum, now: number): void {
    this.running = seat
    this.turnStartedAt = now
  }

  /** Time spent on the running turn so far. */
  elapsed(now: number): number {
    return this.running === -1 ? 0 : Math.max(0, now - this.turnStartedAt)
  }

  /** `seat`'s remaining time at `now`, counting the running turn. */
  remainingAt(seat: SeatNum, now: number): number {
    const base = this.remaining[seat]
    return seat === this.running ? Math.max(0, base - this.elapsed(now)) : base
  }

  /** Whether the running seat's time is up at `now`. */
  hasFlagged(now: number): boolean {
    return this.running !== -1 && this.remainingAt(this.running, now) <= 0
  }

  /** Milliseconds until the running seat flags (Infinity when nothing runs). */
  msUntilFlag(now: number): number {
    return this.running === -1 ? Number.POSITIVE_INFINITY : this.remainingAt(this.running, now)
  }

  /**
   * Ends the running turn: deducts the elapsed time (never below zero) and, for a real move,
   * adds the increment. Returns the seat's remaining time, or null if nothing was running.
   */
  endTurn(now: number, opts: { increment: boolean }): number | null {
    const seat = this.running
    if (seat === -1) return null
    let left = Math.max(0, this.remaining[seat] - this.elapsed(now))
    if (opts.increment && left > 0) left += this.incrementMs
    this.remaining[seat] = left
    this.running = -1
    this.turnStartedAt = 0
    return left
  }

  /**
   * Snapshot for clients: remaining values as of monotonic `now`; `wallNow` is the matching
   * wall-clock time, from which `turnStartedAt` (wall clock) is derived.
   */
  sync(now: number, wallNow: number = now): ClockSync {
    const r = this.remaining
    const at = (s: SeatNum) => this.remainingAt(s, now)
    return {
      remainingMs: this.running === -1 ? [r[0], r[1], r[2], r[3]] : [at(0), at(1), at(2), at(3)],
      runningSeat: this.running,
      serverTimestamp: wallNow,
      turnStartedAt: this.running === -1 ? 0 : wallNow - this.elapsed(now),
    }
  }
}
