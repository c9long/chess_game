/**
 * A CSS-style cubic-bezier easing, precomputed into a lookup table when it is
 * created, so evaluating it per frame neither solves nor allocates.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, samples = 64): Easing {
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t
  // y at evenly spaced x, found by bisection on the (monotonic) x curve.
  const table = new Float32Array(samples + 1)
  for (let i = 0; i <= samples; i++) {
    const x = i / samples
    let lo = 0
    let hi = 1
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2
      if (bx(mid) < x) lo = mid
      else hi = mid
    }
    table[i] = by((lo + hi) / 2)
  }
  table[0] = 0
  table[samples] = 1
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const f = t * samples
    const i = Math.floor(f)
    const a = table[i] as number
    return a + ((table[i + 1] as number) - a) * (f - i)
  }
}

/** Overshooting ease-out; `s` sets the overshoot (1.70158 is the classic ~10%). */
export function outBackWith(s: number): Easing {
  const c3 = s + 1
  return (t: number) => 1 + c3 * (t - 1) ** 3 + s * (t - 1) ** 2
}

/** Easing curves (t in 0..1). */
export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inQuad: (t: number) => t * t,
  outBack: (t: number) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Piece travel: quick take-off, long soft deceleration (cubic-bezier(0.32, 0, 0.18, 1)). */
  move: cubicBezier(0.32, 0, 0.18, 1),
} as const

export type Easing = (t: number) => number

export interface Tween {
  start: number
  duration: number
  ease: Easing
  update: (k: number) => void
  done: (() => void) | null
  alive: boolean
  /** Bit flags for `hurry` / `remaining` (0 = untagged). */
  tag: number
}

/**
 * Time-based tweens. Callbacks are created when a tween starts, never per
 * frame; the per-frame loop only walks a preallocated array.
 */
export class Animator {
  #tweens: Tween[] = []
  #now = 0

  get busy(): boolean {
    return this.#tweens.length > 0
  }

  get now(): number {
    return this.#now
  }

  add(
    duration: number,
    update: (k: number) => void,
    options: { delay?: number; ease?: Easing; done?: () => void; tag?: number } = {},
  ): Tween {
    const tween: Tween = {
      start: this.#now + (options.delay ?? 0),
      duration: Math.max(0, duration),
      ease: options.ease ?? ease.outCubic,
      update,
      done: options.done ?? null,
      alive: true,
      tag: options.tag ?? 0,
    }
    if (tween.duration === 0 && (options.delay ?? 0) === 0) {
      update(1)
      tween.alive = false
      tween.done?.()
      return tween
    }
    this.#tweens.push(tween)
    return tween
  }

  /**
   * Advances all tweens to time `now` (ms). Tweens started by `done` callbacks
   * are appended to the same array and picked up by this loop.
   */
  update(now: number): void {
    this.#now = now
    const list = this.#tweens
    let w = 0
    for (let i = 0; i < list.length; i++) {
      const tw = list[i] as Tween
      if (!tw.alive) continue
      const elapsed = now - tw.start
      if (elapsed < 0) {
        list[w++] = tw
        continue
      }
      const t = tw.duration === 0 ? 1 : Math.min(1, elapsed / tw.duration)
      tw.update(tw.ease(t))
      if (t >= 1) {
        tw.alive = false
        tw.done?.()
      } else {
        list[w++] = tw
      }
    }
    list.length = w
  }

  /**
   * Jumps every tween to its end (running `done` callbacks), e.g. before a new
   * state. `keep`, if given and still running, is left running.
   */
  finishAll(keep: Tween | null = null): void {
    const kept = keep?.alive ? keep : null
    let guard = 0
    while (this.#tweens.length > 0 && guard++ < 8) {
      const list = this.#tweens
      this.#tweens = []
      for (const tw of list) {
        if (!tw.alive || tw === kept) continue
        tw.alive = false
        tw.update(1)
        tw.done?.()
      }
    }
    this.#tweens = kept ? [kept] : []
  }

  /** Longest time (ms) until a live tween with any of `mask`'s tags ends, delays included. */
  remaining(mask: number): number {
    let max = 0
    for (const tw of this.#tweens) {
      if (!tw.alive || (tw.tag & mask) === 0) continue
      max = Math.max(max, tw.start + tw.duration - this.#now)
    }
    return max
  }

  /**
   * Compresses every live tween tagged with `mask` so that all of them end
   * within `maxMs`, keeping their relative timing. A running tween continues
   * from its current value (never jumps) and eases out over its shortened
   * remainder; a pending one has its delay and length scaled. Returns the new
   * longest remainder (<= maxMs), so follow-up animation can start after it.
   */
  hurry(maxMs: number, mask: number): number {
    const longest = this.remaining(mask)
    if (longest <= maxMs) return longest
    const f = Math.max(0, maxMs) / longest
    const now = this.#now
    for (const tw of this.#tweens) {
      if (!tw.alive || (tw.tag & mask) === 0) continue
      const elapsed = now - tw.start
      if (elapsed < 0) {
        tw.start = now + -elapsed * f
        tw.duration *= f
        continue
      }
      if (tw.duration === 0) continue
      const t0 = Math.min(1, elapsed / tw.duration)
      const left = tw.duration * (1 - t0) * f
      const orig = tw.ease
      tw.start = now
      tw.duration = left
      tw.ease = (u: number) => orig(t0 + (1 - t0) * (1 - (1 - u) * (1 - u)))
    }
    return Math.min(maxMs, longest * f)
  }

  cancel(tween: Tween | null | undefined): void {
    if (tween) tween.alive = false
  }

  clear(): void {
    for (const tw of this.#tweens) tw.alive = false
    this.#tweens.length = 0
  }
}
