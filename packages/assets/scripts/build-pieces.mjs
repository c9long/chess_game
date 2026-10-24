// Builds packages/assets/pieces/*.svg from the hand-tuned component outlines
// below. Each piece is a stack of simple closed shapes (stem, collar, head,
// base...) drawn back to front. The script unions them into the body (the
// silhouette plus one "turning" path per visible component), collects the
// brass components into the trim, outlines every visible edge as a filled band
// (stroke converted to fill, never a stroke), adds interior detail lines,
// mirrors symmetric pieces exactly about x = 128 and writes three-tone SVGs
// (body, trim, detail; see ../pieces/README.md).
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
  // Rounded to 0.01 first, so each mirrored coordinate rounds to its exact twin.
  const right = P(plain(op(path, P('M128 -10H300V300H128Z'), 'Intersect')))
  const left = right.copy().transform([-1, 0, 2 * CX, 0, 1, 0, 0, 0, 1])
  return plain(op(right, left, 'Union'))
}

// Skia's SVG path string with coordinates rounded to 0.01.
function plain(path) {
  return path.toSVGString().replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => f(Number(n)))
}

// ---------- piece set ---------------------------------------------------------
const W = 8 // outline width (centred on the body edge)
const DW = 6 // interior detail line width
const DETAIL = '#1a1612'
const TRIM = '#b8913f'
const X = (dx) => CX + dx

// ---------- shared parts -------------------------------------------------------
// A chunky Staunton base: a wide foot (body half width HW, about 72% of the
// canvas with its outline) and a deep rounded step on it. It is stacked in
// front of everything else, so stems and the knight's neck tuck in behind it.
const HW = 88
const FOOT_BOTTOM = 242
function base() {
  return [
    // foot: a low, wide torus
    sym([
      ['M', CX, 220],
      ['L', X(HW - 22), 220],
      ['C', X(HW - 8), 220, X(HW), 225, X(HW), 232],
      ['C', X(HW), 238, X(HW - 3), FOOT_BOTTOM, X(HW - 10), FOOT_BOTTOM],
      ['L', CX, FOOT_BOTTOM],
    ]),
    // step: a deeper, narrower torus
    sym([
      ['M', CX, 199],
      ['L', X(HW - 31), 199],
      ['C', X(HW - 18), 199, X(HW - 12), 204, X(HW - 12), 211],
      ['C', X(HW - 12), 218, X(HW - 17), 224, X(HW - 25), 224],
      ['L', CX, 224],
    ]),
  ]
}

// Component tags: `brass` parts form the trim group; `crown` parts stop the
// Prime Minister's head details; `mitre` clips the bishop's slit.
const brass = (d) => ({ d, brass: true })
const tag = (d, name) => ({ d, [name]: true })

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

// The cross (king, Prime Minister): a vertical bar of half width bw from
// yTop to yBot, arms of half width aw from y0 to y1, softly rounded corners.
function cross(yTop, yBot, bw, aw, y0, y1) {
  return sym([
    ['M', CX, yTop],
    ['L', X(bw - 2), yTop],
    ['C', X(bw - 0.9), yTop, X(bw), yTop + 0.9, X(bw), yTop + 2],
    ['L', X(bw), y0],
    ['L', X(aw - 2), y0],
    ['C', X(aw - 0.9), y0, X(aw), y0 + 0.9, X(aw), y0 + 2],
    ['L', X(aw), y1 - 2],
    ['C', X(aw), y1 - 0.9, X(aw - 0.9), y1, X(aw - 2), y1],
    ['L', X(bw), y1],
    ['L', X(bw), yBot],
    ['L', CX, yBot],
  ])
}

// ---------- pieces ---------------------------------------------------------------
// `comps` are stacked back to front: plain path strings, or tagged objects.
const pieces = {}

pieces.pawn = {
  comps: [
    stem(148, 24, 206, 58, 0.6),
    circle(CX, 108, 37),
    brass(band(44, 137, 157, 8)),
    ...base().map((d) => tag(d, 'base')),
  ],
}

