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
} as const

export type Easing = (t: number) => number

export interface Tween {
  start: number
  duration: number
  ease: Easing
  update: (k: number) => void
  done: (() => void) | null
  alive: boolean
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
    options: { delay?: number; ease?: Easing; done?: () => void } = {},
  ): Tween {
    const tween: Tween = {
      start: this.#now + (options.delay ?? 0),
      duration: Math.max(0, duration),
      ease: options.ease ?? ease.outCubic,
      update,
      done: options.done ?? null,
      alive: true,
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

  cancel(tween: Tween | null | undefined): void {
    if (tween) tween.alive = false
  }

  clear(): void {
    for (const tw of this.#tweens) tw.alive = false
    this.#tweens.length = 0
  }
}
