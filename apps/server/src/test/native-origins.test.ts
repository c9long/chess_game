/**
 * Mobile app preparation (docs/MOBILE.md §2/§3 phase 2): NATIVE_ORIGINS adds the Capacitor
 * WebView origins to CORS, Better Auth's trusted origins and the WebSocket origin check, and
 * the device flow accepts the mobile client id. Empty NATIVE_ORIGINS changes nothing.
 */
import { request as httpRequest } from 'node:http'
import { COLYSEUS_PATH } from '@game/protocol'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type GameHarness, startGameHarness } from './game-harness.ts'
import { type Harness, signUpVerified, startHarness, TestClient, WEB_ORIGIN } from './harness.ts'

const IOS = 'capacitor://localhost'
const ANDROID = 'https://localhost'
const NATIVE = { NATIVE_ORIGINS: `${IOS}, ${ANDROID}` }

let plain: Harness
let mobile: Harness
beforeAll(async () => {
  ;[plain, mobile] = await Promise.all([startHarness(), startHarness(NATIVE)])
})
afterAll(async () => {
  await Promise.all([plain?.close(), mobile?.close()])
})

/** Signs up in the web app, then hands a bearer token to the app through the device flow. */
async function deviceToken(h: Harness, origin = IOS) {
  const account = await signUpVerified(h)
  const app = new TestClient(h.app, undefined, origin)
  const code = await app.post('/api/auth/device/code', { client_id: 'game-mobile-client' })
  expect(code.status).toBe(200)
  const look = await account.client.get(`/api/auth/device?user_code=${code.body.user_code}`)
  expect(look.body.client_id).toBe('game-mobile-client')
  const approve = await account.client.post('/api/auth/device/approve', {
    userCode: code.body.user_code,
  })
  expect(approve.status).toBe(200)
  const token = await app.post('/api/auth/device/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: code.body.device_code,
    client_id: 'game-mobile-client',
  })
  expect(token.status).toBe(200)
  expect(token.body.access_token).toBeTruthy()
  return { account, token: token.body.access_token as string }
}

describe('NATIVE_ORIGINS unset (default)', () => {
  it('keeps CORS to the web origin only', async () => {
    expect(plain.config.nativeOrigins).toEqual([])
    const res = await request(plain.app).get('/api/health').set('origin', IOS)
    expect(res.headers['access-control-allow-origin']).not.toBe(IOS)
    const web = await request(plain.app).get('/api/health').set('origin', WEB_ORIGIN)
    expect(web.headers['access-control-allow-origin']).toBe(WEB_ORIGIN)
  })

  it('refuses cookie-authenticated auth calls from an app origin', async () => {
    const a = await signUpVerified(plain)
    const res = await a.client.post('/api/auth/sign-out').set('origin', IOS)
    expect(res.status).toBe(403)
  })
})

describe('NATIVE_ORIGINS set', () => {
  it('allows CORS from each app origin without credentials, and credentialed from the web', async () => {
    expect(mobile.config.nativeOrigins).toEqual([IOS, ANDROID])
    for (const origin of [IOS, ANDROID, WEB_ORIGIN]) {
      const res = await request(mobile.app)
        .options('/api/auth/get-session')
        .set('origin', origin)
        .set('access-control-request-method', 'GET')
        .set('access-control-request-headers', 'authorization')
      expect(res.headers['access-control-allow-origin']).toBe(origin)
      expect(res.headers['access-control-allow-credentials']).toBe(
        origin === WEB_ORIGIN ? 'true' : undefined,
      )
    }
    const evil = await request(mobile.app).get('/api/health').set('origin', 'https://evil.example')
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example')
  })

  it('trusts the app origins in Better Auth', async () => {
    const a = await signUpVerified(mobile)
    const res = await a.client.post('/api/auth/sign-out').set('origin', IOS)
    expect(res.status).toBe(200)
    const evil = await signUpVerified(mobile)
    expect(
      (await evil.client.post('/api/auth/sign-out').set('origin', 'https://evil.example')).status,
    ).toBe(403)
  })

  it('lets the app use a device-flow bearer token from its origin, and sign out with it', async () => {
    const { account, token } = await deviceToken(mobile)
    const session = await request(mobile.app)
      .get('/api/auth/get-session')
      .set('origin', IOS)
      .set('authorization', `Bearer ${token}`)
    expect(session.headers['access-control-allow-origin']).toBe(IOS)
    expect(session.body.user.id).toBe(account.userId)
    // Our own routes take the bearer token too (no cookie, so no CSRF origin check).
    const ref = await request(mobile.app)
      .get('/api/account/reference')
      .set('origin', IOS)
      .set('authorization', `Bearer ${token}`)
    expect(ref.status).toBe(200)
    const out = await request(mobile.app)
      .post('/api/auth/sign-out')
      .set('origin', IOS)
      .set('authorization', `Bearer ${token}`)
      .send({})
    expect(out.status).toBe(200)
    const after = await request(mobile.app)
      .get('/api/auth/get-session')
      .set('authorization', `Bearer ${token}`)
    expect(after.body?.user).toBeUndefined()
  })

  it('accepts the mobile client id in the device flow even without NATIVE_ORIGINS', async () => {
    const { account, token } = await deviceToken(plain, ANDROID)
    const res = await request(plain.app)
      .get('/api/auth/get-session')
      .set('authorization', `Bearer ${token}`)
    expect(res.body.user.id).toBe(account.userId)
  })
})

describe('WebSocket upgrade origin with NATIVE_ORIGINS', () => {
  let game: GameHarness
  let gamePlain: GameHarness
  beforeAll(async () => {
    ;[game, gamePlain] = await Promise.all([startGameHarness(NATIVE), startGameHarness()])
  })
  afterAll(async () => {
    await Promise.all([game?.close(), gamePlain?.close()])
  })

  function upgradeStatus(url: string, origin: string | undefined): Promise<number> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      }
      if (origin) headers.Origin = origin
      const req = httpRequest(`${url}${COLYSEUS_PATH}/no-process/no-room?sessionId=nope`, {
        headers,
      })
      req.on('upgrade', (res, socket) => {
        socket.destroy()
        resolve(res.statusCode ?? 0)
      })
      req.on('response', (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
  }

  it('accepts the app origins when configured, and refuses them by default', async () => {
    expect(await upgradeStatus(game.url, IOS)).toBe(101)
    expect(await upgradeStatus(game.url, ANDROID)).toBe(101)
    expect(await upgradeStatus(game.url, WEB_ORIGIN)).toBe(101)
    expect(await upgradeStatus(game.url, 'https://evil.example')).toBe(403)
    expect(await upgradeStatus(gamePlain.url, IOS)).toBe(403)
    expect(await upgradeStatus(gamePlain.url, ANDROID)).toBe(403)
  })
})