pieces.rook = {
  comps: [
    // tower, gently tapering upwards
    sym([
      ['M', CX, 106],
      ['L', X(45), 106],
      ['C', X(42), 146, X(46), 180, X(58), 206],
      ['L', CX, 206],
    ]),
    // battlements: three merlons in profile, a wide block below them
    sym([
      ['M', CX, 52],
      ['L', X(13), 52],
      ['L', X(13), 71],
      ['L', X(33), 71],
      ['L', X(33), 52],
      ['L', X(54), 52],
      ['C', X(57), 52, X(60), 55, X(60), 58],
      ['L', X(60), 106],
      ['L', CX, 106],
    ]),
    brass(band(58, 98, 118, 8)),
    ...base().map((d) => tag(d, 'base')),
  ],
}

pieces.bishop = {
  comps: [
    stem(142, 23, 206, 56, 0.5),
    // mitre
    tag(
      sym([
        ['M', CX, 50],
        ['C', X(14), 56, X(45), 76, X(45), 102],
        ['C', X(45), 118, X(35), 130, X(24), 135],
        ['L', CX, 135],
      ]),
      'mitre',
    ),
    brass(band(38, 126, 146, 8)),
    circle(CX, 43, 11.5),
    ...base().map((d) => tag(d, 'base')),
  ],
  // diagonal slit (asymmetric detail, clipped to the mitre)
  extra: [{ d: 'M172 76L132 110', w: 8 }],
}

pieces.queen = {
  comps: [
    stem(122, 23, 206, 56, 0.5),
    // crown cup with a five-point coronet
    sym([
      ['M', CX, 46],
      ['L', X(13), 72],
      ['L', X(29), 44],
      ['L', X(41), 76],
      ['L', X(58), 52],
      ['C', X(53), 78, X(39), 98, X(28), 114],
      ['L', CX, 114],
    ]),
    brass(band(42, 106, 126, 8)),
    circle(X(58), 48, 9),
    circle(X(-58), 48, 9),
    circle(X(29), 40, 9),
    circle(X(-29), 40, 9),
    brass(circle(CX, 34, 10.5)),
    ...base().map((d) => tag(d, 'base')),
  ],
  details: [
    // crown band (thin, so the cup keeps its colour on small squares)
    { d: 'M84 86C97 91 112 93 128 93C144 93 159 91 172 86', w: 4.5 },
  ],
}

pieces.king = {
  comps: [
    stem(120, 23, 206, 56, 0.5),
    // crown cup
    sym([
      ['M', CX, 60],
      ['L', X(52), 60],
      ['C', X(44), 76, X(35), 92, X(32), 108],
      ['L', CX, 108],
    ]),
    band(57, 52, 67, 6),
    // dome
    sym([
      ['M', CX, 38],
      ['C', X(17), 38, X(29), 45, X(29), 56],
      ['L', CX, 56],
    ]),
    brass(band(42, 102, 122, 8)),
    brass(cross(14, 44, 10, 24, 21, 35.5)),
    ...base().map((d) => tag(d, 'base')),
  ],
}

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

// map every "x y" coordinate pair of a path through fn, rounded to 0.01
const mapXY = (d, fn) =>
  d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_, x, y) =>
    fn(Number(x), Number(y)).map(f).join(' '),
  )

// scale a path's coordinates by k about (ox, oy)
const tf = (d, k, ox = CX, oy = 211) => mapXY(d, (x, y) => [ox + (x - ox) * k, oy + (y - oy) * k])

