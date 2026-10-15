import type { AgeBand } from '@game/db'

export const MINIMUM_AGE = 13

export interface DateParts {
  year: number
  month: number
  day: number
}

/** Parses YYYY-MM-DD into a real calendar date, or undefined if it isn't one. */
export function parseDateOfBirth(value: string): DateParts | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return undefined
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return undefined
  }
  return { year, month, day }
}

/** Whole years between `dob` and `today` (UTC calendar dates). */
export function ageOn(dob: DateParts, today: Date): number {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1
  const d = today.getUTCDate()
  let age = y - dob.year
  if (m < dob.month || (m === dob.month && d < dob.day)) age -= 1
  return age
}

export type AgeResult =
  | { result: 'ok'; band: AgeBand }
  | { result: 'under' }
  | { result: 'invalid' }

/** Age band for an age of at least MINIMUM_AGE (PLAN §8: 13–15 / 16–17 / 18+). */
export function bandForAge(age: number): AgeBand {
  if (age >= 18) return '18+'
  if (age >= 16) return '16-17'
  return '13-15'
}

/** Under-18 bands get high-privacy defaults (PLAN §8). */
export function isMinorBand(band: AgeBand | null | undefined): boolean {
  return band === '13-15' || band === '16-17'
}

/**
 * Classifies a date of birth into "under 13", "invalid" or an age band. Uses UTC+14 (the
 * earliest time zone) for "today" so nobody is refused because the server's date lags
 * theirs. The birth date itself is discarded by the caller; only the band is kept.
 */
export function classifyDateOfBirth(value: string, now: Date = new Date()): AgeResult {
  const dob = parseDateOfBirth(value)
  if (!dob) return { result: 'invalid' }
  const earliest = new Date(now.getTime() + 14 * 60 * 60 * 1000)
  if (dob.year < 1900) return { result: 'invalid' }
  const age = ageOn(dob, earliest)
  if (age < 0) return { result: 'invalid' }
  return age >= MINIMUM_AGE ? { result: 'ok', band: bandForAge(age) } : { result: 'under' }
}
