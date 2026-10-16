import { lightFor, SEAT_STYLES } from '@game/board'
import { seatName } from './labels.ts'

export * from './labels.ts'

/** The seat's piece colour (shared with the board renderer). */
export function seatHex(index: number): string {
  return SEAT_STYLES[seatName(index)].base
}

/**
 * The seat's colour for text on the dark panels: a lighter tint of `seatHex`, since the piece
 * colours themselves (Crimson, Azure) are too dark to read as small text (WCAG AA 4.5:1).
 */
export function seatTextHex(index: number): string {
  return lightFor(seatHex(index))
}

export function seatColorName(index: number): string {
  return SEAT_STYLES[seatName(index)].name
}
