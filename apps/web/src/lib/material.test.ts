import type { Piece, PieceKind, Seat } from '@game/rules'
import { describe, expect, it } from 'vitest'
import { lostMaterial } from './material.ts'

const p = (owner: Seat, kind: PieceKind): Piece => ({ owner, kind })

function army(owner: Seat): Piece[] {
  return [
    p(owner, 'king'),
    p(owner, 'queen'),
    p(owner, 'rook'),
    p(owner, 'rook'),
    p(owner, 'bishop'),
    p(owner, 'bishop'),
    p(owner, 'knight'),
    p(owner, 'knight'),
    ...Array.from({ length: 8 }, () => p(owner, 'pawn')),
  ]
}

const start = [...army('south'), ...army('west'), ...army('north'), ...army('east')]

function without(board: Piece[], owner: Seat, kind: PieceKind, n = 1): Piece[] {
  const out = [...board]
  for (let i = 0; i < n; i++) {
    const at = out.findIndex((x) => x.owner === owner && x.kind === kind)
    out.splice(at, 1)
  }
  return out
}

describe('lostMaterial', () => {
  it('is zero at the start', () => {
    for (const m of lostMaterial(start, start)) expect(m.points).toBe(0)
  })

  it('counts lost pieces per seat with the usual values', () => {
    const now = without(without(start, 'west', 'queen'), 'west', 'pawn', 2)
    const [south, west] = lostMaterial(start, now)
    expect(south?.points).toBe(0)
    expect(west?.lost).toEqual({
      queen: 1,
      prime_minister: 0,
      rook: 0,
      bishop: 0,
      knight: 0,
      pawn: 2,
    })
    expect(west?.points).toBe(11)
  })

  it('takes a promotion off the lost pawns', () => {
    // A South pawn promoted to a queen: one pawn fewer, one queen more, nothing lost.
    const promoted = [...without(start, 'south', 'pawn'), p('south', 'queen')]
    expect(lostMaterial(start, promoted)[0]?.points).toBe(0)
    // ...and then a real pawn capture still counts.
    const thenLost = without(promoted, 'south', 'pawn')
    expect(lostMaterial(start, thenLost)[0]?.lost.pawn).toBe(1)
  })

  it('ignores empty squares and the leader', () => {
    const now = [...without(start, 'east', 'king'), null, null] as (Piece | null)[]
    expect(lostMaterial([...start, null], now)[3]?.points).toBe(0)
  })

  it("counts England's lost Prime Ministers, and a promotion to a queen it never started with", () => {
    // England (civ v2): R M B M M B M R + 8 pawns.
    const england: Piece[] = [
      p('south', 'rook'),
      p('south', 'rook'),
      p('south', 'bishop'),
      p('south', 'bishop'),
      ...Array.from({ length: 4 }, () => p('south', 'prime_minister')),
      ...Array.from({ length: 8 }, () => p('south', 'pawn')),
    ]
    const begin = [...england, ...army('west')]
    const now = [
      ...without(without(begin, 'south', 'prime_minister', 2), 'south', 'pawn'),
      p('south', 'queen'),
    ]
    const [south] = lostMaterial(begin, now)
    expect(south?.lost.prime_minister).toBe(2)
    expect(south?.lost.queen).toBe(0)
    expect(south?.lost.pawn).toBe(0)
    expect(south?.points).toBe(8)
  })
})
