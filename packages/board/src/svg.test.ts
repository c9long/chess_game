import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shadePieceSvg, tintEmblemSvg } from './svg.ts'

const piece = (k: string) =>
  readFileSync(new URL(`../../assets/pieces/${k}.svg`, import.meta.url), 'utf8')

const shading = {
  base: '#c42f3c',
  light: '#e08a8f',
  dark: '#85202a',
  deep: '#58151c',
  outline: '#1d0c0b',
}

describe('piece SVG shading', () => {
  it('lights every piece without leaving contract tokens behind', () => {
    for (const k of ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']) {
      const out = shadePieceSvg(piece(k), shading)
      expect(out).not.toContain('currentColor')
      expect(out).not.toContain('#1a1612')
      expect(out).toContain('fill="url(#pz-side)"')
      expect(out).toContain('fill="url(#pz-sheen)"')
      expect(out).toContain(`fill="${shading.outline}"`)
      expect(out.indexOf('<defs>')).toBeGreaterThan(out.indexOf('<svg'))
    }
  })

  it('thickens the outline with a stroke when asked', () => {
    const out = shadePieceSvg(piece('pawn'), { ...shading, outlineBoost: 1.1 })
    expect(out).toContain(`stroke="${shading.outline}" stroke-width="1.1"`)
    expect(shadePieceSvg(piece('pawn'), shading)).not.toContain('stroke=')
  })

  it('rejects SVGs that break the two-tone contract', () => {
    expect(() => shadePieceSvg('<svg><path/></svg>', shading)).toThrow(/two-tone/)
  })

  it('tints emblems', () => {
    expect(tintEmblemSvg('<svg fill="currentColor"/>', '#fff')).toBe('<svg fill="#fff"/>')
  })
})
