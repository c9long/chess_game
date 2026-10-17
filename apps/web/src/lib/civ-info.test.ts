import { CIVILIZATIONS, civInfo } from '@game/config'
import { PIECE_KINDS } from '@game/rules'
import { describe, expect, it } from 'vitest'
import { pieceName } from './civ-info.ts'
import { pieceSprite } from './piece-sprites.ts'

describe('civ info', () => {
  it('has art and a spoken name for every piece an ability shows', () => {
    const pieces = CIVILIZATIONS.flatMap((c) => civInfo(c.slug)?.abilities ?? []).flatMap((a) =>
      a.piece ? [a.piece] : [],
    )
    expect(pieces).toContain('prime_minister')
    for (const kind of pieces) {
      expect(pieceSprite(kind), kind).toMatch(/^<svg[\s\S]*<\/svg>\s*$/)
      expect(pieceSprite(kind), kind).not.toContain('<title>')
      expect(pieceName(kind), kind).not.toContain('_')
    }
    expect(pieceSprite('toString')).toBeNull()
  })

  it('names every piece kind for screen readers', () => {
    expect(pieceName('prime_minister')).toBe('Prime Minister')
    expect(pieceName('prime_minister', 4)).toBe('Prime Ministers')
    expect(pieceName('knight')).toBe('knight')
    expect(pieceName('knight', 0)).toBe('knights')
    expect(pieceName('toString')).toBe('toString')
    for (const k of PIECE_KINDS) {
      expect(pieceName(k)).toMatch(/^[A-Za-z]+( [A-Z][a-z]+)?$/)
      expect(pieceName(k, 2)).not.toBe(pieceName(k))
      expect(pieceSprite(k), k).not.toBeNull()
    }
  })
})
