import { accounts, legalAcceptances, sessions, users } from '@game/db'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptLegal,
  confirmAge,
  type Harness,
  lastMail,
  linkFrom,
  PROD_ENV,
  randomIp,
  signUpVerified,
  startHarness,
  uniqueName,
  WEB_ORIGIN,
} from './harness.ts'
import { TURNSTILE_DUMMY_TOKEN } from './turnstile-stub.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

describe('email + password', () => {
  it('signup → verification email → verify → sign in', async () => {
    const c = h.client()
    const username = uniqueName('Sig')
    const email = `${username}@example.test`
    const password = 'a long enough password'
    expect((await confirmAge(c)).status).toBe(200)
    expect((await acceptLegal(c)).status).toBe(202)

    const signUp = await c.post(
      '/api/auth/sign-up/email',
      { email, password, name: username, username },
      { captcha: true },
    )
    expect(signUp.status).toBe(200)
    expect(signUp.body.token).toBeNull() // no session until the email is verified

    c.ip = randomIp()
    const early = await c.post('/api/auth/sign-in/email', { email, password }, { captcha: true })
    expect(early.status).toBe(403)
    expect(early.body.code).toBe('EMAIL_NOT_VERIFIED')

    const mail = lastMail(h, email, 'verify-email')
    const link = linkFrom(mail)
    expect(link.origin).toBe(WEB_ORIGIN)
    expect(link.pathname).toBe('/verify-email')
    const verify = await c.get(`/api/auth/verify-email?token=${link.searchParams.get('token')}`)
    expect(verify.status).toBe(200)

    const fresh = h.client()
    const signIn = await fresh.post(
      '/api/auth/sign-in/email',
      { email, password },
      { captcha: true },
    )
    expect(signIn.status).toBe(200)
    expect(signIn.body.user.emailVerified).toBe(true)
    const session = await fresh.get('/api/auth/get-session')
    expect(session.body.user.username).toBe(username.toLowerCase())
    expect(session.body.user.displayUsername).toBe(username)
    expect(session.body.user.ageConfirmed).toBe(true)
    expect(session.body.user.ageBand).toBe('18+')

    const byName = await h
      .client()
      .post('/api/auth/sign-in/username', { username, password }, { captcha: true })
    expect(byName.status).toBe(200)
  })

  it('stores passwords as argon2id (m=19456, t=2, p=1)', async () => {
    const a = await signUpVerified(h)
    const [row] = await h.db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, a.userId))
    expect(row?.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(row?.password).not.toContain(a.password)
  })

  it('records the clickwrap acceptance made before signup, with a hashed IP', async () => {
    const c = h.client()
    const a = await signUpVerified(h, c)
    const rows = await h.db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, a.userId))
    expect(rows.map((r) => `${r.document}@${r.version}`).sort()).toEqual([
      'privacy@0.2',
      'terms@0.2',
    ])
    for (const r of rows) {
      expect(r.ipHash).toMatch(/^[0-9a-f]{64}$/)
      expect(r.ipHash).not.toContain(c.ip)
    }
  })

  it('refuses signup without age confirmation or clickwrap acceptance', async () => {
    const body = () => {
      const username = uniqueName('n')
      return {
        email: `${username}@example.test`,
        password: 'password1234',
        name: username,
        username,
      }
    }
    const noAge = h.client()
    await acceptLegal(noAge)
    const r1 = await noAge.post('/api/auth/sign-up/email', body(), { captcha: true })
    expect(r1.status).toBe(403)
    expect(r1.body.code).toBe('AGE_CONFIRMATION_REQUIRED')

    const noTerms = h.client()
    await confirmAge(noTerms)
    const r2 = await noTerms.post('/api/auth/sign-up/email', body(), { captcha: true })
    expect(r2.status).toBe(403)
    expect(r2.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED')

    const noName = h.client()
    await confirmAge(noName)
    await acceptLegal(noName)
    const { username: _u, ...withoutUsername } = body()
    const r3 = await noName.post('/api/auth/sign-up/email', withoutUsername, { captcha: true })
    expect(r3.status).toBe(400)
  })

  it('validates usernames through the name policy and keeps them unique', async () => {
    const c = h.client()
    await confirmAge(c)
    await acceptLegal(c)
    const bad = await c.post(
      '/api/auth/sign-up/email',
      {
        email: `${uniqueName()}@example.test`,
        password: 'password1234',
        name: 'x',
        username: 'Guest-1234',
      },
      { captcha: true },
    )
    expect(bad.status).toBe(400)
    const a = await signUpVerified(h)
    const c2 = h.client()
    await confirmAge(c2)
    await acceptLegal(c2)
    const dup = await c2.post(
      '/api/auth/sign-up/email',
      {
        email: `${uniqueName()}@example.test`,
        password: 'password1234',
        name: 'x',
        username: a.username.toUpperCase(),
      },
      { captcha: true },
    )
    expect(dup.status).toBe(400)
  })

  it('requires a valid Turnstile token on sign-up and sign-in', async () => {
    const c = h.client()
    const missing = await c.post('/api/auth/sign-in/email', {
      email: 'x@example.test',
      password: 'x',
    })
    expect(missing.status).toBe(400)
    const wrong = await c
      .post('/api/auth/sign-in/email', { email: 'x@example.test', password: 'x' })
      .set('x-captcha-response', 'forged-token')
    expect(wrong.status).toBe(403)
  })

  it('resets a password through the emailed link', async () => {
    const a = await signUpVerified(h)
    const c = h.client()
    const req = await c.post(
      '/api/auth/request-password-reset',
      { email: a.email, redirectTo: `${WEB_ORIGIN}/reset-password` },
      { captcha: true },
    )
    expect(req.status).toBe(200)
    const link = linkFrom(lastMail(h, a.email, 'reset-password'))
    expect(link.pathname).toBe('/reset-password')
    const reset = await c.post('/api/auth/reset-password', {
      token: link.searchParams.get('token'),
      newPassword: 'a brand new password',
    })
    expect(reset.status).toBe(200)
    const old = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    expect(old.status).toBe(401)
    const fresh = await h
      .client()
      .post(
        '/api/auth/sign-in/email',
        { email: a.email, password: 'a brand new password' },
        { captcha: true },
      )
    expect(fresh.status).toBe(200)
  })
})

