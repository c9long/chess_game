import type { PieceKind } from '@game/rules'
import { BOARD_SIZE } from './geometry.ts'
import { type Easing, ease } from './tween.ts'

/**
 * Pure motion design: how long things take, how high pieces lift and what a
 * renderer does when snapshots arrive faster than animations finish. The
 * renderer (BoardView) only applies these numbers.
 */

/** Tween tags: `MOTION` tweens belong to a move and are hurried when the next one arrives. */
export const TAG_MOTION = 1
/** The local user's own slide (never hurried by an incoming snapshot). */
export const TAG_USER = 2

export interface MoveTiming {
  /** Flight length, ms (under reduced motion: the destination fade-in). */
  readonly duration: number
  /** Peak lift, 0..1 (scale 1 + 0.15 lift, shadow pushed out). */
  readonly lift: number
  /** Screen-up arc height at mid-flight, in squares (knights hop). */
  readonly hop: number
  /** Position easing over the flight. */
  readonly ease: Easing
  /** Fraction of the flight at which the piece reads as landed (sound, turn handover). */
  readonly landAt: number
  /** Landing settle length, ms (0 = none). */
  readonly settleMs: number
  /** Reduced motion: fade out at the origin and in at the destination instead of moving. */
  readonly crossFade: boolean
}

export const SETTLE_MS = 110
/** Under reduced motion: the ghost at the origin fades out over this. */
export const REDUCED_GHOST_MS = 100
export const REDUCED_FADE_MS = 140

/**
 * Timing of one piece's move over `distSq` squares (Euclidean, centre to centre).
 * Sliders: clamp(200 + 42 sqrt(d), 230, 360) ms, so one step reads as deliberate
 * and a long diagonal still has room to glide. Knights hop in a fixed 280 ms.
 */
export function moveTiming(kind: PieceKind, distSq: number, reduced: boolean): MoveTiming {
  if (reduced) {
    return {
      duration: REDUCED_FADE_MS,
      lift: 0,
      hop: 0,
      ease: ease.linear,
      landAt: 0,
      settleMs: 0,
      crossFade: true,
    }
  }
  if (kind === 'knight') {
    return {
      duration: 280,
      lift: 1,
      hop: 0.32,
      ease: ease.inOutSine,
      landAt: 0.9,
      settleMs: SETTLE_MS,
      crossFade: false,
    }
  }
  const d = Math.max(0, distSq)
  return {
    duration: Math.round(Math.min(360, Math.max(230, 200 + 42 * Math.sqrt(d)))),
    lift: d > 0.5 ? 0.55 : 0,
    hop: 0,
    ease: ease.move,
    landAt: 0.9,
    settleMs: d > 0.5 ? SETTLE_MS : 0,
    crossFade: false,
  }
}

/**
 * Lift during a flight (k = raw progress 0..1). It eases from `from` up to
 * `peak` over the first 25% (ease out), holds, and drops to zero after
 * `dropAt` (ease in), so the piece lands rather than just stopping. With
 * `dropAt` < 0.25 there is no rise: the lift held at `from` comes down
 * (a dropped or returning piece).
 */
export function flightLift(k: number, from: number, peak: number, dropAt = 0.7): number {
  if (k >= 1) return 0
  const rises = dropAt >= 0.25
  const top = rises ? Math.max(from, peak) : from
  if (k > dropAt) {
    const u = (k - dropAt) / (1 - dropAt)
    return top * (1 - u * u)
  }
  if (rises && k < 0.25) {
    const u = Math.max(0, k) / 0.25
    return from + (top - from) * (1 - (1 - u) * (1 - u))
  }
  return top
}

/** `flightLift` from the ground to a peak of 1 (rise 25%, hold, drop over the last 30%). */
export function liftProfile(k: number): number {
  if (k <= 0) return 0
  return flightLift(k, 0, 1, 0.7)
}

