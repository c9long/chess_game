/**
 * Security checks for the mobile-app preparation (NATIVE_ORIGINS, bearer tokens, reconnection
 * tokens): hostile configuration, no cookie sessions from the app origins, and a seat's
 * reconnection token that is useless without its owner's session.
 */
import { request as httpRequest } from 'node:http'
import { matchMaker } from '@colyseus/core'
import { Client } from '@colyseus/sdk'
import { COLYSEUS_PATH } from '@game/protocol'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig, parseNativeOrigins } from '../config.ts'
import {
  createSolo,
  type GameHarness,
  guest,
  Player,
  startGameHarness,
  waitFor,
} from './game-harness.ts'
import {
  confirmAge,
  type Harness,
  PROD_ENV,
  signUpVerified,
  startHarness,
  TestClient,
  WEB_ORIGIN,
} from './harness.ts'

const IOS = 'capacitor://localhost'
const ANDROID = 'https://localhost'

describe('parseNativeOrigins: hostile entries', () => {
  const bad = [
    '*',
    'null',
    'https://*.example.com',
    'https://example.com/path',
    'https://user:pass@example.com',
    'https://example.com?x=1',
    'https://example.com#x',
    'file://',
    'file:///etc',
    '//example.com',
    'example.com',
    'https://exa mple.com',
    'https://[::1]',
  ]
  for (const entry of bad) {
    it(`refuses ${JSON.stringify(entry)}`, () => {
      const { origins, problems } = parseNativeOrigins(entry, false)
      expect(origins).toEqual([])
      expect(problems.length).toBe(1)
    })
  }

  it('refuses plain http in production only', () => {
    expect(parseNativeOrigins('http://localhost', true).origins).toEqual([])
    expect(parseNativeOrigins('http://localhost', false).origins).toEqual(['http://localhost'])
  })

  it('a bad entry in production makes loadConfig fail, not silently widen', () => {
    expect(() =>
      loadConfig({ ...PROD_ENV, DATABASE_URL: 'postgres://x@y/z', NATIVE_ORIGINS: '*' }),
    ).toThrow(/NATIVE_ORIGINS/)
    expect(() =>
      loadConfig({
        ...PROD_ENV,
        DATABASE_URL: 'postgres://x@y/z',
        NATIVE_ORIGINS: 'http://10.0.0.2:5173',
      }),
    ).toThrow(/NATIVE_ORIGINS/)
  })

  it('drops a default port, as browsers do in Origin (else the entry would never match)', () => {
    expect(parseNativeOrigins('https://app.example:443', true).origins).toEqual([
      'https://app.example',
    ])
    expect(parseNativeOrigins('http://localhost:80,http://localhost:8080', false).origins).toEqual([
      'http://localhost',
      'http://localhost:8080',
    ])
    expect(parseNativeOrigins('capacitor://localhost:443', true).origins).toEqual([
      'capacitor://localhost:443',
    ])
  })
})

describe('empty NATIVE_ORIGINS does not widen anything', () => {
  let h: Harness
  beforeAll(async () => {
    h = await startHarness({ NATIVE_ORIGINS: ' , ,' })
  })
  afterAll(async () => {
    await h?.close()
  })

  it('whitespace/commas only parse to no origins and CORS stays single-origin', async () => {
    expect(h.config.nativeOrigins).toEqual([])
    for (const origin of [IOS, ANDROID, 'null']) {
      const res = await request(h.app)
        .options('/api/auth/get-session')
        .set('origin', origin)
        .set('access-control-request-method', 'GET')
      expect(res.headers['access-control-allow-origin']).not.toBe(origin)
    }
  })
})

