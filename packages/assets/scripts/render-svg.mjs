// Renders one or more SVG files into a PNG contact sheet for visual review:
// each SVG at several sizes, tinted in every seat colour, on light and dark backgrounds.
// Usage: node scripts/render-svg.mjs out.png a.svg [b.svg ...]
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { chromium } from '@playwright/test'

const [out, ...files] = process.argv.slice(2)
if (!out || files.length === 0) {
  console.error('usage: render-svg.mjs out.png file.svg [...]')
  process.exit(1)
}

const SEAT_COLORS = ['#c0392b', '#2e6fd8', '#d4a017', '#1f9e6e']
const SIZES = [24, 48, 128, 256]

const rows = files
  .map((f) => {
    const svg = readFileSync(f, 'utf8')
    const cells = (bg, fg) =>
      SIZES.map(
        (s) =>
          `<div class="cell" style="background:${bg};color:${fg}"><div style="width:${s}px;height:${s}px">${svg}</div></div>`,
      ).join('')
    const tints = SEAT_COLORS.map(
      (c) =>
        `<div class="cell" style="background:#1d1b19;color:${c}"><div style="width:96px;height:96px">${svg}</div></div>`,
    ).join('')
    return `<h2>${basename(f)}</h2><div class="row">${cells('#f4efe6', '#2a2622')}${cells('#1d1b19', '#efe6d4')}${tints}</div>`
  })
  .join('')

const html = `<!doctype html><html><head><style>
body{margin:16px;font-family:sans-serif;background:#888}
h2{margin:8px 0 4px;font-size:14px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cell{padding:8px;border-radius:6px;display:flex;align-items:center;justify-content:center}
.cell svg{width:100%;height:100%;display:block}
</style></head><body>${rows}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1700, height: 400 } })
await page.setContent(html)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log(`wrote ${out}`)
