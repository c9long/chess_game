import { APP_NAME } from '@game/config'
import { accounts, securityNotices, sessions, signInThrottle, twoFactors, users } from '@game/db'
import { eq } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { claimSecurityNotice } from '../auth/security-notice.ts'
import { THROTTLE } from '../auth/throttle.ts'
import { signInLockedEmail } from '../email/templates.ts'
import {
  type Account,
  type Harness,
  signUpVerified,
  startHarness,
  type TestClient,
  WEB_ORIGIN,
} from './harness.ts'
import { SoftPasskey } from './webauthn.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

async function enableTotp(a: Account, body: object = { password: a.password }) {
  const enable = await a.client.post('/api/auth/two-factor/enable', body)
  const { totpURI, backupCodes } = enable.body as { totpURI: string; backupCodes: string[] }
  const totp = OTPAuth.URI.parse(totpURI) as OTPAuth.TOTP
  const verify = await a.client.post('/api/auth/two-factor/verify-totp', { code: totp.generate() })
  expect(verify.status).toBe(200)
  return { totp, backupCodes }
}

/** Ages every session of the account past the deletion freshness window. */
async function makeStale(userId: string) {
  const old = new Date(Date.now() - 26 * 60 * 60 * 1000)
  await h.db.update(sessions).set({ createdAt: old }).where(eq(sessions.userId, userId))
}

async function addPasskey(client: TestClient) {
  const key = new SoftPasskey('localhost', WEB_ORIGIN)
  const options = await client.get('/api/auth/passkey/generate-register-options')
  expect(options.status).toBe(200)
  const res = await client.post('/api/auth/passkey/verify-registration', {
    response: key.register(options.body),
    name: 'Test key',
  })
  expect(res.status).toBe(200)
  return key
}

async function passkeyAssertion(client: TestClient, key: SoftPasskey) {
  const options = await client.get('/api/auth/passkey/generate-authenticate-options')
  expect(options.status).toBe(200)
  return key.assert(options.body)
}

const remaining = async (c: TestClient) =>
  (await c.get('/api/account/two-factor/backup-codes')).body

describe('backup codes remaining', () => {
  it('counts unused codes without ever returning them', async () => {
    const a = await signUpVerified(h)
    expect(await remaining(a.client)).toEqual({ enabled: false, remaining: 0, total: 10 })

    const { backupCodes } = await enableTotp(a)
    const res = await a.client.get('/api/account/two-factor/backup-codes')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toEqual({ enabled: true, remaining: 10, total: 10 })
    for (const code of backupCodes) expect(res.text).not.toContain(code)

    // Signing in with two backup codes uses them up.
    for (const code of backupCodes.slice(0, 2)) {
      const c = h.client()
      await c.post(
        '/api/auth/sign-in/email',
        { email: a.email, password: a.password },
        { captcha: true },
      )
      expect((await c.post('/api/auth/two-factor/verify-backup-code', { code })).status).toBe(200)
    }
    expect((await remaining(a.client)).remaining).toBe(8)

    // A new set is full again.
    const regen = await a.client.post('/api/auth/two-factor/generate-backup-codes', {
      password: a.password,
    })
    expect(regen.status).toBe(200)
    expect((await remaining(a.client)).remaining).toBe(10)
  })

  it('reports an unknown count (not zero) when the stored codes can’t be read', async () => {
    const a = await signUpVerified(h)
    await enableTotp(a)
    await h.db
      .update(twoFactors)
      .set({ backupCodes: 'not-a-valid-ciphertext' })
      .where(eq(twoFactors.userId, a.userId))
    expect(await remaining(a.client)).toEqual({ enabled: true, remaining: null, total: 10 })
  })

  it('needs a session (cookie or bearer)', async () => {
    expect((await h.client().get('/api/account/two-factor/backup-codes')).status).toBe(401)
    const a = await signUpVerified(h)
    const [s] = await h.db.select().from(sessions).where(eq(sessions.userId, a.userId))
    const res = await h
      .client()
      .get('/api/account/two-factor/backup-codes')
      .set('authorization', `Bearer ${s?.token}`)
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
  })
})

