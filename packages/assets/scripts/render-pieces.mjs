// Renders the piece set into PNG review sheets. Each piece is tinted by string
// replacement (body to the seat colour, trim to that seat's brass, as the game
// recolours them before lighting) and rasterised through an <img>, in the four
// seat colours (Gold with its paler trim) plus frozen grey, on maple and walnut
// squares, at 19 and 22 (a phone's square), 40, 80 and 256 px. The optional
// second sheet is a 16x16 starting position with 40 px squares, with England's
// Prime Ministers (civ version 2) in the South army. Colours come from the
// board palette (Node runs the .ts module directly).
// Usage: node scripts/render-pieces.mjs out.png [board.png] [piecesDir]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import {
  BOARD_MATERIALS,
  FROZEN_BASE,
  PIECE_TRIM,
  SEAT_STYLES,
  trimFor,
} from '../../board/src/palette.ts'

const [out, boardOut, dir = new URL('../pieces/', import.meta.url).pathname] = process.argv.slice(2)
if (!out) {
  console.error('usage: render-pieces.mjs out.png [board.png] [piecesDir]')
  process.exit(1)
}
const NAMES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn', 'prime-minister']
const SEATS = ['south', 'west', 'north', 'east']
// body and trim per column: the four seats, then frozen
const COLORS = [
  ...SEATS.map((s) => ({ body: SEAT_STYLES[s].base, trim: trimFor(s).base })),
  { body: FROZEN_BASE, trim: PIECE_TRIM.frozen.base },
]
const LIGHT = BOARD_MATERIALS.light
const DARK = BOARD_MATERIALS.dark
const src = Object.fromEntries(NAMES.map((n) => [n, readFileSync(join(dir, `${n}.svg`), 'utf8')]))
const url = (n, c) =>
  `data:image/svg+xml;base64,${Buffer.from(
    src[n].replaceAll('currentColor', c.body).replace('fill="#b8913f"', `fill="${c.trim}"`),
  ).toString('base64')}`
const img = (n, c, s, bg, flip) =>
  `<div class="sq" style="background:${bg};width:${s}px;height:${s}px"><img src="${url(n, c)}" width="${s}" height="${s}" style="${flip ? 'transform:scaleX(-1)' : ''}"></div>`

let html = '<div class="row">'
for (const n of NAMES) {
  html += '<div class="col">'
  for (const s of [19, 22, 40, 80]) {
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
  // 16x16 board at 40px with the starting position (South red, West blue, North gold, East green)
  const S = 40
  const N = 16 // board size (rules version 2)
  const M = 4 // empty squares either side of each army
  const back = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']
  // England (civ v2): Prime Ministers on the K, Q and both N squares.
  const england = back.map((p) => (['king', 'queen', 'knight'].includes(p) ? 'prime-minister' : p))
  const at = {}
  back.forEach((p, i) => {
    at[`${M + i},0`] = [england[i], COLORS[0]]
    at[`${M + i},1`] = ['pawn', COLORS[0]]
    at[`${M + i},${N - 1}`] = [p, COLORS[2]]
    at[`${M + i},${N - 2}`] = ['pawn', COLORS[2]]
    at[`0,${M + i}`] = [p, COLORS[1]]
    at[`1,${M + i}`] = ['pawn', COLORS[1]]
    at[`${N - 1},${M + i}`] = [p, COLORS[3]]
    at[`${N - 2},${M + i}`] = ['pawn', COLORS[3]]
  })
  // a couple of frozen pieces in the middle
  at['7,7'] = ['queen', COLORS[4]]
  at['8,8'] = ['knight', COLORS[4]]
  at['8,7'] = ['knight', COLORS[0]]
  at['7,8'] = ['bishop', COLORS[3]]
  let b = `<div style="display:grid;grid-template-columns:repeat(${N},${S}px)">`
  for (let r = N - 1; r >= 0; r--)
    for (let f = 0; f < N; f++) {
      const bg = (f + r) % 2 === 0 ? DARK : LIGHT
      const p = at[`${f},${r}`]
      b += p
        ? img(
            p[0],
            p[1],
            S,
            bg,
            ['knight', 'prime-minister'].includes(p[0]) &&
              (p[1] === COLORS[2] || p[1] === COLORS[3]),
          )
        : `<div style="background:${bg};width:${S}px;height:${S}px"></div>`
    }
  b += '</div>'
  await page.setViewportSize({ width: N * S + 24, height: N * S + 24 })
  await page.setContent(`<body style="margin:12px;background:#2b2724">${b}</body>`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: boardOut })
  console.log('wrote', boardOut)
}
await browser.close()
