/**
 * Attack review of the username / lobby-name filter (auth/name-filter.ts). Each `it` states the
 * behavior the moderation brief asks for; failures are findings, not flaky tests.
 *
 * Offensive inputs are built from fragments so the file itself doesn't spell slurs out.
 */
import { describe, expect, it } from 'vitest'
import { moderateUsername } from '../auth/name-filter.ts'
import { defaultNamePolicy } from '../auth/name-policy.ts'

const refused = (name: string) => !defaultNamePolicy.check(name).ok
const j = (...parts: string[]) => parts.join('')

describe('profanity: separator bypass (word split into a long and a short piece)', () => {
  // "f_u_c_k" and "sh.it" are caught (runs of 1-2 letter pieces are joined), but a split that
  // leaves one piece of 3+ letters is never re-joined.
  const cases = [
    j('Fuc', '_k'),
    j('Shi', '_t'),
    j('Fuc', '_kYou'),
    j('Bit', '_ch'),
    j('Cun', '_t_face'),
    j('Nig', '_ger'),
    j('Whor', '_e'),
    j('Rap', '_ist'),
  ]
  for (const name of cases) {
    it(`refuses ${name}`, () => {
      expect(refused(name)).toBe(true)
    })
  }
})

describe('profanity: lobby names with confusable letters', () => {
  // Lobby names allow any script; NFKD does not map Cyrillic look-alikes to Latin.
  for (const name of [`fuсk lobby`, `shіt night`, j('fuc', ' k night')]) {
    it(`refuses ${JSON.stringify(name)}`, () => {
      expect(defaultNamePolicy.checkLobbyName(name).ok).toBe(false)
    })
  }
})

describe('reserved / impersonation names: leetspeak and near-miss bypasses', () => {
  for (const name of [
    'B0t_1500', // bot placeholder
    'Gu3st_4821', // guest placeholder
    'P1ayer_1234', // OAuth / renamed placeholder
    'LinkedList', // the APP_NAME owner word, singular
    'Linked_List',
    'SupportTeam',
    'Support_Team',
    'TheSupport',
  ]) {
    it(`refuses ${name}`, () => {
      expect(refused(name)).toBe(true)
    })
  }
})

describe('false positives: 50 ordinary names must be accepted', () => {
  const ordinary = [
    // Japanese, Thai, Indian, Italian, German, Russian names and ordinary words
    'Ashitaka',
    'Yoshitaka',
    'Matsushita',
    'Hoshitani',
    'Kashita',
    'Ishita',
    'Shitij',
    'Dikshit',
    'Siriporn',
    'Kanokporn',
    'Pornthip',
    'Supaporn',
    'Wankel',
    'Wankhede',
    'Pennisi',
    'Peniston',
    'Slutsky',
    'Van_Dyke',
    'Hubertus_Heil',
    'Semen_Padang',
    'Guestrin',
    // ...and ones that already pass (Scunthorpe-style), kept as regressions
    'Scunthorpe',
    'Penistone',
    'Therapist',
    'Cassandra',
    'Dickens',
    'Hancock',
    'Cockburn',
    'Sussex',
    'Essex',
    'Assassin',
    'Classic',
    'Bassist',
    'Grasshopper',
    'Analyst',
    'Titanic',
    'Sextant',
    'Cumberland',
    'Hitchcock',
    'Peacock',
    'Shitake',
    'Moderna',
    'Badminton',
    'Admiral',
    'Bottle',
    'Botany',
    'Mitsubishi',
    'Nazir',
    'Arsenal',
    'Cocktail',
  ]
  it('has 50 names', () => {
    expect(ordinary).toHaveLength(50)
  })
  for (const name of ordinary) {
    it(`accepts ${name}`, () => {
      expect(moderateUsername(name)).toEqual({ ok: true })
    })
  }
})