// The horse's head and neck, facing right: two clear ears, a long face ending
// in a blunt muzzle, and a deep throat notch under the jaw, so it reads as a
// head (not a blob) on a 19 px square.
const HORSE =
  'M80 212' +
  'C72 190 68 168 71 146' + // back of neck
  lobes(
    [
      [71, 146],
      [75, 120],
      [84, 97],
      [97, 77],
      [112, 61],
    ],
    -5,
  ) + // mane locks along the crest
  'C112 54 113 45 116 34' + // back ear
  'C122 41 125 49 127 56' +
  'C129 48 133 40 141 33' + // front ear
  'C145 42 147 51 147 59' +
  'C160 64 172 74 182 86' + // forehead
  'C195 102 206 120 214 136' + // face
  'C221 149 221 162 211 167' + // muzzle
  'C205 169 199 167 194 164' + // upper lip to mouth corner
  'C192 172 185 176 176 175' + // chin
  'C166 174 152 166 140 157' + // jaw underside
  'C128 176 138 200 174 212' + // throat and chest
  'Z'

const KNIGHT_DETAILS = [
  { d: 'M143 96C149 88 160 87 168 92C161 99 151 100 143 96Z', fill: true }, // eye
  { d: 'M205 141L209 148', w: 6.5 }, // nostril
  { d: 'M223 160C215 160 207 161 200 163', w: 5 }, // mouth
  { d: 'M128 104C146 112 156 126 154 147', w: 5.5 }, // cheek / jaw
  { d: 'M123 68C108 88 97 114 92 142C89 160 89 176 90 192', w: 5.5 }, // mane edge
]

pieces.knight = {
  symmetric: false,
  comps: [HORSE, brass(band(58, 180, 200, 8)), ...base().map((d) => tag(d, 'base'))],
  details: KNIGHT_DETAILS,
}

