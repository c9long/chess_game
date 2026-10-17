// Builds packages/assets/pieces/*.svg from the hand-tuned component outlines
// below. Each piece is a stack of simple closed shapes (base, collar, stem,
// head...) drawn back to front. The script unions them into the body, outlines
// every visible edge as a filled band (stroke converted to fill, never a
// stroke), adds interior detail lines, mirrors symmetric pieces exactly about
// x = 128 and writes two-tone SVGs (see ../pieces/README.md).
//
// Geometry ops use Skia via canvaskit-wasm, which is deliberately not a
// workspace dependency. Install it anywhere and point CANVASKIT_DIR at it:
//   npm install --prefix /tmp/ck canvaskit-wasm@0.40.0
//   CANVASKIT_DIR=/tmp/ck node scripts/build-pieces.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const ckDir = process.env.CANVASKIT_DIR
if (!ckDir) {
  console.error('set CANVASKIT_DIR to a folder containing node_modules/canvaskit-wasm')
  process.exit(1)
}
const CanvasKitInit = createRequire(join(ckDir, 'noop.js'))('canvaskit-wasm')
const CK = await CanvasKitInit()
const out = process.argv[2] ?? new URL('../pieces/', import.meta.url).pathname

// ---------- geometry helpers ---------------------------------------------------
const CX = 128
const f = (n) => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

// --- authoring ---------------------------------------------------------------
// Build a closed, exactly symmetric outline from its right half.
// cmds: ['M',x,y] first (x must be 128), then ['L',x,y] / ['C',x1,y1,x2,y2,x,y]
// running down/around the right side and ending back on x=128.
function sym(cmds) {
  const [m, ...rest] = cmds
  if (m[0] !== 'M' || m[1] !== CX) throw new Error('sym must start at x=128')
  const end = rest.at(-1)
  if (end.at(-2) !== CX) throw new Error(`sym must end at x=128, got ${end}`)
  const mx = (x) => 2 * CX - x
  let d = `M${f(m[1])} ${f(m[2])}`
  const pts = [[m[1], m[2]]]
  for (const c of rest) {
    if (c[0] === 'L') d += `L${f(c[1])} ${f(c[2])}`
    else d += `C${c.slice(1).map(f).join(' ')}`
    pts.push([c.at(-2), c.at(-1)])
  }
  // mirrored, reversed
  for (let i = rest.length - 1; i >= 0; i--) {
    const c = rest[i]
    const [px, py] = pts[i]
    if (c[0] === 'L') d += `L${f(mx(px))} ${f(py)}`
    else d += `C${f(mx(c[3]))} ${f(c[4])} ${f(mx(c[1]))} ${f(c[2])} ${f(mx(px))} ${f(py)}`
  }
  return `${d}Z`
}

// Rounded rectangle centred on x=128 (half width hw), y0..y1, corner radius r.
function band(hw, y0, y1, r = Math.min(7, (y1 - y0) / 2), rb = r) {
  const k = 0.5523
  const x1 = CX + hw
  return sym([
    ['M', CX, y0],
    ['L', x1 - r, y0],
    ['C', x1 - r + r * k, y0, x1, y0 + r - r * k, x1, y0 + r],
    ['L', x1, y1 - rb],
    ['C', x1, y1 - rb + rb * k, x1 - rb + rb * k, y1, x1 - rb, y1],
    ['L', CX, y1],
  ])
}

function circle(cx, cy, r) {
  const k = 0.5523 * r
  return `M${cx} ${cy - r}C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}Z`
}

