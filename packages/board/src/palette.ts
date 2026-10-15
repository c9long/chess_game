import type { Seat } from '@game/rules'
import { mixHex, shadeHex } from './color.ts'

/**
 * Seat colours. Neutral game colours (never national colours, PLAN §2), chosen
 * so every pair stays distinguishable under protanopia, deuteranopia and
 * tritanopia: the set spreads across lightness as well as hue, so a lost
 * colour axis still leaves a lightness difference (palette.test.ts checks a
 * minimum OKLab distance for every pair under each simulated deficiency).
 * Pieces can additionally carry a per-seat shape marker (`SEAT_MARKERS`).
 */
export interface SeatStyle {
  /** Display name of the colour. */
  readonly name: string
  /** Main body colour of the seat's pieces and frame band. */
  readonly base: string
  /** Shape drawn on pieces when colour-blind markers are on. */
  readonly marker: MarkerShape
}

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond'

export const SEAT_STYLES: Readonly<Record<Seat, SeatStyle>> = {
  south: { name: 'Crimson', base: '#c42f3c', marker: 'circle' },
  west: { name: 'Azure', base: '#2a66d6', marker: 'square' },
  north: { name: 'Gold', base: '#d9a21e', marker: 'triangle' },
  east: { name: 'Jade', base: '#2fa98d', marker: 'diamond' },
}

/**
 * Body colour of frozen pieces: a cool slate that sits between the light and
 * dark square shades, so frozen armies stay readable on both.
 */
export const FROZEN_BASE = '#7f858e'

/** Outline colour of frozen pieces. */
export const FROZEN_OUTLINE = '#24272c'

/**
 * Colour of a seat's frame band and turn glow. Usually the base colour; Gold
 * uses its brighter metallic tone, since the band's dye darkens it to khaki.
 */
export function bandColor(seat: Seat): string {
  return seat === 'north' ? '#f0c242' : SEAT_STYLES[seat].base
}

/**
 * Extra brightness for a seat's frame band dye (1 = none). Gold needs more
 * lift than the darker hues to read as gold rather than olive.
 */
export function bandGain(seat: Seat): number {
  return seat === 'north' ? 1.6 : 1
}

/**
 * Relative outline weight for a seat's pieces. The light seats (Gold, Jade)
 * get a heavier outline so they hold their silhouette on light maple.
 */
export function outlineWeight(seat: Seat | 'frozen'): number {
  return seat === 'north' || seat === 'east' ? 1.3 : 1
}

/** Seat colour as a hex string. */
export function seatColor(seat: Seat): string {
  return SEAT_STYLES[seat].base
}

/** Near-black outline colour for a body colour: a deep shade of the same hue. */
export function outlineFor(base: string): string {
  return mixHex(shadeHex(base, 0.22), '#120d0a', 0.55)
}

/** Lighter variant for highlights and emblem glyphs. */
export function lightFor(base: string): string {
  return mixHex(base, '#ffffff', 0.38)
}
