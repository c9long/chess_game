import type { Seat } from '@game/rules'
import { BOARD_SIZE as RULES_BOARD_SIZE, NUM_SQUARES as RULES_NUM_SQUARES } from '@game/rules'
import { describe, expect, it } from 'vitest'
import {
  BOARD_CANVAS_MARGIN,
  BOARD_MARGIN,
  BOARD_SIZE,
  type BoardLayout,
  boardExtent,
  fitLayout,
  frameInset,
  hopOffset,
  indexOf,
  isDarkSquare,
  layoutForSquare,
  nameOf,
  nearestAngle,
  nearestTarget,
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
  it('match the rules package board size (16×16)', () => {
    expect(BOARD_SIZE).toBe(16)
    expect(BOARD_SIZE).toBe(RULES_BOARD_SIZE)
    expect(BOARD_SIZE * BOARD_SIZE).toBe(RULES_NUM_SQUARES)
  })

  it('put each seat’s king on the bottom row of its own view', () => {
    const kings: Record<Seat, string> = { south: 'i1', west: 'a9', north: 'i16', east: 'p9' }
    for (const seat of SEATS) {
      expect(squareToView(sq(kings[seat]), seat).row).toBe(15)
    }
  })

  it('map corners as the viewer sees them', () => {
    expect(squareToView(sq('a1'), 'south')).toEqual({ col: 0, row: 15 })
    expect(squareToView(sq('p16'), 'south')).toEqual({ col: 15, row: 0 })
    expect(squareToView(sq('p16'), 'north')).toEqual({ col: 0, row: 15 })
    // West looks east: north (rank 16) is on their left, file p is at the top.
    expect(squareToView(sq('a16'), 'west')).toEqual({ col: 0, row: 15 })
    expect(squareToView(sq('p1'), 'west')).toEqual({ col: 15, row: 0 })
    // East looks west: south (rank 1) is on their left, file a is at the top.
    expect(squareToView(sq('p1'), 'east')).toEqual({ col: 0, row: 15 })
    expect(squareToView(sq('a16'), 'east')).toEqual({ col: 15, row: 0 })
  })

  it('are inverted by viewToSquare for every square and seat', () => {
    for (const seat of SEATS) {
      const seen = new Set<number>()
      for (let i = 0; i < 256; i++) {
        const v = squareToView(i, seat)
        expect(viewToSquare(v.col, v.row, seat)).toBe(i)
        seen.add(v.row * 16 + v.col)
      }
      expect(seen.size).toBe(256)
    }
    expect(viewToSquare(-1, 0, 'south')).toBe(-1)
    expect(viewToSquare(0, 16, 'east')).toBe(-1)
  })

  it('agree with rotating the south-frame board by the perspective angle', () => {
    const layout: BoardLayout = { square: 10, frame: 8 }
    const p = { x: 0, y: 0 }
    const r = { x: 0, y: 0 }
    for (const seat of SEATS) {
      for (let i = 0; i < 256; i++) {
        squareCenter(i, layout, p)
        rotateVector(p.x, p.y, perspectiveAngle(seat), r)
        const v = squareToView(i, seat)
        expect(r.x).toBeCloseTo((v.col + 0.5) * 10 - 80, 6)
        expect(r.y).toBeCloseTo((v.row + 0.5) * 10 - 80, 6)
      }
    }
  })

  it('keep a1 dark from every side', () => {
    expect(isDarkSquare(sq('a1'))).toBe(true)
    expect(isDarkSquare(sq('b1'))).toBe(false)
    expect(isDarkSquare(sq('p16'))).toBe(true)
    expect(isDarkSquare(sq('p1'))).toBe(false)
    // Queens on their own colour: S h1 and W a8 light, N h16 and E p8 dark.
    expect(isDarkSquare(sq('h1'))).toBe(false)
    expect(isDarkSquare(sq('a8'))).toBe(false)
    expect(isDarkSquare(sq('h16'))).toBe(true)
    expect(isDarkSquare(sq('p8'))).toBe(true)
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
    for (let i = 0; i < 256; i++) {
      squareCenter(i, layout, p)
      expect(pointToSquare(p.x, p.y, layout)).toBe(i)
      expect(pointToSquare(p.x + 24, p.y - 24, layout)).toBe(i)
    }
    expect(pointToSquare(-401, 0, layout)).toBe(-1)
    expect(pointToSquare(0, 400.5, layout)).toBe(-1)
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
    expect(nameOf(255)).toBe('p16')
    expect(indexOf('p16')).toBe(255)
    expect(indexOf('l12')).toBe(187)
    expect(indexOf('q1')).toBe(-1)
    expect(indexOf('a17')).toBe(-1)
  })
})

