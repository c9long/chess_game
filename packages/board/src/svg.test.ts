import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PIECE_TRIM } from './palette.ts'
import {
  DETAIL_TOKEN,
  flatPieceSvg,
  pieceSilhouetteSvg,
  shadePieceSvg,
  TRIM_TOKEN,
  tintEmblemSvg,
} from './svg.ts'

const KINDS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn', 'prime-minister']
const piece = (k: string) =>
  readFileSync(new URL(`../../assets/pieces/${k}.svg`, import.meta.url), 'utf8')

const shading = {
  base: '#c42f3c',
  light: '#e08a8f',
  dark: '#85202a',
  deep: '#58151c',
  outline: '#1d0c0b',
  trim: PIECE_TRIM.normal,
}

describe('piece SVG contract', () => {
  it('has body, trim and detail groups in that order, each token once', () => {
    for (const k of KINDS) {
      const svg = piece(k)
      const body = svg.indexOf('<g id="body" fill="currentColor">')
      const trim = svg.indexOf(`<g id="trim" fill="${TRIM_TOKEN}">`)
      const detail = svg.indexOf(`<g id="detail" fill="${DETAIL_TOKEN}">`)
      expect(body, k).toBeGreaterThan(0)
      expect(trim, k).toBeGreaterThan(body)
      expect(detail, k).toBeGreaterThan(trim)
      for (const token of ['currentColor', TRIM_TOKEN, DETAIL_TOKEN]) {
        expect(svg.split(token).length - 1, `${k} ${token}`).toBe(1)
      }
      expect(svg, k).toMatch(/<title>[^<]+<\/title>/)
      expect(svg, k).not.toMatch(/stroke|<style|<text|Gradient|<image|<use|filter|mask/)
    }
  })
})

describe('piece SVG shading', () => {
  it('lights every piece without leaving contract tokens behind', () => {
    for (const k of KINDS) {
      const out = shadePieceSvg(piece(k), shading)
      expect(out).not.toContain('currentColor')
      expect(out).not.toContain(DETAIL_TOKEN)
      expect(out).not.toContain(TRIM_TOKEN)
      expect(out).toContain('fill="url(#pz-side)"')
      expect(out).toContain('fill="url(#pz-sheen)"')
      expect(out).toContain('<g id="trim" fill="url(#pz-brass)">')
      expect(out).toContain(`stop-color="${PIECE_TRIM.normal.light}"`)
      expect(out).toContain(`fill="${shading.outline}"`)
      expect(out.indexOf('<defs>')).toBeGreaterThan(out.indexOf('<svg'))
    }
  })

  it('takes the trim tones from the shading (dulled for frozen pieces)', () => {
    const out = shadePieceSvg(piece('king'), { ...shading, trim: PIECE_TRIM.frozen })
    expect(out).toContain(`stop-color="${PIECE_TRIM.frozen.base}"`)
    expect(out).not.toContain(`stop-color="${PIECE_TRIM.normal.base}"`)
  })

  it('thickens the outline with a stroke when asked', () => {
    const out = shadePieceSvg(piece('pawn'), { ...shading, outlineBoost: 1.1 })
    expect(out).toContain(`stroke="${shading.outline}" stroke-width="1.1"`)
    expect(shadePieceSvg(piece('pawn'), shading)).not.toContain('stroke=')
  })

  it('rejects SVGs that break the contract', () => {
    expect(() => shadePieceSvg('<svg><path/></svg>', shading)).toThrow(/contract/)
    const noTrim = piece('pawn').replace(/<g id="trim"[\s\S]*?<\/g>/, '')
    expect(() => shadePieceSvg(noTrim, shading)).toThrow(/contract/)
  })

  it('recolours flat (trim follows the body unless given) and makes silhouettes', () => {
    const flat = flatPieceSvg(piece('rook'), '#111111', '#222222')
    expect(flat).toContain('fill="#111111"><path')
    expect(flat.split('fill="#111111"').length - 1).toBe(2)
    expect(flatPieceSvg(piece('rook'), '#111111', '#222222', '#333333')).toContain(
      '<g id="trim" fill="#333333">',
    )
    const sil = pieceSilhouetteSvg(piece('queen'))
    expect(sil).not.toContain('<title>')
    expect(sil).not.toContain(TRIM_TOKEN)
    expect(sil).not.toContain(DETAIL_TOKEN)
    expect(sil).toContain('fill="currentColor"')
  })

  it('tints emblems', () => {
    expect(tintEmblemSvg('<svg fill="currentColor"/>', '#fff')).toBe('<svg fill="#fff"/>')
  })
})
