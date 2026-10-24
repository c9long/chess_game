import type { CivId, PieceKind, Seat } from '@game/rules'
import { CanvasSource, Rectangle, Texture } from 'pixi.js'
import { EMBLEM_SVGS, PIECE_SVGS } from './assets.ts'
import { desaturateHex, mixHex, shadeHex } from './color.ts'
import {
  bandColor,
  FROZEN_BASE,
  FROZEN_OUTLINE,
  type MarkerShape,
  outlineFor,
  outlineWeight,
  PIECE_TRIM,
  SEAT_STYLES,
  trimFor,
} from './palette.ts'
import {
  type PieceShading,
  shadePieceSvg,
  svgDataUrl,
  type TrimShading,
  tintEmblemSvg,
} from './svg.ts'

/**
 * Runtime-rasterised textures: pieces (per seat colour, plus frozen grey),
 * their soft shadows, colour-blind markers, emblem medallions and small
 * effect sprites. Everything is drawn with Canvas 2D from the SVG art and
 * cached; nothing is loaded from image files.
 */

export type PieceVariant = Seat | 'frozen'

const KINDS: readonly PieceKind[] = [
  'king',
  'queen',
  'rook',
  'bishop',
  'knight',
  'pawn',
  'prime_minister',
]
const VARIANTS: readonly PieceVariant[] = ['south', 'west', 'north', 'east', 'frozen']
const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']

function loadSvg(svg: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'async'
  img.src = svgDataUrl(svg)
  return img.decode().then(() => img)
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  return g
}

/**
 * Shading colours for a body base colour. The highlight is kept modest so
 * saturated seats (Crimson) stay saturated instead of washing out to pink.
 */
export function shadingFor(base: string, trim: TrimShading, weight = 1): PieceShading {
  return {
    base,
    light: mixHex(base, '#fff8ea', 0.2),
    dark: shadeHex(base, 0.66),
    deep: shadeHex(base, 0.42),
    outline: outlineFor(base),
    outlineBoost: weight > 1 ? (weight - 1) * 3.5 : 0,
    trim,
  }
}

function shadingForVariant(v: PieceVariant): PieceShading {
  if (v === 'frozen') {
    return {
      ...shadingFor(FROZEN_BASE, PIECE_TRIM.frozen),
      outline: FROZEN_OUTLINE,
      light: '#a9b0b9',
    }
  }
  return shadingFor(SEAT_STYLES[v].base, trimFor(v), outlineWeight(v))
}

/** Traces a marker shape of radius `r` around (cx, cy). */
function markerPath(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  shape: MarkerShape,
) {
  g.beginPath()
  switch (shape) {
    case 'circle':
      g.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
      break
    case 'square':
      g.rect(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56)
      break
    case 'triangle':
      g.moveTo(cx, cy - r * 1.0)
      g.lineTo(cx + r * 1.0, cy + r * 0.78)
      g.lineTo(cx - r * 1.0, cy + r * 0.78)
      g.closePath()
      break
    case 'diamond':
      g.moveTo(cx, cy - r * 1.05)
      g.lineTo(cx + r * 0.85, cy)
      g.lineTo(cx, cy + r * 1.05)
      g.lineTo(cx - r * 0.85, cy)
      g.closePath()
      break
  }
}

/**
 * Draws a seat marker centred in a square of side `s`: the badge is the shape
 * itself, filled with the seat colour, with a dark stroke and a white inner rim
 * so the four shapes stay distinct at small sizes.
 */
function drawMarker(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  shape: MarkerShape,
  color: string,
) {
  const cx = x + s / 2
  const cy = y + s / 2
  const r = s * 0.4
  g.save()
  g.lineJoin = 'round'
  markerPath(g, cx, cy, r, shape)
  g.fillStyle = color
  g.fill()
  g.lineWidth = Math.max(1.5, s * 0.12)
  g.strokeStyle = '#120d0a'
  g.stroke()
  markerPath(g, cx, cy, r * 0.8, shape)
  g.lineWidth = Math.max(1, s * 0.06)
  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.stroke()
  g.restore()
}

/**
 * Ice finish for frozen pieces, painted inside the piece's silhouette in the
 * square (x, y, s): a soft cool tint, a little crystalline sparkle and a pale
 * rim light on the upper-left edge. No line patterns (they moire at 1x).
 */
