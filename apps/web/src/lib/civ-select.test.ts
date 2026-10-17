import { CIVILIZATIONS } from '@game/config'
import { describe, expect, it } from 'vitest'
import {
  bestMatchIndex,
  buildSearchIndex,
  type CivOption,
  filterCivs,
  foldName,
  isTypeaheadKey,
  listNavIndex,
  PAGE_STEP,
} from './civ-select.ts'

/** A synthetic roster of 120 civs (the real one will pass 100), some with accented names. */
const SYNTHETIC: CivOption[] = Array.from({ length: 120 }, (_, i) => ({
  slug: `civ-${i}`,
  name: `Realm ${String(i).padStart(3, '0')}`,
}))
SYNTHETIC[7] = { slug: 'cote', name: "Côte d'Ivoire" }
SYNTHETIC[42] = { slug: 'sao-tome', name: 'São Tomé and Príncipe' }
SYNTHETIC[99] = { slug: 'aland', name: 'Åland' }
SYNTHETIC[118] = { slug: 'new-realm', name: 'New Realm of the North' }

describe('foldName', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(foldName('  Côte   D’Ivoire ')).toBe('cote d’ivoire')
    expect(foldName('ÅLAND')).toBe('aland')
    expect(foldName('São Tomé')).toBe('sao tome')
  })
})

describe('filterCivs', () => {
  const index = buildSearchIndex(SYNTHETIC)

  it('keeps every civ, in roster order, for an empty or blank query', () => {
    expect(filterCivs(index, '')).toEqual(SYNTHETIC)
    expect(filterCivs(index, '   ')).toHaveLength(120)
  })

  it('matches anywhere in the name, case- and accent-insensitively', () => {
    expect(filterCivs(index, 'COTE').map((c) => c.slug)).toEqual(['cote'])
    expect(filterCivs(index, 'tome').map((c) => c.slug)).toEqual(['sao-tome'])
    expect(filterCivs(index, 'príncipe').map((c) => c.slug)).toEqual(['sao-tome'])
    expect(filterCivs(index, 'aland').map((c) => c.slug)).toEqual(['aland'])
    expect(filterCivs(index, 'realm 11').map((c) => c.slug)).toEqual([
      'civ-110',
      'civ-111',
      'civ-112',
      'civ-113',
      'civ-114',
      'civ-115',
      'civ-116',
      'civ-117',
      'civ-119',
    ])
    expect(filterCivs(index, 'zzz')).toEqual([])
  })

  it('works on the real roster', () => {
    const real = buildSearchIndex(CIVILIZATIONS)
    expect(filterCivs(real, 'states').map((c) => c.slug)).toEqual(['usa'])
    expect(filterCivs(real, 'an').map((c) => c.slug)).toEqual([
      'canada',
      'japan',
      'germany',
      'england',
      'france',
    ])
  })

  it('stays fast with 120 civs (a keystroke is far under a frame)', () => {
    const queries = ['r', 're', 'rea', 'real', 'realm', 'realm 0', 'realm 05', 'côte', 'x']
    const start = performance.now()
    for (let round = 0; round < 200; round++) {
      for (const q of queries) bestMatchIndex(filterCivs(index, q), q)
    }
    const perKeystroke = (performance.now() - start) / (200 * queries.length)
    expect(perKeystroke).toBeLessThan(2)
  })
})

describe('bestMatchIndex', () => {
  it('prefers a name prefix, then a word prefix, then any match', () => {
    const list = filterCivs(buildSearchIndex(SYNTHETIC), 'realm')
    // "New Realm of the North" only has "realm" as a word, so a "Realm 000" prefix wins.
    expect(list[bestMatchIndex(list, 'realm')]?.slug).toBe('civ-0')
    const north = filterCivs(buildSearchIndex(SYNTHETIC), 'nor')
    expect(north[bestMatchIndex(north, 'nor')]?.slug).toBe('new-realm')
    const options = [
      { slug: 'a', name: 'Grand Duchy' },
      { slug: 'b', name: 'Duchy of Ruritania' },
    ]
    expect(bestMatchIndex(options, 'duchy')).toBe(1)
    expect(bestMatchIndex(options, 'uch')).toBe(0)
    expect(bestMatchIndex(options, 'ruri')).toBe(1) // a later word's start
  })

  it('is -1 for an empty list and 0 for an empty query', () => {
    expect(bestMatchIndex([], 'x')).toBe(-1)
    expect(bestMatchIndex(SYNTHETIC, '')).toBe(0)
  })
})

describe('listNavIndex', () => {
  const n = SYNTHETIC.length

  it('steps one row with the arrows and stops at the ends', () => {
    expect(listNavIndex('ArrowDown', 0, n)).toBe(1)
    expect(listNavIndex('ArrowDown', n - 1, n)).toBe(n - 1)
    expect(listNavIndex('ArrowUp', 5, n)).toBe(4)
    expect(listNavIndex('ArrowUp', 0, n)).toBe(0)
  })

  it('pages and jumps to the ends', () => {
    expect(listNavIndex('PageDown', 0, n)).toBe(PAGE_STEP)
    expect(listNavIndex('PageDown', n - 2, n)).toBe(n - 1)
    expect(listNavIndex('PageUp', 3, n)).toBe(0)
    expect(listNavIndex('Home', 77, n)).toBe(0)
    expect(listNavIndex('End', 3, n)).toBe(n - 1)
  })

  it('starts from nothing highlighted', () => {
    expect(listNavIndex('ArrowDown', -1, n)).toBe(0)
    expect(listNavIndex('ArrowUp', -1, n)).toBe(n - 1)
  })

  it('ignores other keys and empty lists', () => {
    expect(listNavIndex('Enter', 3, n)).toBeNull()
    expect(listNavIndex('a', 3, n)).toBeNull()
    expect(listNavIndex('ArrowDown', 0, 0)).toBeNull()
  })

  it('walks all 120 rows with the keyboard', () => {
    let i = -1
    for (let step = 0; step < 200; step++) i = listNavIndex('ArrowDown', i, n) ?? i
    expect(i).toBe(n - 1)
    let pages = 0
    for (i = 0; i < n - 1; pages++) i = listNavIndex('PageDown', i, n) ?? i
    expect(pages).toBe(Math.ceil((n - 1) / PAGE_STEP))
  })
})

describe('isTypeaheadKey', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) =>
    isTypeaheadKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })

  it('accepts printable characters only', () => {
    expect(key('m')).toBe(true)
    expect(key('É')).toBe(true)
    expect(key(' ')).toBe(false)
    expect(key('Enter')).toBe(false)
    expect(key('ArrowDown')).toBe(false)
    expect(key('c', { ctrlKey: true })).toBe(false)
    expect(key('v', { metaKey: true })).toBe(false)
  })
})
