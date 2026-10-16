import { describe, expect, it } from 'vitest'
import { Animator, cubicBezier, ease, outBackWith } from './tween.ts'

describe('Animator', () => {
  it('runs tweens over time with delays and completion callbacks', () => {
    const a = new Animator()
    const seen: number[] = []
    let done = 0
    a.update(1000)
    a.add(100, (k) => seen.push(k), { ease: ease.linear, done: () => done++ })
    a.add(50, () => {}, { delay: 100, done: () => done++ })
    a.update(1050)
    expect(seen.at(-1)).toBeCloseTo(0.5)
    a.update(1100)
    expect(seen.at(-1)).toBe(1)
    expect(done).toBe(1)
    expect(a.busy).toBe(true)
    a.update(1200)
    expect(done).toBe(2)
    expect(a.busy).toBe(false)
  })

  it('picks up tweens started from completion callbacks', () => {
    const a = new Animator()
    const order: string[] = []
    a.add(10, () => {}, {
      done: () => {
        order.push('first')
        a.add(10, () => {}, { done: () => order.push('second') })
      },
    })
    a.update(10)
    a.update(25)
    expect(order).toEqual(['first', 'second'])
  })

  it('finishes everything at once', () => {
    const a = new Animator()
    let last = 0
    a.add(1000, (k) => {
      last = k
    })
    a.finishAll()
    expect(last).toBe(1)
    expect(a.busy).toBe(false)
  })
  it('can keep one tween running while finishing the rest', () => {
    const a = new Animator()
    let kept = 0
    let other = 0
    const keep = a.add(
      100,
      (k) => {
        kept = k
      },
      { ease: ease.linear },
    )
    a.add(100, (k) => {
      other = k
    })
    a.update(50)
    a.finishAll(keep)
    expect(other).toBe(1)
    expect(kept).toBeCloseTo(0.5)
    expect(a.busy).toBe(true)
    a.update(100)
    expect(kept).toBe(1)
    expect(a.busy).toBe(false)
  })
})

describe('Animator.hurry', () => {
  it('compresses tagged tweens without jumping and keeps untagged ones', () => {
    const a = new Animator()
    a.update(0)
    let moved = 0
    let other = 0
    let pendingDone = false
    a.add(300, (k) => (moved = k), { ease: ease.linear, tag: 1 })
    a.add(0, () => {}, { delay: 250, tag: 1, done: () => (pendingDone = true) })
    a.add(1000, (k) => (other = k), { ease: ease.linear })
    a.update(150)
    expect(moved).toBeCloseTo(0.5)
    expect(a.remaining(1)).toBeCloseTo(150)
    const left = a.hurry(90, 1)
    expect(left).toBeCloseTo(90)
    a.update(151)
    // Continues from where it was (no jump).
    expect(moved).toBeGreaterThan(0.5)
    expect(moved).toBeLessThan(0.53)
    a.update(240)
    expect(moved).toBe(1)
    expect(pendingDone).toBe(true)
    expect(other).toBeCloseTo(0.24)
    expect(a.remaining(1)).toBe(0)
  })

  it('leaves tweens that already end in time alone', () => {
    const a = new Animator()
    a.update(0)
    let v = 0
    a.add(50, (k) => (v = k), { ease: ease.linear, tag: 1 })
    expect(a.hurry(90, 1)).toBeCloseTo(50)
    a.update(25)
    expect(v).toBeCloseTo(0.5)
  })
})

describe('cubicBezier and outBackWith', () => {
  it('approximates the CSS curve and overshoots as asked', () => {
    const lin = cubicBezier(0.25, 0.25, 0.75, 0.75)
    expect(lin(0.3)).toBeCloseTo(0.3, 2)
    const back = outBackWith(1.6)
    let peak = 0
    for (let i = 0; i <= 100; i++) peak = Math.max(peak, back(i / 100))
    expect(peak).toBeGreaterThan(1.05)
    expect(back(1)).toBeCloseTo(1)
  })
})
