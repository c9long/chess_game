import { Game, initRules } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { indexOf } from './geometry.ts'
import { MoveIndex } from './moves.ts'
import { CASTLE_READY, TO_PROMOTION } from './test/positions.ts'

beforeAll(async () => {
  await initRules()
})

const names = (xs: number[]) =>
  xs.map((i) => `${'abcdefghijklmnop'[i % 16]}${Math.floor(i / 16) + 1}`)

describe('MoveIndex', () => {
  it('lists the selected piece’s destinations with capture flags', () => {
    const g = Game.create({ mode: 'ffa' })
    const idx = new MoveIndex(g.legalMoves())
    const e2 = idx.targetsFrom(indexOf('e2'))
    expect(names(e2.map((t) => t.to))).toEqual(['e3', 'e4'])
    expect(e2.every((t) => !t.capture)).toBe(true)
    const f1 = idx.targetsFrom(indexOf('f1'))
    expect(names(f1.map((t) => t.to)).sort()).toEqual(['d2', 'e3', 'g3'])
    expect(idx.targetsFrom(indexOf('i1'))).toEqual([])
    expect(idx.canMoveFrom(indexOf('b5'))).toBe(false) // West's pawn: not South's move
    expect(names(idx.movableSquares())).toContain('f1')
    expect(idx.resolve(indexOf('e2'), indexOf('e4'))).toBe('e2e4')
    expect(idx.resolve(indexOf('e2'), indexOf('e5'))).toBeNull()
    // South's rook slides into the corner, where West's rook can take it.
    g.applyMove('e1a1')
    const west = new MoveIndex(g.legalMoves())
    const a5 = west.targetsFrom(indexOf('a5'))
    expect(a5.find((t) => t.to === indexOf('a1'))?.capture).toBe(true)
    expect(a5.find((t) => t.to === indexOf('a2'))?.capture).toBe(false)
    g.free()
  })

  it('groups promotion choices and requires one', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_PROMOTION) g.applyMove(m)
    const idx = new MoveIndex(g.legalMoves())
    const t = idx.target(indexOf('e8'), indexOf('e9'))
    expect(t?.promotions).toEqual(['queen', 'rook', 'bishop', 'knight'])
    expect(idx.resolve(indexOf('e8'), indexOf('e9'))).toBe('promotion')
    expect(idx.resolve(indexOf('e8'), indexOf('e9'), 'king')).toBe('promotion')
    expect(idx.resolve(indexOf('e8'), indexOf('e9'), 'knight')).toBe('e8e9n')
    g.free()
  })

  it('flags castling targets', () => {
    const g = Game.fromPosition(CASTLE_READY)
    const idx = new MoveIndex(g.legalMoves())
    const t = idx.target(indexOf('i1'), indexOf('k1'))
    expect(t?.castle).toBe(true)
    expect(t?.notation).toBe('i1k1')
    g.free()
  })
})