describe('rate limiting and client IP', () => {
  it('limits sign-in attempts per real client IP (CF-Connecting-IP)', async () => {
    const ip = randomIp()
    const attempt = () =>
      h
        .client(ip)
        .post(
          '/api/auth/sign-in/email',
          { email: 'nobody@example.test', password: 'wrong-password' },
          { captcha: true },
        )
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push((await attempt()).status)
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401])
    expect(statuses[3]).toBe(429)
    // A different client IP is not affected.
    const other = await h
      .client()
      .post(
        '/api/auth/sign-in/email',
        { email: 'nobody@example.test', password: 'wrong-password' },
        { captcha: true },
      )
    expect(other.status).toBe(401)
  })
})

describe('bearer tokens, cookies and CORS', () => {
  it('never exposes the session token to page scripts (no set-auth-token header)', async () => {
    const a = await signUpVerified(h)
    const signIn = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    expect(signIn.status).toBe(200)
    expect(signIn.headers['set-auth-token']).toBeUndefined()
    expect(String(signIn.headers['access-control-expose-headers'] ?? '')).not.toMatch(
      /set-auth-token/i,
    )
  })

  it('gives native clients a bearer token through the device flow (Unity)', async () => {
    const a = await signUpVerified(h)
    const native = h.client()
    const code = await native.post('/api/auth/device/code', { client_id: 'game-unity-client' })
    expect(code.status).toBe(200)
    // The signed-in player opens the verification page and approves.
    const look = await a.client.get(`/api/auth/device?user_code=${code.body.user_code}`)
    expect(look.body.client_id).toBe('game-unity-client')
    const approve = await a.client.post('/api/auth/device/approve', {
      userCode: code.body.user_code,
    })
    expect(approve.status).toBe(200)
    const token = await native.post('/api/auth/device/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: code.body.device_code,
      client_id: 'game-unity-client',
    })
    expect(token.status).toBe(200)
    expect(token.body.access_token).toBeTruthy()
    const res = await request(h.app)
      .get('/api/auth/get-session')
      .set('authorization', `Bearer ${token.body.access_token}`)
    expect(res.body.user.id).toBe(a.userId)
    // Device codes are short-lived.
    expect(code.body.expires_in).toBeLessThanOrEqual(600)
  })

  it('approves a device only from a fresh session, so an old one cannot mint a fresh one', async () => {
    const a = await signUpVerified(h)
    await h.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(sessions.userId, a.userId))
    const native = h.client()
    const code = await native.post('/api/auth/device/code', { client_id: 'game-unity-client' })
    const approve = await a.client.post('/api/auth/device/approve', {
      userCode: code.body.user_code,
    })
    expect(approve.status).toBe(403)
    expect(approve.body.code).toBe('SESSION_NOT_FRESH')
    const token = await native.post('/api/auth/device/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: code.body.device_code,
      client_id: 'game-unity-client',
    })
    expect(token.body.access_token).toBeUndefined()
  })

  it('sets HttpOnly SameSite=Lax session cookies', async () => {
    const a = await signUpVerified(h)
    const signIn = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    const cookie = ([] as string[])
      .concat(signIn.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('better-auth.session_token='))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('allows credentialed CORS only from the web origin', async () => {
    const ok = await h.client().get('/api/health').set('origin', WEB_ORIGIN)
    expect(ok.headers['access-control-allow-origin']).toBe(WEB_ORIGIN)
    expect(ok.headers['access-control-allow-credentials']).toBe('true')
    const evil = await h.client().get('/api/health').set('origin', 'https://evil.example')
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example')
  })

  it('rejects cookie-authenticated auth calls from untrusted origins', async () => {
    const a = await signUpVerified(h)
    const res = await a.client.post('/api/auth/sign-out').set('origin', 'https://evil.example')
    expect(res.status).toBe(403)
  })
})

