import { twoFactors, users } from '@game/db'
import { eq } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, signUpVerified, startHarness } from './harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

describe('TOTP two-factor', () => {
  it('enables TOTP with a QR URI + backup codes, then challenges password sign-in', async () => {
    const a = await signUpVerified(h)
    const enable = await a.client.post('/api/auth/two-factor/enable', { password: a.password })
    expect(enable.status).toBe(200)
    const { totpURI, backupCodes } = enable.body as { totpURI: string; backupCodes: string[] }
    expect(totpURI).toMatch(/^otpauth:\/\/totp\//)
    expect(backupCodes.length).toBeGreaterThanOrEqual(8)
    const totp = OTPAuth.URI.parse(totpURI) as OTPAuth.TOTP
    // Better Auth form-encodes spaces as '+'; the web client normalizes before drawing the QR.
    expect(totp.issuer.replaceAll('+', ' ')).toBe("LinkedList's Chess Game")

    // Not enabled until a code is verified.
    let [u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u?.twoFactorEnabled).toBe(false)
    const verify = await a.client.post('/api/auth/two-factor/verify-totp', {
      code: totp.generate(),
    })
    expect(verify.status).toBe(200)
    ;[u] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(u?.twoFactorEnabled).toBe(true)
    // Secret is encrypted at rest, not the base32 secret from the URI.
    const [tf] = await h.db.select().from(twoFactors).where(eq(twoFactors.userId, a.userId))
    expect(tf?.secret).not.toContain(totp.secret.base32)

    // Password sign-in now stops at the second factor.
    const c = h.client()
    const signIn = await c.post(
      '/api/auth/sign-in/email',
      { email: a.email, password: a.password },
      { captcha: true },
    )
    expect(signIn.status).toBe(200)
    expect(signIn.body.twoFactorRedirect).toBe(true)
    expect(signIn.body.twoFactorMethods).toContain('totp')
    expect((await c.get('/api/auth/get-session')).body).toBeNull()
    const wrong = await c.post('/api/auth/two-factor/verify-totp', { code: '000000' })
    expect(wrong.status).toBe(401)
    const ok = await c.post('/api/auth/two-factor/verify-totp', {
      code: totp.generate({ timestamp: Date.now() + 30_000 }),
    })
    expect(ok.status).toBe(200)
    expect((await c.get('/api/auth/get-session')).body.user.id).toBe(a.userId)

    // A backup code also completes the challenge, once.
    const c2 = h.client()
    await c2.post(
      '/api/auth/sign-in/email',
      { email: a.email, password: a.password },
      { captcha: true },
    )
    const backup = await c2.post('/api/auth/two-factor/verify-backup-code', {
      code: backupCodes[0],
    })
    expect(backup.status).toBe(200)
    const c3 = h.client()
    await c3.post(
      '/api/auth/sign-in/email',
      { email: a.email, password: a.password },
      { captcha: true },
    )
    const reused = await c3.post('/api/auth/two-factor/verify-backup-code', {
      code: backupCodes[0],
    })
    expect(reused.status).toBeGreaterThanOrEqual(400)
  })

  it('issues unambiguous upper-case backup codes and accepts them in any case or spacing', async () => {
    const a = await signUpVerified(h)
    const enable = await a.client.post('/api/auth/two-factor/enable', { password: a.password })
    const { totpURI, backupCodes } = enable.body as { totpURI: string; backupCodes: string[] }
    for (const code of backupCodes)
      expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}$/)
    const totp = OTPAuth.URI.parse(totpURI) as OTPAuth.TOTP
    await a.client.post('/api/auth/two-factor/verify-totp', { code: totp.generate() })

    const c = h.client()
    await c.post(
      '/api/auth/sign-in/email',
      { email: a.email, password: a.password },
      { captcha: true },
    )
    const typed = ` ${(backupCodes[0] as string).replace('-', ' ').toLowerCase()} `
    const res = await c.post('/api/auth/two-factor/verify-backup-code', { code: typed })
    expect(res.status).toBe(200)
  })
})
