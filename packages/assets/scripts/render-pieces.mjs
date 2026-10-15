// Renders the piece set into PNG review sheets. Each piece is tinted by string
// replacement (the same way the game recolours it) and rasterised through an
// <img>, in the four seat colours plus frozen grey, on light and dark squares,
// at 40, 80 and 256 px. The optional second sheet is a 12x12 starting position
// with 40 px squares.
// Usage: node scripts/render-pieces.mjs out.png [board.png] [piecesDir]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const [out, boardOut, dir = new URL('../pieces/', import.meta.url).pathname] = process.argv.slice(2)
if (!out) {
  console.error('usage: render-pieces.mjs out.png [board.png] [piecesDir]')
  process.exit(1)
}
const NAMES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
const COLORS = ['#c0392b', '#2e6fd8', '#d4a017', '#1f9e6e', '#8f8b86']
const LIGHT = '#e8d9b5'
const DARK = '#8a6a45'
const src = Object.fromEntries(NAMES.map((n) => [n, readFileSync(join(dir, `${n}.svg`), 'utf8')]))
const url = (n, c) =>
  `data:image/svg+xml;base64,${Buffer.from(src[n].replaceAll('currentColor', c)).toString('base64')}`
const img = (n, c, s, bg, flip) =>
  `<div class="sq" style="background:${bg};width:${s}px;height:${s}px"><img src="${url(n, c)}" width="${s}" height="${s}" style="${flip ? 'transform:scaleX(-1)' : ''}"></div>`

let html = '<div class="row">'
for (const n of NAMES) {
  html += '<div class="col">'
  for (const s of [40, 80]) {
    html += '<div class="line">'
    for (const c of COLORS) html += img(n, c, s, LIGHT) + img(n, c, s, DARK)
    html += '</div>'
  }
  html += '</div>'
}
html += '</div><div class="line">'
for (const n of NAMES)
  html += img(n, COLORS[NAMES.indexOf(n) % 5], 256, NAMES.indexOf(n) % 2 ? DARK : LIGHT)
html += '</div><div class="line">'
for (const n of NAMES)
  html += img(n, COLORS[(NAMES.indexOf(n) + 2) % 5], 256, NAMES.indexOf(n) % 2 ? LIGHT : DARK)
html += '</div>'

const page0 = `<!doctype html><html><head><style>
body{margin:12px;background:#2b2724;font-family:sans-serif}
.row{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.col{display:flex;flex-direction:column;gap:2px}
.line{display:flex;gap:0;margin-bottom:4px}
.sq{display:flex}
img{display:block}
</style></head><body>${html}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 400 } })
await page.setContent(page0)
await page.waitForTimeout(300)
await page.screenshot({ path: out, fullPage: true })
console.log('wrote', out)

if (boardOut) {
  // 12x12 board at 40px with the starting position (South red, West blue, North gold, East green)
  const S = 40
  const back = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']
  const at = {}
  back.forEach((p, i) => {
    at[`${2 + i},0`] = [p, COLORS[0]]
    at[`${2 + i},1`] = ['pawn', COLORS[0]]
    at[`${2 + i},11`] = [p, COLORS[2]]
    at[`${2 + i},10`] = ['pawn', COLORS[2]]
    at[`0,${2 + i}`] = [p, COLORS[1]]
    at[`1,${2 + i}`] = ['pawn', COLORS[1]]
    at[`11,${2 + i}`] = [p, COLORS[3]]
    at[`10,${2 + i}`] = ['pawn', COLORS[3]]
  })
  // a couple of frozen pieces in the middle
  at['5,5'] = ['queen', COLORS[4]]
  at['6,6'] = ['knight', COLORS[4]]
  at['6,5'] = ['knight', COLORS[0]]
  at['5,6'] = ['bishop', COLORS[3]]
  let b = `<div style="display:grid;grid-template-columns:repeat(12,${S}px)">`
  for (let r = 11; r >= 0; r--)
    for (let f = 0; f < 12; f++) {
      const bg = (f + r) % 2 === 0 ? DARK : LIGHT
      const p = at[`${f},${r}`]
      b += p
        ? img(p[0], p[1], S, bg, p[0] === 'knight' && (p[1] === COLORS[2] || p[1] === COLORS[3]))
        : `<div style="background:${bg};width:${S}px;height:${S}px"></div>`
    }
  b += '</div>'
  await page.setViewportSize({ width: 12 * S + 24, height: 12 * S + 24 })
  await page.setContent(`<body style="margin:12px;background:#2b2724">${b}</body>`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: boardOut })
  console.log('wrote', boardOut)
}
await browser.close()