describe('device authorization', () => {
  it('issues device/user codes for known clients only', async () => {
    const ok = await h.client().post('/api/auth/device/code', { client_id: 'game-unity-client' })
    expect(ok.status).toBe(200)
    expect(ok.body.user_code).toBeTruthy()
    expect(ok.body.verification_uri).toBe(`${WEB_ORIGIN}/device`)
    const bad = await h.client().post('/api/auth/device/code', { client_id: 'someone-else' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
  })
})

describe('production layout (play./api. subdomains behind Cloudflare)', () => {
  it('sets Secure cookies, credentialed CORS for play. only, and the passkey rpID', async () => {
    const prod = await startHarness(PROD_ENV)
    const play = PROD_ENV.WEB_ORIGIN
    try {
      // CORS: credentials only for the web origin.
      const ok = await request(prod.app).get('/api/health').set('origin', play)
      expect(ok.headers['access-control-allow-origin']).toBe(play)
      expect(ok.headers['access-control-allow-credentials']).toBe('true')
      expect(ok.headers['strict-transport-security']).toMatch(/max-age=/)
      const evil = await request(prod.app).get('/api/health').set('origin', 'https://evil.test')
      expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.test')

      // Secure cookies aren't replayed over plain http by the test agent, so carry them by hand.
      const ip = randomIp()
      const jar: string[] = []
      const keep = (res: { headers: Record<string, unknown> }) => {
        for (const c of ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? [])) {
          jar.push(c.split(';')[0] as string)
        }
        return res
      }
      const post = (path: string, body: object, origin = play) =>
        request(prod.app)
          .post(path)
          .set('origin', origin)
          .set('cf-connecting-ip', ip)
          .set('x-captcha-response', TURNSTILE_DUMMY_TOKEN)
          .set('cookie', jar.join('; '))
          .send(body)
      const age = keep(await post('/api/legal/age-confirmation', { dateOfBirth: '1990-01-01' }))
      expect(String(age.headers['set-cookie'])).toMatch(/age_ok=.*Secure/)
      keep(
        await post('/api/legal/acceptances', {
          documents: [
            { document: 'terms', version: '0.2' },
            { document: 'privacy', version: '0.2' },
          ],
        }),
      )
      // The old dev origin is not trusted in production.
      expect((await post('/api/auth/sign-in/anonymous', {}, WEB_ORIGIN)).status).toBe(403)
      const res = await post('/api/auth/sign-in/anonymous', {})
      expect(res.status).toBe(200)
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .find((x) => x.startsWith('__Secure-better-auth.session_token='))
      expect(cookie).toMatch(/; Secure/i)
      expect(cookie).toMatch(/SameSite=Lax/i)
      expect(cookie).toMatch(/HttpOnly/i)
      // Passkeys are bound to the registrable domain and the play. origin.
      const opts = await request(prod.app).get('/api/auth/passkey/generate-authenticate-options')
      expect(opts.body.rpId).toBe('example.test')
      // The dev mailbox is never mounted in production.
      expect((await request(prod.app).get('/api/dev/mail')).status).toBe(404)
      const [u] = await prod.db.select().from(users).where(eq(users.id, res.body.user.id))
      expect(u?.isAnonymous).toBe(true)
    } finally {
      await prod.close()
    }
  })
})

describe('client IP without Cloudflare', () => {
  it('ignores a spoofed X-Forwarded-For when not trusting Cloudflare', async () => {
    const direct = await startHarness({ TRUST_CLOUDFLARE: 'false' })
    try {
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) {
        const r = await request(direct.app)
          .post('/api/auth/sign-in/email')
          .set('origin', WEB_ORIGIN)
          .set('x-forwarded-for', randomIp())
          .set('x-captcha-response', TURNSTILE_DUMMY_TOKEN)
          .send({ email: 'spoof@example.test', password: 'wrong-password' })
        statuses.push(r.status)
      }
      // All four come from the same TCP peer, whatever the header says.
      expect(statuses).toEqual([401, 401, 401, 429])
    } finally {
      await direct.close()
    }
  })
})

