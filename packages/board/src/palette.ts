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
 * Board materials (the shader's base colours). The squares are a pale, low-chroma maple and a
 * dark, greyed walnut: every seat colour sits well apart from both in lightness or hue, so the
 * pieces stay the strongest shapes even on 20 px squares (palette.test.ts checks the margins).
 * The frame is a deeper walnut than the dark squares, divided from them by a brass inlay line.
 */
export const BOARD_MATERIALS = {
  light: '#eadcc0',
  dark: '#654d3c',
  frame: '#4a3425',
  brass: '#c9a55a',
} as const

/**
 * Board-wide highlight colours, shared with the app's tokens: gold for the selected piece (the
 * same gold that marks "to move"), parchment for drop targets, and the danger vermilion that
 * only the check warning uses.
 */
export const HIGHLIGHT = {
  gold: '#e6b42a',
  lastMove: '#e9c76b',
  parchment: '#f4efe6',
  danger: '#ff5a1f',
  dangerLight: '#ffd2b8',
  illegal: '#e0553f',
} as const

/**
 * Body colour of frozen pieces: a cool slate that sits between the light and
 * dark square shades, so frozen armies stay readable on both.
 */
export const FROZEN_BASE = '#7f858e'

/** Outline colour of frozen pieces. */
export const FROZEN_OUTLINE = '#24272c'

/**
 * Colour of a seat's enamel banner and turn glow. Usually the base colour; Gold uses a
 * slightly brighter tone so it reads as gold, not ochre, next to the brass hairlines.
 */
export function bandColor(seat: Seat): string {
  return seat === 'north' ? '#e6b02a' : SEAT_STYLES[seat].base
}

/**
 * Extra brightness for a seat's frame band (1 = none). The banner is flat enamel now, so no
 * seat needs lifting; kept for callers that scale a band colour.
 */
export function bandGain(_seat: Seat): number {
  return 1
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
