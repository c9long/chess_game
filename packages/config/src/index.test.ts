import { describe, expect, it } from 'vitest'
import {
  APP_NAME,
  APP_SHORT_NAME,
  CIVILIZATIONS,
  LEGAL_DOCUMENTS,
  LEGAL_VERSIONS,
  TIME_CONTROLS,
} from './index.ts'

describe('config', () => {
  it('exposes the working title', () => {
    expect(APP_NAME).toBe("LinkedList's Chess Game")
  })

  it('has a home-screen name launchers show in full', () => {
    expect(APP_SHORT_NAME.length).toBeGreaterThan(0)
    expect(APP_SHORT_NAME.length).toBeLessThanOrEqual(12)
  })

  it('lists exactly the nine v1 civilizations with unique slugs', () => {
    expect(CIVILIZATIONS).toHaveLength(9)
    expect(new Set(CIVILIZATIONS.map((c) => c.slug)).size).toBe(9)
  })

  it('offers only 10+0 and 3+2', () => {
    expect(Object.keys(TIME_CONTROLS).sort()).toEqual(['10+0', '3+2'])
  })

  it('versions the Terms and Privacy Policy at 0.2', () => {
    expect(LEGAL_VERSIONS).toEqual({ terms: '0.2', privacy: '0.2' })
    expect([...LEGAL_DOCUMENTS].sort()).toEqual(['privacy', 'terms'])
  })
})
