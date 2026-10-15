import type { Seat } from '@game/rules'
import { describe, expect, it } from 'vitest'
import {
  type BoardLayout,
  indexOf,
  isDarkSquare,
  nameOf,
  nearestAngle,
  perspectiveAngle,
  pointToSquare,
  relativeSeat,
  rotateVector,
  squareCenter,
  squareToView,
  stepCursor,
  viewToSquare,
} from './geometry.ts'

const SEATS: Seat[] = ['south', 'west', 'north', 'east']
const sq = (n: string) => indexOf(n)

describe('perspective transforms', () => {
  it('put each seat’s king on the bottom row of its own view', () => {
    const kings: Record<Seat, string> = { south: 'g1', west: 'a7', north: 'g12', east: 'l7' }
    for (const seat of SEATS) {
      expect(squareToView(sq(kings[seat]), seat).row).toBe(11)
    }
  })

  it('map corners as the viewer sees them', () => {
    expect(squareToView(sq('a1'), 'south')).toEqual({ col: 0, row: 11 })
    expect(squareToView(sq('l12'), 'south')).toEqual({ col: 11, row: 0 })
    expect(squareToView(sq('l12'), 'north')).toEqual({ col: 0, row: 11 })
    // West looks east: north (rank 12) is on their left, file l is at the top.
    expect(squareToView(sq('a12'), 'west')).toEqual({ col: 0, row: 11 })
    expect(squareToView(sq('l1'), 'west')).toEqual({ col: 11, row: 0 })
    // East looks west: south (rank 1) is on their left, file a is at the top.
    expect(squareToView(sq('l1'), 'east')).toEqual({ col: 0, row: 11 })
    expect(squareToView(sq('a12'), 'east')).toEqual({ col: 11, row: 0 })
  })

  it('are inverted by viewToSquare for every square and seat', () => {
    for (const seat of SEATS) {
      const seen = new Set<number>()
      for (let i = 0; i < 144; i++) {
        const v = squareToView(i, seat)
        expect(viewToSquare(v.col, v.row, seat)).toBe(i)
        seen.add(v.row * 12 + v.col)
      }
      expect(seen.size).toBe(144)
    }
    expect(viewToSquare(-1, 0, 'south')).toBe(-1)
    expect(viewToSquare(0, 12, 'east')).toBe(-1)
  })

  it('agree with rotating the south-frame board by the perspective angle', () => {
    const layout: BoardLayout = { square: 10, frame: 8 }
    const p = { x: 0, y: 0 }
    const r = { x: 0, y: 0 }
    for (const seat of SEATS) {
      for (let i = 0; i < 144; i++) {
        squareCenter(i, layout, p)
        rotateVector(p.x, p.y, perspectiveAngle(seat), r)
        const v = squareToView(i, seat)
        expect(r.x).toBeCloseTo((v.col + 0.5) * 10 - 60, 6)
        expect(r.y).toBeCloseTo((v.row + 0.5) * 10 - 60, 6)
      }
    }
  })

  it('keep a1 dark from every side', () => {
    expect(isDarkSquare(sq('a1'))).toBe(true)
    expect(isDarkSquare(sq('b1'))).toBe(false)
    expect(isDarkSquare(sq('l12'))).toBe(true)
  })
})

describe('relative seats and rotation', () => {
  it('places the next seat in turn order on the viewer’s left', () => {
    expect(relativeSeat('south', 'south')).toBe(0)
    expect(relativeSeat('west', 'south')).toBe(1)
    expect(relativeSeat('north', 'south')).toBe(2)
    expect(relativeSeat('east', 'south')).toBe(3)
    expect(relativeSeat('north', 'west')).toBe(1)
    expect(relativeSeat('south', 'east')).toBe(1)
  })

  it('turns by at most half a revolution', () => {
    expect(nearestAngle(0, 'west')).toBeCloseTo(-Math.PI / 2)
    expect(nearestAngle(0, 'east')).toBeCloseTo(Math.PI / 2)
    expect(nearestAngle(-Math.PI / 2, 'north')).toBeCloseTo(-Math.PI)
    expect(nearestAngle(4 * Math.PI, 'south')).toBeCloseTo(4 * Math.PI)
    for (const from of SEATS) {
      for (const to of SEATS) {
        const a = perspectiveAngle(from) + 2 * Math.PI * 3
        expect(Math.abs(nearestAngle(a, to) - a)).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })
})

describe('hit testing and cursor', () => {
  const layout: BoardLayout = { square: 50, frame: 40 }

  it('maps square centres back to their squares', () => {
    const p = { x: 0, y: 0 }
    for (let i = 0; i < 144; i++) {
      squareCenter(i, layout, p)
      expect(pointToSquare(p.x, p.y, layout)).toBe(i)
      expect(pointToSquare(p.x + 24, p.y - 24, layout)).toBe(i)
    }
    expect(pointToSquare(-301, 0, layout)).toBe(-1)
    expect(pointToSquare(0, 300.5, layout)).toBe(-1)
  })

  it('moves the keyboard cursor in screen directions', () => {
    expect(nameOf(stepCursor(sq('e2'), 0, -1, 'south'))).toBe('e3')
    expect(nameOf(stepCursor(sq('e2'), 0, -1, 'north'))).toBe('e1')
    expect(nameOf(stepCursor(sq('e2'), 0, -1, 'west'))).toBe('f2')
    expect(nameOf(stepCursor(sq('e2'), 1, 0, 'east'))).toBe('e3')
    expect(nameOf(stepCursor(sq('a1'), -1, 1, 'south'))).toBe('a1')
  })

  it('names squares', () => {
    expect(nameOf(0)).toBe('a1')
    expect(nameOf(143)).toBe('l12')
    expect(indexOf('l12')).toBe(143)
    expect(indexOf('m1')).toBe(-1)
    expect(indexOf('a13')).toBe(-1)
  })
})