// --- skia ops ----------------------------------------------------------------
const P = (d) => {
  const p = CK.Path.MakeFromSVGString(d)
  if (!p) throw new Error(`bad path ${d.slice(0, 80)}`)
  return p
}
function union(paths) {
  let acc = null
  for (const p of paths) {
    const q = typeof p === 'string' ? P(p) : p.copy()
    if (!acc) acc = q
    else {
      const r = CK.Path.MakeFromOp(acc, q, CK.PathOp.Union)
      if (!r) throw new Error('union failed')
      acc = r
    }
  }
  return acc ?? new CK.Path()
}
const op = (a, b, kind) => {
  const r = CK.Path.MakeFromOp(a, b, CK.PathOp[kind])
  if (!r) throw new Error(`op ${kind} failed`)
  return r
}
function strokeOf(path, width, cap = 'Round') {
  const p = (typeof path === 'string' ? P(path) : path).copy()
  p.stroke({ width, join: CK.StrokeJoin.Round, cap: CK.StrokeCap[cap], precision: 2 })
  p.simplify()
  return p
}

// Make a path mirror-symmetric about x=128: keep the right half, union it
// with its exact mirror image. Curves away from the seam keep their exact
// (mirrored) coordinates. Output is meant for fill-rule="evenodd": PathOps
// results are non-overlapping contours, so even-odd is always correct.
function symmetrise(path) {
  const right = op(path, P('M128 -10H300V300H128Z'), 'Intersect')
  const left = right.copy().transform([-1, 0, 2 * CX, 0, 1, 0, 0, 0, 1])
  return plain(op(right, left, 'Union'))
}

// Skia's SVG path string with coordinates rounded to 0.01.
function plain(path) {
  return path.toSVGString().replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => f(Number(n)))
}

// ---------- piece set ---------------------------------------------------------
const W = 7 // outline width (centred on the body edge)
const DW = 5.5 // interior detail line width
const DETAIL = '#1a1612'
const X = (dx) => CX + dx

// ---------- shared parts -------------------------------------------------------
const BASE_BOTTOM = 230
function base(hw = 70) {
  return [
    // foot: a low convex torus
    sym([
      ['M', CX, 210],
      ['L', X(hw - 16), 210],
      ['C', X(hw - 6), 210, X(hw), 214, X(hw), 221],
      ['C', X(hw), 226, X(hw - 2), BASE_BOTTOM, X(hw - 8), BASE_BOTTOM],
      ['L', CX, BASE_BOTTOM],
    ]),
    // step: smaller torus
    sym([
      ['M', CX, 198],
      ['L', X(hw - 24), 198],
      ['C', X(hw - 15), 198, X(hw - 10), 201, X(hw - 10), 206],
      ['C', X(hw - 10), 210, X(hw - 13), 213, X(hw - 18), 213],
      ['L', CX, 213],
    ]),
  ]
}

// concave stem: half width wTop at yTop flaring to wBot at yBot
function stem(yTop, wTop, yBot, wBot, flare = 0.5) {
  const h = yBot - yTop
  const dw = wBot - wTop
  return sym([
    ['M', CX, yTop],
    ['L', X(wTop), yTop],
    ['C', X(wTop + 0.5), yTop + h * flare, X(wTop + dw * 0.16), yBot - h * 0.1, X(wBot), yBot],
    ['L', CX, yBot],
  ])
}

// ---------- pieces ---------------------------------------------------------------
const pieces = {}

pieces.pawn = {
  comps: [
    ...base(),
    stem(140, 17, 204, 44, 0.6),
    band(42, 190, 204, 7),
    band(34, 134, 148, 7),
    circle(CX, 108, 30),
  ],
}

pieces.rook = {
  comps: [
    ...base(),
    // tower body, gently tapering
    sym([
      ['M', CX, 104],
      ['L', X(38), 104],
      ['C', X(34), 140, X(36), 180, X(44), 200],
      ['L', CX, 200],
    ]),
    band(52, 188, 204, 7),
    // battlements: three merlons in profile
    sym([
      ['M', CX, 66],
      ['L', X(12), 66],
      ['L', X(12), 82],
      ['L', X(30), 82],
      ['L', X(30), 66],
      ['L', X(48), 66],
      ['C', X(50), 66, X(52), 68, X(52), 70],
      ['L', X(52), 102],
      ['L', CX, 102],
    ]),
    band(48, 98, 114, 7),
  ],
}