describe('hopOffset', () => {
  // Screen vector of a board-local offset (the board is drawn rotated by `angle`).
  const toScreen = (v: { x: number; y: number }, angle: number) =>
    rotateVector(v.x, v.y, angle, { x: 0, y: 0 })
  const out = { x: 0, y: 0 }

  it('is screen-up by default, whatever the path', () => {
    for (const seat of ['south', 'west', 'north', 'east'] as Seat[]) {
      const a = perspectiveAngle(seat)
      const s = toScreen(hopOffset(3, 1, 10, a, false, out), a)
      expect(s.x).toBeCloseTo(0)
      expect(s.y).toBeCloseTo(-10)
    }
  })

  it('aside: a horizontal on-screen path still hops straight up', () => {
    const s = toScreen(hopOffset(-2, 0, 10, perspectiveAngle('south'), true, out), 0)
    expect(s.x).toBeCloseTo(0)
    expect(s.y).toBeCloseTo(-10)
  })

  it('aside: a vertical on-screen path hops sideways, twice as far, towards the centre', () => {
    // A rank (board-local x) seen from the west runs vertically on screen.
    const a = perspectiveAngle('west')
    for (const dx of [2, -2]) {
      // A path on the right half of the screen hops left, and vice versa.
      for (const my of [-50, 50]) {
        const mid = toScreen({ x: 0, y: my }, a)
        const s = toScreen(hopOffset(dx, 0, 10, a, true, out, 0, my), a)
        expect(s.y).toBeCloseTo(0)
        expect(Math.abs(s.x)).toBeCloseTo(20)
        expect(Math.sign(s.x)).toBe(-Math.sign(mid.x))
      }
    }
  })

  it('aside: the offset is perpendicular to the on-screen path, on its upper side', () => {
    const a = perspectiveAngle('east')
    const path = { x: 3, y: -2 }
    const s = toScreen(hopOffset(path.x, path.y, 10, a, true, out), a)
    const p = toScreen(path, a)
    expect(s.x * p.x + s.y * p.y).toBeCloseTo(0)
    expect(s.y).toBeLessThan(0)
  })
})

describe('nearestTarget (touch slop)', () => {
  const layout: BoardLayout = { square: 20, frame: 10 }
  const c = (sq: string) => squareCenter(indexOf(sq), layout, { x: 0, y: 0 })

  it('picks the target whose centre is within the slop', () => {
    const e4 = c('e4')
    // Just over the edge into f4 (a non-target), still within 22 px of e4's centre.
    expect(nearestTarget(e4.x + 12, e4.y, [indexOf('e4'), indexOf('e6')], layout, 22)).toBe(
      indexOf('e4'),
    )
  })

  it('gives -1 when no target is close enough', () => {
    const e4 = c('e4')
    expect(nearestTarget(e4.x + 30, e4.y, [indexOf('e4')], layout, 22)).toBe(-1)
    expect(nearestTarget(0, 0, [], layout, 22)).toBe(-1)
  })

  it('refuses to guess between two almost equally near targets', () => {
    const e4 = c('e4')
    // Exactly between e4 and g4 (both targets), on f4.
    expect(nearestTarget(e4.x + 20, e4.y, [indexOf('e4'), indexOf('g4')], layout, 22)).toBe(-1)
    // Clearly nearer to g4.
    expect(nearestTarget(e4.x + 28, e4.y, [indexOf('e4'), indexOf('g4')], layout, 22)).toBe(
      indexOf('g4'),
    )
  })
})

describe('fitting the board to its canvas', () => {
  it('rounds the square down to whole device pixels and the frame to the nearest', () => {
    // 648 / 18.16 = 35.7 squares: 35 px at 1x, 35.5 px at 2x.
    expect(fitLayout(648, 1)).toEqual({ square: 35, frame: 23 })
    expect(fitLayout(648, 2)).toEqual({ square: 35.5, frame: 23.5 })
    expect(layoutForSquare(44, 1)).toEqual({ square: 44, frame: 29 })
    expect(fitLayout(40, 1).square).toBe(8)
  })

  it('puts the frame further in than the unrounded margin', () => {
    for (const [side, res] of [
      [648, 1],
      [648, 2],
      [808, 1],
      [992, 1],
      [468, 1],
      [374, 3],
    ] as const) {
      const layout = fitLayout(side, res)
      const inset = frameInset(layout, side, res)
      expect(inset).toBeGreaterThanOrEqual(side * BOARD_CANVAS_MARGIN - 1 / res)
      // The board and its margin still fit the canvas, centred to the device pixel.
      expect(inset).toBeGreaterThanOrEqual(BOARD_MARGIN * layout.square - 1 / res)
      expect(2 * inset + boardExtent(layout)).toBeCloseTo(side, 0)
    }
    // 1280×800: a 648 px canvas of 35 px squares, 606 px of board centred in it, 6 px further
    // in than the fraction says.
    expect(frameInset(fitLayout(648, 1), 648, 1)).toBe(21)
    expect(frameInset(fitLayout(648, 2), 648, 2)).toBe(16.5)
    expect(648 * BOARD_CANVAS_MARGIN).toBeCloseTo(14.99, 2)
  })

  it('scales the board down when the frame’s rounding pushes its margin past the canvas', () => {
    // 180 px of board plus 2 × 4.2 px of margin in a 180 px canvas: only the margin, scaled, is left.
    const layout: BoardLayout = { square: 10, frame: 10 }
    expect(frameInset(layout, 180, 1)).toBeCloseTo(BOARD_MARGIN * 10 * (180 / 188.4), 6)
  })
})
