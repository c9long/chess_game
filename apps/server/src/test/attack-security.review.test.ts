/**
 * Security review regressions. Each block started as a proof of a defect (asserting the
 * defective behaviour) and now asserts the fixed behaviour.
 */
import {
  accounts,
  civilizations,
  deletionLog,
  matches,
  matchPlayers,
  sessions,
  users,
} from '@game/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.ts'
import {
  acceptLegal,
  confirmAge,
  createGuest,
  type Harness,
  lastMail,
  linkFrom,
  signUpVerified,
  startHarness,
  uniqueName,
  WEB_ORIGIN,
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
  await h.db
    .insert(matchPlayers)
    .values([{ matchId: match.id, seat: 0, userId, civId: civ.id, civVersion: 1, placement: 1 }])
  return match.id
}

describe('FIXED: guest history hijack via an attacker-owned verification link', () => {
  it("keeps a victim guest's matches and session when they open someone else's link", async () => {
    const attacker = h.client()
    await confirmAge(attacker)
    await acceptLegal(attacker)
    const username = uniqueName('evil')
    const email = `${username}@example.test`
    const su = await attacker.post(
      '/api/auth/sign-up/email',
      { email, password: 'attacker password 1', name: username, username },
      { captcha: true },
    )
    expect(su.status).toBe(200)
    const attackerId = su.body.user.id as string
    const token = linkFrom(lastMail(h, email, 'verify-email')).searchParams.get('token')

    // Victim guest opens the link (plain GET).
    const { client: victim, user: guest } = await createGuest(h)
    const matchId = await fakeMatchFor(guest.id)
    expect((await victim.agent.get(`/api/auth/verify-email?token=${token}`)).status).toBe(200)

    const [mp] = await h.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    expect(mp?.userId).toBe(guest.id)
    expect(await h.db.select().from(users).where(eq(users.id, guest.id))).toHaveLength(1)
    // No login CSRF: the victim is still their own guest.
    expect((await victim.get('/api/auth/get-session')).body.user.id).toBe(guest.id)
    // The attacker's address is verified, but nobody got signed in to it.
    const [acct] = await h.db.select().from(users).where(eq(users.id, attackerId))
    expect(acct?.emailVerified).toBe(true)
  })

  it('does not merge a guest into an account signed in to without an explicit upgrade', async () => {
    const owner = await signUpVerified(h)
    const { client, user: guest } = await createGuest(h)
    const matchId = await fakeMatchFor(guest.id)
    const res = await client.post(
      '/api/auth/sign-in/email',
      { email: owner.email, password: owner.password },
      { captcha: true },
    )
    expect(res.status).toBe(200)
    const [mp] = await h.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    expect(mp?.userId).toBe(guest.id)
  })
})

describe('FIXED: guests can delete themselves whenever they like', () => {
  it('skips the fresh-session rule for guests (they have nothing to re-authenticate with)', async () => {
    const { client, user } = await createGuest(h)
    await h.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) })
      .where(eq(sessions.userId, user.id))
    const del = await client.delete('/api/account', { confirm: 'DELETE' })
    expect(del.status).toBe(200)
    expect(await h.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0)
  })

  it('still requires a fresh session or the password for registered accounts', async () => {
    const a = await signUpVerified(h)
    await h.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) })
      .where(eq(sessions.userId, a.userId))
    const stale = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(stale.status).toBe(403)
    expect(stale.body.error).toBe('SESSION_NOT_FRESH')
    const wrong = await a.client.delete('/api/account', { confirm: 'DELETE', password: 'nope' })
    expect(wrong.status).toBe(403)
    const ok = await a.client.delete('/api/account', { confirm: 'DELETE', password: a.password })
    expect(ok.status).toBe(200)
  })
})

describe('FIXED: deletion re-keys history (PLAN §5)', () => {
  it('moves match_players to an id that deletion_log never stores', async () => {
    const a = await signUpVerified(h)
    const matchId = await fakeMatchFor(a.userId)
    expect((await a.client.delete('/api/account', { confirm: 'DELETE' })).status).toBe(200)
    const [mp] = await h.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    const [log] = await h.db.select().from(deletionLog).where(eq(deletionLog.userId, a.userId))
    expect(log?.userId).toBe(a.userId)
    expect(mp?.userId).not.toBe(a.userId)
    const logged = (await h.db.select({ u: deletionLog.userId }).from(deletionLog)).map((r) => r.u)
    expect(logged).not.toContain(mp?.userId)
  })
})