describe('guest creation limit', () => {
  it('allows 5 guests per minute per client IP', async () => {
    const ip = randomIp()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const c = h.client(ip)
      await confirmAge(c)
      await acceptLegal(c)
      statuses.push((await c.post('/api/auth/sign-in/anonymous', {}, { captcha: true })).status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})

describe('per-account password throttle', () => {
  it('locks password sign-in after 10 failures, across email and username', async () => {
    const a = await signUpVerified(h)
    for (let i = 0; i < 10; i++) {
      const path = i % 2 ? '/api/auth/sign-in/username' : '/api/auth/sign-in/email'
      const body = i % 2 ? { username: a.username } : { email: a.email }
      const r = await h
        .client()
        .post(path, { ...body, password: `wrong password ${i}` }, { captcha: true })
      expect(r.status).toBe(401)
    }
    const locked = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    expect(locked.status).toBe(429)
    expect(locked.body.code).toBe('ACCOUNT_LOCKED')
    expect(Number(locked.headers['x-retry-after'])).toBeGreaterThan(0)

    // A password reset lifts the lock.
    await h
      .client()
      .post(
        '/api/auth/request-password-reset',
        { email: a.email, redirectTo: `${WEB_ORIGIN}/reset-password` },
        { captcha: true },
      )
    const token = linkFrom(lastMail(h, a.email, 'reset-password')).searchParams.get('token')
    await h.client().post('/api/auth/reset-password', { token, newPassword: 'reset password 99' })
    const after = await h
      .client()
      .post(
        '/api/auth/sign-in/username',
        { username: a.username, password: 'reset password 99' },
        { captcha: true },
      )
    expect(after.status).toBe(200)
  })
})

describe('verification email recovery', () => {
  it('re-sends the link when an unverified account signs in with the right password', async () => {
    const c = h.client()
    await confirmAge(c)
    await acceptLegal(c)
    const username = uniqueName('unv')
    const email = `${username}@example.test`
    await c.post(
      '/api/auth/sign-up/email',
      { email, password: 'unverified password', name: username, username },
      { captcha: true },
    )
    const count = () => h.mailbox.list(email).filter((m) => m.kind === 'verify-email').length
    expect(count()).toBe(1)
    const wrong = await h
      .client()
      .post('/api/auth/sign-in/email', { email, password: 'not it at all' }, { captcha: true })
    expect(wrong.status).toBe(401)
    expect(count()).toBe(1)
    const right = await h.client().post(
      '/api/auth/sign-in/username',
      { username, password: 'unverified password' },
      {
        captcha: true,
      },
    )
    expect(right.status).toBe(403)
    expect(right.body.code).toBe('EMAIL_NOT_VERIFIED')
    await new Promise((r) => setTimeout(r, 50))
    expect(count()).toBe(2)
  })

  it('requires Turnstile to send a verification email', async () => {
    const r = await h
      .client()
      .post('/api/auth/send-verification-email', { email: 'x@example.test' })
    expect(r.status).toBe(400)
  })

  it('tells an existing owner when someone signs up with their email', async () => {
    const owner = await signUpVerified(h)
    const c = h.client()
    await confirmAge(c)
    await acceptLegal(c)
    const username = uniqueName('dup')
    const res = await c.post(
      '/api/auth/sign-up/email',
      { email: owner.email, password: 'some other password', name: username, username },
      { captcha: true },
    )
    // Same answer as a fresh signup (no enumeration) ...
    expect(res.status).toBe(200)
    expect(res.body.token).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    // ... but the owner hears about it.
    const notice = lastMail(h, owner.email, 'account-exists')
    expect(notice.text).toContain(`${WEB_ORIGIN}/forgot-password`)
  })
})

describe('usernames for accounts created without one (OAuth)', () => {
  it('lets the player choose a username once, which becomes the shown name', async () => {
    const a = await signUpVerified(h)
    // Stand-in for an OAuth signup: no username yet, placeholder name.
    await h.db
      .update(users)
      .set({ username: null, displayUsername: null, name: 'Player-1234' })
      .where(eq(users.id, a.userId))
    const bad = await a.client.post('/api/auth/update-user', { username: 'Guest-1234' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    const chosen = uniqueName('Pick')
    const ok = await a.client.post('/api/auth/update-user', { username: chosen })
    expect(ok.status).toBe(200)
    const [row] = await h.db.select().from(users).where(eq(users.id, a.userId))
    expect(row?.username).toBe(chosen.toLowerCase())
    expect(row?.displayUsername).toBe(chosen)
    expect(row?.name).toBe(chosen)
    // Only once.
    const again = await a.client.post('/api/auth/update-user', { username: uniqueName('Again') })
    expect(again.status).toBe(400)
  })

  it('accepts a displayUsername at signup only if it matches the username', async () => {
    const c = h.client()
    await confirmAge(c)
    await acceptLegal(c)
    const username = uniqueName('case')
    const res = await c.post(
      '/api/auth/sign-up/email',
      {
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        name: 'Official Support',
        username,
        displayUsername: username.toUpperCase(),
      },
      { captcha: true },
    )
    expect(res.status).toBe(200)
    const [row] = await h.db.select().from(users).where(eq(users.username, username.toLowerCase()))
    expect(row?.displayUsername).toBe(username.toUpperCase())
    // A client-supplied `name` is ignored: the shown name is the username.
    expect(row?.name).toBe(username.toUpperCase())
  })
})
