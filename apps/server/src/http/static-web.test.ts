import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.ts'
import { resolveWebDistDir, webAppCsp, webAppHandler } from './static-web.ts'

const INDEX =
  '<!doctype html><html><head><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>'
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

let dir: string

/** A miniature web build with the same layout as apps/web/dist. */
function makeDist(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'web-dist-'))
  mkdirSync(path.join(d, 'assets'))
  mkdirSync(path.join(d, 'icons'))
  writeFileSync(path.join(d, 'index.html'), INDEX)
  writeFileSync(path.join(d, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(path.join(d, 'assets', 'index-abc123.css'), 'body{}')
  writeFileSync(path.join(d, 'assets', 'rules_wasm_bg-DBqjfVpZ.wasm'), WASM)
  writeFileSync(path.join(d, 'manifest.webmanifest'), '{"name":"x"}')
  writeFileSync(path.join(d, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(path.join(d, 'icons', 'icon-192.png'), 'png')
  writeFileSync(path.join(d, '.secret'), 'nope')
  return d
}

/** The handler mounted the way createApp mounts it: after the API and its JSON 404. */
function makeApp(distDir: string) {
  const app = express()
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.post('/api/things', (_req, res) => {
    res.status(201).json({ ok: true })
  })
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' })
  })
  app.use(webAppHandler(distDir, { apiPublicUrl: 'https://play.example.test' }))
  return app
}

beforeAll(() => {
  dir = makeDist()
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('webAppHandler', () => {
  it('serves index.html at / with no-cache and the CSP', async () => {
    const res = await request(makeApp(dir)).get('/').set('accept', 'text/html')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/html/)
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.headers['content-security-policy']).toBe(webAppCsp('https://play.example.test'))
    expect(res.text).toBe(INDEX)
  })

  it('caches hashed assets for a year, immutable', async () => {
    const res = await request(makeApp(dir)).get('/assets/index-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/javascript|^application\/javascript/)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const css = await request(makeApp(dir)).get('/assets/index-abc123.css')
    expect(css.headers['content-type']).toMatch(/^text\/css/)
  })

  it('serves the rules engine as application/wasm', async () => {
    const res = await request(makeApp(dir)).get('/assets/rules_wasm_bg-DBqjfVpZ.wasm')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/wasm')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('revalidates unhashed files and types the manifest', async () => {
    const app = makeApp(dir)
    const manifest = await request(app).get('/manifest.webmanifest')
    expect(manifest.status).toBe(200)
    expect(manifest.headers['content-type']).toMatch(/^application\/manifest\+json/)
    expect(manifest.headers['cache-control']).toBe('no-cache')
    const icon = await request(app).get('/icons/icon-192.png')
    expect(icon.headers['content-type']).toBe('image/png')
    expect(icon.headers['cache-control']).toBe('no-cache')
    const svg = await request(app).get('/favicon.svg')
    expect(svg.headers['content-type']).toMatch(/^image\/svg\+xml/)
  })

  it('falls back to index.html for client-side routes', async () => {
    const app = makeApp(dir)
    for (const p of ['/match/abc123', '/sign-in', '/u/some.name', '/index.html']) {
      const res = await request(app).get(p).set('accept', 'text/html,application/xhtml+xml')
      expect(res.status, p).toBe(200)
      expect(res.text, p).toBe(INDEX)
      expect(res.headers['cache-control'], p).toBe('no-cache')
    }
    // A deep link without an Accept header (e.g. a link checker) still gets the page.
    const bare = await request(app).get('/play')
    expect(bare.status).toBe(200)
    expect(bare.text).toBe(INDEX)
    const head = await request(app).head('/match/abc123').set('accept', 'text/html')
    expect(head.status).toBe(200)
  })

  it('404s missing files instead of answering them with the page', async () => {
    const app = makeApp(dir)
    // An old hashed chunk after an update must fail, not run index.html as a script.
    const chunk = await request(app).get('/assets/Play-OLDHASH.js').set('accept', 'text/html')
    expect(chunk.status).toBe(404)
    // Never cached, so Cloudflare can't keep answering 404 once the file exists.
    expect(chunk.headers['cache-control']).toBe('no-store')
    expect(chunk.headers.vary).toMatch(/Accept/)
    const ico = await request(app).get('/favicon.ico').set('accept', 'image/*')
    expect(ico.status).toBe(404)
    const dot = await request(app).get('/.secret').set('accept', 'text/plain')
    expect(dot.status).toBe(404)
    const post = await request(app).post('/sign-in').set('accept', 'text/html')
    expect(post.status).toBe(404)
  })

  it('never serves files outside the build or dotfiles', async () => {
    const app = makeApp(dir)
    const outside = path.join(path.dirname(dir), `outside-${path.basename(dir)}.txt`)
    writeFileSync(outside, 'SECRET-OUTSIDE')
    try {
      for (const p of [
        `/../${path.basename(outside)}`,
        `/assets/../../${path.basename(outside)}`,
        `/%2e%2e/${path.basename(outside)}`,
        `/assets/%2e%2e%2f%2e%2e%2f${path.basename(outside)}`,
        `/..%5c${path.basename(outside)}`,
        '/.secret',
        '/assets/%00.js',
      ]) {
        for (const accept of ['text/html', '*/*']) {
          const res = await request(app).get(p).set('accept', accept)
          expect(res.text, `${p} ${accept}`).not.toContain('SECRET-OUTSIDE')
          expect(res.text, `${p} ${accept}`).not.toContain('nope')
          expect([200, 400, 404], `${p} ${accept}`).toContain(res.status)
          if (res.status === 200) expect(res.text, p).toBe(INDEX)
        }
      }
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('never shadows the API', async () => {
    const app = makeApp(dir)
    const health = await request(app).get('/api/health').set('accept', 'text/html')
    expect(health.body).toEqual({ status: 'ok' })
    const created = await request(app).post('/api/things')
    expect(created.status).toBe(201)
    for (const p of ['/api', '/api/nope', '/api/colyseus/matchmake/x', '/api/index.html']) {
      const res = await request(app).get(p).set('accept', 'text/html')
      expect(res.status, p).toBe(404)
      expect(res.body, p).toEqual({ error: 'NOT_FOUND' })
    }
  })
})

describe('webAppCsp', () => {
  it('allows the wasm engine, Turnstile and the same-origin API and WebSocket', () => {
    const csp = webAppCsp('https://play.example.test')
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com")
    expect(csp).toContain('frame-src https://challenges.cloudflare.com')
    expect(csp).toContain("connect-src 'self' https://play.example.test wss://play.example.test")
    expect(csp).toContain("frame-ancestors 'none'")
    // No inline scripts and no other script hosts.
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src ')) ?? ''
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    // No eval: the board renderer uses PixiJS's CSP-safe path (pixi.js/unsafe-eval).
    expect(scriptSrc.split(' ')).not.toContain("'unsafe-eval'")
    expect(scriptSrc.split(' ').filter((t) => t.startsWith('http'))).toEqual([
      'https://challenges.cloudflare.com',
    ])
    expect(csp).toContain("object-src 'none'")
    expect(webAppCsp('http://localhost:3950')).toContain('ws://localhost:3950')
  })

  it('allows the Sentry ingest origin only when error tracking is on', () => {
    expect(webAppCsp('https://play.example.test')).not.toContain('sentry')
    const csp = webAppCsp('https://play.example.test', 'https://o42.ingest.us.sentry.io')
    expect(csp).toContain(
      "connect-src 'self' https://play.example.test wss://play.example.test https://o42.ingest.us.sentry.io",
    )
  })
})

describe('resolveWebDistDir / WEB_DIST_DIR', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    LOG_LEVEL: 'silent',
  }

  it('is off when empty or unset', () => {
    expect(loadConfig(base).webDistDir).toBeUndefined()
    expect(loadConfig({ ...base, WEB_DIST_DIR: '' }).webDistDir).toBeUndefined()
  })

  it('resolves a relative directory to an absolute one', () => {
    const rel = path.relative(process.cwd(), dir)
    expect(loadConfig({ ...base, WEB_DIST_DIR: rel }).webDistDir).toBe(dir)
    expect(resolveWebDistDir(path.basename(dir), path.dirname(dir))).toEqual({ dir })
  })

  it('refuses a missing directory with a clear message', () => {
    expect(() => loadConfig({ ...base, WEB_DIST_DIR: '/nonexistent/web-dist' })).toThrow(
      /WEB_DIST_DIR "\/nonexistent\/web-dist" is not a directory/,
    )
  })

  it('refuses a directory without index.html', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'web-empty-'))
    try {
      expect(() => loadConfig({ ...base, WEB_DIST_DIR: empty })).toThrow(/has no index.html/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('requires one origin for the API and the web app in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 's'.repeat(40),
      IP_HASH_SECRET: 'i'.repeat(40),
      TURNSTILE_SITE_KEY: 'site',
      TURNSTILE_SECRET_KEY: 'secret',
      RESEND_API_KEY: 're_x',
      PASSKEY_RP_ID: 'example.com',
      TRUST_CLOUDFLARE: 'true',
      WEB_DIST_DIR: dir,
    }
    expect(() =>
      loadConfig({
        ...prod,
        API_PUBLIC_URL: 'https://api.example.com',
        WEB_ORIGIN: 'https://play.example.com',
      }),
    ).toThrow(/WEB_DIST_DIR needs API_PUBLIC_URL and WEB_ORIGIN to be the same origin/)
    const one = loadConfig({
      ...prod,
      API_PUBLIC_URL: 'https://play.example.com/',
      WEB_ORIGIN: 'https://play.example.com',
    })
    expect(one.webDistDir).toBe(dir)
    expect(one.apiPublicUrl).toBe('https://play.example.com')
  })

  it('refuses a file', () => {
    expect(() => loadConfig({ ...base, WEB_DIST_DIR: path.join(dir, 'index.html') })).toThrow(
      /is not a directory/,
    )
  })
})
