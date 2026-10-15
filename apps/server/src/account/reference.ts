import { createHmac } from 'node:crypto'
import { type Database, users } from '@game/db'
import { eq } from 'drizzle-orm'
import type { AppConfig } from '../config.ts'

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789' // no I, L, O, U, 0, 1

/**
 * Reference code a guest quotes in email requests (PLAN §8), e.g. "K7QD-M2XA-9TRP". It is a
 * keyed hash of the user id, so it proves access to the guest's own Settings page: unlike
 * the user id, which other players may see later, it is shown only to the guest.
 */
export function referenceCode(config: AppConfig, userId: string): string {
  const mac = createHmac('sha256', `${config.authSecret}:reference-code`).update(userId).digest()
  let out = ''
  for (let i = 0; i < 12; i++) out += ALPHABET[(mac[i] as number) % ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`
}

/** Operator lookup for an emailed reference code (scans guests; they're purged after 30 days). */
export async function findGuestByReferenceCode(
  db: Database,
  config: AppConfig,
  code: string,
): Promise<string | undefined> {
  const want = code.trim().toUpperCase()
  const guests = await db.select({ id: users.id }).from(users).where(eq(users.isAnonymous, true))
  return guests.find((g) => referenceCode(config, g.id) === want)?.id
}
