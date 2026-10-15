/**
 * Spec-compliance probes (review). Each test asserts the behavior PLAN requires; they were
 * `it.fails` while the defects existed and are plain regressions now that they're fixed.
 */
import { civilizations, deletionLog, matches, matchPlayers, sessions, users } from '@game/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptLegal,
  confirmAge,
  createGuest,
  type Harness,
  signUpVerified,
  startHarness,
  uniqueName,
} from './harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

describe('attack-spec: PLAN §5/§8 compliance probes', () => {
  // PLAN §8: guest sessions get "Delete guest account" in Settings. Guests cannot re-auth.
  it('a guest whose session is older than 24h can still delete the guest account', async () => {
    const { client, user } = await createGuest(h)
    await h.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(sessions.userId, user.id))
    const res = await client.delete('/api/account', { confirm: 'DELETE' })
    expect(res.status).toBe(200)
  })

  // PLAN §5: match_players/ratings/legal_acceptances are re-keyed to a fresh random
  // per-deletion id that deletion_log does not keep.
  it('deletion re-keys match_players to an id not stored in deletion_log', async () => {
    const a = await signUpVerified(h)
    const [civ] = await h.db.select().from(civilizations).limit(1)
    const [m] = await h.db
      .insert(matches)
      .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, status: 'finished' })
      .returning()
    if (!civ || !m) throw new Error('fixture')
    await h.db
      .insert(matchPlayers)
      .values({ matchId: m.id, seat: 0, userId: a.userId, civId: civ.id, civVersion: 1 })
    const res = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(res.status).toBe(200)
    const [mp] = await h.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, m.id))
    const logs = await h.db.select().from(deletionLog)
    expect(mp?.userId).not.toBe(a.userId)
    expect(logs.map((l) => l.userId)).not.toContain(mp?.userId)
  })

  // NamePolicy must govern the shown name; the web shows displayUsername first.
  it('sign-up rejects a displayUsername that fails the NamePolicy', async () => {
    const c = h.client()
    await confirmAge(c)
    await acceptLegal(c)
    const username = uniqueName('dn')
    await c.post(
      '/api/auth/sign-up/email',
      {
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        name: username,
        username,
        displayUsername: 'Deleted player #1',
      },
      { captcha: true },
    )
    const [row] = await h.db.select().from(users).where(eq(users.username, username))
    expect(row?.displayUsername).not.toBe('Deleted player #1')
  })

  it('update-user cannot set a displayUsername that fails the NamePolicy', async () => {
    const a = await signUpVerified(h)
    await a.client.post('/api/auth/update-user', { displayUsername: 'Guest-9999' })
    const [row] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(row?.displayUsername).not.toBe('Guest-9999')
  })

  // match_players.(civ_id, civ_version) must reference an existing civilization_versions row.
  it('rejects a match seat that references a civ version that does not exist', async () => {
    const [civ] = await h.db.select().from(civilizations).limit(1)
    const [m] = await h.db
      .insert(matches)
      .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, status: 'finished' })
      .returning()
    if (!civ || !m) throw new Error('fixture')
    await expect(
      h.db
        .insert(matchPlayers)
        .values({ matchId: m.id, seat: 0, botLevel: '600', civId: civ.id, civVersion: 99 }),
    ).rejects.toThrow()
  })
})
