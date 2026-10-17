/**
 * Security checks for the mobile-app preparation on the web side (bearer mode, token store,
 * reconnection-token persistence).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './test-storage.ts'

const TOKEN = 'session-token-from-device-flow'

interface Call {
  url: string
  init: RequestInit | undefined
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
      calls.push({ url, init, headers })
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

describe('web build never enters bearer mode by accident', () => {
  beforeEach(() => vi.stubEnv('VITE_NATIVE', ''))

  it('a clobbered or fake window.Capacitor without a real function is not native', async () => {
    for (const fake of [
      { isNativePlatform: true },
      { isNativePlatform: 'true' },
      {
        isNativePlatform: () => {
          throw new Error('x')
        },
      },
      { isNativePlatform: () => 'yes' },
    ]) {
      vi.resetModules()
      ;(window as unknown as { Capacitor: unknown }).Capacitor = fake
      const { isNative } = await import('./platform.ts')
      expect(isNative()).toBe(false)
    }
  })

  it('VITE_NATIVE values other than 1/true are off', async () => {
    for (const v of ['0', 'false', 'yes', ' 1', 'TRUE']) {
      vi.resetModules()
      vi.stubEnv('VITE_NATIVE', v)
      const { isNativeBuild } = await import('./platform.ts')
      expect(isNativeBuild()).toBe(false)
    }
  })
})

describe('bearer mode (native build)', () => {
  beforeEach(() => vi.stubEnv('VITE_NATIVE', '1'))

  it('the token only goes to the configured API origin', async () => {
    ;(await import('./token-store.ts')).saveBearerToken(TOKEN)
    const { api } = await import('./api.ts')
    await api('/api/account/reference')
    for (const c of calls) {
      if (c.headers.get('authorization')) {
        expect(new URL(c.url).origin).toBe('https://api.example.test')
      }
    }
  })

  it('no "Bearer undefined" header before sign-in', async () => {
    const { authClient } = await import('./auth-client.ts')
    await authClient.getSession()
    const { api } = await import('./api.ts')
    await api('/api/config')
    for (const c of calls) expect(c.headers.get('authorization')).toBeNull()
  })

  it('the token never ends up in the Colyseus socket URL', async () => {
    ;(await import('./token-store.ts')).saveBearerToken(TOKEN)
    const { gameClient } = await import('./match.ts')
    const client = gameClient()
    expect((client.http as unknown as { authToken?: string }).authToken).toBeFalsy()
  })

  it('sends no cookies in bearer mode (API calls, Better Auth, Colyseus matchmaking)', async () => {
    ;(await import('./token-store.ts')).saveBearerToken(TOKEN)
    const { api } = await import('./api.ts')
    await api('/api/legal/acceptances', { body: { documents: [] } })
    expect(calls[0]?.init?.credentials).toBe('omit')
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    const { authClient } = await import('./auth-client.ts')
    await authClient.getSession()
    const auth = calls.find((c) => c.url.includes('/api/auth/'))
    expect(auth?.init?.credentials ?? (auth as unknown as Request)?.credentials).toBe('omit')
    const { gameClient } = await import('./match.ts')
    expect(gameClient().http.options.credentials).toBe('omit')
  })

  it('sign-out / account deletion forget every saved match reconnection token', async () => {
    const store = await import('./reconnect-store.ts')
    const { endMatchSession } = await import('./match.ts')
    store.saveReconnectToken('room1', 'room1:seat-secret')
    store.saveReconnectToken('room2', 'room2:other')
    localStorage.setItem('board:prefs', '{}')
    await endMatchSession()
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(store.loadReconnectToken('room1')).toBeNull()
    expect(store.loadReconnectToken('room2')).toBeNull()
    expect(localStorage.getItem('board:prefs')).toBe('{}')
  })
})

describe('the browser build keeps cookies', () => {
  beforeEach(() => vi.stubEnv('VITE_NATIVE', ''))

  it('sends credentials and no Authorization header', async () => {
    ;(await import('./token-store.ts')).saveBearerToken(TOKEN)
    const { api } = await import('./api.ts')
    await api('/api/config')
    expect(calls[0]?.init?.credentials).toBe('include')
    expect(calls[0]?.headers.get('authorization')).toBeNull()
  })
})

describe('reconnect-store scope', () => {
  it('a token is never handed out for another room', async () => {
    const store = await import('./reconnect-store.ts')
    store.saveReconnectToken('roomA', 'roomA:a')
    expect(store.loadReconnectToken('roomB')).toBeNull()
    expect(store.loadReconnectToken('roomA')).toBe('roomA:a')
  })

  it('forged or far-future localStorage entries are ignored', async () => {
    const now = Date.now()
    const store = await import('./reconnect-store.ts')
    localStorage.setItem(
      'match:reconnect:r1',
      JSON.stringify({ token: 'r1:x', savedAt: now + 10 * 60_000 }),
    )
    localStorage.setItem('match:reconnect:r2', JSON.stringify({ token: 42, savedAt: now }))
    localStorage.setItem('match:reconnect:r3', '{not json')
    expect(store.loadReconnectToken('r1', now)).toBeNull()
    expect(store.loadReconnectToken('r2', now)).toBeNull()
    expect(store.loadReconnectToken('r3', now)).toBeNull()
  })

  it('a tab clearing its token keeps the shared copy another tab has since replaced', async () => {
    const store = await import('./reconnect-store.ts')
    store.saveReconnectToken('r', 'r:tab1')
    // A second tab takes the seat over and saves its own token in the shared storage.
    localStorage.setItem(
      'match:reconnect:r',
      JSON.stringify({ token: 'r:tab2', savedAt: Date.now() }),
    )
    store.clearReconnectToken('r', 'all', 'r:tab1')
    expect(sessionStorage.getItem('match:reconnect:r')).toBeNull()
    expect(store.loadReconnectToken('r')).toBe('r:tab2')
    // A failed older attempt in a tab doesn't erase the token a newer connection just saved.
    store.saveReconnectToken('r', 'r:new')
    store.clearReconnectToken('r', 'all', 'r:old')
    expect(sessionStorage.getItem('match:reconnect:r')).toBe('r:new')
    expect(store.loadReconnectToken('r')).toBe('r:new')
    store.clearReconnectToken('r', 'all', 'r:new')
    expect(store.loadReconnectToken('r')).toBeNull()
  })

  it('a finished game keeps only the tab copy; a full clear removes both', async () => {
    const store = await import('./reconnect-store.ts')
    store.saveReconnectToken('r', 'r:t')
    store.clearReconnectToken('r', 'persistent')
    expect(localStorage.getItem('match:reconnect:r')).toBeNull()
    expect(sessionStorage.getItem('match:reconnect:r')).toBe('r:t')
    store.clearReconnectToken('r')
    expect(store.loadReconnectToken('r')).toBeNull()
  })

  it('storage that throws never breaks saving or loading', async () => {
    const throwing = {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
      removeItem() {
        throw new Error('denied')
      },
      key: () => null,
      length: 0,
      clear() {},
    }
    vi.stubGlobal('localStorage', throwing)
    vi.stubGlobal('sessionStorage', throwing)
    const store = await import('./reconnect-store.ts')
    expect(() => store.saveReconnectToken('r', 'r:t')).not.toThrow()
    expect(store.loadReconnectToken('r')).toBeNull()
    expect(() => store.clearReconnectToken('r')).not.toThrow()
  })
})