function frost(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const src = g.canvas
  // Upper-left rim: the silhouette minus itself shifted down-right.
  const rim = canvas(s, s)
  const rg = ctx2d(rim)
  rg.drawImage(src, x, y, s, s, 0, 0, s, s)
  rg.globalCompositeOperation = 'source-in'
  rg.fillStyle = '#e8f2ff'
  rg.fillRect(0, 0, s, s)
  rg.globalCompositeOperation = 'destination-out'
  const d = Math.max(1, s * 0.022)
  rg.drawImage(src, x, y, s, s, d, d, s, s)

  g.save()
  g.beginPath()
  g.rect(x, y, s, s)
  g.clip()
  g.globalCompositeOperation = 'source-atop'
  const tint = g.createLinearGradient(x, y, x + s, y + s)
  tint.addColorStop(0, 'rgba(196,214,232,0.18)')
  tint.addColorStop(1, 'rgba(143,153,166,0.2)')
  g.fillStyle = tint
  g.fillRect(x, y, s, s)
  // Sparse crystalline sparkle (deterministic, soft).
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < 26; i++) {
    const px = x + (0.25 + rnd() * 0.5) * s
    const py = y + (0.15 + rnd() * 0.75) * s
    const pr = s * (0.006 + rnd() * 0.01)
    const gr = g.createRadialGradient(px, py, 0, px, py, pr * 2.5)
    gr.addColorStop(0, 'rgba(240,248,255,0.5)')
    gr.addColorStop(1, 'rgba(240,248,255,0)')
    g.fillStyle = gr
    g.fillRect(px - pr * 2.5, py - pr * 2.5, pr * 5, pr * 5)
  }
  g.globalAlpha = 0.35
  g.drawImage(rim, x, y)
  g.restore()
}

/** Pieces, shadows and markers in one atlas texture (one GPU texture, batches in one draw). */
export class PieceAtlas {
  /** Drawn piece size in device pixels. */
  readonly size: number
  /** Atlas cell size (piece plus padding for shadow blur). */
  readonly cell: number
  readonly #base: Texture
  readonly #pieces = new Map<string, Texture>()
  readonly #shadows = new Map<PieceKind, Texture>()
  readonly #markers = new Map<Seat, Texture>()

  private constructor(size: number, cell: number, base: Texture) {
    this.size = size
    this.cell = cell
    this.#base = base
  }

  static async build(size: number): Promise<PieceAtlas> {
    const pad = Math.ceil(size * 0.1)
    const cell = size + pad * 2
    const cols = KINDS.length
    const rows = VARIANTS.length + 2
    const atlas = canvas(cols * cell, rows * cell)
    const g = ctx2d(atlas)

    const images = await Promise.all(
      VARIANTS.flatMap((v) =>
        KINDS.map((k) => loadSvg(shadePieceSvg(PIECE_SVGS[k], shadingForVariant(v)))),
      ),
    )

    VARIANTS.forEach((v, row) => {
      KINDS.forEach((k, col) => {
        const img = images[row * KINDS.length + col] as HTMLImageElement
        const x = col * cell + pad
        const y = row * cell + pad
        if (v === 'frozen') {
          const tmp = canvas(size, size)
          const tg = ctx2d(tmp)
          tg.drawImage(img, 0, 0, size, size)
          frost(tg, 0, 0, size)
          g.drawImage(tmp, x, y)
        } else {
          g.drawImage(img, x, y, size, size)
        }
        void k
      })
    })

    // Shadows: blurred silhouettes (the shadow is offset far away and the shape itself
    // drawn off-canvas, so only the blur lands in the cell).
    const shadowRow = VARIANTS.length
    KINDS.forEach((_, col) => {
      const img = images[col] as HTMLImageElement
      const sil = canvas(size, size)
      const sg = ctx2d(sil)
      sg.drawImage(img, 0, 0, size, size)
      sg.globalCompositeOperation = 'source-in'
      sg.fillStyle = '#000'
      sg.fillRect(0, 0, size, size)
      const x = col * cell + pad
      const y = shadowRow * cell + pad
      const far = cell * cols * 4
      g.save()
      g.beginPath()
      g.rect(col * cell, shadowRow * cell, cell, cell)
      g.clip()
      g.shadowColor = 'rgba(0,0,0,1)'
      g.shadowBlur = size * 0.06
      g.shadowOffsetX = far
      g.drawImage(sil, x - far, y)
      g.restore()
    })

    const markerRow = VARIANTS.length + 1
    SEATS.forEach((seat, col) => {
      const st = SEAT_STYLES[seat]
      drawMarker(g, col * cell + pad, markerRow * cell + pad, size, st.marker, st.base)
    })

    const base = canvasTexture(atlas)
    base.source.style.scaleMode = 'linear'
    const out = new PieceAtlas(size, cell, base)
    const sub = (x: number, y: number, w: number, h: number) =>
      new Texture({ source: base.source, frame: new Rectangle(x, y, w, h) })
    VARIANTS.forEach((v, row) => {
      KINDS.forEach((k, col) => {
        out.#pieces.set(`${k}:${v}`, sub(col * cell + pad, row * cell + pad, size, size))
      })
    })
    KINDS.forEach((k, col) => {
      out.#shadows.set(k, sub(col * cell, shadowRow * cell, cell, cell))
    })
    SEATS.forEach((s, col) => {
      out.#markers.set(s, sub(col * cell + pad, markerRow * cell + pad, size, size))
    })
    return out
  }

