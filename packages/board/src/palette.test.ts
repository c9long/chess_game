import type { Seat } from '@game/rules'
import { describe, expect, it } from 'vitest'
import { hexToRgb, perceivedDistance, srgbToLinear, VISION_TYPES } from './color.ts'
import {
  BOARD_MATERIALS,
  FROZEN_BASE,
  HIGHLIGHT,
  PIECE_TRIM,
  SEAT_STYLES,
  trimFor,
} from './palette.ts'

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = srgbToLinear(hexToRgb(hex))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Square base colours from the board shader (BoardView uniforms). */
const MAPLE = BOARD_MATERIALS.light
const WALNUT = BOARD_MATERIALS.dark

const SEATS: Seat[] = ['south', 'west', 'north', 'east']

describe('seat palette', () => {
  it('keeps every pair of seat colours apart under common colour-vision deficiencies', () => {
    for (const type of VISION_TYPES) {
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const a = SEAT_STYLES[SEATS[i] as Seat].base
          const b = SEAT_STYLES[SEATS[j] as Seat].base
          // OKLab distance; ~0.1 is a clearly visible difference at piece size.
          expect(perceivedDistance(a, b, type), `${type} ${a} vs ${b}`).toBeGreaterThan(0.12)
        }
      }
    }
  })

  it('keeps frozen grey distinct from every seat colour', () => {
    for (const seat of SEATS) {
      expect(perceivedDistance(SEAT_STYLES[seat].base, FROZEN_BASE)).toBeGreaterThan(0.1)
    }
  })

  it('keeps piece bodies readable on light maple squares', () => {
    for (const seat of SEATS) {
      const base = SEAT_STYLES[seat].base
      expect(contrast(base, MAPLE), `${seat} on maple`).toBeGreaterThan(1.35)
    }
  })

  it('keeps piece bodies apart from dark walnut squares', () => {
    for (const seat of [...SEATS.map((s) => SEAT_STYLES[s].base), FROZEN_BASE]) {
      // Normal vision: clearly apart in hue or lightness (OKLab).
      expect(perceivedDistance(seat, WALNUT), `${seat} on walnut`).toBeGreaterThan(0.15)
    }
  })

  it('separates the frame from the dark squares', () => {
    expect(contrast(BOARD_MATERIALS.dark, BOARD_MATERIALS.frame)).toBeGreaterThan(1.25)
  })

  it('puts frozen grey between the two square shades', () => {
    expect(contrast(FROZEN_BASE, MAPLE)).toBeGreaterThan(1.8)
    expect(contrast(FROZEN_BASE, WALNUT)).toBeGreaterThan(1.4)
  })

  it('gives every seat its own marker shape', () => {
    expect(new Set(SEATS.map((s) => SEAT_STYLES[s].marker)).size).toBe(4)
  })
})

describe('highlights', () => {
  it('gives the premove a colour of its own', () => {
    const others = [
      ...SEATS.map((s) => SEAT_STYLES[s].base),
      HIGHLIGHT.gold,
      HIGHLIGHT.lastMove,
      HIGHLIGHT.danger,
      HIGHLIGHT.parchment,
      BOARD_MATERIALS.brass,
    ]
    for (const c of others) {
      expect(perceivedDistance(HIGHLIGHT.premove, c), c).toBeGreaterThan(0.2)
      // The corner brackets carry it too, so a smaller margin will do under a deficiency.
      for (const type of VISION_TYPES) {
        expect(perceivedDistance(HIGHLIGHT.premove, c, type), `${type} ${c}`).toBeGreaterThan(0.08)
      }
    }
  })
})

describe('piece trim', () => {
  const chroma = (hex: string) => {
    const [r, g, b] = hexToRgb(hex)
    return Math.max(r, g, b) - Math.min(r, g, b)
  }
  it('stands apart from every seat body, not melting into it', () => {
    for (const seat of SEATS) {
      const trim = trimFor(seat).base
      expect(perceivedDistance(trim, SEAT_STYLES[seat].base), seat).toBeGreaterThan(0.15)
    }
    // Gold needs its own, paler brass: the plain one is the same tone as its body.
    expect(contrast(trimFor('north').base, SEAT_STYLES.north.base)).toBeGreaterThan(1.5)
  })
  it('is dulled when frozen, and each tone set runs light to dark', () => {
    expect(chroma(PIECE_TRIM.frozen.base)).toBeLessThan(chroma(PIECE_TRIM.normal.base) * 0.6)
    for (const t of Object.values(PIECE_TRIM)) {
      expect(luminance(t.light)).toBeGreaterThan(luminance(t.base))
      expect(luminance(t.base)).toBeGreaterThan(luminance(t.dark))
    }
  })
})
