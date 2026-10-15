import { Game, initRules } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { indexOf } from './geometry.ts'
import { MoveIndex } from './moves.ts'
import { CASTLE_READY, TO_PROMOTION } from './test/positions.ts'

beforeAll(async () => {
  await initRules()
})

const names = (xs: number[]) => xs.map((i) => `${'abcdefghijkl'[i % 12]}${Math.floor(i / 12) + 1}`)

describe('MoveIndex', () => {
  it('lists the selected piece’s destinations with capture flags', () => {
    const g = Game.create({ mode: 'ffa' })
    const idx = new MoveIndex(g.legalMoves())
    const c2 = idx.targetsFrom(indexOf('c2'))
    expect(names(c2.map((t) => t.to))).toEqual(['b3', 'c3', 'c4'])
    expect(c2.find((t) => t.to === indexOf('b3'))?.capture).toBe(true)
    expect(c2.find((t) => t.to === indexOf('c4'))?.capture).toBe(false)
    expect(idx.targetsFrom(indexOf('g1'))).toEqual([])
    expect(idx.canMoveFrom(indexOf('b3'))).toBe(false) // West's pawn: not South's move
    expect(names(idx.movableSquares())).toContain('d1')
    expect(idx.resolve(indexOf('c2'), indexOf('c4'))).toBe('c2c4')
    expect(idx.resolve(indexOf('c2'), indexOf('c5'))).toBeNull()
    g.free()
  })

  it('groups promotion choices and requires one', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_PROMOTION) g.applyMove(m)
    const idx = new MoveIndex(g.legalMoves())
    const t = idx.target(indexOf('e6'), indexOf('e7'))
    expect(t?.promotions).toEqual(['queen', 'rook', 'bishop', 'knight'])
    expect(idx.resolve(indexOf('e6'), indexOf('e7'))).toBe('promotion')
    expect(idx.resolve(indexOf('e6'), indexOf('e7'), 'king')).toBe('promotion')
    expect(idx.resolve(indexOf('e6'), indexOf('e7'), 'knight')).toBe('e6e7n')
    g.free()
  })

  it('flags castling targets', () => {
    const g = Game.fromPosition(CASTLE_READY)
    const idx = new MoveIndex(g.legalMoves())
    const t = idx.target(indexOf('g1'), indexOf('i1'))
    expect(t?.castle).toBe(true)
    expect(t?.notation).toBe('g1i1')
    g.free()
  })
})