pieces.bishop = {
  comps: [
    ...base(),
    stem(132, 15, 204, 42, 0.5),
    band(46, 190, 203, 6.5),
    // mitre
    sym([
      ['M', CX, 58],
      ['C', X(10), 64, X(35), 78, X(35), 100],
      ['C', X(35), 114, X(27), 124, X(19), 128],
      ['L', CX, 128],
    ]),
    band(23, 122, 133, 5),
    band(35, 129, 141, 6),
    circle(CX, 50, 10),
  ],
  // diagonal slit (asymmetric detail)
  extra: [{ d: 'M164 78L132 104', w: 7, clipTo: 4 }],
}

pieces.queen = {
  comps: [
    ...base(),
    stem(112, 15, 204, 42, 0.5),
    band(46, 190, 203, 6.5),
    // crown cup with coronet
    sym([
      ['M', CX, 40],
      ['L', X(10), 64],
      ['L', X(24), 42],
      ['L', X(34), 68],
      ['L', X(50), 48],
      ['C', X(44), 72, X(30), 92, X(20), 106],
      ['L', CX, 106],
    ]),
    band(26, 100, 112, 6),
    band(34, 108, 120, 6),
    circle(X(50), 46, 7),
    circle(X(-50), 46, 7),
    circle(X(24), 38, 7),
    circle(X(-24), 38, 7),
    circle(CX, 32, 9),
  ],
  details: [
    // crown band
    'M90 82C100 86 114 88 128 88C142 88 156 86 166 82',
  ],
}

pieces.king = {
  comps: [
    ...base(),
    stem(110, 15, 204, 42, 0.5),
    band(46, 190, 203, 6.5),
    // crown cup
    sym([
      ['M', CX, 56],
      ['L', X(40), 56],
      ['C', X(30), 70, X(21), 86, X(20), 104],
      ['L', CX, 104],
    ]),
    band(27, 96, 108, 6),
    band(35, 104, 116, 6),
    band(43, 51, 62, 5.5),
    // dome
    sym([
      ['M', CX, 36],
      ['C', X(14), 36, X(24), 42, X(24), 52],
      ['L', CX, 52],
    ]),
    // cross
    sym([
      ['M', CX, 9],
      ['L', X(5.5), 9],
      ['C', X(7.5), 9, X(8.5), 10, X(8.5), 12],
      ['L', X(8.5), 19],
      ['L', X(18.5), 19],
      ['C', X(20.5), 19, X(21.5), 20, X(21.5), 22],
      ['L', X(21.5), 30],
      ['C', X(21.5), 32, X(20.5), 33, X(18.5), 33],
      ['L', X(8.5), 33],
      ['L', X(8.5), 44],
      ['L', CX, 44],
    ]),
  ],
}

// scale a path's coordinates about (ox, oy)
const tf = (d, k, ox = CX, oy = 196) =>
  d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_, x, y) => {
    const nx = Math.round((ox + (Number(x) - ox) * k) * 100) / 100
    const ny = Math.round((oy + (Number(y) - oy) * k) * 100) / 100
    return `${nx} ${ny}`
  })
const KN = 0.91

// Mane locks: convex lobes between successive points, bulging to the left of
// the direction of travel, meeting in small notches.
function lobes(points, bulge) {
  let d = ''
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    const nx = dy / len
    const ny = -dx / len
    const r = (n) => Math.round(n * 100) / 100
    d += `C${r(ax + dx * 0.2 + nx * bulge)} ${r(ay + dy * 0.2 + ny * bulge)} ${r(ax + dx * 0.75 + nx * bulge)} ${r(ay + dy * 0.75 + ny * bulge)} ${bx} ${by}`
  }
  return d
}

