import { describe, expect, it } from 'vitest'
import { Animator, ease } from './tween.ts'

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
