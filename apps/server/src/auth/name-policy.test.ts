import { describe, expect, it } from 'vitest'
import {
  generateGuestName,
  generatePlayerName,
  lengthCharsetPolicy as policy,
} from './name-policy.ts'

describe('lengthCharsetPolicy', () => {
  it('accepts 3–20 letters, digits and underscores', () => {
    expect(policy.check('abc').ok).toBe(true)
    expect(policy.check('Knight_Rider_2026').ok).toBe(true)
    expect(policy.check('a'.repeat(20)).ok).toBe(true)
  })

  it('rejects bad lengths and characters, including guest/deleted look-alikes', () => {
    for (const name of ['ab', 'a'.repeat(21), 'Guest-1234', 'Deleted player #1', 'émile', 'a b']) {
      expect(policy.check(name).ok).toBe(false)
    }
  })

  it('generates Guest-NNNN names', () => {
    expect(generateGuestName(() => 0)).toBe('Guest-1000')
    expect(generateGuestName(() => 0.9999)).toBe('Guest-9999')
    expect(generateGuestName()).toMatch(/^Guest-\d{4}$/)
  })

  it('generates Player-NNNN placeholders that no username can imitate', () => {
    expect(generatePlayerName(() => 0)).toBe('Player-1000')
    const name = generatePlayerName()
    expect(name).toMatch(/^Player-\d{4}$/)
    expect(policy.check(name).ok).toBe(false)
  })
})
