import { civilizations, legalAcceptances, matches, matchPlayers, users } from '@game/db'
import { eq } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptLegal,
  createGuest,
  type Harness,
  lastMail,
  linkFrom,
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

async function fakeMatchFor(userId: string) {
  const [civ] = await h.db.select().from(civilizations).where(eq(civilizations.slug, 'mali'))
  const [match] = await h.db
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, status: 'finished' })
    .returning()
  if (!civ || !match) throw new Error('fixture failed')
  await h.db.insert(matchPlayers).values([
    { matchId: match.id, seat: 0, userId, civId: civ.id, civVersion: 1, placement: 1 },
    { matchId: match.id, seat: 1, botLevel: '1200', civId: civ.id, civVersion: 1, placement: 2 },
  ])
  return match.id
}

describe('guest accounts', () => {
  it('creates a guest with a generated name after age + clickwrap + captcha', async () => {
    const { client, user } = await createGuest(h)
    expect(user.name).toMatch(/^Guest-\d{4}$/)
    expect(user.isAnonymous).toBe(true)
    const [row] = await h.db.select().from(users).where(eq(users.id, user.id))
    expect(row?.isAnonymous).toBe(true)
    expect(row?.username).toBeNull()
    expect(row?.ageConfirmed).toBe(true)
    expect(row?.ageBand).toBe('18+')
    const acceptances = await h.db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, user.id))
    expect(acceptances.map((a) => `${a.document}:${a.kind}`).sort()).toEqual([
      'privacy:acknowledged',
      'terms:accepted',
    ])
    await acceptLegal(client)
    const again = await client.post('/api/auth/sign-in/anonymous', {}, { captcha: true })
    expect(again.status).toBe(400)
  })

  it('requires a captcha token and a clickwrap acceptance for guests', async () => {
    const c = h.client()
    await c.post('/api/legal/age-confirmation', { dateOfBirth: '1995-03-03' })
    const noTerms = await c.post('/api/auth/sign-in/anonymous', {}, { captcha: true })
    expect(noTerms.status).toBe(403)
    expect(noTerms.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED')
    await acceptLegal(c)
    const noCaptcha = await c.post('/api/auth/sign-in/anonymous', {})
    expect(noCaptcha.status).toBe(400)
  })

  it('upgrades a guest to an email account, keeping its history', async () => {
    const { client, user: guest } = await createGuest(h)
    const matchId = await fakeMatchFor(guest.id)

    // Signup form: the clickwrap is ticked again, then the account is created.
    await acceptLegal(client)
    const username = uniqueName('Up')
    const email = `${username}@example.test`
    const signUp = await client.post(
      '/api/auth/sign-up/email',
      { email, password: 'upgrade password 123', name: username, username },
      { captcha: true },
    )
    expect(signUp.status).toBe(200)
    const newUserId = signUp.body.user.id as string
    expect(newUserId).not.toBe(guest.id)

    // Verifying in the same browser signs in and links the guest (onLinkAccount).
    const token = linkFrom(lastMail(h, email, 'verify-email')).searchParams.get('token')
    const verify = await client.get(`/api/auth/verify-email?token=${token}`)
    expect(verify.status).toBe(200)

    const session = await client.get('/api/auth/get-session')
    expect(session.body.user.id).toBe(newUserId)
    expect(session.body.user.isAnonymous).toBeFalsy()

    const [mp] = await h.db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(matchPlayers.seat)
    expect(mp?.userId).toBe(newUserId)
    const moved = await h.db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, newUserId))
    // 2 guest-time + 2 from the signup-time tick (recorded for the guest, then moved) + 2 at creation.
    expect(moved.length).toBe(6)
    expect(
      await h.db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, guest.id)),
    ).toHaveLength(0)
    // The guest row itself is gone.
    expect(await h.db.select().from(users).where(eq(users.id, guest.id))).toHaveLength(0)

    const exported = await client.get('/api/account/export')
    expect(exported.body.matchHistory).toHaveLength(1)
    expect(exported.body.matchHistory[0].matchId).toBe(matchId)
  })

  it('moves guest history when the link is verified in another browser', async () => {
    const { client, user: guest } = await createGuest(h)
    const matchId = await fakeMatchFor(guest.id)
    await acceptLegal(client)
    const username = uniqueName('Xb')
    const email = `${username}@example.test`
    const signUp = await client.post(
      '/api/auth/sign-up/email',
      { email, password: 'cross browser 1234', name: username, username },
      { captcha: true },
    )
    const newUserId = signUp.body.user.id as string
    const token = linkFrom(lastMail(h, email, 'verify-email')).searchParams.get('token')
    // e.g. the email is opened on a phone.
    const phone = h.client()
    expect((await phone.get(`/api/auth/verify-email?token=${token}`)).status).toBe(200)
    const [mp] = await h.db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(matchPlayers.seat)
    expect(mp?.userId).toBe(newUserId)
    expect(await h.db.select().from(users).where(eq(users.id, guest.id))).toHaveLength(0)
    // The phone isn't signed in by the link; the player signs in there with the password.
    expect((await phone.get('/api/auth/get-session')).body).toBeNull()
  })

  it('links a guest that signs in to an existing account when it chose to', async () => {
    const owner = await signUpVerified(h)
    const { client, user: guest } = await createGuest(h)
    const matchId = await fakeMatchFor(guest.id)
    expect((await client.post('/api/account/guest-upgrade-intent')).status).toBe(204)
    const res = await client.post(
      '/api/auth/sign-in/email',
      { email: owner.email, password: owner.password },
      { captcha: true },
    )
    expect(res.status).toBe(200)
    const [mp] = await h.db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(matchPlayers.seat)
    expect(mp?.userId).toBe(owner.userId)
    expect(await h.db.select().from(users).where(eq(users.id, guest.id))).toHaveLength(0)
  })

  it('links on the 2FA step when the account uses two-factor sign-in', async () => {
    const owner = await signUpVerified(h)
    const enable = await owner.client.post('/api/auth/two-factor/enable', {
      password: owner.password,
    })
    const totp = OTPAuth.URI.parse(enable.body.totpURI) as OTPAuth.TOTP
    await owner.client.post('/api/auth/two-factor/verify-totp', { code: totp.generate() })

    const { client, user: guest } = await createGuest(h)
    const matchId = await fakeMatchFor(guest.id)
    await client.post('/api/account/guest-upgrade-intent')
    const signIn = await client.post(
      '/api/auth/sign-in/email',
      { email: owner.email, password: owner.password },
      { captcha: true },
    )
    expect(signIn.body.twoFactorRedirect).toBe(true)
    const ok = await client.post('/api/auth/two-factor/verify-totp', {
      code: totp.generate({ timestamp: Date.now() + 30_000 }),
    })
    expect(ok.status).toBe(200)
    const [mp] = await h.db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(matchPlayers.seat)
    expect(mp?.userId).toBe(owner.userId)
  })

  it('only guests can ask for an upgrade', async () => {
    const a = await signUpVerified(h)
    expect((await a.client.post('/api/account/guest-upgrade-intent')).status).toBe(400)
  })
})
