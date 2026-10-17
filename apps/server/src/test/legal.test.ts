import { deletionLog, legalAcceptances, sessions, users, verifications } from '@game/db'
import { count, eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptLegal,
  confirmAge,
  type Harness,
  signUpVerified,
  startHarness,
  WEB_ORIGIN,
} from './harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

async function tableCounts() {
  const n = async (
    t:
      | typeof users
      | typeof legalAcceptances
      | typeof verifications
      | typeof sessions
      | typeof deletionLog,
  ) => (await h.db.select({ n: count() }).from(t))[0]?.n
  return {
    users: await n(users),
    acceptances: await n(legalAcceptances),
    verifications: await n(verifications),
    sessions: await n(sessions),
    deletionLog: await n(deletionLog),
  }
}

function cookiesOf(res: { headers: Record<string, unknown> }): string[] {
  return ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? [])
}

describe('neutral age screen', () => {
  it('refuses under-13 neutrally, stores nothing, and blocks an immediate retry', async () => {
    const before = await tableCounts()
    const c = h.client()
    const today = new Date()
    const dob = `${today.getUTCFullYear() - 10}-01-15`
    const res = await confirmAge(c, dob)
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      allowed: false,
      error: 'NOT_AVAILABLE',
      message: "Sorry, we can't create an account right now.",
    })
    // The refusal never mentions an age or a cutoff.
    expect(res.body.message).not.toMatch(/\d|\bage\b|old|year|birth/i)
    const set = cookiesOf(res)
    expect(set.some((s) => s.startsWith('age_block=') && /Max-Age=\d+/.test(s))).toBe(true)
    expect(set.some((s) => /^age_ok=[^;]+/.test(s))).toBe(false)
    expect(await tableCounts()).toEqual(before)

    // Same browser immediately claims an adult date: still refused.
    const retry = await confirmAge(c, '1980-01-01')
    expect(retry.status).toBe(403)
    // And it cannot create a guest or an account.
    await acceptLegal(c)
    const guest = await c.post('/api/auth/sign-in/anonymous', {}, { captcha: true })
    expect(guest.status).toBe(403)
    expect(await tableCounts()).toEqual(before)
  })

  it('accepts 13+ and keeps only the age band and date', async () => {
    const c = h.client()
    const res = await confirmAge(c, '2000-02-29')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: true })
    const cookie = cookiesOf(res).find((s) => s.startsWith('age_ok='))
    expect(cookie).toMatch(/HttpOnly/i)
    // The signed cookie payload holds no birth date.
    const payload = decodeURIComponent(
      (cookie as string).split(';')[0]?.slice('age_ok='.length) ?? '',
    )
    const json = Buffer.from(payload.split('.')[0] ?? '', 'base64url').toString()
    expect(json).not.toContain('2000')
    expect(JSON.parse(json)).toMatchObject({ confirmed: true, band: '18+' })
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['at', 'band', 'confirmed'])
    const status = await c.get('/api/legal/status')
    expect(status.body.ageConfirmed).toBe(true)
    expect(status.body.ageBand).toBe('18+')
  })

  it('stores the age band on accounts created after the screen', async () => {
    const c = h.client()
    const year = new Date().getUTCFullYear() - 14
    expect((await confirmAge(c, `${year}-01-01`)).status).toBe(200)
    await acceptLegal(c)
    const guest = await c.post('/api/auth/sign-in/anonymous', {}, { captcha: true })
    const [row] = await h.db.select().from(users).where(eq(users.id, guest.body.user.id))
    expect(row?.ageBand).toBe('13-15')
    expect(row?.ageConfirmedAt).toBeInstanceOf(Date)
  })

  it('does not count mistyped dates against the rate limit', async () => {
    const c = h.client()
    for (let i = 0; i < 12; i++) expect((await confirmAge(c, '2001-02-30')).status).toBe(400)
    expect((await confirmAge(c, '1990-01-01')).status).toBe(200)
  })

  it('a signed-in account answers from its own confirmation, not the browser cookie', async () => {
    const a = await signUpVerified(h)
    // A browser that never saw the age screen: sign-in doesn't need it.
    const c = h.client()
    const signedOut = await c.get('/api/legal/status')
    expect(signedOut.body).toMatchObject({ userId: null, ageConfirmed: false })
    const res = await c.post(
      '/api/auth/sign-in/username',
      { username: a.username, password: a.password },
      { captcha: true },
    )
    expect(res.status).toBe(200)
    const status = await c.get('/api/legal/status')
    expect(status.body).toMatchObject({
      userId: a.userId,
      ageConfirmed: true,
      ageBand: '18+',
      needsAcceptance: false,
    })
    expect(cookiesOf(res).some((s) => s.startsWith('age_ok='))).toBe(false)
  })

  it('rejects impossible dates', async () => {
    const c = h.client()
    expect((await confirmAge(c, '2001-02-30')).status).toBe(400)
    expect((await confirmAge(c, 'not-a-date')).status).toBe(400)
    expect((await confirmAge(c, '2999-01-01')).status).toBe(400)
  })
})

