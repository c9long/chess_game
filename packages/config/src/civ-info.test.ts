import { describe, expect, it } from 'vitest'
import { CIV_INFO, type CivInfo, civInfo, STANDARD_ARMY } from './civ-info.ts'
import { CIVILIZATIONS } from './index.ts'

const entries = Object.entries(CIV_INFO) as [string, CivInfo][]

describe('civ info', () => {
  it('has exactly one entry per civilization', () => {
    expect(Object.keys(CIV_INFO).sort()).toEqual(CIVILIZATIONS.map((c) => c.slug).sort())
    for (const c of CIVILIZATIONS) expect(civInfo(c.slug)).not.toBeNull()
  })

  it('survives a JSON round trip', () => {
    expect(JSON.parse(JSON.stringify(CIV_INFO))).toEqual(CIV_INFO)
    expect(JSON.parse(JSON.stringify(STANDARD_ARMY))).toEqual(STANDARD_ARMY)
  })

  it('keeps the copy within its length limits', () => {
    for (const [slug, info] of entries) {
      expect(info.emblem.length, slug).toBeLessThanOrEqual(20)
      expect(info.identity.length, slug).toBeLessThanOrEqual(90)
      expect(info.identity, slug).toMatch(/\.$/)
      for (const a of info.abilities) {
        expect(a.name.length, a.id).toBeLessThanOrEqual(28)
        expect(a.summary.length, a.id).toBeLessThanOrEqual(80)
        expect(a.summary, a.id).not.toMatch(/\.$/)
        expect(a.details.length, a.id).toBeGreaterThan(a.summary.length)
      }
    }
  })

  it('gives abilities unique kebab-case ids', () => {
    for (const [slug, info] of entries) {
      const ids = info.abilities.map((a) => a.id)
      expect(new Set(ids).size, slug).toBe(ids.length)
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('never calls an ability "special"', () => {
    expect(JSON.stringify(CIV_INFO)).not.toMatch(/special/i)
    expect(JSON.stringify(STANDARD_ARMY)).not.toMatch(/special/i)
  })

  it('names England’s ability Magna Carta, with the approved wording', () => {
    expect(CIV_INFO.england.abilities).toEqual([
      {
        id: 'magna-carta',
        name: 'Magna Carta',
        summary: 'Four Prime Ministers replace the king, queen and knights',
        details:
          'England has no king, queen or knights. Four Prime Ministers stand on their squares: each moves like a knight or a king, and England is out only when all four are captured. England can’t castle; its pawns still promote to a queen, rook, bishop or knight.',
        piece: 'prime_minister',
      },
    ])
    const withAbilities = entries.filter(([, i]) => i.abilities.length > 0).map(([s]) => s)
    expect(withAbilities).toEqual(['england'])
  })

  it('returns null for slugs off the roster, including inherited keys', () => {
    expect(civInfo('toString')).toBeNull()
    expect(civInfo('__proto__')).toBeNull()
    expect(civInfo('atlantis')).toBeNull()
  })
})
