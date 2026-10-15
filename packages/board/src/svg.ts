/**
 * SVG string preparation for rasterising (pure string work, no DOM).
 *
 * The piece files follow the two-tone contract in packages/assets/pieces:
 * a `body` group filled with the literal `currentColor` and a `detail` group
 * filled with the literal `#1a1612`, each token appearing exactly once.
 */

export const BODY_TOKEN = 'currentColor'
export const DETAIL_TOKEN = '#1a1612'

export interface PieceShading {
  /** Body base colour. */
  readonly base: string
  /** Lit side of the body. */
  readonly light: string
  /** Shadowed side of the body. */
  readonly dark: string
  /** Deepest shade at the silhouette edge. */
  readonly deep: string
  /** Outline / interior line colour (replaces the detail token). */
  readonly outline: string
  /**
   * Extra outline thickness in SVG units (viewBox 256), added as a stroke on
   * the detail shapes. 0 or absent keeps the drawn weight (about 3.5 units).
   */
  readonly outlineBoost?: number
}

const BODY_GROUP = /<g id="body" fill="currentColor">([\s\S]*?)<\/g>/

/**
 * Turns a two-tone piece SVG into a lit one: the body gets a turned-wood style
 * horizontal gradient (light from the upper left) plus a vertical sheen, and
 * the outline takes `shading.outline`. Throws if the file breaks the contract.
 */
export function shadePieceSvg(svg: string, shading: PieceShading): string {
  const body = BODY_GROUP.exec(svg)
  if (!body || !svg.includes(`fill="${DETAIL_TOKEN}"`)) {
    throw new Error('piece SVG does not follow the two-tone contract')
  }
  const inner = body[1] ?? ''
  const defs =
    '<defs>' +
    '<linearGradient id="pz-side" x1="0" y1="0" x2="1" y2="0">' +
    `<stop offset="0" stop-color="${shading.dark}"/>` +
    `<stop offset="0.2" stop-color="${shading.base}"/>` +
    `<stop offset="0.38" stop-color="${shading.light}"/>` +
    `<stop offset="0.55" stop-color="${shading.base}"/>` +
    `<stop offset="0.72" stop-color="${shading.dark}"/>` +
    `<stop offset="0.88" stop-color="${shading.deep}"/>` +
    `<stop offset="1" stop-color="${shading.deep}"/>` +
    '</linearGradient>' +
    '<linearGradient id="pz-sheen" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>' +
    '<stop offset="0.4" stop-color="#ffffff" stop-opacity="0.04"/>' +
    '<stop offset="0.75" stop-color="#000000" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="#000000" stop-opacity="0.28"/>' +
    '</linearGradient>' +
    '</defs>'
  const litBody = `<g id="body" fill="url(#pz-side)">${inner}</g><g fill="url(#pz-sheen)">${inner}</g>`
  const boost = shading.outlineBoost ?? 0
  const detailAttrs =
    boost > 0
      ? `fill="${shading.outline}" stroke="${shading.outline}" stroke-width="${boost}" stroke-linejoin="round"`
      : `fill="${shading.outline}"`
  return svg
    .replace(BODY_GROUP, litBody)
    .replace(`fill="${DETAIL_TOKEN}"`, detailAttrs)
    .replace(/(<svg[^>]*>)/, `$1${defs}`)
}

/** Flat recolour of a piece (both tokens), e.g. for silhouettes. */
export function flatPieceSvg(svg: string, body: string, detail: string): string {
  return svg.replace(`fill="${BODY_TOKEN}"`, `fill="${body}"`).replace(DETAIL_TOKEN, detail)
}

/** Tints a single-colour emblem SVG (house style: `fill="currentColor"` on the root). */
export function tintEmblemSvg(svg: string, color: string): string {
  return svg.replaceAll(BODY_TOKEN, color)
}

/** A data: URL for an SVG string. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
