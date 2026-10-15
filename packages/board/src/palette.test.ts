import type { Seat } from '@game/rules'
import { describe, expect, it } from 'vitest'
import { hexToRgb, perceivedDistance, srgbToLinear, VISION_TYPES } from './color.ts'
import { FROZEN_BASE, SEAT_STYLES } from './palette.ts'

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
const MAPLE = '#e2c89a'
const WALNUT = '#8c5633'

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

  it('puts frozen grey between the two square shades', () => {
    expect(contrast(FROZEN_BASE, MAPLE)).toBeGreaterThan(1.8)
    expect(contrast(FROZEN_BASE, WALNUT)).toBeGreaterThan(1.4)
  })

  it('gives every seat its own marker shape', () => {
    expect(new Set(SEATS.map((s) => SEAT_STYLES[s].marker)).size).toBe(4)
  })
})
