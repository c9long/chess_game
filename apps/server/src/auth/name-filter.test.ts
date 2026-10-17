import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appNameWords, isProfane, isReserved, moderateUsername } from './name-filter.ts'
import { defaultNamePolicy, generateGuestName, generatePlayerName } from './name-policy.ts'

const TERMS = JSON.parse(readFileSync(new URL('./name-terms.json', import.meta.url), 'utf8')) as {
  substring: string[]
  token: string[]
  allow: string[]
}

/** Writes a term the way people dodge filters (no slur is spelled out in this file). */
const leet = (t: string) =>
  t.replace(/o/g, '0').replace(/e/g, '3').replace(/a/g, '4').replace(/s/g, '5')
const stretch = (t: string) => t.replace(/[aeiou]/, (v) => v.repeat(4))
const spaced = (t: string) => [...t].join('_')
const capitalized = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

describe('profanity filter', () => {
  it('blocks every listed term, plainly and disguised', () => {
    for (const t of TERMS.substring) {
      for (const v of [t, t.toUpperCase(), leet(t), stretch(t), `x${t}y`, `The_${t}_42`]) {
        expect(isProfane(v), v).toBe(true)
      }
    }
    for (const t of TERMS.token) {
      for (const v of [t, t.toUpperCase(), leet(t), `big_${t}`, `Big${capitalized(t)}`, `${t}99`]) {
        expect(isProfane(v), v).toBe(true)
      }
    }
  })

  it('catches spelled-out terms and accents', () => {
    for (const t of TERMS.substring.filter((x) => x.length <= 6)) {
      expect(isProfane(spaced(t)), spaced(t)).toBe(true)
    }
    expect(isProfane('sh_it')).toBe(true)
    expect(isProfane('fÜck')).toBe(true)
    expect(isProfane('fUCK')).toBe(true)
    expect(isProfane('5h1t')).toBe(true)
    expect(isProfane('a55')).toBe(true)
  })

  it('does not block innocent names (the Scunthorpe problem)', () => {
    for (const name of [
      'Scunthorpe_United',
      'Scunthorpe',
      'Classic_Bass',
      'Assassin',
      'Passenger',
      'Glass',
      'Cocktail',
      'Hancock',
      'Peacock',
      'Dickens',
      'Therapist',
      'Grapefruit',
      'Analyst',
      'Sussex',
      'Cumulus',
      'Cucumber',
      'Shiitake',
      'Shitake_Farmer',
      'Penistone',
      'Raccoon',
      'Niger',
      'Nigeria',
      'Title',
      'Homer',
      'Mississippi',
      'Sextant',
      'Spicy',
      'Matsui',
      'Is_Hit',
      'Retardant',
      'Swanky',
      'Snigger',
      'Pedometer',
      'Hitman',
      'Knight_Rider_2026',
      'Assistant',
      'Butterscotch',
      'Arsenal',
    ]) {
      expect(isProfane(name), name).toBe(false)
    }
  })

  it('covers every allowlist entry with a false-positive check', () => {
    for (const word of TERMS.allow) expect(isProfane(capitalized(word)), word).toBe(false)
  })

  it('passes generated test names (no accidental hits from hex)', () => {
    for (let i = 0; i < 3000; i++) {
      const hex = randomBytes(5).toString('hex')
      for (const name of [`u_${hex}`, `e2e_${hex.slice(0, 8)}`, `f_${hex}`]) {
        expect(moderateUsername(name), name).toEqual({ ok: true })
      }
    }
  })
})

describe('reserved names', () => {
  it('blocks staff, system and placeholder names', () => {
    for (const name of [
      'admin',
      'Admin',
      'ADMIN_1',
      'adm1n',
      'Administrator',
      'TheAdmin',
      'superadmin',
      'Moderator',
      'Moderator_2',
      'mod',
      'Mod_Team',
      'Support',
      'staff',
      'Official_Bob',
      'OfficialSupport',
      'System',
      'root',
      'Guest_4821',
      'guest4821',
      'Guest',
      'Player_1234',
      'Player1234',
      'player',
      'Deleted_player_7',
      'DeletedPlayer',
      'Removed_Player',
      'Bot_1500',
      'bot1500',
      'Bot_Max',
      'BotMax',
      'bot',
    ]) {
      expect(isReserved(name), name).toBe(true)
    }
  })

  it('reserves the distinctive words of the app name, not generic ones', () => {
    const words = appNameWords('Example Chess Game')
    expect(words).toContain('example')
    expect(words).not.toContain('chess')
    expect(isReserved('Example_Fan', 'Example Chess Game')).toBe(true)
    expect(isReserved('ExampleChessGame', 'Example Chess Game')).toBe(true)
    expect(isReserved('ChessFan', 'Example Chess Game')).toBe(false)
    expect(isReserved('GameOn', 'Example Chess Game')).toBe(false)
  })

  it('allows names that merely contain a reserved word', () => {
    for (const name of [
      'Badminton_Ace',
      'Modern_Man',
      'Moderna',
      'Rooted',
      'Systematic',
      'Supporter',
      'Botany',
      'Robotics',
      'Players_Club',
      'Teammate',
      'Staffordshire',
      'Developers',
    ]) {
      expect(isReserved(name), name).toBe(false)
    }
  })
})

describe('defaultNamePolicy', () => {
  it('answers moderated names with one neutral message', () => {
    const r = defaultNamePolicy.check('Admin')
    expect(r).toEqual({
      ok: false,
      reason: 'That username isn’t available. Try another.',
      code: 'USERNAME_UNAVAILABLE',
    })
    expect(defaultNamePolicy.check(`big_${TERMS.token[0]}`)).toMatchObject({
      ok: false,
      code: 'USERNAME_UNAVAILABLE',
    })
  })

  it('keeps the format rules and their messages', () => {
    expect(defaultNamePolicy.check('ab')).toMatchObject({ ok: false })
    expect(defaultNamePolicy.check('ab')).not.toHaveProperty('code')
    expect(defaultNamePolicy.check('Knight_Rider_2026')).toEqual({ ok: true })
  })

  it('rejects the generated guest and placeholder names', () => {
    expect(defaultNamePolicy.check(generateGuestName().replace('-', '_')).ok).toBe(false)
    expect(defaultNamePolicy.check(generatePlayerName().replace('-', '')).ok).toBe(false)
  })

  it('filters profanity in lobby names but allows ordinary ones', () => {
    expect(defaultNamePolicy.checkLobbyName(`${TERMS.substring[0]} lobby`).ok).toBe(false)
    expect(defaultNamePolicy.checkLobbyName('f.u.c.k this').ok).toBe(false)
    expect(defaultNamePolicy.checkLobbyName('Friday night 3+2')).toEqual({
      ok: true,
      name: 'Friday night 3+2',
    })
    expect(defaultNamePolicy.checkLobbyName("ana's challenge").ok).toBe(true)
    expect(defaultNamePolicy.checkLobbyName('Admin lobby').ok).toBe(true)
  })
})
