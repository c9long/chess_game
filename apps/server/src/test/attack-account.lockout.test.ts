import { securityNotices, signInThrottle } from '@game/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { THROTTLE } from '../auth/throttle.ts'
import { type Harness, signUpVerified, startHarness } from './harness.ts'

/** Attacks on the sign-in lock notice email (auth.ts notifyLocked, security-notice.ts). */

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

const lockMails = (to: string) => h.mailbox.list(to).filter((m) => m.kind === 'sign-in-locked')
const settle = () => new Promise((r) => setTimeout(r, 300))

const attempt = (email: string, i: number) =>
  h
    .client()
    .post('/api/auth/sign-in/email', { email, password: `wrong password ${i}` }, { captcha: true })

describe('lock notice: enumeration', () => {
  it('the locking attempt looks the same for a real and an unknown address', async () => {
    const a = await signUpVerified(h)
    const ghost = `ghost-${Date.now()}@example.test`
    const shape = (r: Awaited<ReturnType<typeof attempt>>) => ({
      status: r.status,
      body: r.body,
      headers: Object.keys(r.headers)
        .filter((k) => !['date', 'etag', 'content-length', 'x-request-id'].includes(k))
        .sort(),
    })
    let real: ReturnType<typeof shape> | undefined
    let fake: ReturnType<typeof shape> | undefined
    for (let i = 0; i < THROTTLE.maxFailures + 1; i++) {
      real = shape(await attempt(a.email, i))
      fake = shape(await attempt(ghost, i))
      expect(real).toEqual(fake)
    }
    await settle()
    expect(lockMails(a.email)).toHaveLength(1)
    expect(lockMails(ghost)).toHaveLength(0)
  })
})

describe('lock notice: floods', () => {
  it('a burst of parallel failures sends one email', async () => {
    const a = await signUpVerified(h)
    await Promise.all(
      Array.from({ length: THROTTLE.maxFailures * 3 }, (_, i) => attempt(a.email, i)),
    )
    await settle()
    expect(lockMails(a.email)).toHaveLength(1)
  })

  it('repeated lock/unlock cycles within the hour send one email', async () => {
    const a = await signUpVerified(h)
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let i = 0; i < THROTTLE.maxFailures; i++) await attempt(a.email, i)
      // The lock (and its window) ends.
      await h.db.delete(signInThrottle).where(eq(signInThrottle.key, `u:${a.userId}`))
    }
    await settle()
    expect(lockMails(a.email)).toHaveLength(1)
  })

  it('a stale throttle window (lock expired, failures continue) sends no extra mail', async () => {
    const a = await signUpVerified(h)
    for (let i = 0; i < THROTTLE.maxFailures; i++) await attempt(a.email, i)
    await settle()
    expect(lockMails(a.email)).toHaveLength(1)
    // Lock and window both expired: counting restarts from 1, another lock within the hour.
    const past = new Date(Date.now() - THROTTLE.windowMs - 60_000)
    await h.db
      .update(signInThrottle)
      .set({ windowStartedAt: past, lockedUntil: past })
      .where(eq(signInThrottle.key, `u:${a.userId}`))
    for (let i = 0; i < THROTTLE.maxFailures + 3; i++) await attempt(a.email, i)
    await settle()
    expect(lockMails(a.email)).toHaveLength(1)
    const rows = await h.db
      .select()
      .from(securityNotices)
      .where(eq(securityNotices.userId, a.userId))
    expect(rows).toHaveLength(1)
  })

  it('step-up failures never trigger the sign-in lock email', async () => {
    const a = await signUpVerified(h)
    const { sessions } = await import('@game/db')
    await h.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 26 * 3600_000) })
      .where(eq(sessions.userId, a.userId))
    for (let i = 0; i < THROTTLE.maxFailures + 1; i++) {
      await a.client.delete('/api/account', { confirm: 'DELETE', password: `nope ${i}` })
    }
    await settle()
    expect(lockMails(a.email)).toHaveLength(0)
  })
})

describe('lock notice: content', () => {
  it('contains no client IP or user agent', async () => {
    const a = await signUpVerified(h)
    for (let i = 0; i < THROTTLE.maxFailures; i++) {
      await h
        .client(`10.123.45.${i + 10}`)
        .post(
          '/api/auth/sign-in/email',
          { email: a.email, password: `x${i}xxxxxxxxx` },
          { captcha: true },
        )
        .set('user-agent', 'EvilBrowser/9.9')
    }
    await settle()
    const [mail] = lockMails(a.email)
    expect(mail).toBeDefined()
    const all = `${mail?.subject}${mail?.text}${mail?.html}`
    expect(all).not.toContain('10.123')
    expect(all).not.toContain('EvilBrowser')
  })
})