  piece(kind: PieceKind, variant: PieceVariant): Texture {
    return this.#pieces.get(`${kind}:${variant}`) ?? Texture.EMPTY
  }

  /** Shadow texture; its frame is `cell / size` times larger than the piece, same centre. */
  shadow(kind: PieceKind): Texture {
    return this.#shadows.get(kind) ?? Texture.EMPTY
  }

  marker(seat: Seat): Texture {
    return this.#markers.get(seat) ?? Texture.EMPTY
  }

  destroy(): void {
    for (const t of this.#pieces.values()) t.destroy(false)
    for (const t of this.#shadows.values()) t.destroy(false)
    for (const t of this.#markers.values()) t.destroy(false)
    this.#base.destroy(true)
  }
}

export type MedallionState = 'active' | 'defeated' | 'frozen' | 'removed'

const emblemCache = new Map<string, Promise<HTMLImageElement>>()

function emblemImage(civ: CivId, color: string): Promise<HTMLImageElement> {
  const key = `${civ}:${color}`
  let p = emblemCache.get(key)
  if (!p) {
    p = loadSvg(tintEmblemSvg(EMBLEM_SVGS[civ], color))
    emblemCache.set(key, p)
  }
  return p
}

/**
 * A round enamel medallion with a brass bezel carrying the civ emblem, in the
 * seat colour (greyed for frozen or removed seats). `size` is in device px.
 */
export async function drawMedallion(
  civ: CivId,
  seat: Seat,
  state: MedallionState,
  size: number,
): Promise<HTMLCanvasElement> {
  let seatBase = bandColor(seat)
  if (state === 'frozen') seatBase = mixHex(desaturateHex(seatBase, 0.85), '#a9c4dc', 0.35)
  if (state === 'removed') seatBase = desaturateHex(seatBase, 1)
  if (state === 'defeated') seatBase = desaturateHex(seatBase, 0.45)
  const gold = seat === 'north' && state !== 'removed' && state !== 'frozen'
  // Glyphs are always metal (brass, or pale steel when frozen / grey when out),
  // never a seat-derived light tint: a red field with a white symbol would echo
  // a national flag (CLAUDE.md), and brass reads richer on every enamel.
  const glyphColor =
    state === 'frozen'
      ? '#dfe8f0'
      : state === 'removed'
        ? '#bdb8b0'
        : state === 'defeated'
          ? '#cdb98a'
          : '#e8c66a'
  const edgeColor = state === 'frozen' || state === 'removed' ? '#3d4248' : '#3a2810'
  const [img, edge] = await Promise.all([emblemImage(civ, glyphColor), emblemImage(civ, edgeColor)])

  const c = canvas(size, size)
  const g = ctx2d(c)
  const cx = size / 2
  const cy = size / 2
  const R = size * 0.46

  // Drop shadow.
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowBlur = size * 0.06
  g.shadowOffsetY = size * 0.025
  g.beginPath()
  g.arc(cx, cy, R, 0, Math.PI * 2)
  g.fillStyle = '#2a1d12'
  g.fill()
  g.restore()

  // Brass bezel: the pieces' brass trim, brushed rather than mirror-bright.
  const bezel = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
  const metal =
    state === 'removed' ? { light: '#d8d4cc', base: '#8d8a84', dark: '#5b5853' } : PIECE_TRIM.normal
  bezel.addColorStop(0, metal.light)
  bezel.addColorStop(0.55, metal.base)
  bezel.addColorStop(1, metal.dark)
  g.beginPath()
  g.arc(cx, cy, R, 0, Math.PI * 2)
  g.fillStyle = bezel
  g.fill()

  // An engraved line round the bezel's inner edge.
  const r1 = R * 0.84
  g.beginPath()
  g.arc(cx, cy, R * 0.9, 0, Math.PI * 2)
  g.lineWidth = Math.max(1, size * 0.012)
  g.strokeStyle = 'rgba(40,28,12,0.55)'
  g.stroke()

  // Enamel field in the seat colour, deepening toward the rim. Gold is laid darker (amber),
  // so the brass glyph still stands out from it.
  const disc = g.createRadialGradient(cx - r1 * 0.3, cy - r1 * 0.35, r1 * 0.1, cx, cy, r1)
  disc.addColorStop(0, gold ? '#8a5f10' : mixHex(seatBase, '#000000', 0.2))
  disc.addColorStop(1, gold ? '#3a2706' : mixHex(seatBase, '#000000', 0.62))
  g.beginPath()
  g.arc(cx, cy, r1, 0, Math.PI * 2)
  g.fillStyle = disc
  g.fill()
  // A thin lip of brighter enamel just inside the bezel, so the seat colour reads at a glance.
  g.beginPath()
  g.arc(cx, cy, r1 - Math.max(1, size * 0.02), 0, Math.PI * 2)
  g.lineWidth = Math.max(1, size * 0.03)
  g.strokeStyle = shadeHex(seatBase, gold ? 1.05 : 1.12)
  g.globalAlpha = 0.85
  g.stroke()
  g.globalAlpha = 1
  g.beginPath()
  g.arc(cx, cy, r1, 0, Math.PI * 2)
  g.lineWidth = Math.max(1, size * 0.012)
  g.strokeStyle = 'rgba(0,0,0,0.6)'
  g.stroke()
  const r2 = r1

  // Emblem: a darker metal edge (the glyph drawn offset around itself), then the glyph.
  const e = r2 * 1.62
  g.save()
  g.globalAlpha = state === 'removed' ? 0.6 : 1
  g.shadowColor = 'rgba(0,0,0,0.65)'
  g.shadowBlur = size * 0.025
  g.shadowOffsetY = size * 0.012
  const o = Math.max(1, size * 0.012)
  for (const [dx, dy] of [
    [-o, 0],
    [o, 0],
    [0, -o],
    [0, o],
  ] as const) {
    g.drawImage(edge, cx - e / 2 + dx, cy - e / 2 + dy, e, e)
  }
  g.shadowColor = 'transparent'
  g.drawImage(img, cx - e / 2, cy - e / 2, e, e)
  g.restore()

  // Gloss.
  g.save()
  g.beginPath()
  g.arc(cx, cy, r2, 0, Math.PI * 2)
  g.clip()
  const gloss = g.createLinearGradient(cx, cy - r2, cx, cy + r2 * 0.2)
  gloss.addColorStop(0, 'rgba(255,255,255,0.14)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gloss
  g.beginPath()
  g.ellipse(cx, cy - r2 * 0.45, r2 * 0.92, r2 * 0.62, 0, 0, Math.PI * 2)
  g.fill()
  g.restore()

  if (state === 'frozen') {
    g.save()
    g.beginPath()
    g.arc(cx, cy, R, 0, Math.PI * 2)
    g.clip()
    frost(g, 0, 0, size)
    g.restore()
  }
  return c
}

/** Small effect textures, drawn once. */
export interface EffectTextures {
  /** Soft round dot (particles, dust). */
  readonly dot: Texture
  /** Large radial glow. */
  readonly glow: Texture
  /** Four-point sparkle. */
  readonly spark: Texture
  /** Thin ring (shockwave). */
  readonly ring: Texture
  /** Soft horizontal light bar (turn indicator), fades at both ends. */
  readonly bar: Texture
  /** Hot halo (check indicator, tinted red by the board): white-yellow core, red rim, transparent edge. */
  readonly halo: Texture
  /** Small irregular shard with a lit edge (capture debris, tinted with the victim's colour). */
  readonly chip: Texture
  /** Quiet-move hint, a full square: dark translucent dot with a thin light rim. Not tinted. */
  readonly hintDot: Texture
  /** Capture hint, a full square: white ring with a dark outline (tinted with the mover's light colour). */
  readonly hintRing: Texture
  /** Promotion marker, a full square: thin white ring (tinted). */
  readonly hintPromo: Texture
}

/** Destroys effect textures together with their canvases (they are not shared). */
export function destroyEffectTextures(fx: EffectTextures): void {
  for (const t of [
    fx.dot,
    fx.glow,
    fx.spark,
    fx.ring,
    fx.bar,
    fx.halo,
    fx.chip,
    fx.hintDot,
    fx.hintRing,
    fx.hintPromo,
  ])
    t.destroy(true)
}

/** A texture for a canvas that never enters Pixi's global cache (so destroying it frees the canvas). */
export function canvasTexture(c: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: c }) })
}

