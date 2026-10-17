import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, PROD_ENV, randomIp, startHarness } from './harness.ts'
import { TURNSTILE_DUMMY_TOKEN } from './turnstile-stub.ts'

/**
 * Single-origin deploy (WEB_DIST_DIR): one hostname serves the web app and the API, so
 * WEB_ORIGIN and API_PUBLIC_URL are the same https origin. Auth, CORS and the CSRF check must
 * still work, and the web app must never answer an API path.
 */
const ORIGIN = 'https://play.example.test'
const INDEX = '<!doctype html><title>Loading…</title><div id="root"></div>'

let dist: string
let h: Harness

beforeAll(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'single-origin-'))
  mkdirSync(path.join(dist, 'assets'))
  writeFileSync(path.join(dist, 'index.html'), INDEX)
  writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'export {}')
  h = await startHarness({
    ...PROD_ENV,
    API_PUBLIC_URL: ORIGIN,
    WEB_ORIGIN: ORIGIN,
    PASSKEY_RP_ID: 'play.example.test',
    WEB_DIST_DIR: dist,
  })
})
afterAll(async () => {
  await h?.close()
  rmSync(dist, { recursive: true, force: true })
})

describe('single-origin deploy (WEB_DIST_DIR)', () => {
  it('serves the web app and its client-side routes next to the API', async () => {
    const page = await request(h.app).get('/match/abc').set('accept', 'text/html')
    expect(page.status).toBe(200)
    expect(page.text).toBe(INDEX)
    expect(page.headers['content-security-policy']).toContain(`connect-src 'self' ${ORIGIN}`)
    // The API's own security headers apply to the pages too.
    expect(page.headers['x-frame-options']).toBe('DENY')
    expect(page.headers['strict-transport-security']).toMatch(/max-age=/)
    const asset = await request(h.app).get('/assets/index-abc.js')
    expect(asset.headers['cache-control']).toContain('immutable')
  })

  it('keeps every API path on the API', async () => {
    const health = await request(h.app).get('/api/health').set('accept', 'text/html')
    expect(health.status).toBe(200)
    expect(health.body.status).toBe('ok')
    const config = await request(h.app).get('/api/config').set('accept', 'text/html')
    expect(config.body.appName).toBeTruthy()
    const missing = await request(h.app).get('/api/no-such-route').set('accept', 'text/html')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'NOT_FOUND' })
    const auth = await request(h.app).get('/api/auth/get-session').set('accept', 'text/html')
    expect(auth.headers['content-type']).toMatch(/json/)
  })

  it('signs a guest in with a same-origin session cookie', async () => {
    const ip = randomIp()
    const jar: string[] = []
    const keep = <T extends { headers: Record<string, unknown> }>(res: T): T => {
      for (const c of ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? [])) {
        jar.push(c.split(';')[0] as string)
      }
      return res
    }
    const post = (p: string, body: object) =>
      request(h.app)
        .post(p)
        .set('origin', ORIGIN)
        .set('cf-connecting-ip', ip)
        .set('x-captcha-response', TURNSTILE_DUMMY_TOKEN)
        .set('cookie', jar.join('; '))
        .send(body)
    const age = keep(await post('/api/legal/age-confirmation', { dateOfBirth: '1990-01-01' }))
    expect(age.status).toBeLessThan(300)
    const legal = keep(
      await post('/api/legal/acceptances', {
        documents: Object.entries((await request(h.app).get('/api/config')).body.legalVersions).map(
          ([document, version]) => ({ document, version }),
        ),
      }),
    )
    expect(legal.status).toBeLessThan(300)
    const res = keep(await post('/api/auth/sign-in/anonymous', {}))
    expect(res.status).toBe(200)
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((x) => x.startsWith('__Secure-better-auth.session_token='))
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).not.toMatch(/Domain=/i)
    // CORS for the (same) web origin still grants credentials, and the CSRF check passes.
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    const session = await request(h.app)
      .get('/api/auth/get-session')
      .set('origin', ORIGIN)
      .set('cookie', jar.join('; '))
    expect(session.body?.user?.isAnonymous).toBe(true)
  })
})