// Prime Minister (England): the knight's head at 90%, its ears smoothed into a
// poll (beside the cross they would only be a smudge of outline), wearing a
// brass circlet with the king's cross standing where the ears were. The crown
// is drawn in front of the head, so only the eye, mouth and mane line remain.
const KM = 0.9
const POLLED = HORSE.replace(
  'C112 54 113 45 116 34C122 41 125 49 127 56C129 48 133 40 141 33C145 42 147 51 147 59',
  'C118 55 136 54 147 59',
)
if (POLLED === HORSE) throw new Error('prime minister: ear outline not found')
const PMX = 128.5 // crown centre line (over the poll)
const pm = (d) => ({ d: mapXY(d, (x, y) => [x - CX + PMX, y]), brass: true, crown: true })
pieces['prime-minister'] = {
  title: 'Prime Minister',
  symmetric: false,
  comps: [
    tf(POLLED, KM),
    brass(band(58, 180, 200, 8)),
    // the cross stands on the poll, its foot tucked behind the circlet
    pm(cross(24, 80, 9.5, 22.5, 32, 45)),
    pm(
      sym([
        ['M', CX, 75],
        ['L', X(24), 75],
        ['C', X(28), 75, X(30), 77, X(30), 81],
        ['L', X(30), 86],
        ['C', X(30), 90, X(28), 93, X(24), 93],
        ['C', X(15), 93, X(6), 95, CX, 95],
      ]),
    ),
    ...base().map((d) => tag(d, 'base')),
  ],
  // the knight's eye, mouth and mane line, rescaled with the head
  details: [0, 2, 4].map((i) => ({ ...KNIGHT_DETAILS[i], d: tf(KNIGHT_DETAILS[i].d, KM) })),
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

// The ink box (body plus outline) must stay inside the canvas, the tallest
// piece reaching about 92% of it, and every piece must share the base.
function checkBounds(name, body) {
  const b = body.computeTightBounds()
  const half = W / 2
  const box = [b[0] - half, b[1] - half, b[2] + half, b[3] + half]
  if (box[0] < 2 || box[1] < 2 || box[2] > 254 || box[3] > 254)
    throw new Error(`${name}: ink box ${box.map(f)} leaves the canvas`)
  if (Math.abs(b[3] - FOOT_BOTTOM) > 0.5) throw new Error(`${name}: base bottom ${b[3]}`)
  return box
}

// ---------- build ----------------------------------------------------------------
function build(name, def) {
  const specs = def.comps.map((c) => (typeof c === 'string' ? { d: c } : c))
  const comps = specs.map((c) => union([c.d]))
  const tagged = (key) => union(comps.filter((_, i) => specs[i][key]))
  const body = union(comps)
  // what is stacked in front of each component, and what of it stays visible
  const ahead = comps.map((_, i) => (i + 1 < comps.length ? union(comps.slice(i + 1)) : null))
  const visible = comps.map((c, i) => (ahead[i] ? op(c, ahead[i], 'Difference') : c.copy()))
  const parts = comps.map((c, i) => {
    const s = strokeOf(c, W)
    return ahead[i] ? op(s, ahead[i], 'Difference') : s
  })
  const front = specs.some((c) => c.crown) ? tagged('crown') : null
  const lower = union(comps.filter((_, i) => specs[i].brass || specs[i].base))
  for (const dd of def.details ?? []) {
    const { d, w, fill } = typeof dd === 'string' ? { d: dd, w: DW } : dd
    // details stay on the body above the brass and the base
    let part = op(fill ? union([d]) : strokeOf(P(d), w), body, 'Intersect')
    if (lower) part = op(part, lower, 'Difference')
    if (front) part = op(part, front, 'Difference')
    parts.push(part)
  }
  const detail = union(parts)
  // brass: the visible part of each trim component
  const trimParts = visible.filter((_, i) => specs[i].brass)
  if (!trimParts.length) throw new Error(`${name}: every piece needs a trim (collar)`)
  const trim = union(trimParts)
  const symmetric = def.symmetric !== false
  const emit = (p) => (symmetric ? symmetrise(p) : plain(p))
  const bodyD = emit(body)
  // Turnings: the visible part of each (non-brass) component as its own path
  // after the silhouette, so the renderer's objectBoundingBox gradients light
  // every turned ring, ball and head as a cylinder of its own.
  const turnings = []
  for (let i = 0; i < comps.length; i++) {
    if (specs[i].brass) continue
    const part = visible[i]
    const b = part.computeTightBounds()
    if (b[2] - b[0] < 1 || b[3] - b[1] < 1) continue
    // (symmetrised, a mirror pair such as the queen's side balls becomes one path)
    const d = emit(part)
    if (d && !turnings.includes(d)) turnings.push(d)
  }
  const trimD = emit(trim)
  const detailD = emit(detail)
  check(name, 'body', body, bodyD)
  check(name, 'trim', trim, trimD)
  check(name, 'detail', detail, detailD)
  const box = checkBounds(name, body)
  let extra = ''
  for (const e of def.extra ?? []) {
    const s = op(strokeOf(P(e.d), e.w, 'Butt'), tagged('mitre'), 'Intersect')
    extra += `<path fill-rule="evenodd" d="${plain(s)}"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<title>${def.title ?? `${name[0].toUpperCase()}${name.slice(1)}`}</title>
<g id="body" fill="currentColor"><path fill-rule="evenodd" d="${bodyD}"/>${turnings.map((d) => `<path fill-rule="evenodd" d="${d}"/>`).join('')}</g>
<g id="trim" fill="${TRIM}"><path fill-rule="evenodd" d="${trimD}"/></g>
<g id="detail" fill="${DETAIL}"><path fill-rule="evenodd" d="${detailD}"/>${extra}</g>
</svg>
`
  if (symmetric) checkSymmetric(name, [bodyD, trimD, detailD, ...turnings])
  writeFileSync(join(out, `${name}.svg`), svg)
  return `${svg.length} bytes, ink x ${f(box[0])}-${f(box[2])}, y ${f(box[1])}-${f(box[3])}`
}

// Optional: build only some pieces, e.g. `PIECES=prime-minister`.
const only = process.env.PIECES?.split(',')
mkdirSync(out, { recursive: true })
for (const [name, def] of Object.entries(pieces)) {
  if (only && !only.includes(name)) continue
  console.log(`${name}.svg`, build(name, def))
}
