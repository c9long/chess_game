import { describe, expect, it } from 'vitest'
import { allowedOrigins, ConfigError, loadConfig, TURNSTILE_TEST_SECRET_KEY } from './config.ts'

const base = { NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
const prod = {
  ...base,
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: 's'.repeat(40),
  IP_HASH_SECRET: 'i'.repeat(40),
  TURNSTILE_SITE_KEY: 'site',
  TURNSTILE_SECRET_KEY: 'secret',
  RESEND_API_KEY: 're_x',
  API_PUBLIC_URL: 'https://api.example.com',
  WEB_ORIGIN: 'https://play.example.com',
  PASSKEY_RP_ID: 'example.com',
  TRUST_CLOUDFLARE: 'true',
}

describe('loadConfig', () => {
  it('uses safe development defaults (test Turnstile keys, dev mailbox)', () => {
    const c = loadConfig(base)
    expect(c.env).toBe('development')
    expect(c.turnstile.secretKey).toBe(TURNSTILE_TEST_SECRET_KEY)
    expect(c.devMailEndpoint).toBe(true)
    expect(c.oauth).toEqual({})
    expect(c.webOrigin).toBe('http://localhost:5173')
  })

  it('requires real secrets in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...prod, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY })).toThrow(
      /test key/,
    )
    expect(() => loadConfig({ ...prod, RESEND_API_KEY: '' })).toThrow(/RESEND_API_KEY/)
    expect(() => loadConfig({ ...prod, DEV_MAIL_ENDPOINT: 'true' })).toThrow(/DEV_MAIL_ENDPOINT/)
    expect(() => loadConfig({ ...prod, ABORT_ORPHANED_MATCHES: 'false' })).toThrow(
      /ABORT_ORPHANED_MATCHES/,
    )
    const c = loadConfig(prod)
    expect(c.isProduction).toBe(true)
    expect(c.devMailEndpoint).toBe(false)
    expect(c.ipHashSecret).toBe('i'.repeat(40))
  })

  it('refuses to guess the environment', () => {
    const { NODE_ENV: _drop, ...noEnv } = base
    expect(() => loadConfig(noEnv)).toThrow(/NODE_ENV/)
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })

  it('requires explicit, safe production addresses and secrets', () => {
    const without = (key: keyof typeof prod) => {
      const { [key]: _drop, ...rest } = prod
      return rest
    }
    expect(() => loadConfig(without('API_PUBLIC_URL'))).toThrow(/API_PUBLIC_URL/)
    expect(() => loadConfig(without('WEB_ORIGIN'))).toThrow(/WEB_ORIGIN/)
    expect(() => loadConfig(without('PASSKEY_RP_ID'))).toThrow(/PASSKEY_RP_ID/)
    expect(() => loadConfig(without('IP_HASH_SECRET'))).toThrow(/IP_HASH_SECRET/)
    expect(() => loadConfig({ ...prod, WEB_ORIGIN: 'http://play.example.com' })).toThrow(/https/)
    expect(() => loadConfig({ ...prod, PASSKEY_RP_ID: 'other.com' })).toThrow(/PASSKEY_RP_ID/)
    expect(() => loadConfig({ ...prod, IP_HASH_SECRET: prod.BETTER_AUTH_SECRET })).toThrow(/differ/)
    expect(() => loadConfig({ ...prod, TRUST_CLOUDFLARE: 'false' })).toThrow(/TRUST_CLOUDFLARE/)
    expect(() => loadConfig({ ...prod, RATE_LIMIT_ENABLED: 'false' })).toThrow(/RATE_LIMIT/)
    expect(() => loadConfig({ ...prod, TURNSTILE_SITEVERIFY_URL: 'http://x.test/v' })).toThrow(
      /SITEVERIFY/,
    )
  })

  it('enables an OAuth provider only when both credentials exist', () => {
    const c = loadConfig({
      ...base,
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      GOOGLE_CLIENT_ID: 'only-id',
    })
    expect(Object.keys(c.oauth)).toEqual(['github'])
  })

  it('rejects malformed values', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...base, TRUST_CLOUDFLARE: 'yes' })).toThrow(/TRUST_CLOUDFLARE/)
  })

  it('reads game settings with defaults and refuses test clocks in production', () => {
    const c = loadConfig(base)
    expect(c.game).toMatchObject({
      botServiceUrl: undefined,
      reconnectGraceMs: 60_000,
      countdownMs: 3_000,
      devClockBaseMs: undefined,
    })
    const g = loadConfig({
      ...base,
      BOT_SERVICE_URL: 'http://127.0.0.1:7700/',
      RECONNECT_GRACE_SECONDS: '0.5',
      DEV_CLOCK_BASE_MS: '2000',
    }).game
    expect(g.botServiceUrl).toBe('http://127.0.0.1:7700')
    expect(g.reconnectGraceMs).toBe(500)
    expect(g.devClockBaseMs).toBe(2000)
    expect(loadConfig({ ...base, BOT_SERVICE_URL: '' }).game.botServiceUrl).toBeUndefined()
    expect(() => loadConfig({ ...prod, DEV_CLOCK_BASE_MS: '2000' })).toThrow(/DEV_CLOCK_BASE_MS/)
  })

  it('parses NATIVE_ORIGINS (mobile app WebViews), empty by default', () => {
    const plain = loadConfig(base)
    expect(plain.nativeOrigins).toEqual([])
    expect(allowedOrigins(plain)).toEqual(['http://localhost:5173'])

    const c = loadConfig({
      ...prod,
      NATIVE_ORIGINS: ' capacitor://localhost , https://localhost/,Capacitor://LOCALHOST,',
    })
    expect(c.nativeOrigins).toEqual(['capacitor://localhost', 'https://localhost'])
    expect(allowedOrigins(c)).toEqual([
      'https://play.example.com',
      'capacitor://localhost',
      'https://localhost',
    ])
    // Live reload from a dev machine uses plain http: allowed outside production only.
    expect(loadConfig({ ...base, NATIVE_ORIGINS: 'http://localhost:8100' }).nativeOrigins).toEqual([
      'http://localhost:8100',
    ])
    expect(() => loadConfig({ ...prod, NATIVE_ORIGINS: 'http://localhost' })).toThrow(/plain http/)
    for (const bad of [
      '*',
      'null',
      'capacitor://localhost/app',
      'https://*.example.com',
      'localhost',
    ]) {
      expect(() => loadConfig({ ...base, NATIVE_ORIGINS: bad })).toThrow(/NATIVE_ORIGINS/)
    }
  })
})
