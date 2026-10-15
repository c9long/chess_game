import { LEGAL_VERSIONS, type LegalDocument } from '@game/config'
import { AGE_BANDS, type AgeBand } from '@game/db'
import type { AppConfig } from '../config.ts'
import { parseCookieHeader, signValue, verifyValue } from './signed-cookie.ts'

/** Set after an under-13 answer; blocks an immediate retry. Holds no personal data. */
export const AGE_BLOCK_COOKIE = 'age_block'
export const AGE_BLOCK_MAX_AGE_S = 24 * 60 * 60
/** Signed age band plus the date it was confirmed. Never the birth date. */
export const AGE_OK_COOKIE = 'age_ok'
export const AGE_OK_MAX_AGE_S = 365 * 24 * 60 * 60
/** Signed record of a clickwrap acceptance made before the account exists. */
export const LEGAL_PENDING_COOKIE = 'legal_pending'
export const LEGAL_PENDING_MAX_AGE_S = 60 * 60
/** Signed timestamps from slightly ahead of the server clock are tolerated. */
const CLOCK_SKEW_MS = 5 * 60 * 1000

export const NEUTRAL_REFUSAL = "Sorry, we can't create an account right now."

export interface AgeOk {
  confirmed: true
  band: AgeBand
  at: string
}

export type PendingAcceptance = Partial<Record<LegalDocument, string>> & { at: string }

const secretFor = (config: AppConfig, purpose: string) => `${config.authSecret}:${purpose}`

export function signAgeOk(config: AppConfig, band: AgeBand, at: Date): string {
  return signValue(
    { confirmed: true, band, at: at.toISOString() } satisfies AgeOk,
    secretFor(config, 'age'),
  )
}

export function signPending(config: AppConfig, value: PendingAcceptance): string {
  return signValue(value, secretFor(config, 'legal'))
}

export interface GateState {
  blocked: boolean
  ageOk: AgeOk | undefined
  pending: PendingAcceptance | undefined
}

/**
 * Whether a signed `at` is within `maxAgeS` of `now`. The lifetime is enforced from the
 * signed timestamp, not only by the cookie's Max-Age (which the client controls), so a
 * captured or shared value stops working on schedule.
 */
function isFresh(at: unknown, maxAgeS: number, now: Date): boolean {
  if (typeof at !== 'string') return false
  const t = Date.parse(at)
  if (Number.isNaN(t)) return false
  return t <= now.getTime() + CLOCK_SKEW_MS && now.getTime() - t <= maxAgeS * 1000
}

export function readGate(
  config: AppConfig,
  cookieHeader: string | null | undefined,
  now: Date = new Date(),
): GateState {
  const cookies = parseCookieHeader(cookieHeader)
  const ageOk = verifyValue<AgeOk>(cookies[AGE_OK_COOKIE], secretFor(config, 'age'))
  const pending = verifyValue<PendingAcceptance>(
    cookies[LEGAL_PENDING_COOKIE],
    secretFor(config, 'legal'),
  )
  const ageValid =
    ageOk?.confirmed === true &&
    (AGE_BANDS as readonly string[]).includes(ageOk.band) &&
    isFresh(ageOk.at, AGE_OK_MAX_AGE_S, now)
  return {
    blocked: AGE_BLOCK_COOKIE in cookies,
    ageOk: ageValid ? ageOk : undefined,
    pending: pending && isFresh(pending.at, LEGAL_PENDING_MAX_AGE_S, now) ? pending : undefined,
  }
}

/** Whether a pending acceptance covers every current document version. */
export function pendingCoversCurrent(pending: PendingAcceptance | undefined): boolean {
  if (!pending) return false
  return (Object.keys(LEGAL_VERSIONS) as LegalDocument[]).every(
    (doc) => pending[doc] === LEGAL_VERSIONS[doc],
  )
}

export function cookieOptions(config: AppConfig, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  }
}