describe('FIXED: display names follow the name policy', () => {
  it('rejects free-form name/displayUsername updates, for guests and accounts', async () => {
    const { client, user } = await createGuest(h)
    const g = await client.post('/api/auth/update-user', { name: 'Deleted player #1' })
    expect(g.status).toBe(400)
    const gu = await client.post('/api/auth/update-user', { username: 'squatter_name' })
    expect(gu.status).toBe(400)
    const [guestRow] = await h.db.select().from(users).where(eq(users.id, user.id))
    expect(guestRow?.name).toMatch(/^Guest-\d{4}$/)
    expect(guestRow?.username).toBeNull()

    const a = await signUpVerified(h)
    const d = await a.client.post('/api/auth/update-user', { displayUsername: 'Official Support' })
    expect(d.status).toBe(400)
    const n = await a.client.post('/api/auth/update-user', { name: 'x'.repeat(5000) })
    expect(n.status).toBe(400)
    const rename = await a.client.post('/api/auth/update-user', { username: 'someone_else' })
    expect(rename.status).toBe(400)
    // Changing only the letter case of the shown name is fine.
    const cased = await a.client.post('/api/auth/update-user', {
      displayUsername: a.username.toUpperCase(),
    })
    expect(cased.status).toBe(200)
  })
})

describe('FIXED: production config fails closed', () => {
  it('refuses to start without an explicit NODE_ENV', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x@y/z', WEB_ORIGIN: 'https://play.ex.com' }),
    ).toThrow(/NODE_ENV/)
  })

  it('production refuses a siteverify override, rate limiting off, no Cloudflare trust', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x@y/z',
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      IP_HASH_SECRET: 'y'.repeat(40),
      TURNSTILE_SITE_KEY: 'a',
      TURNSTILE_SECRET_KEY: 'b',
      RESEND_API_KEY: 're_x',
      API_PUBLIC_URL: 'https://api.ex.com',
      WEB_ORIGIN: 'https://play.ex.com',
      PASSKEY_RP_ID: 'ex.com',
      TRUST_CLOUDFLARE: 'true',
    }
    expect(loadConfig(base).isProduction).toBe(true)
    expect(() =>
      loadConfig({ ...base, TURNSTILE_SITEVERIFY_URL: 'http://attacker.example/siteverify' }),
    ).toThrow(/TURNSTILE_SITEVERIFY_URL/)
    expect(() => loadConfig({ ...base, RATE_LIMIT_ENABLED: 'false' })).toThrow(/RATE_LIMIT/)
    expect(() => loadConfig({ ...base, TRUST_CLOUDFLARE: 'false' })).toThrow(/TRUST_CLOUDFLARE/)
    expect(() => loadConfig({ ...base, IP_HASH_SECRET: '' })).toThrow(/IP_HASH_SECRET/)
  })
})

describe('OK: hashing and redirects (verified, no defect)', () => {
  it('change-password and reset-password store argon2id m=19456,t=2,p=1', async () => {
    const a = await signUpVerified(h)
    await a.client.post('/api/auth/change-password', {
      currentPassword: a.password,
      newPassword: 'brand new password 42',
    })
    const [r1] = await h.db.select().from(accounts).where(eq(accounts.userId, a.userId))
    expect(r1?.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    await h
      .client()
      .post(
        '/api/auth/request-password-reset',
        { email: a.email, redirectTo: `${WEB_ORIGIN}/reset-password` },
        { captcha: true },
      )
    const token = linkFrom(lastMail(h, a.email, 'reset-password')).searchParams.get('token')
    await h.client().post('/api/auth/reset-password', { token, newPassword: 'another one 7777' })
    const [r2] = await h.db.select().from(accounts).where(eq(accounts.userId, a.userId))
    expect(r2?.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(r2?.password).not.toBe(r1?.password)
  })

  it('rejects foreign callbackURL variants', async () => {
    for (const v of ['//evil.example', '/\\evil.example', 'http://localhost:5173@evil.example/']) {
      const r = await h
        .client()
        .get(`/api/auth/verify-email?token=bogus&callbackURL=${encodeURIComponent(v)}`)
        .redirects(0)
      expect(r.status).toBe(403)
    }
  })
})
