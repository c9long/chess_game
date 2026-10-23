import { CIVILIZATIONS, type CivInfo, civInfo } from '@game/config'
import { describe, expect, it } from 'vitest'
import {
  abilityNames,
  bestMatchIndex,
  buildSearchIndex,
  type CivOption,
  civKeywords,
  filterCivs,
  foldName,
  isTypeaheadKey,
  listNavIndex,
  matchRange,
  PAGE_STEP,
  searchHit,
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

  it('also finds civs by keywords, from three letters on', () => {
    const civs = [
      { slug: 'england', name: 'England' },
      { slug: 'canada', name: 'Canada' },
    ]
    const idx = buildSearchIndex(civs, (c) =>
      c.slug === 'england' ? 'Magna Carta Four Prime Ministers replace the king' : '',
    )
    expect(filterCivs(idx, 'prime').map((c) => c.slug)).toEqual(['england'])
    expect(filterCivs(idx, 'Prime Minister').map((c) => c.slug)).toEqual(['england'])
    expect(filterCivs(idx, 'magna').map((c) => c.slug)).toEqual(['england'])
    expect(filterCivs(idx, 'pr')).toEqual([])
    expect(filterCivs(idx, 'can').map((c) => c.slug)).toEqual(['canada'])
  })

  it('finds civs by ability name, ability summary and emblem on the real roster', () => {
    const real = buildSearchIndex(CIVILIZATIONS, (c) => civKeywords(civInfo(c.slug)))
    expect(civKeywords(civInfo('england'))).toBe(
      'Tudor rose | Magna Carta | Four Prime Ministers replace the king, queen and knights',
    )
    expect(civKeywords(civInfo('canada'))).toBe('Maple leaf')
    expect(civKeywords(null)).toBe('')
    expect(filterCivs(real, 'magna').map((c) => c.slug)).toEqual(['england'])
    expect(filterCivs(real, 'MAGNA CARTA').map((c) => c.slug)).toEqual(['england'])
    expect(filterCivs(real, 'eagle').map((c) => c.slug)).toEqual(['usa'])
    expect(filterCivs(real, 'prime').map((c) => c.slug)).toEqual(['england'])
    expect(filterCivs(real, 'fleur').map((c) => c.slug)).toEqual(['france'])
    // Never across two fields ("…rose | Magna…").
    expect(filterCivs(real, 'rose magna')).toEqual([])
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

describe('matchRange', () => {
  it('finds the query in the original text, ignoring case, accents and spaces', () => {
    expect(matchRange('Magna Carta', 'magna')).toEqual([0, 5])
    expect(matchRange('Magna Carta', 'CARTA')).toEqual([6, 11])
    expect(matchRange("Côte d'Ivoire", 'cote')).toEqual([0, 4])
    // A decomposed accent (e + combining acute) still spans both code units.
    expect(matchRange('Re\u0301union', 'reu')).toEqual([0, 4])
    expect(matchRange('São  Tomé', 'sao tome')).toEqual([0, 9])
    expect(matchRange('  Maple leaf', 'leaf')).toEqual([8, 12])
    expect(matchRange('Magna Carta', 'zz')).toBeNull()
    expect(matchRange('Magna Carta', '  ')).toBeNull()
  })
})

describe('searchHit', () => {
  const england = civInfo('england')
  it('reports which text matched, name first', () => {
    expect(searchHit('England', england, 'eng')).toEqual({ field: 'name', range: [0, 3] })
    expect(searchHit('England', england, 'magna')).toEqual({ field: 'ability', range: [0, 5] })
    expect(searchHit('England', england, 'prime')).toEqual({
      field: 'summary',
      index: 0,
      range: [5, 10],
    })
    expect(searchHit('England', england, 'tudor')).toEqual({ field: 'emblem', range: [0, 5] })
    expect(searchHit('United States', civInfo('usa'), 'eagle')).toEqual({
      field: 'emblem',
      range: [5, 10],
    })
  })

  it('needs three letters for anything but the name, and a civ with copy', () => {
    expect(searchHit('England', england, 'ma')).toBeNull()
    expect(searchHit('England', england, '')).toBeNull()
    expect(searchHit('Atlantis', null, 'magna')).toBeNull()
  })

  it('joins several ability names on one line', () => {
    const twin: CivInfo = {
      emblem: 'Twin crowns',
      identity: 'Two crowns.',
      abilities: [
        { id: 'a', name: 'First Rule', summary: 'One', details: 'One more.' },
        { id: 'b', name: 'Second Rule', summary: 'Two', details: 'Two more.' },
      ],
    }
    expect(abilityNames(twin)).toBe('First Rule, Second Rule')
    expect(abilityNames(null)).toBe('')
    expect(searchHit('Twin', twin, 'second')).toEqual({ field: 'ability', range: [12, 18] })
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