describe('clickwrap acceptance', () => {
  it('publishes the current required versions', async () => {
    const res = await h.client().get('/api/legal/versions')
    expect(res.body).toEqual({ versions: { terms: '0.2', privacy: '0.2' } })
  })

  it('records acceptances for a signed-in user and reports status', async () => {
    const a = await signUpVerified(h)
    const res = await acceptLegal(a.client)
    expect(res.status).toBe(201)
    const rows = await h.db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, a.userId))
    // Two from signup, two from this call.
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.kind).toBe(r.document === 'terms' ? 'accepted' : 'acknowledged')
    }
    expect(rows.every((r) => r.ipHash && r.acceptedAt instanceof Date)).toBe(true)
    const status = await a.client.get('/api/legal/status')
    expect(status.body).toMatchObject({
      required: { terms: '0.2', privacy: '0.2' },
      accepted: { terms: '0.2', privacy: '0.2' },
      needsAcceptance: false,
    })
    const list = await a.client.get('/api/legal/acceptances')
    expect(list.body.acceptances).toHaveLength(4)
  })

  it('rejects stale or unknown document versions', async () => {
    const c = h.client()
    const stale = await c.post('/api/legal/acceptances', { document: 'terms', version: '0.1' })
    expect(stale.status).toBe(409)
    expect(stale.body.required).toEqual({ terms: '0.2', privacy: '0.2' })
    const unknown = await c.post('/api/legal/acceptances', { document: 'eula', version: '0.2' })
    expect(unknown.status).toBe(400)
  })

  it('rejects cookie-carrying state changes from other origins (CSRF)', async () => {
    const a = await signUpVerified(h)
    const res = await a.client
      .post('/api/legal/acceptances', { document: 'terms', version: '0.2' })
      .set('origin', 'https://evil.example')
    expect(res.status).toBe(403)
    const ok = await a.client
      .post('/api/legal/acceptances', { document: 'terms', version: '0.2' })
      .set('origin', WEB_ORIGIN)
    expect(ok.status).toBe(201)
  })
})

describe('clickwrap on every account-creation path', () => {
  const create = () => {
    const before = h.auth.options.databaseHooks?.user?.create?.before
    if (!before) throw new Error('missing user.create.before hook')
    return before
  }
  const user = {
    id: 'oauth-user',
    name: 'Jane Q. Realname',
    email: 'jane@example.test',
    emailVerified: true,
    image: 'https://provider.example/photo.jpg',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const ctxWith = (cookie: string) =>
    ({ path: '/callback/:id', headers: new Headers({ cookie }) }) as unknown as Parameters<
      ReturnType<typeof create>
    >[1]

  async function gateCookies(withTerms: boolean) {
    const c = h.client()
    const jar: string[] = []
    const keep = (res: { headers: Record<string, unknown> }) => {
      for (const v of ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? [])) {
        jar.push(v.split(';')[0] as string)
      }
    }
    keep(await confirmAge(c))
    if (withTerms) keep(await acceptLegal(c))
    return jar.join('; ')
  }

  it('refuses an OAuth signup without a clickwrap acceptance', async () => {
    await expect(create()(user, ctxWith(await gateCookies(false)))).rejects.toMatchObject({
      body: { code: 'LEGAL_ACCEPTANCE_REQUIRED' },
    })
  })

  it('creates OAuth users with a placeholder name and no provider photo', async () => {
    const result = (await create()(user, ctxWith(await gateCookies(true)))) as {
      data: { name: string; image: string | null; ageBand: string }
    }
    expect(result.data.name).toMatch(/^Player-\d{4}$/)
    expect(result.data.image).toBeNull()
    expect(result.data.ageBand).toBe('18+')
  })
})

describe('server-side acceptance gate for game routes', () => {
  it('rejects sessions that have not accepted the current versions', async () => {
    const { default: express } = await import('express')
    const { requireSession } = await import('../http/session.ts')
    const { requireCurrentAcceptance } = await import('../legal/routes.ts')
    const app = express()
    app.get('/x', requireSession(h.auth), requireCurrentAcceptance(h.db), (_req, res) => {
      res.json({ ok: true })
    })
    const a = await signUpVerified(h)
    const signIn = await h
      .client()
      .post('/api/auth/sign-in/email', { email: a.email, password: a.password }, { captcha: true })
    const jar = cookiesOf(signIn)
      .map((c) => c.split(';')[0])
      .join('; ')
    const okRes = await request(app).get('/x').set('cookie', jar)
    expect(okRes.status).toBe(200)
    // A new Terms version the user hasn't accepted yet blocks game routes.
    await h.db.delete(legalAcceptances).where(eq(legalAcceptances.userId, a.userId))
    const blocked = await request(app).get('/x').set('cookie', jar)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error).toBe('LEGAL_ACCEPTANCE_REQUIRED')
  })
})
