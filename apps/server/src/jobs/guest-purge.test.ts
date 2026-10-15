import { randomUUID } from 'node:crypto'
import {
  civilizations,
  createDb,
  deletionLog,
  legalAcceptances,
  matches,
  matchPlayers,
  sessions,
  users,
} from '@game/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reapplyDeletionLog } from '../account/anonymize.ts'
import { TEST_DATABASE_URL } from '../test/env.ts'
import { purgeInactiveGuests } from './guest-purge.ts'

const { db, close } = createDb(TEST_DATABASE_URL, { max: 2 })
const DAY = 24 * 60 * 60 * 1000
// Far in the future so guests created by other test files never qualify.
const NOW = new Date(Date.now() + 365 * DAY)
const OLD = new Date(NOW.getTime() - 31 * DAY)
const RECENT = new Date(NOW.getTime() - 2 * DAY)

async function makeUser(opts: { guest: boolean; updatedAt: Date }) {
  const id = randomUUID()
  await db.insert(users).values({
    id,
    name: opts.guest ? 'Guest-1234' : `user-${id.slice(0, 8)}`,
    email: `${id}@guest.invalid`,
    isAnonymous: opts.guest,
    createdAt: opts.updatedAt,
    updatedAt: opts.updatedAt,
  })
  await db
    .insert(legalAcceptances)
    .values({ userId: id, document: 'terms', version: '0.2', kind: 'accepted', ipHash: 'abc' })
  return id
}

let ids: Record<string, string> = {}
let matchId = ''

beforeAll(async () => {
  const [civ] = await db.select().from(civilizations).limit(1)
  if (!civ) throw new Error('catalog not seeded')
  ids = {
    oldNoMatches: await makeUser({ guest: true, updatedAt: OLD }),
    oldWithMatch: await makeUser({ guest: true, updatedAt: OLD }),
    recent: await makeUser({ guest: true, updatedAt: RECENT }),
    oldButActiveSession: await makeUser({ guest: true, updatedAt: OLD }),
    oldRegistered: await makeUser({ guest: false, updatedAt: OLD }),
  }
  const [m] = await db
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '3+2', rulesVersion: 1, status: 'finished' })
    .returning()
  if (!m) throw new Error('fixture failed')
  matchId = m.id
  await db.insert(matchPlayers).values({
    matchId: m.id,
    seat: 0,
    userId: ids.oldWithMatch,
    civId: civ.id,
    civVersion: 1,
  })
  await db.insert(sessions).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: ids.oldButActiveSession as string,
    expiresAt: new Date(NOW.getTime() + DAY),
    updatedAt: RECENT,
  })
})

afterAll(async () => {
  await close()
})

describe('purgeInactiveGuests', () => {
  it('deletes idle guests without matches and anonymizes idle guests with matches', async () => {
    const result = await purgeInactiveGuests(db, { now: NOW, inactiveDays: 30 })
    // Guests made by other test files are also "old" at NOW, so check membership.
    expect(result.deleted).toContain(ids.oldNoMatches)
    expect(result.anonymized).toContain(ids.oldWithMatch)
    for (const keep of [ids.recent, ids.oldButActiveSession, ids.oldRegistered]) {
      expect([...result.deleted, ...result.anonymized]).not.toContain(keep)
    }

    // Both purged guests are gone; the others are untouched.
    const remaining = await db
      .select()
      .from(users)
      .where(inArray(users.id, Object.values(ids)))
    const byId = new Map(remaining.map((u) => [u.id, u]))
    expect(byId.has(ids.oldNoMatches as string)).toBe(false)
    expect(byId.has(ids.oldWithMatch as string)).toBe(false)
    expect(byId.get(ids.recent as string)?.deletedAt).toBeNull()
    expect(byId.get(ids.oldButActiveSession as string)?.deletedAt).toBeNull()
    expect(byId.get(ids.oldRegistered as string)?.deletedAt).toBeNull()

    // The guest with a game: its seat and acceptance moved to a fresh "Deleted player"
    // placeholder whose id is not in deletion_log (PLAN §5), IP hash cleared.
    const [mp] = await db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    const placeholderId = mp?.userId as string
    expect(placeholderId).toBeTruthy()
    expect(placeholderId).not.toBe(ids.oldWithMatch)
    const [placeholder] = await db.select().from(users).where(eq(users.id, placeholderId))
    expect(placeholder?.name).toMatch(/^Deleted player #\d+$/)
    expect(placeholder?.deletedAt).toBeInstanceOf(Date)
    const acc = await db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, placeholderId))
    expect(acc.map((a) => a.ipHash)).toEqual([null])
    // The guest without games is erased, acceptances included.
    expect(
      await db
        .select()
        .from(legalAcceptances)
        .where(eq(legalAcceptances.userId, ids.oldNoMatches as string)),
    ).toHaveLength(0)

    // Both are logged (so a restore re-applies them); the placeholder id never is.
    const log = await db
      .select()
      .from(deletionLog)
      .where(inArray(deletionLog.userId, [ids.oldWithMatch, ids.oldNoMatches] as string[]))
    expect(log.map((l) => l.reason)).toEqual(['guest_purge', 'guest_purge'])
    const allLogged = (await db.select({ u: deletionLog.userId }).from(deletionLog)).map((r) => r.u)
    expect(allLogged).not.toContain(placeholderId)

    // Running again is a no-op.
    expect(await purgeInactiveGuests(db, { now: NOW, inactiveDays: 30 })).toEqual({
      anonymized: [],
      deleted: [],
    })
  })

  it('re-applies deletion_log after a restore, so deleted accounts stay deleted', async () => {
    // Simulate a backup restore bringing back a purged guest with its acceptance and a game.
    const [civ] = await db.select().from(civilizations).limit(1)
    const restored = await makeUser({ guest: true, updatedAt: OLD })
    await db.insert(deletionLog).values({ userId: restored, reason: 'user_request' })
    const [m] = await db
      .insert(matches)
      .values({ mode: 'teams', timeControl: '10+0', rulesVersion: 1, status: 'finished' })
      .returning()
    if (!m || !civ) throw new Error('fixture failed')
    await db
      .insert(matchPlayers)
      .values({ matchId: m.id, seat: 1, userId: restored, civId: civ.id, civVersion: 1 })

    expect(await reapplyDeletionLog(db, NOW)).toContain(restored)
    expect(await db.select().from(users).where(eq(users.id, restored))).toHaveLength(0)
    const [mp] = await db.select().from(matchPlayers).where(eq(matchPlayers.matchId, m.id))
    expect(mp?.userId).not.toBe(restored)
    expect(
      (
        await db
          .select()
          .from(users)
          .where(eq(users.id, mp?.userId as string))
      )[0]?.name,
    ).toMatch(/^Deleted player #/)
    // Idempotent, and no extra deletion_log rows are written.
    const before = (await db.select().from(deletionLog)).length
    expect(await reapplyDeletionLog(db, NOW)).not.toContain(restored)
    expect((await db.select().from(deletionLog)).length).toBe(before)
  })
})