describe('sign-in lock notice email', () => {
  const lockMails = (to: string) => h.mailbox.list(to).filter((m) => m.kind === 'sign-in-locked')

  async function failTimes(identifier: { email: string } | { username: string }, n: number) {
    const path = 'email' in identifier ? '/api/auth/sign-in/email' : '/api/auth/sign-in/username'
    for (let i = 0; i < n; i++) {
      const r = await h
        .client()
        .post(path, { ...identifier, password: `wrong password ${i}` }, { captcha: true })
      expect(r.status).toBe(401)
    }
  }

  it('emails the owner once when the throttle locks password sign-in', async () => {
    const a = await signUpVerified(h)
    await failTimes({ email: a.email }, THROTTLE.maxFailures - 1)
    expect(lockMails(a.email)).toHaveLength(0)
    await failTimes({ username: a.username }, 1)
    await vi.waitFor(() => expect(lockMails(a.email)).toHaveLength(1))

    const mail = lockMails(a.email)[0]
    expect(mail?.subject).toContain(APP_NAME)
    expect(mail?.text).toContain(`${WEB_ORIGIN}/forgot-password`)
    expect(mail?.text).toContain(`${WEB_ORIGIN}/account#two-step`)
    expect(mail?.text).toMatch(/after \d{1,2} \w{3} \d{4}, \d{2}:\d{2} UTC/)
    // No addresses or devices: the attempts' IPs never appear.
    expect(`${mail?.text}${mail?.html}`).not.toMatch(/\b10\.\d+\.\d+\.\d+\b/)

    // Still locked: refused before the password check, no more email.
    const locked = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    expect(locked.body.code).toBe('ACCOUNT_LOCKED')

    // The lock ends and is triggered again within the hour: still one email.
    await h.db.delete(signInThrottle).where(eq(signInThrottle.key, `u:${a.userId}`))
    await failTimes({ email: a.email }, THROTTLE.maxFailures)
    await new Promise((r) => setTimeout(r, 200))
    expect(lockMails(a.email)).toHaveLength(1)

    // An hour later, a new lock sends a new email.
    await h.db.delete(signInThrottle).where(eq(signInThrottle.key, `u:${a.userId}`))
    await h.db
      .update(securityNotices)
      .set({ sentAt: new Date(Date.now() - 61 * 60_000) })
      .where(eq(securityNotices.userId, a.userId))
    await failTimes({ email: a.email }, THROTTLE.maxFailures)
    await vi.waitFor(() => expect(lockMails(a.email)).toHaveLength(2))
  })

  it('never emails an unverified address, and unknown identifiers lock silently', async () => {
    const a = await signUpVerified(h)
    await h.db.update(users).set({ emailVerified: false }).where(eq(users.id, a.userId))
    await failTimes({ email: a.email }, THROTTLE.maxFailures)
    const ghost = 'nobody-here@example.test'
    await failTimes({ email: ghost }, THROTTLE.maxFailures)
    await new Promise((r) => setTimeout(r, 200))
    expect(lockMails(a.email)).toHaveLength(0)
    expect(lockMails(ghost)).toHaveLength(0)
  })

  it('claims a notice atomically', async () => {
    const a = await signUpVerified(h)
    const claims = await Promise.all(
      Array.from({ length: 5 }, () => claimSecurityNotice(h.db, a.userId, 'test-kind')),
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('renders the template with the app name and the unlock time in UTC', () => {
    const mail = signInLockedEmail('x@example.test', {
      unlocksAt: new Date('2026-10-17T14:05:00Z'),
      lockMinutes: 15,
      twoFactorEnabled: false,
      resetLink: 'https://play.example.test/forgot-password',
      securityLink: 'https://play.example.test/account#two-step',
    })
    expect(mail.subject).toBe(`Password sign-in to your ${APP_NAME} account was paused`)
    expect(mail.text).toContain('in about 15 minutes (after 17 Oct 2026, 14:05 UTC)')
    expect(mail.html).toContain('17 Oct 2026, 14:05 UTC')
    expect(mail.text).toContain('None of these attempts signed in.')
    expect(mail.text).not.toContain('nobody got in')
    expect(mail.text).toContain('turning on two-step verification')
    expect(mail.html).toContain('account#two-step')
    expect(mail.html).not.toContain("If you didn't ask for this")
  })

  it('doesn’t suggest two-step to an account that already has it', () => {
    const mail = signInLockedEmail('x@example.test', {
      unlocksAt: new Date('2026-10-17T14:05:00Z'),
      lockMinutes: 15,
      twoFactorEnabled: true,
      resetLink: 'https://play.example.test/forgot-password',
      securityLink: 'https://play.example.test/account#two-step',
    })
    expect(mail.text).toContain('Two-step verification is on')
    expect(mail.text).not.toContain('turning on two-step')
    expect(mail.html).not.toContain('turning on')
  })
})

describe('account deletion step-up', () => {
  it('lists the methods the account has when the session is stale', async () => {
    const a = await signUpVerified(h)
    await makeStale(a.userId)
    const res = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('SESSION_NOT_FRESH')
    expect(res.body.methods).toEqual(['password'])
  })

  it('accepts a TOTP code, and refuses a wrong one', async () => {
    const a = await signUpVerified(h)
    const { totp } = await enableTotp(a)
    await makeStale(a.userId)
    const listed = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(listed.body.methods).toEqual(['password', 'totp'])

    const wrong = await a.client.delete('/api/account', { confirm: 'DELETE', totpCode: '000000' })
    expect(wrong.status).toBe(403)
    expect(wrong.body.error).toBe('INVALID_CODE')
    const ok = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      totpCode: totp.generate(),
    })
    expect(ok.status).toBe(200)
    expect(ok.body.deleted).toBe(true)
  })

  it('accepts a backup code (any case or spacing) and uses it up', async () => {
    const a = await signUpVerified(h)
    const { backupCodes } = await enableTotp(a)
    await makeStale(a.userId)
    const code = backupCodes[3] as string
    const typed = ` ${code.replace('-', ' ').toLowerCase()} `
    const res = await a.client.delete('/api/account', { confirm: 'DELETE', backupCode: typed })
    expect(res.status).toBe(200)
  })

  it('refuses a used backup code', async () => {
    const a = await signUpVerified(h)
    const { backupCodes } = await enableTotp(a)
    const code = backupCodes[0] as string
    const c = h.client()
    await c.post(
      '/api/auth/sign-in/email',
      { email: a.email, password: a.password },
      { captcha: true },
    )
    expect((await c.post('/api/auth/two-factor/verify-backup-code', { code })).status).toBe(200)
    await makeStale(a.userId)
    const res = await a.client.delete('/api/account', { confirm: 'DELETE', backupCode: code })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('INVALID_BACKUP_CODE')
    expect((await remaining(a.client)).remaining).toBe(9)
  })

  it('refuses two-step codes for an account without two-step', async () => {
    const a = await signUpVerified(h)
    await makeStale(a.userId)
    const res = await a.client.delete('/api/account', { confirm: 'DELETE', totpCode: '123456' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('METHOD_UNAVAILABLE')
  })

  it('accepts a passkey assertion for a passwordless account', async () => {
    const a = await signUpVerified(h)
    const key = await addPasskey(a.client)
    // Passkey-only (as after signing up through OAuth and adding a passkey).
    await h.db.delete(accounts).where(eq(accounts.userId, a.userId))
    await makeStale(a.userId)
    const listed = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(listed.body.methods).toEqual(['passkey'])
    const pw = await a.client.delete('/api/account', { confirm: 'DELETE', password: a.password })
    expect(pw.body.error).toBe('METHOD_UNAVAILABLE')

    const sessionsBefore = await h.db.select().from(sessions).where(eq(sessions.userId, a.userId))
    const res = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      passkey: await passkeyAssertion(a.client, key),
    })
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(true)
    expect(sessionsBefore).toHaveLength(1)
    const [u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u).toBeUndefined()
  })

  it('refuses a replayed assertion and another account’s passkey', async () => {
    const a = await signUpVerified(h)
    const mine = await addPasskey(a.client)
    const b = await signUpVerified(h)
    const theirs = await addPasskey(b.client)
    await makeStale(a.userId)

    // B's passkey, signed for a challenge A's browser asked for.
    const options = await a.client.get('/api/auth/passkey/generate-authenticate-options')
    const foreign = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      passkey: theirs.assert(options.body),
    })
    expect(foreign.status).toBe(403)
    expect(foreign.body.error).toBe('PASSKEY_MISMATCH')
    // The session the check opened for B is closed again; B's own session stays.
    const bSessions = await h.db.select().from(sessions).where(eq(sessions.userId, b.userId))
    expect(bSessions).toHaveLength(1)

    // That challenge is used up: even the right passkey can't reuse it.
    const replay = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      passkey: mine.assert(options.body),
    })
    expect(replay.status).toBe(403)
    expect(replay.body.error).toBe('PASSKEY_FAILED')

    // A new challenge with A's own passkey works.
    const ok = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      passkey: await passkeyAssertion(a.client, mine),
    })
    expect(ok.status).toBe(200)
  })

  it('refuses a passkey assertion without its challenge cookie', async () => {
    const a = await signUpVerified(h)
    const key = await addPasskey(a.client)
    await makeStale(a.userId)
    const options = await h.client().get('/api/auth/passkey/generate-authenticate-options')
    const res = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      passkey: key.assert(options.body),
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('PASSKEY_FAILED')
  })

  it('locks step-up after repeated wrong proofs', async () => {
    const a = await signUpVerified(h)
    const { totp } = await enableTotp(a)
    await makeStale(a.userId)
    for (let i = 0; i < THROTTLE.maxFailures; i++) {
      const r = await a.client.delete('/api/account', { confirm: 'DELETE', totpCode: '000000' })
      expect(r.status).toBe(403)
    }
    const locked = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      totpCode: totp.generate(),
    })
    expect(locked.status).toBe(429)
    expect(locked.body.error).toBe('STEP_UP_LOCKED')
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0)
    // Password sign-in is a separate budget and keeps working.
    const signIn = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    expect(signIn.status).toBe(200)
  })

  it('refuses more than one method in one request', async () => {
    const a = await signUpVerified(h)
    await makeStale(a.userId)
    const res = await a.client.delete('/api/account', {
      confirm: 'DELETE',
      password: a.password,
      totpCode: '123456',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('ONE_METHOD')
  })
})

describe('two-step management on a stale session', () => {
  it('a passwordless account must sign in again; a password account confirms with it', async () => {
    const passwordless = await signUpVerified(h)
    await h.db.delete(accounts).where(eq(accounts.userId, passwordless.userId))
    await enableTotp(passwordless, {}) // fresh session: allowed without a password
    await makeStale(passwordless.userId)
    for (const path of ['get-totp-uri', 'generate-backup-codes', 'disable', 'enable']) {
      const res = await passwordless.client.post(`/api/auth/two-factor/${path}`, {})
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('SESSION_NOT_FRESH')
    }

    const withPassword = await signUpVerified(h)
    await enableTotp(withPassword)
    await makeStale(withPassword.userId)
    const regen = await withPassword.client.post('/api/auth/two-factor/generate-backup-codes', {
      password: withPassword.password,
    })
    expect(regen.status).toBe(200)
  })
})