/** The raw progress t at which `e(t)` first reaches `y` (bisection; `e` must be monotonic). */
export function invertEase(e: Easing, y: number): number {
  if (y <= 0) return 0
  if (y >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (e(mid) < y) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * When (ms after the flight starts) an attacker travelling `distSq` squares is
 * `gapSq` squares from its target: the moment the victim reacts.
 */
export function contactTime(timing: MoveTiming, distSq: number, gapSq = 0.55): number {
  if (timing.crossFade) return 0
  if (distSq <= gapSq * 1.4) return timing.duration * 0.5
  return timing.duration * invertEase(timing.ease, 1 - gapSq / distSq)
}

export interface CastleTiming {
  readonly leader: { readonly delay: number; readonly duration: number; readonly lift: number }
  readonly rook: {
    readonly delay: number
    readonly duration: number
    readonly lift: number
    readonly hop: number
  }
  /** When both have landed (ms). */
  readonly end: number
}

/**
 * Castling: the leader glides first; the rook takes off at 55% of the
 * leader's flight and hops over it (drawn above), so the two never smear
 * through each other.
 */
export function castleTiming(reduced: boolean): CastleTiming {
  if (reduced) {
    return {
      leader: { delay: 0, duration: REDUCED_FADE_MS, lift: 0 },
      rook: { delay: 0, duration: REDUCED_FADE_MS, lift: 0, hop: 0 },
      end: REDUCED_FADE_MS,
    }
  }
  const leader = { delay: 0, duration: 250, lift: 0.55 }
  const rook = { delay: Math.round(leader.duration * 0.55), duration: 260, lift: 0.9, hop: 0.3 }
  return { leader, rook, end: Math.max(leader.duration, rook.delay + rook.duration) }
}

/** What to do with running animations when a new snapshot arrives. */
export type BlendPolicy =
  /** Hurry the running move tweens to finish within `hurryMs`, then chain the new plan after them. */
  | { readonly mode: 'chain'; readonly hurryMs: number }
  /** Too far behind (reconnect, catch-up): show the new position with a short cross-fade. */
  | { readonly mode: 'instant'; readonly fadeMs: number }

export const HURRY_MS = 90
export const CATCH_UP_FADE_MS = 150

/**
 * `runningRemainingMs`: how long the current move animation still needs.
 * `pliesBehind`: how many plies the new snapshot is ahead of the shown one.
 * More than two plies at once are applied together with a cross-fade
 * instead of being chained; otherwise the running move is hurried (never
 * jumped) so the next one can start within 90 ms.
 */
export function blendPolicy(runningRemainingMs: number, pliesBehind: number): BlendPolicy {
  if (Math.abs(pliesBehind) > 2) return { mode: 'instant', fadeMs: CATCH_UP_FADE_MS }
  return { mode: 'chain', hurryMs: Math.max(0, Math.min(runningRemainingMs, HURRY_MS)) }
}

/** Chebyshev (king-step) distance between two square indices on the board grid. */
export function chebyshev(a: number, b: number): number {
  const n = BOARD_SIZE
  return Math.max(Math.abs((a % n) - (b % n)), Math.abs(Math.floor(a / n) - Math.floor(b / n)))
}

/** Euclidean distance in squares between two square indices. */
export function squareDistance(a: number, b: number): number {
  const n = BOARD_SIZE
  return Math.hypot((a % n) - (b % n), Math.floor(a / n) - Math.floor(b / n))
}

/** Move hints appear in a ripple from the selected piece: 10 ms per king step. */
export function hintDelay(from: number, to: number): number {
  return 10 * chebyshev(from, to)
}

export const HINT_IN_MS = 160
export const HINT_OUT_MS = 100

/** Snap-back after an illegal drop: lift held, eased home with a small capped overshoot. */
export const SNAP_BACK = { duration: 220, overshootSq: 0.06, dropFrom: 0.7 } as const

/**
 * Snap-back position easing for a return of `distSq` squares: an ease-out
 * with overshoot whose overshoot never exceeds `SNAP_BACK.overshootSq`.
 */
export function snapBackEase(distSq: number): Easing {
  // outBack(s) overshoots by 4 s^3 / (27 (s + 1)^2) of the distance; pick the
  // largest s <= 1.25 whose overshoot stays within the cap.
  const maxFrac = distSq > 0 ? SNAP_BACK.overshootSq / distSq : 0
  const over = (s: number) => (4 * s ** 3) / (27 * (s + 1) ** 2)
  let lo = 0
  let hi = 1.25
  if (over(hi) <= maxFrac) lo = hi
  else {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (over(mid) <= maxFrac) lo = mid
      else hi = mid
    }
  }
  const s = lo
  const c3 = s + 1
  return (t: number) => 1 + c3 * (t - 1) ** 3 + s * (t - 1) ** 2
}

/** Turn handover: starts at this fraction of the main move's flight. */
export const HANDOVER_AT = 0.85

export interface HandoverTiming {
  readonly outMs: number
  readonly inMs: number
  readonly medalInMs: number
  readonly medalOutMs: number
}

export function handoverTiming(reduced: boolean): HandoverTiming {
  return reduced
    ? { outMs: 150, inMs: 150, medalInMs: 150, medalOutMs: 150 }
    : { outMs: 180, inMs: 260, medalInMs: 320, medalOutMs: 220 }
}

/** Last-move highlight fades: origin at the start, destination at landing, previous one out. */
export function lastMoveTiming(reduced: boolean): {
  readonly fromMs: number
  readonly toMs: number
  readonly outMs: number
} {
  return reduced ? { fromMs: 120, toMs: 120, outMs: 120 } : { fromMs: 120, toMs: 160, outMs: 160 }
}

/**
 * Plays out a set of piece moves as delays and durations (ms). Castling uses
 * `castleTiming`; any other move uses `moveTiming`. Returns the start delay,
 * flight length and landing time of each move, and when the whole set lands.
 */
export function scheduleMoves(
  moves: readonly {
    readonly kind: PieceKind
    readonly distSq: number
    readonly castleRook: boolean
  }[],
  reduced: boolean,
): {
  readonly items: readonly { delay: number; duration: number; timing: MoveTiming }[]
  readonly end: number
} {
  const castling = moves.some((m) => m.castleRook)
  const ct = castleTiming(reduced)
  let end = 0
  const items = moves.map((m) => {
    const base = moveTiming(m.kind, m.distSq, reduced)
    let timing: MoveTiming = base
    let delay = 0
    if (castling && !reduced) {
      if (m.castleRook) {
        delay = ct.rook.delay
        timing = {
          ...base,
          duration: ct.rook.duration,
          lift: ct.rook.lift,
          hop: ct.rook.hop,
          ease: ease.inOutSine,
          settleMs: SETTLE_MS,
        }
      } else if (m.kind === 'king') {
        timing = { ...base, duration: ct.leader.duration, lift: ct.leader.lift }
      }
    }
    end = Math.max(end, delay + timing.duration)
    return { delay, duration: timing.duration, timing }
  })
  return { items, end }
}
