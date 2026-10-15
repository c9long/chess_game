import { describe, expect, it } from 'vitest'
import { ageOn, bandForAge, classifyDateOfBirth, isMinorBand, parseDateOfBirth } from './age.ts'

describe('date of birth classification', () => {
  const now = new Date('2026-10-15T12:00:00Z')

  it('parses only real calendar dates', () => {
    expect(parseDateOfBirth('2000-02-29')).toEqual({ year: 2000, month: 2, day: 29 })
    expect(parseDateOfBirth('2001-02-29')).toBeUndefined()
    expect(parseDateOfBirth('2001-13-01')).toBeUndefined()
    expect(parseDateOfBirth('01/02/2001')).toBeUndefined()
  })

  it('counts whole years', () => {
    expect(ageOn({ year: 2013, month: 10, day: 15 }, now)).toBe(13)
    expect(ageOn({ year: 2013, month: 10, day: 16 }, now)).toBe(12)
  })

  it('classifies 13+ vs under 13 on the boundary', () => {
    expect(classifyDateOfBirth('2013-10-15', now)).toEqual({ result: 'ok', band: '13-15' })
    expect(classifyDateOfBirth('2013-10-17', now)).toEqual({ result: 'under' })
    expect(classifyDateOfBirth('1960-01-01', now)).toEqual({ result: 'ok', band: '18+' })
    expect(classifyDateOfBirth('2020-01-01', now)).toEqual({ result: 'under' })
  })

  it('assigns the 13–15 / 16–17 / 18+ bands on their boundaries', () => {
    expect(classifyDateOfBirth('2010-10-16', now)).toEqual({ result: 'ok', band: '16-17' })
    expect(classifyDateOfBirth('2010-10-17', now)).toEqual({ result: 'ok', band: '13-15' })
    expect(classifyDateOfBirth('2008-10-16', now)).toEqual({ result: 'ok', band: '18+' })
    expect(classifyDateOfBirth('2008-10-17', now)).toEqual({ result: 'ok', band: '16-17' })
    expect([13, 15, 16, 17, 18, 40].map(bandForAge)).toEqual([
      '13-15',
      '13-15',
      '16-17',
      '16-17',
      '18+',
      '18+',
    ])
    expect(isMinorBand('13-15')).toBe(true)
    expect(isMinorBand('16-17')).toBe(true)
    expect(isMinorBand('18+')).toBe(false)
    expect(isMinorBand(null)).toBe(false)
  })

  it('treats future and implausible dates as invalid', () => {
    expect(classifyDateOfBirth('2030-01-01', now)).toEqual({ result: 'invalid' })
    expect(classifyDateOfBirth('1850-01-01', now)).toEqual({ result: 'invalid' })
    expect(classifyDateOfBirth('garbage', now)).toEqual({ result: 'invalid' })
  })
})
