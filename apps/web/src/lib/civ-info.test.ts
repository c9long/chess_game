import { CIVILIZATIONS } from '@game/config'
import { PIECE_KINDS } from '@game/rules'
import { describe, expect, it } from 'vitest'
import { pieceName, specialArmy } from './civ-info.ts'

describe('civ info', () => {
  it('only England has a special army so far', () => {
    const special = CIVILIZATIONS.filter((c) => specialArmy(c.slug)).map((c) => c.slug)
    expect(special).toEqual(['england'])
    const e = specialArmy('england')
    expect(e?.tag).toBe('Special army')
    expect(e?.summary).toBe('Four Prime Ministers replace the king, queen and knights')
    expect(specialArmy('canada')).toBeNull()
    expect(specialArmy('toString')).toBeNull()
  })

  it('names every piece kind for screen readers', () => {
    expect(pieceName('prime_minister')).toBe('Prime Minister')
    expect(pieceName('knight')).toBe('Knight')
    for (const k of PIECE_KINDS) expect(pieceName(k)).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)?$/)
  })
})
