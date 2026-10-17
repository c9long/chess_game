/**
 * Bearer-token mode for the mobile apps (VITE_NATIVE / Capacitor): the auth client, our API
 * helper and Colyseus matchmaking send `Authorization: Bearer <token>` from the token store;
 * sign-out wipes it. In a browser nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './test-storage.ts'

const TOKEN = 'session-token-from-device-flow'

interface Call {
  url: string
  headers: Headers
}
let calls: Call[]

beforeEach(() => {
  vi.resetModules()
  calls = []
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('window', {
    location: { origin: 'https://localhost', href: 'https://localhost/' },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
      calls.push({ url, headers })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('bearer mode on (native build)', () => {
  beforeEach(() => vi.stubEnv('VITE_NATIVE', '1'))

  it('reads the token from the pluggable store and wipes it on sign-out', async () => {
    const store = await import('./token-store.ts')
    const auth = await import('./native-auth.ts')
    expect(auth.bearerMode()).toBe(true)
    expect(auth.authHeaders()).toEqual({})
    store.saveBearerToken(TOKEN)
    expect(localStorage.getItem('auth:bearer')).toBe(TOKEN)
    expect(auth.authHeaders()).toEqual({ authorization: `Bearer ${TOKEN}` })
    const opts = auth.betterAuthBearer()
    expect(opts.auth?.type).toBe('Bearer')
    expect(opts.auth?.token()).toBe(TOKEN)
    auth.endBearerSession()
    expect(localStorage.getItem('auth:bearer')).toBeNull()
    expect(opts.auth?.token()).toBeUndefined()

    // The app shell can swap in secure storage (Keychain/Keystore).
    const secure = new Map<string, string>()
    store.setTokenStore({
      get: () => secure.get('t') ?? null,
      set: (t) => secure.set('t', t),
      clear: () => secure.delete('t'),
    })
    store.saveBearerToken('from-keychain')
    expect(secure.get('t')).toBe('from-keychain')
    expect(auth.activeBearerToken()).toBe('from-keychain')
  })

  it('sends the token on our API calls and on Better Auth calls', async () => {
    ;(await import('./token-store.ts')).saveBearerToken(TOKEN)
    const { api } = await import('./api.ts')
    await api('/api/account/reference')
    expect(calls[0]?.url).toBe('https://api.example.test/api/account/reference')
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)

    const { authClient } = await import('./auth-client.ts')
    await authClient.getSession()
    const session = calls.find((c) => c.url.includes('/api/auth/get-session'))
    expect(session?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('puts the token on Colyseus matchmaking requests only (never in the socket URL)', async () => {
    const store = await import('./token-store.ts')
    store.saveBearerToken(TOKEN)
    const { gameClient } = await import('./match.ts')
    const client = gameClient()
    const headers = client.http.options.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(client.auth.token).toBeFalsy()
    store.clearBearerToken()
    expect((gameClient().http.options.headers as Record<string, string>).authorization).toBe(
      undefined,
    )
  })
})

describe('bearer mode off (browser)', () => {
  beforeEach(() => vi.stubEnv('VITE_NATIVE', ''))

  it('never sends a token, even if one is stored', async () => {
    localStorage.setItem('auth:bearer', TOKEN)
    const auth = await import('./native-auth.ts')
    expect(auth.bearerMode()).toBe(false)
    expect(auth.authHeaders()).toEqual({})
    expect(auth.betterAuthBearer()).toEqual({})
    const { api } = await import('./api.ts')
    await api('/api/config')
    expect(calls[0]?.headers.get('authorization')).toBeNull()
    const { gameClient } = await import('./match.ts')
    expect(
      (gameClient().http.options.headers as Record<string, string> | undefined)?.authorization,
    ).toBeUndefined()
    auth.endBearerSession()
    expect(localStorage.getItem('auth:bearer')).toBe(TOKEN)
  })
})
