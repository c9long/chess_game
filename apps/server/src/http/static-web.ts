import { statSync } from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'

/**
 * Optional single-origin deploy (WEB_DIST_DIR): the server also serves the built web app
 * (`pnpm --filter @game/web build`, built without VITE_API_URL so it calls its own origin).
 * Off by default; Cloudflare Pages remains the other way to host the web app.
 */

/** Vite writes every content-hashed file (scripts, styles, fonts, the rules wasm) here. */
const HASHED_PREFIX = '/assets/'
const IMMUTABLE = 'public, max-age=31536000, immutable'
/** index.html, the manifest and the icons keep their names, so they are revalidated. */
const REVALIDATE = 'no-cache'
/** Misses are never cached (by the browser or Cloudflare), so a file that appears later loads. */
const NO_STORE = 'no-store'

/** Types set explicitly, so they never depend on the mime database's version. */
const TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

/** Turnstile's widget script and its challenge frame (docs: Turnstile CSP). */
const TURNSTILE = 'https://challenges.cloudflare.com'

/**
 * Resolves WEB_DIST_DIR and checks it holds a web build. Returns the absolute directory or a
 * message naming the problem (shown at startup by loadConfig).
 */
export function resolveWebDistDir(
  raw: string,
  cwd = process.cwd(),
): { dir: string } | { problem: string } {
  const dir = path.resolve(cwd, raw)
  let isDir = false
  try {
    isDir = statSync(dir).isDirectory()
  } catch {
    // reported below
  }
  if (!isDir) {
    return { problem: `WEB_DIST_DIR "${raw}" is not a directory (resolved to ${dir})` }
  }
  let hasIndex = false
  try {
    hasIndex = statSync(path.join(dir, 'index.html')).isFile()
  } catch {
    // reported below
  }
  if (!hasIndex) {
    return {
      problem: `WEB_DIST_DIR "${dir}" has no index.html; build the web app first (pnpm --filter @game/web build) and point WEB_DIST_DIR at apps/web/dist`,
    }
  }
  return { dir }
}

/**
 * Content-Security-Policy for the web app's pages. Scripts come only from this origin (the
 * Vite build has no inline scripts) plus Turnstile; `wasm-unsafe-eval` lets the rules engine
 * (WebAssembly) compile. There is no `unsafe-eval`: the board renderer imports
 * `pixi.js/unsafe-eval` (in @game/board), PixiJS's CSP-safe path that uploads uniforms and
 * builds shaders without `new Function`. Styles allow inline attributes, which React and
 * the animation library set. API calls and the game's WebSocket go to the API origin (this origin in a
 * single-origin deploy; listed explicitly because older browsers don't match ws(s) to 'self').
 */
export function webAppCsp(apiPublicUrl: string): string {
  const api = new URL(apiPublicUrl)
  const ws = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${TURNSTILE}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api.origin} ${ws}`,
    `frame-src ${TURNSTILE}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Paths the web app must never answer: the API, Better Auth and Colyseus all live here. */
function isApiPath(p: string): boolean {
  return p === '/api' || p.startsWith('/api/')
}

/** A browser navigation (a page load or deep link), as opposed to a missing file. */
function wantsPage(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (isApiPath(req.path) || req.path.startsWith(HASHED_PREFIX)) return false
  const accept = req.headers.accept ?? ''
  // Deep links like /match/<id> have no extension; a navigation also says it takes HTML.
  return accept.includes('text/html') || !path.posix.basename(req.path).includes('.')
}

/**
 * Serves `dir` (a web build) after the API routes: hashed files with a one-year immutable
 * cache, everything else revalidated, and index.html for client-side routes. Requests under
 * /api never reach it (they are answered, or 404 as JSON, before it).
 */
export function webAppHandler(dir: string, options: { apiPublicUrl: string }) {
  const csp = webAppCsp(options.apiPublicUrl)
  const index = path.join(dir, 'index.html')
  const files = express.static(dir, {
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    fallthrough: true,
    setHeaders: (res, file) => {
      const type = TYPES[path.extname(file).toLowerCase()]
      if (type) res.setHeader('Content-Type', type)
      const rel = `/${path.relative(dir, file).split(path.sep).join('/')}`
      res.setHeader('Cache-Control', rel.startsWith(HASHED_PREFIX) ? IMMUTABLE : REVALIDATE)
      res.setHeader('Content-Security-Policy', csp)
    },
  })

  return (req: Request, res: Response, next: NextFunction) => {
    if (isApiPath(req.path)) {
      next()
      return
    }
    files(req, res, () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next()
        return
      }
      // Whether a dotted path gets the page or a 404 depends on Accept.
      res.setHeader('Vary', 'Accept')
      if (!wantsPage(req)) {
        res.status(404).setHeader('Cache-Control', NO_STORE)
        res.type('text/plain').send('Not found')
        return
      }
      res.setHeader('Cache-Control', REVALIDATE)
      res.setHeader('Content-Security-Policy', csp)
      res.sendFile(index, { cacheControl: false }, (err) => {
        // A client that hangs up mid-file is not a server error.
        if (err && !res.headersSent) next(err)
      })
    })
  }
}
