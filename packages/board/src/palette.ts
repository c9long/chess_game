import type { Seat } from '@game/rules'
import { mixHex, shadeHex } from './color.ts'
import type { TrimShading } from './svg.ts'

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
  /** The pieces' brass trim, where the plain brass (`PIECE_TRIM.normal`) won't stand out. */
  readonly trim?: TrimShading
  /** The enamel banner and turn glow, where the base colour won't do (default: the base). */
  readonly band?: string
  /** Relative outline weight of the pieces (default 1): heavier for seats light on maple. */
  readonly outlineWeight?: number
}

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond'

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
 * The brass trim on every piece (its collar ring, the king's cross and the queen's finial),
 * lit / base / shadowed side: the app's brass on live pieces, a paler, polished brass on the
 * Gold seat (the plain brass would vanish into its ochre body) and a dulled, cooler brass on
 * frozen pieces.
 */
export const PIECE_TRIM = {
  normal: { light: '#f3dc9c', base: BOARD_MATERIALS.brass, dark: '#7a5d2c' },
  gold: { light: '#fff7e2', base: '#eadcb4', dark: '#9c8352' },
  frozen: { light: '#c8c6b8', base: '#9c9580', dark: '#5d5a50' },
} as const satisfies Record<string, TrimShading>

/**
 * The seats. Gold gets the paler trim and a brighter banner (so it reads as gold, not ochre,
 * next to the brass hairlines); the light seats (Gold, Jade) a heavier outline so they hold
 * their silhouette on light maple.
 */
export const SEAT_STYLES: Readonly<Record<Seat, SeatStyle>> = {
  south: { name: 'Crimson', base: '#c42f3c', marker: 'circle' },
  west: { name: 'Azure', base: '#2a66d6', marker: 'square' },
  north: {
    name: 'Gold',
    base: '#d9a21e',
    marker: 'triangle',
    trim: PIECE_TRIM.gold,
    band: '#e6b02a',
    outlineWeight: 1.3,
  },
  east: { name: 'Jade', base: '#2fa98d', marker: 'diamond', outlineWeight: 1.3 },
}

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

/** The brass trim tones for a seat's live pieces. */
export function trimFor(seat: Seat): TrimShading {
  return SEAT_STYLES[seat].trim ?? PIECE_TRIM.normal
}

/** Colour of a seat's enamel banner and turn glow. */
export function bandColor(seat: Seat): string {
  return SEAT_STYLES[seat].band ?? SEAT_STYLES[seat].base
}

/**
 * Extra brightness for a seat's frame band (1 = none). The banner is flat enamel now, so no
 * seat needs lifting; kept for callers that scale a band colour.
 */
export function bandGain(_seat: Seat): number {
  return 1
}

/** Relative outline weight for a seat's pieces (frozen pieces keep the drawn weight). */
export function outlineWeight(seat: Seat | 'frozen'): number {
  return seat === 'frozen' ? 1 : (SEAT_STYLES[seat].outlineWeight ?? 1)
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
