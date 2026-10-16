import { describe, expect, it } from 'vitest'
import {
  blendPolicy,
  CATCH_UP_FADE_MS,
  castleTiming,
  chebyshev,
  contactTime,
  flightLift,
  HURRY_MS,
  hintDelay,
  invertEase,
  liftProfile,
  moveTiming,
  SNAP_BACK,
  scheduleMoves,
  snapBackEase,
  squareDistance,
} from './motion.ts'
import { ease } from './tween.ts'

describe('moveTiming', () => {
  it('scales slider duration with distance inside 230..360 ms', () => {
    const one = moveTiming('rook', 1, false).duration
    const two = moveTiming('rook', 2, false).duration
    const five = moveTiming('rook', 5, false).duration
    const eleven = moveTiming('queen', 11, false).duration
    expect(one).toBeGreaterThanOrEqual(240)
    expect(one).toBeLessThanOrEqual(245)
    expect(two).toBeGreaterThan(one)
    expect(five).toBeGreaterThan(two)
    expect(eleven).toBeGreaterThan(five)
    expect(eleven).toBeLessThanOrEqual(360)
    expect(moveTiming('pawn', 0.2, false).duration).toBe(230)
    expect(moveTiming('queen', 400, false).duration).toBe(360)
  })

  it('knights hop in a fixed time with a higher lift', () => {
    const k = moveTiming('knight', Math.SQRT2 * 1.58, false)
    expect(k.duration).toBe(280)
    expect(k.lift).toBe(1)
    expect(k.hop).toBeGreaterThan(0)
    expect(moveTiming('bishop', 3, false).hop).toBe(0)
    expect(moveTiming('bishop', 3, false).lift).toBeCloseTo(0.55)
  })

  it('reduced motion cross-fades with no lift, hop or settle', () => {
    for (const kind of ['pawn', 'knight', 'queen'] as const) {
      const t = moveTiming(kind, 4, true)
      expect(t.crossFade).toBe(true)
      expect(t.lift).toBe(0)
      expect(t.hop).toBe(0)
      expect(t.settleMs).toBe(0)
      expect(t.duration).toBeLessThanOrEqual(150)
    }
  })

  it('lands late in the flight', () => {
    const t = moveTiming('rook', 3, false)
    expect(t.landAt).toBeGreaterThan(0.8)
    expect(t.landAt).toBeLessThan(1)
  })
})

