/**
 * Web app manifest and icons (docs/MOBILE.md phase 1 #7), with no service worker: a cached
 * build could outlive the server's protocol version.
 *
 * The manifest is generated from APP_NAME (never a hard-coded title). The icons come from
 * packages/assets/app-icon: the favicon is the source emblem itself, and the PNGs were rendered
 * from it by packages/assets/scripts/render-app-icons.mjs. Served by the dev server, emitted
 * into the build, and linked from index.html.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { APP_NAME, APP_SHORT_NAME } from '@game/config'
import type { HtmlTagDescriptor, Plugin } from 'vite'

/** The app's ink colour (index.css `--color-ink`): browser UI, splash and maskable background. */
export const THEME_COLOR = '#1d1b19'

const assetsDir = join(
  dirname(createRequire(import.meta.url).resolve('@game/assets/package.json')),
  'app-icon',
)

/** Published path → source file (relative to packages/assets/app-icon) and content type. */
const FILES: Record<string, { from: string; type: string }> = {
  'favicon.svg': { from: 'emblem.svg', type: 'image/svg+xml' },
  'apple-touch-icon.png': { from: 'generated/apple-touch-icon.png', type: 'image/png' },
  'icons/icon-192.png': { from: 'generated/icon-192.png', type: 'image/png' },
  'icons/icon-512.png': { from: 'generated/icon-512.png', type: 'image/png' },
  'icons/maskable-192.png': { from: 'generated/maskable-192.png', type: 'image/png' },
  'icons/maskable-512.png': { from: 'generated/maskable-512.png', type: 'image/png' },
}

export const MANIFEST_PATH = 'manifest.webmanifest'

/** The manifest. URLs are relative to the manifest itself, so any base path works. */
export function manifest() {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: 'Four-player chess on a 16×16 board, online or against bots.',
    start_url: '.',
    scope: '.',
    display: 'standalone',
    orientation: 'any',
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    categories: ['games'],
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

function contents(path: string): { body: Buffer | string; type: string } | undefined {
  if (path === MANIFEST_PATH) {
    return { body: `${JSON.stringify(manifest(), null, 2)}\n`, type: 'application/manifest+json' }
  }
  const file = FILES[path]
  return file ? { body: readFileSync(join(assetsDir, file.from)), type: file.type } : undefined
}

export function appManifest(): Plugin {
  let base = '/'
  return {
    name: 'game:app-manifest',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''
        const found = url.startsWith(base) ? contents(url.slice(base.length)) : undefined
        if (!found) {
          next()
          return
        }
        res.setHeader('Content-Type', found.type)
        res.setHeader('Cache-Control', 'no-cache')
        res.end(found.body)
      })
    },
    generateBundle() {
      for (const path of [MANIFEST_PATH, ...Object.keys(FILES)]) {
        const found = contents(path)
        if (found) this.emitFile({ type: 'asset', fileName: path, source: found.body })
      }
    },
    transformIndexHtml() {
      const link = (attrs: Record<string, string>): HtmlTagDescriptor => ({
        tag: 'link',
        attrs,
        injectTo: 'head',
      })
      const meta = (name: string, content: string): HtmlTagDescriptor => ({
        tag: 'meta',
        attrs: { name, content },
        injectTo: 'head',
      })
      return [
        link({ rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }),
        link({ rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }),
        link({ rel: 'manifest', href: `${base}${MANIFEST_PATH}` }),
        meta('application-name', APP_NAME),
        meta('apple-mobile-web-app-title', APP_SHORT_NAME),
      ]
    },
  }
}