pieces.knight = {
  symmetric: false,
  comps: [
    ...base(),
    // horse head and neck, facing right
    tf(
      'M78 196' +
        'C75 180 75 164 78 150' + // back of neck
        lobes(
          [
            [78, 150],
            [80, 124],
            [87, 100],
            [99, 79],
            [114, 60],
          ],
          -5,
        ) + // mane locks along the crest
        'C114 50 115 40 117 30' + // back ear
        'C121 36 124 42 126 46' +
        'C128 40 130 36 134 32' + // front ear
        'C138 40 140 48 140 56' +
        'C150 60 160 66 168 74' + // forehead
        'C180 88 194 106 202 120' + // face
        'C208 130 208 142 200 146' + // nose
        'C194 148 188 146 184 144' + // upper lip to mouth corner
        'C182 150 176 152 170 150' + // chin
        'C160 148 150 146 144 148' + // jaw underside
        'C140 164 152 182 180 196' + // throat and chest
        'Z',
      KN,
    ),
    band(46, 190, 203, 6.5),
  ],
  details: [
    { d: tf('M143 86C148 79 157 78 163 83C157 88 150 89 143 86Z', KN), fill: true }, // eye
    { d: tf('M194 124L196 128', KN), w: 6 }, // nostril
    { d: tf('M206 140C200 140 194 140 188 142', KN), w: 4.5 }, // mouth
    { d: tf('M128 92C146 100 158 116 160 140', KN), w: 5 }, // cheek / jaw
    { d: tf('M124 62C110 80 100 104 96 130C93 150 94 172 96 194', KN), w: 5 }, // mane edge
  ],
}

// Prime Minister (England): the knight's head, a little smaller, wearing the
// king's crown (band, cup, dome and cross) between its ears. The crown is
// drawn in front of the head, so the head's detail lines stop at its edge.
const KM = 0.8
const PMX = 124 // crown centre line (over the poll, between the ears)
const PM_CROWN_X = 0.95 // crown size relative to the king's: a little narrower,
const PM_CROWN_Y = 0.75 // and squatter, so it fits above the head
const PM_CROWN_DY = 7
const crown = (d) =>
  d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_, x, y) => {
    const nx = Math.round((PMX + (Number(x) - CX) * PM_CROWN_X) * 100) / 100
    const ny = Math.round((Number(y) * PM_CROWN_Y + PM_CROWN_DY) * 100) / 100
    return `${nx} ${ny}`
  })
pieces['prime-minister'] = {
  title: 'Prime Minister',
  symmetric: false,
  comps: [
    ...base(),
    // the knight's head and neck (same outline as the knight), scaled about its foot
    tf(pieces.knight.comps[2], KM / KN),
    band(46, 190, 203, 6.5),
    // crown: cup, rim band sitting on the head, dome, cross (no upper band:
    // fewer outlines keep the seat colour visible at 19 px)
    crown(
      sym([
        ['M', CX, 50],
        ['L', X(42), 50],
        ['C', X(32), 66, X(25), 78, X(24), 92],
        ['L', CX, 92],
      ]),
    ),
    crown(band(30, 86, 100, 6)),
    crown(
      sym([
        ['M', CX, 36],
        ['C', X(14), 36, X(24), 42, X(24), 52],
        ['L', CX, 52],
      ]),
    ),
    crown(
      sym([
        ['M', CX, 9],
        ['L', X(6), 9],
        ['C', X(8), 9, X(9), 10, X(9), 12],
        ['L', X(9), 19],
        ['L', X(19), 19],
        ['C', X(21), 19, X(22), 20, X(22), 22],
        ['L', X(22), 30],
        ['C', X(22), 32, X(21), 33, X(19), 33],
        ['L', X(9), 33],
        ['L', X(9), 44],
        ['L', CX, 44],
      ]),
    ),
  ],
  // the knight's eye, nostril, mouth, cheek and mane, rescaled with the head
  details: pieces.knight.details.map((dd) => ({ ...dd, d: tf(dd.d, KM / KN) })),
  // details never cross the crown (components 4.. are the crown)
  detailClipFrom: 4,
}

