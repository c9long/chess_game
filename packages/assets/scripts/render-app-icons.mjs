// Renders the web app's icons (PWA manifest, apple-touch-icon) from the one
// source image, app-icon/emblem.svg, into app-icon/generated/. The PNGs are committed, so
// builds need no browser; run this again after changing the emblem:
//   node packages/assets/scripts/render-app-icons.mjs
// Uses Playwright's Chromium (a root dev dependency; `pnpm exec playwright install chromium`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const dir = new URL('../app-icon/', import.meta.url)
const out = new URL('generated/', dir)
const emblem = readFileSync(new URL('emblem.svg', dir), 'utf8')
const INK = '#1d1b19'

// Each icon: size in px, background (null = transparent), and how much of the canvas the
// emblem fills. Maskable icons keep the emblem inside the central safe circle (80% of the
// width), so any launcher mask shape leaves it whole; iOS rounds apple-touch-icon itself.
const ICONS = [
  { file: 'icon-192.png', size: 192, background: null, scale: 1 },
  { file: 'icon-512.png', size: 512, background: null, scale: 1 },
  { file: 'maskable-192.png', size: 192, background: INK, scale: 0.6 },
  { file: 'maskable-512.png', size: 512, background: INK, scale: 0.6 },
  { file: 'apple-touch-icon.png', size: 180, background: INK, scale: 0.78 },
]

mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const icon of ICONS) {
    const inner = Math.round(icon.size * icon.scale)
    const svg = `data:image/svg+xml;base64,${Buffer.from(emblem).toString('base64')}`
    await page.setViewportSize({ width: icon.size, height: icon.size })
    await page.setContent(
      `<html><body style="margin:0;width:${icon.size}px;height:${icon.size}px;display:flex;` +
        `align-items:center;justify-content:center;background:${icon.background ?? 'transparent'}">` +
        `<img src="${svg}" width="${inner}" height="${inner}" style="display:block"></body></html>`,
    )
    await page.waitForFunction(() => document.images[0]?.complete)
    const png = await page.screenshot({ omitBackground: icon.background === null, type: 'png' })
    writeFileSync(new URL(icon.file, out), png)
    console.log(`wrote app-icon/generated/${icon.file}`)
  }
} finally {
  await browser.close()
}
