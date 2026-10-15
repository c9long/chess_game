import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.ts'
import {
  AGE_OK_COOKIE,
  AGE_OK_MAX_AGE_S,
  LEGAL_PENDING_COOKIE,
  LEGAL_PENDING_MAX_AGE_S,
  readGate,
  signAgeOk,
  signPending,
} from './gate.ts'
import { signValue } from './signed-cookie.ts'

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost/db_test' })
const now = new Date('2026-10-15T12:00:00Z')
const ago = (s: number) => new Date(now.getTime() - s * 1000)
const cookie = (name: string, value: string) => `${name}=${encodeURIComponent(value)}`

describe('signed gate cookies', () => {
  it('accepts fresh values and carries the age band', () => {
    const gate = readGate(
      config,
      [
        cookie(AGE_OK_COOKIE, signAgeOk(config, '16-17', ago(60))),
        cookie(
          LEGAL_PENDING_COOKIE,
          signPending(config, { terms: '0.2', at: ago(60).toISOString() }),
        ),
      ].join('; '),
      now,
    )
    expect(gate.ageOk?.band).toBe('16-17')
    expect(gate.pending?.terms).toBe('0.2')
  })

  it('expires values by their signed timestamp, whatever the cookie Max-Age says', () => {
    const stale = readGate(
      config,
      [
        cookie(AGE_OK_COOKIE, signAgeOk(config, '18+', ago(AGE_OK_MAX_AGE_S + 60))),
        cookie(
          LEGAL_PENDING_COOKIE,
          signPending(config, {
            terms: '0.2',
            at: ago(LEGAL_PENDING_MAX_AGE_S + 60).toISOString(),
          }),
        ),
      ].join('; '),
      now,
    )
    expect(stale.ageOk).toBeUndefined()
    expect(stale.pending).toBeUndefined()
  })

  it('rejects future timestamps, missing bands and forged signatures', () => {
    const future = signAgeOk(config, '18+', new Date(now.getTime() + 3600_000))
    expect(readGate(config, cookie(AGE_OK_COOKIE, future), now).ageOk).toBeUndefined()
    // An old-format value without a band (only "confirmed") no longer counts.
    const noBand = signValue(
      { confirmed: true, at: ago(10).toISOString() },
      `${config.authSecret}:age`,
    )
    expect(readGate(config, cookie(AGE_OK_COOKIE, noBand), now).ageOk).toBeUndefined()
    const forged = signValue({ confirmed: true, band: '18+', at: ago(10).toISOString() }, 'nope')
    expect(readGate(config, cookie(AGE_OK_COOKIE, forged), now).ageOk).toBeUndefined()
  })
})