// ---------- validation: emitted path must match the Skia geometry ---------------
function check(name, what, src, d) {
  const got = P(d)
  got.setFillType(CK.FillType.EvenOdd)
  let bad = 0
  for (let y = 0.5; y < 256; y += 1)
    for (let x = 0.5; x < 256; x += 1) if (src.contains(x, y) !== got.contains(x, y)) bad++
  if (bad > 40) throw new Error(`${name} ${what}: ${bad} mismatched samples`)
}

// Exact mirror symmetry: every point has its mirror twin, and the filled
// shapes match pixel for pixel across x = 128.
function checkSymmetric(name, ds) {
  for (const d of ds) {
    const pts = d.match(/-?\d*\.?\d+ -?\d*\.?\d+/g)
    const set = new Set(pts)
    for (const p of pts) {
      const [x, y] = p.split(' ').map(Number)
      if (!set.has(`${f(2 * CX - x)} ${y}`)) throw new Error(`${name}: ${p} has no mirror point`)
    }
    const path = P(d)
    path.setFillType(CK.FillType.EvenOdd)
    for (let y = 0.5; y < 256; y++)
      for (let x = 0.5; x < CX; x++)
        if (path.contains(x, y) !== path.contains(2 * CX - x, y))
          throw new Error(`${name}: asymmetric at ${x},${y}`)
  }
}

// ---------- build ----------------------------------------------------------------
// Global fit: scale every shape about (128, 136) so the tallest piece keeps a
// margin for the renderer's shadow; line widths stay constant.
const FIT = 0.94
const fit = (p) => p.transform([FIT, 0, CX * (1 - FIT), 0, FIT, 136 * (1 - FIT), 0, 0, 1])

function build(name, def) {
  const comps = def.comps.map((c) => fit(union([c])))
  const body = union(comps)
  const parts = []
  for (let i = 0; i < comps.length; i++) {
    const s = strokeOf(comps[i], W)
    const front = comps.slice(i + 1)
    parts.push(front.length ? op(s, union(front), 'Difference') : s)
  }
  const front = def.detailClipFrom ? union(comps.slice(def.detailClipFrom)) : null
  for (const dd of def.details ?? []) {
    const { d, w, fill } = typeof dd === 'string' ? { d: dd, w: DW } : dd
    let part = op(fill ? fit(union([d])) : strokeOf(fit(P(d)), w), body, 'Intersect')
    if (front) part = op(part, front, 'Difference')
    parts.push(part)
  }
  const detail = union(parts)
  const symmetric = def.symmetric !== false
  const bodyD = symmetric ? symmetrise(body) : plain(body)
  const detailD = symmetric ? symmetrise(detail) : plain(detail)
  check(name, 'body', body, bodyD)
  check(name, 'detail', detail, detailD)
  let extra = ''
  for (const e of def.extra ?? []) {
    const s = op(strokeOf(fit(P(e.d)), e.w, 'Butt'), comps[e.clipTo], 'Intersect')
    extra += `<path fill-rule="evenodd" d="${plain(s)}"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<title>${def.title ?? `${name[0].toUpperCase()}${name.slice(1)}`}</title>
<g id="body" fill="currentColor"><path fill-rule="evenodd" d="${bodyD}"/></g>
<g id="detail" fill="${DETAIL}"><path fill-rule="evenodd" d="${detailD}"/>${extra}</g>
</svg>
`
  if (symmetric) checkSymmetric(name, [bodyD, detailD])
  writeFileSync(join(out, `${name}.svg`), svg)
  return svg.length
}

// Optional: build only some pieces, e.g. `PIECES=prime-minister`.
const only = process.env.PIECES?.split(',')
mkdirSync(out, { recursive: true })
for (const [name, def] of Object.entries(pieces)) {
  if (only && !only.includes(name)) continue
  console.log(`${name}.svg`, build(name, def), 'bytes')
}