describe('easing', () => {
  it('the move bezier starts and ends exactly and is monotonic', () => {
    expect(ease.move(0)).toBe(0)
    expect(ease.move(1)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = ease.move(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = v
    }
    // Quick take-off, long soft deceleration: well past halfway at t = 0.5.
    expect(ease.move(0.5)).toBeGreaterThan(0.7)
    expect(ease.move(0.1)).toBeLessThan(0.1)
  })

  it('invertEase finds the progress for a value', () => {
    expect(invertEase(ease.linear, 0.3)).toBeCloseTo(0.3, 4)
    const t = invertEase(ease.move, 0.6)
    expect(ease.move(t)).toBeCloseTo(0.6, 3)
  })

  it('snap-back overshoot never exceeds the cap', () => {
    for (const d of [0.3, 1, 2, 5, 11]) {
      const e = snapBackEase(d)
      let peak = 0
      for (let i = 0; i <= 400; i++) peak = Math.max(peak, e(i / 400))
      expect((peak - 1) * d).toBeLessThanOrEqual(SNAP_BACK.overshootSq + 1e-4)
      expect(e(1)).toBeCloseTo(1)
    }
    // Long returns get a visible (but capped) overshoot.
    const e = snapBackEase(0.5)
    let peak = 0
    for (let i = 0; i <= 400; i++) peak = Math.max(peak, e(i / 400))
    expect(peak).toBeGreaterThan(1.01)
  })
})

describe('liftProfile', () => {
  it('rises fast, holds, and drops at the end', () => {
    expect(liftProfile(0)).toBe(0)
    expect(liftProfile(1)).toBe(0)
    expect(liftProfile(0.25)).toBeCloseTo(1)
    expect(liftProfile(0.5)).toBe(1)
    expect(liftProfile(0.7)).toBeCloseTo(1)
    expect(liftProfile(0.1)).toBeGreaterThan(0.5)
    expect(liftProfile(0.95)).toBeLessThan(0.35)
    expect(liftProfile(0.85)).toBeGreaterThan(liftProfile(0.95))
  })
})

describe('contactTime', () => {
  it('reacts when the attacker is about half a square away', () => {
    const t = moveTiming('rook', 5, false)
    const c = contactTime(t, 5)
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThan(t.duration)
    const k = c / t.duration
    expect(t.ease(k) * 5).toBeCloseTo(5 - 0.55, 1)
  })
})

describe('castling', () => {
  it('the rook takes off after half the leader flight and lands last', () => {
    const c = castleTiming(false)
    expect(c.rook.delay).toBeGreaterThanOrEqual(c.leader.delay + 0.5 * c.leader.duration)
    expect(c.rook.lift).toBeGreaterThan(c.leader.lift)
    expect(c.rook.hop).toBeGreaterThan(0)
    expect(c.end).toBe(c.rook.delay + c.rook.duration)
  })

  it('scheduleMoves applies castle timing', () => {
    const s = scheduleMoves(
      [
        { kind: 'king', distSq: 2, castleRook: false },
        { kind: 'rook', distSq: 2, castleRook: true },
      ],
      false,
    )
    const [leader, rook] = s.items
    expect(rook?.delay).toBeGreaterThanOrEqual((leader?.delay ?? 0) + 0.5 * (leader?.duration ?? 0))
    expect(s.end).toBe((rook?.delay ?? 0) + (rook?.duration ?? 0))
    const r = scheduleMoves(
      [
        { kind: 'king', distSq: 2, castleRook: false },
        { kind: 'rook', distSq: 2, castleRook: true },
      ],
      true,
    )
    expect(r.items.every((i) => i.delay === 0 && i.timing.crossFade)).toBe(true)
  })
})

describe('blendPolicy', () => {
  it('hurries a running move to at most 90 ms', () => {
    expect(blendPolicy(300, 1)).toEqual({ mode: 'chain', hurryMs: HURRY_MS })
    expect(blendPolicy(40, 1)).toEqual({ mode: 'chain', hurryMs: 40 })
    expect(blendPolicy(0, 2)).toEqual({ mode: 'chain', hurryMs: 0 })
  })

  it('applies a catch-up of more than two plies with a cross-fade', () => {
    expect(blendPolicy(200, 3)).toEqual({ mode: 'instant', fadeMs: CATCH_UP_FADE_MS })
    expect(blendPolicy(0, -5).mode).toBe('instant')
  })
})

describe('grid helpers', () => {
  it('measure distances and ripple delays', () => {
    expect(chebyshev(0, 13)).toBe(1)
    expect(chebyshev(0, 143)).toBe(11)
    expect(squareDistance(0, 2)).toBe(2)
    expect(hintDelay(0, 26)).toBe(20)
  })
})

describe('flightLift', () => {
  it('starts from the current lift and lands at zero', () => {
    expect(flightLift(0, 0.3, 0.55)).toBeCloseTo(0.3)
    expect(flightLift(0.5, 0.3, 0.55)).toBeCloseTo(0.55)
    expect(flightLift(1, 0.3, 0.55)).toBe(0)
    // Held lift (snap-back): stays up until the drop, then comes down.
    expect(flightLift(0.1, 1, 1, 0.7)).toBeCloseTo(1)
    expect(flightLift(0.6, 1, 1, 0.7)).toBeCloseTo(1)
    expect(flightLift(0.9, 1, 1, 0.7)).toBeLessThan(0.6)
    // Dropped piece: no rise, comes straight down.
    expect(flightLift(0, 1, 0, 0)).toBeCloseTo(1)
    expect(flightLift(0.5, 1, 0, 0)).toBeCloseTo(0.75)
    expect(flightLift(0.99, 1, 0, 0)).toBeLessThan(0.05)
  })
})
