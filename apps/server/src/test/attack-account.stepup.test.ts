import { accounts, sessions, signInThrottle, users } from '@game/db'
import { eq } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { THROTTLE } from '../auth/throttle.ts'
import { type Account, type Harness, signUpVerified, startHarness, WEB_ORIGIN } from './harness.ts'
import { SoftPasskey } from './webauthn.ts'

/**
 * Attacks on the account-deletion step-up (account/step-up.ts) and the backup-code count
 * endpoint. The threat model: someone holds the victim's *stale* session (cookie or bearer,
 * e.g. from a shared or stolen device) and nothing else.
 */

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

async function makeStale(userId: string) {
  const old = new Date(Date.now() - 26 * 60 * 60 * 1000)
  await h.db.update(sessions).set({ createdAt: old }).where(eq(sessions.userId, userId))
}

async function enableTotp(a: Account, body: object = { password: a.password }) {
  const enable = await a.client.post('/api/auth/two-factor/enable', body)
  expect(enable.status).toBe(200)
  const { totpURI, backupCodes } = enable.body as { totpURI: string; backupCodes: string[] }
  const totp = OTPAuth.URI.parse(totpURI) as OTPAuth.TOTP
  const verify = await a.client.post('/api/auth/two-factor/verify-totp', { code: totp.generate() })
  expect(verify.status).toBe(200)
  return { totp, backupCodes }
}

/** Passwordless (as after an OAuth or passkey-only signup): drop the credential row. */
async function dropPassword(a: Account) {
  await h.db.delete(accounts).where(eq(accounts.userId, a.userId))
}

async function stillExists(userId: string) {
  const [u] = await h.db
    .select({ deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
  return Boolean(u && !u.deletedAt)
}

/** Six-digit codes that are certainly not valid for `totp` right now (window ±1). */
function wrongCodes(totp: OTPAuth.TOTP, n: number): string[] {
  const now = Date.now()
  const valid = new Set(
    [-1, 0, 1].map((i) => totp.generate({ timestamp: now + i * totp.period * 1000 })),
  )
  const out: string[] = []
  for (let i = 100000; out.length < n; i += 7919) {
    const c = String(i).padStart(6, '0')
    if (!valid.has(c)) out.push(c)
  }
  return out
}

describe('step-up: passwordless accounts can mint their own second factor from a stale session', () => {
  it('a stale session reads the existing TOTP secret and uses it as the step-up', async () => {
    const a = await signUpVerified(h)
    await dropPassword(a)
    await enableTotp(a, {}) // allowPasswordless: no password needed
    await makeStale(a.userId)

    const listed = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(listed.status).toBe(403)
    expect(listed.body.methods).toEqual(['totp'])

    // Attacker with only the stale cookie:
    const uri = await a.client.post('/api/auth/two-factor/get-totp-uri', {})
    if (uri.status === 200) {
      const totp = OTPAuth.URI.parse(uri.body.totpURI) as OTPAuth.TOTP
      const del = await a.client.delete('/api/account', {
        confirm: 'DELETE',
        totpCode: totp.generate(),
      })
      // A step-up the session holder can satisfy on its own proves nothing.
      expect(del.status).not.toBe(200)
    }
    expect(await stillExists(a.userId)).toBe(true)
  })

  it('a stale session regenerates backup codes and uses one as the step-up', async () => {
    const a = await signUpVerified(h)
    await dropPassword(a)
    await enableTotp(a, {})
    await makeStale(a.userId)

    const regen = await a.client.post('/api/auth/two-factor/generate-backup-codes', {})
    if (regen.status === 200) {
      const code = (regen.body.backupCodes as string[])[0] as string
      const del = await a.client.delete('/api/account', { confirm: 'DELETE', backupCode: code })
      expect(del.status).not.toBe(200)
    }
    expect(await stillExists(a.userId)).toBe(true)
  })

  it('a stale session enrolls a new TOTP (no password) and then deletes the account', async () => {
    const a = await signUpVerified(h)
    await dropPassword(a)
    await makeStale(a.userId)

    const blocked = await a.client.delete('/api/account', { confirm: 'DELETE' })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error).toBe('SESSION_NOT_FRESH')
    expect(blocked.body.methods).toEqual([]) // only re-signing in is supposed to work

    // Enrolling needs only a session (Better Auth's sessionMiddleware, not a fresh one), and
    // verifying the first code swaps the stale session for a brand-new one.
    const enable = await a.client.post('/api/auth/two-factor/enable', {})
    if (enable.status === 200) {
      const totp = OTPAuth.URI.parse(enable.body.totpURI) as OTPAuth.TOTP
      await a.client.post('/api/auth/two-factor/verify-totp', { code: totp.generate() })
      // Verifying the first code swapped the stale session for a fresh one: no proof needed.
      const noProof = await a.client.delete('/api/account', { confirm: 'DELETE' })
      expect(noProof.status).not.toBe(200)
    }
    expect(await stillExists(a.userId)).toBe(true)
  })

  it('a stale session cannot register a passkey (fresh session required)', async () => {
    const a = await signUpVerified(h)
    await makeStale(a.userId)
    const options = await a.client.get('/api/auth/passkey/generate-register-options')
    expect(options.status).not.toBe(200)
  })
})

describe('step-up: per-account budget under concurrency', () => {
  it('parallel wrong TOTP proofs cannot exceed the failure budget', async () => {
    const a = await signUpVerified(h)
    const { totp } = await enableTotp(a)
    await makeStale(a.userId)

    const N = 40
    const codes = wrongCodes(totp, N)
    const results = await Promise.all(
      codes.map((totpCode) => a.client.delete('/api/account', { confirm: 'DELETE', totpCode })),
    )
    const evaluated = results.filter((r) => r.status === 403).length
    const locked = results.filter((r) => r.status === 429).length
    const [row] = await h.db
      .select()
      .from(signInThrottle)
      .where(eq(signInThrottle.key, `stepup:${a.userId}`))
    // Each evaluated guess is a TOTP oracle query; the budget must hold for bursts too.
    expect({ evaluated, locked, recorded: row?.failures }).toEqual({
      evaluated: THROTTLE.maxFailures,
      locked: N - THROTTLE.maxFailures,
      recorded: THROTTLE.maxFailures,
    })
  })

  it('parallel wrong passwords cannot exceed the failure budget', async () => {
    const a = await signUpVerified(h)
    await makeStale(a.userId)
    const N = 25
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        a.client.delete('/api/account', { confirm: 'DELETE', password: `guess number ${i}` }),
      ),
    )
    const evaluated = results.filter((r) => r.status === 403).length
    expect(evaluated).toBeLessThanOrEqual(THROTTLE.maxFailures)
  })
})