describe('NATIVE_ORIGINS set: CSRF and cookie behaviour', () => {
  let h: Harness
  beforeAll(async () => {
    h = await startHarness({ NATIVE_ORIGINS: `${IOS},${ANDROID}` })
  })
  afterAll(async () => {
    await h?.close()
  })

  it('an Origin of "null" (sandboxed iframe, file:) is not trusted by Better Auth', async () => {
    const a = await signUpVerified(h)
    const res = await a.client.post('/api/auth/sign-out').set('origin', 'null')
    expect(res.status).toBe(403)
  })

  it('a look-alike scheme or authority is not trusted', async () => {
    for (const origin of ['capacitor://localhost.evil.example', 'capacitorx://localhost']) {
      const a = await signUpVerified(h)
      const res = await a.client.post('/api/auth/sign-out').set('origin', origin)
      expect(res.status).toBe(403)
    }
  })

  it('app origins get CORS without credentials, so a WebView never keeps or sends a cookie', async () => {
    for (const origin of [IOS, ANDROID]) {
      const pre = await request(h.app)
        .options('/api/auth/sign-in/email')
        .set('origin', origin)
        .set('access-control-request-method', 'POST')
        .set('access-control-request-headers', 'authorization,content-type')
      expect(pre.headers['access-control-allow-origin']).toBe(origin)
      expect(pre.headers['access-control-allow-credentials']).toBeUndefined()
    }
    // A sign-in through the web forms from the app origin: the browser would drop the
    // response's cookie (no credentials in the CORS grant), so no cookie session can follow.
    const web = await signUpVerified(h)
    const app = new TestClient(h.app, undefined, IOS)
    await confirmAge(app)
    const signIn = await app.post(
      '/api/auth/sign-in/email',
      { email: web.email, password: web.password },
      { captcha: true },
    )
    expect(signIn.headers['access-control-allow-origin']).toBe(IOS)
    expect(signIn.headers['access-control-allow-credentials']).toBeUndefined()
    // The web origin keeps its credentialed grant.
    const site = await request(h.app).get('/api/health').set('origin', WEB_ORIGIN)
    expect(site.headers['access-control-allow-origin']).toBe(WEB_ORIGIN)
    expect(site.headers['access-control-allow-credentials']).toBe('true')
    // A cookie that did ride along from an app origin is still refused on our own routes.
    const legal = await app.post('/api/legal/acceptances', { documents: [] })
    expect(legal.status).toBe(403)
    expect(legal.body.error).toBe('INVALID_ORIGIN')
  })
})

describe('WebSocket origin check with NATIVE_ORIGINS', () => {
  let game: GameHarness
  beforeAll(async () => {
    game = await startGameHarness({ NATIVE_ORIGINS: IOS })
  })
  afterAll(async () => {
    await game?.close()
  })

  function upgradeStatus(origin: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${game.url}${COLYSEUS_PATH}/p/r?sessionId=x`, {
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          Origin: origin,
        },
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

  it('refuses null, look-alike and unlisted origins', async () => {
    for (const o of ['null', 'capacitor://localhost.evil', 'capacitor://evil', ANDROID]) {
      expect(await upgradeStatus(o)).toBe(403)
    }
    expect(await upgradeStatus(IOS)).toBe(101)
  })
})

describe('reconnection token is a bearer credential for the seat', () => {
  let game: GameHarness
  beforeAll(async () => {
    game = await startGameHarness()
  })
  afterAll(async () => {
    await game?.close()
  })

  it('another signed-in user (or nobody) cannot reclaim a dropped seat with only the token', async () => {
    // The web client keeps this token in localStorage, so the next user of a shared browser
    // could open /match/<id> within the grace. Colyseus' reconnect skips onAuth; matchmaking
    // checks the seat owner's session instead.
    const alice = await guest(game)
    const p = await createSolo(alice)
    await p.waitState((s) => s.phase === 'in_game', 10_000)
    const server = matchMaker.getLocalRoomById(p.room.roomId) as unknown as {
      state: { seats: { connected: boolean }[] }
    }
    const token = p.room.reconnectionToken
    p.drop()
    await waitFor(() => server.state.seats[0]?.connected === false, 5_000, 'disconnected')

    const mallory = await guest(game) // a different account on the same machine
    expect(mallory.userId).not.toBe(alice.userId)
    await expect(mallory.sdk().reconnect(token)).rejects.toThrow(/not_seated/)
    const nobody = new Client(`${game.url}${COLYSEUS_PATH}`, { headers: { origin: WEB_ORIGIN } })
    await expect(nobody.reconnect(token)).rejects.toThrow(/unauthorized/)
    expect(server.state.seats[0]?.connected).toBe(false)

    // The seat's own account still gets back in with it.
    const room = await alice.sdk().reconnect(token)
    const back = new Player(alice, room)
    await back.waitMessage('welcome')
    await waitFor(() => server.state.seats[0]?.connected === true, 5_000, 'seat retaken')
    expect(back.seat).toBe(0)
    await back.leave()
  })
})