export function createEffectTextures(): EffectTextures {
  const dotC = canvas(64, 64)
  {
    const g = ctx2d(dotC)
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.35, 'rgba(255,255,255,0.75)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 64, 64)
  }
  const glowC = canvas(256, 256)
  {
    const g = ctx2d(glowC)
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    gr.addColorStop(0, 'rgba(255,255,255,0.9)')
    gr.addColorStop(0.3, 'rgba(255,255,255,0.45)')
    gr.addColorStop(0.65, 'rgba(255,255,255,0.12)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 256, 256)
  }
  const sparkC = canvas(64, 64)
  {
    const g = ctx2d(sparkC)
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.beginPath()
    g.moveTo(32, 0)
    g.quadraticCurveTo(35, 29, 64, 32)
    g.quadraticCurveTo(35, 35, 32, 64)
    g.quadraticCurveTo(29, 35, 0, 32)
    g.quadraticCurveTo(29, 29, 32, 0)
    g.fill()
  }
  const ringC = canvas(128, 128)
  {
    const g = ctx2d(ringC)
    const gr = g.createRadialGradient(64, 64, 40, 64, 64, 64)
    gr.addColorStop(0, 'rgba(255,255,255,0)')
    gr.addColorStop(0.7, 'rgba(255,255,255,0.9)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 128, 128)
  }
  const barC = canvas(256, 32)
  {
    const g = ctx2d(barC)
    const v = g.createLinearGradient(0, 0, 0, 32)
    v.addColorStop(0, 'rgba(255,255,255,0)')
    v.addColorStop(0.5, 'rgba(255,255,255,1)')
    v.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = v
    g.fillRect(0, 0, 256, 32)
    g.globalCompositeOperation = 'destination-in'
    const h = g.createLinearGradient(0, 0, 256, 0)
    h.addColorStop(0, 'rgba(0,0,0,0)')
    h.addColorStop(0.12, 'rgba(0,0,0,1)')
    h.addColorStop(0.88, 'rgba(0,0,0,1)')
    h.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = h
    g.fillRect(0, 0, 256, 32)
  }
  const haloC = canvas(256, 256)
  {
    const g = ctx2d(haloC)
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    gr.addColorStop(0, 'rgba(255,241,194,0.95)')
    gr.addColorStop(0.28, 'rgba(255,196,120,0.8)')
    gr.addColorStop(0.5, 'rgba(255,59,34,0.7)')
    gr.addColorStop(0.75, 'rgba(255,59,34,0.34)')
    gr.addColorStop(1, 'rgba(255,59,34,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 256, 256)
  }
  const chipC = canvas(48, 48)
  {
    const g = ctx2d(chipC)
    // An irregular faceted shard: lit upper facet, shaded lower one.
    g.beginPath()
    g.moveTo(6, 20)
    g.lineTo(22, 4)
    g.lineTo(42, 14)
    g.lineTo(38, 36)
    g.lineTo(16, 44)
    g.closePath()
    g.fillStyle = 'rgb(205,205,205)'
    g.fill()
    g.beginPath()
    g.moveTo(6, 20)
    g.lineTo(22, 4)
    g.lineTo(42, 14)
    g.lineTo(24, 24)
    g.closePath()
    g.fillStyle = 'rgb(255,255,255)'
    g.fill()
    g.beginPath()
    g.moveTo(24, 24)
    g.lineTo(38, 36)
    g.lineTo(16, 44)
    g.closePath()
    g.fillStyle = 'rgb(140,140,140)'
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = 'rgba(30,22,16,0.55)'
    g.beginPath()
    g.moveTo(6, 20)
    g.lineTo(22, 4)
    g.lineTo(42, 14)
    g.lineTo(38, 36)
    g.lineTo(16, 44)
    g.closePath()
    g.stroke()
  }
  const H = 128
  const hintDotC = canvas(H, H)
  {
    const g = ctx2d(hintDotC)
    // Diameter 0.28 of the texture (HINT_DOT_FRACTION in BoardView). The rim scales with the
    // dot so it still shows when the dot is only a few pixels wide.
    const r = H * 0.14
    const rim = H * 0.025
    g.beginPath()
    g.arc(H / 2, H / 2, r, 0, Math.PI * 2)
    g.fillStyle = 'rgba(26,18,12,0.38)'
    g.fill()
    g.lineWidth = rim
    g.strokeStyle = 'rgba(255,241,214,0.75)'
    g.beginPath()
    g.arc(H / 2, H / 2, r - rim / 2, 0, Math.PI * 2)
    g.stroke()
  }
  const hintRingC = canvas(H, H)
  {
    const g = ctx2d(hintRingC)
    const w = H * 0.08
    const r = H * 0.45 - w / 2
    g.lineWidth = w + 3
    g.strokeStyle = 'rgba(26,18,12,0.5)'
    g.beginPath()
    g.arc(H / 2, H / 2, r, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = w
    g.strokeStyle = 'rgba(255,255,255,0.92)'
    g.beginPath()
    g.arc(H / 2, H / 2, r, 0, Math.PI * 2)
    g.stroke()
  }
  const hintPromoC = canvas(H, H)
  {
    const g = ctx2d(hintPromoC)
    g.lineWidth = H * 0.03
    g.strokeStyle = 'rgba(255,255,255,0.85)'
    g.beginPath()
    g.arc(H / 2, H / 2, H * 0.26, 0, Math.PI * 2)
    g.stroke()
  }
  return {
    dot: canvasTexture(dotC),
    glow: canvasTexture(glowC),
    spark: canvasTexture(sparkC),
    ring: canvasTexture(ringC),
    bar: canvasTexture(barC),
    halo: canvasTexture(haloC),
    chip: canvasTexture(chipC),
    hintDot: canvasTexture(hintDotC),
    hintRing: canvasTexture(hintRingC),
    hintPromo: canvasTexture(hintPromoC),
  }
}

/** Soft rounded-rectangle shadow for the whole board (CSS px `extent`, scaled by `res`). */
export function drawBoardShadow(extent: number, res: number): HTMLCanvasElement {
  const blur = extent * 0.05
  const size = (extent + blur * 4) * res
  const c = canvas(size, size)
  const g = ctx2d(c)
  const far = size * 4
  g.shadowColor = 'rgba(0,0,0,0.62)'
  g.shadowBlur = blur * res
  g.shadowOffsetX = far
  g.fillStyle = '#000'
  const o = blur * 2 * res
  const e = extent * res
  const r = extent * 0.02 * res
  g.beginPath()
  g.roundRect(o - far, o, e, e, r)
  g.fill()
  return c
}

/**
 * Screen-space lighting over the board in one texture (drawn with normal
 * blending): a soft vignette plus a warm highlight from the upper left. The
 * whole texture is the board's footprint and is clipped to its rounded
 * outline (`radius` is the corner radius as a fraction of the side), so no
 * light spills past the frame.
 */
export function drawLighting(size: number, radius: number): HTMLCanvasElement {
  const c = canvas(size, size)
  const g = ctx2d(c)
  g.beginPath()
  g.roundRect(0, 0, size, size, size * radius)
  g.clip()
  const v = g.createRadialGradient(
    size * 0.45,
    size * 0.42,
    size * 0.3,
    size * 0.5,
    size * 0.5,
    size * 0.78,
  )
  v.addColorStop(0, 'rgba(10,6,4,0)')
  v.addColorStop(0.7, 'rgba(10,6,4,0.12)')
  v.addColorStop(1, 'rgba(10,6,4,0.34)')
  g.fillStyle = v
  g.fillRect(0, 0, size, size)
  const l = g.createRadialGradient(
    size * 0.25,
    size * 0.18,
    0,
    size * 0.25,
    size * 0.18,
    size * 0.85,
  )
  l.addColorStop(0, 'rgba(255,238,205,0.09)')
  l.addColorStop(0.5, 'rgba(255,232,195,0.04)')
  l.addColorStop(1, 'rgba(255,232,195,0)')
  g.fillStyle = l
  g.fillRect(0, 0, size, size)
  return c
}
