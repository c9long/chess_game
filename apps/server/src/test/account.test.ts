import {
  accounts,
  civilizations,
  deletionLog,
  legalAcceptances,
  matches,
  matchPlayers,
  passkeys,
  ratings,
  sessions,
  twoFactors,
  users,
} from '@game/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findGuestByReferenceCode } from '../account/reference.ts'
import { createGuest, type Harness, signUpVerified, startHarness } from './harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

async function seedHistory(userId: string) {
  const [civ] = await h.db.select().from(civilizations).where(eq(civilizations.slug, 'japan'))
  const [match] = await h.db
    .insert(matches)
    .values({ mode: 'teams', timeControl: '3+2', rulesVersion: 1, rated: true, status: 'finished' })
    .returning()
  if (!civ || !match) throw new Error('fixture failed')
  await h.db.insert(matchPlayers).values({
    matchId: match.id,
    seat: 2,
    team: 0,
    userId,
    civId: civ.id,
    civVersion: 1,
    placement: 1,
    ratingBefore: 1500,
    ratingAfter: 1516,
  })
  await h.db
    .insert(ratings)
    .values({ userId, mode: 'teams', timeControl: '3+2', mu: 26.1, sigma: 7.9, gamesPlayed: 1 })
  return match.id
}

describe('account export', () => {
  it('downloads profile, acceptances, ratings and match history as JSON', async () => {
    const a = await signUpVerified(h)
    const matchId = await seedHistory(a.userId)
    const res = await a.client.get('/api/account/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="account-export-/)
    const data = JSON.parse(res.text)
    expect(data.profile).toMatchObject({
      id: a.userId,
      username: a.username,
      email: a.email,
      emailVerified: true,
      isGuest: false,
      ageConfirmed: true,
      ageBand: '18+',
    })
    expect(data.legalAcceptances).toHaveLength(2)
    expect(
      data.legalAcceptances.map(
        (x: { document: string; kind: string }) => `${x.document}:${x.kind}`,
      ),
    ).toEqual(expect.arrayContaining(['terms:accepted', 'privacy:acknowledged']))
    expect(data.ratings).toEqual([
      expect.objectContaining({ mode: 'teams', timeControl: '3+2', mu: 26.1, gamesPlayed: 1 }),
    ])
    expect(data.matchHistory).toEqual([
      expect.objectContaining({
        matchId,
        civ: 'japan',
        placement: 1,
        rated: true,
        ratingAfter: 1516,
      }),
    ])
    expect(data.linkedAccounts).toEqual([expect.objectContaining({ provider: 'credential' })])
    // No secrets: password hashes, session tokens, TOTP secrets.
    expect(res.text).not.toMatch(/\$argon2|"token"|"secret"|"password"/)
  })

  it('requires a session', async () => {
    expect((await h.client().get('/api/account/export')).status).toBe(401)
  })
})

describe('account deletion', () => {
  it('re-keys history to a placeholder, deletes the account and logs the deletion', async () => {
    const a = await signUpVerified(h)
    const matchId = await seedHistory(a.userId)

    expect((await a.client.delete('/api/account', {})).status).toBe(400)
    const res = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(res.status).toBe(200)
    expect(res.body.label).toMatch(/^Deleted player #\d+$/)

    // The account row and everything hanging off it are gone.
    expect(await h.db.select().from(users).where(eq(users.id, a.userId))).toHaveLength(0)
    for (const t of [accounts, sessions, passkeys, twoFactors] as const) {
      expect(await h.db.select().from(t).where(eq(t.userId, a.userId))).toHaveLength(0)
    }
    const log = await h.db.select().from(deletionLog).where(eq(deletionLog.userId, a.userId))
    expect(log).toHaveLength(1)
    expect(log[0]?.reason).toBe('user_request')

    // Opponents' history stays intact, under a fresh random id not kept in deletion_log.
    const [mp] = await h.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    const placeholderId = mp?.userId as string
    expect(placeholderId).toBeTruthy()
    expect(placeholderId).not.toBe(a.userId)
    const logged = (await h.db.select({ u: deletionLog.userId }).from(deletionLog)).map((r) => r.u)
    expect(logged).not.toContain(placeholderId)
    const [placeholder] = await h.db.select().from(users).where(eq(users.id, placeholderId))
    expect(placeholder?.name).toBe(res.body.label)
    expect(placeholder?.username).toBeNull()
    expect(placeholder?.email).not.toContain(a.username)
    expect(placeholder?.deletedAt).toBeInstanceOf(Date)
    // The label is not the deletion_log sequence number (that would link them again).
    expect(res.body.label).not.toBe(`Deleted player #${log[0]?.id}`)
    const [rating] = await h.db.select().from(ratings).where(eq(ratings.userId, placeholderId))
    expect(rating?.gamesPlayed).toBe(1)
    const acc = await h.db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, placeholderId))
    expect(acc.length).toBe(2)
    expect(acc.every((r) => r.ipHash === null)).toBe(true)

    // The placeholder can never sign in.
    expect(await h.db.select().from(accounts).where(eq(accounts.userId, placeholderId))).toEqual([])

    // The old session no longer works and the old password can't sign in.
    expect((await a.client.get('/api/auth/get-session')).body).toBeNull()
    const signIn = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    expect(signIn.status).toBe(401)
  })
})

describe('guest reference code', () => {
  it('shows a stable code that operators can resolve to the guest', async () => {
    const { client, user } = await createGuest(h)
    const r1 = await client.get('/api/account/reference')
    expect(r1.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect((await client.get('/api/account/reference')).body.code).toBe(r1.body.code)
    expect(await findGuestByReferenceCode(h.db, h.config, r1.body.code.toLowerCase())).toBe(user.id)
  })
})