describe('step-up: replay and cross-account proofs', () => {
  it('a backup code works once even when sent in parallel', async () => {
    const a = await signUpVerified(h)
    const { backupCodes } = await enableTotp(a)
    await makeStale(a.userId)
    const code = backupCodes[0] as string
    const [r1, r2] = await Promise.all([
      a.client.delete('/api/account', { confirm: 'DELETE', backupCode: code }),
      a.client.delete('/api/account', { confirm: 'DELETE', backupCode: code }),
    ])
    expect([r1.status, r2.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1)
  })

  it('another user’s passkey on a challenge minted for the victim is refused', async () => {
    const victim = await signUpVerified(h)
    const attacker = await signUpVerified(h)
    const attackerKey = new SoftPasskey('localhost', WEB_ORIGIN)
    const reg = await attacker.client.get('/api/auth/passkey/generate-register-options')
    await attacker.client.post('/api/auth/passkey/verify-registration', {
      response: attackerKey.register(reg.body),
      name: 'k',
    })
    // Victim has a passkey too, so 'passkey' is an offered method.
    const victimKey = new SoftPasskey('localhost', WEB_ORIGIN)
    const vreg = await victim.client.get('/api/auth/passkey/generate-register-options')
    await victim.client.post('/api/auth/passkey/verify-registration', {
      response: victimKey.register(vreg.body),
      name: 'k',
    })
    await makeStale(victim.userId)

    const options = await victim.client.get('/api/auth/passkey/generate-authenticate-options')
    const res = await victim.client.delete('/api/account', {
      confirm: 'DELETE',
      passkey: attackerKey.assert(options.body),
    })
    expect(res.status).toBe(403)
    expect(await stillExists(victim.userId)).toBe(true)
    // The attacker's challenge cookie can't be paired with the victim's session either.
    const aOpts = await attacker.client.get('/api/auth/passkey/generate-authenticate-options')
    const mixed = await victim.client.delete('/api/account', {
      confirm: 'DELETE',
      passkey: victimKey.assert(aOpts.body),
    })
    expect(mixed.status).toBe(403)
    expect(await stillExists(victim.userId)).toBe(true)
  })

  it('a stale bearer token gets the same step-up gate as a stale cookie', async () => {
    const a = await signUpVerified(h)
    await makeStale(a.userId)
    const [s] = await h.db.select().from(sessions).where(eq(sessions.userId, a.userId))
    const res = await h
      .client()
      .agent.delete('/api/account')
      .set('authorization', `Bearer ${s?.token}`)
      .send({ confirm: 'DELETE' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('SESSION_NOT_FRESH')
    expect(await stillExists(a.userId)).toBe(true)
  })
})

describe('step-up: CSRF', () => {
  it('a cross-site DELETE with the victim’s cookie is refused, even with a fresh session', async () => {
    const a = await signUpVerified(h)
    for (const origin of ['https://evil.example', 'null']) {
      const res = await a.client.agent
        .delete('/api/account')
        .set('origin', origin)
        .send({ confirm: 'DELETE' })
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('INVALID_ORIGIN')
    }
    const noOrigin = await a.client.agent.delete('/api/account').send({ confirm: 'DELETE' })
    expect(noOrigin.status).toBe(403)
    expect(await stillExists(a.userId)).toBe(true)
  })
})

describe('backup-code count', () => {
  it('only ever reports the caller’s own count', async () => {
    const victim = await signUpVerified(h)
    await enableTotp(victim)
    const attacker = await signUpVerified(h)
    for (const path of [
      `/api/account/two-factor/backup-codes?userId=${victim.userId}`,
      `/api/account/two-factor/backup-codes/${victim.userId}`,
    ]) {
      const res = await attacker.client.get(path)
      if (res.status === 200) expect(res.body).toEqual({ enabled: false, remaining: 0, total: 10 })
    }
    // The server-only Better Auth endpoint is not reachable over HTTP.
    const direct = await attacker.client.post('/api/auth/two-factor/view-backup-codes', {
      userId: victim.userId,
    })
    expect(direct.status).toBe(404)
  })
})
