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

/** A bot's name on its nameplate: "Bot 1200", or "Bot Max" at full strength. */
export function botName(level: string): string {
  return `Bot ${level === 'max' ? 'Max' : level}`
}

/**
 * Which seat index sits on each side of the table for a viewer in seat `viewer` (the board
 * turns the same way in the game): the viewer at the bottom, then clockwise in turn order.
 * Spectators (no seat) see South at the bottom.
 */
export function seatsAround(viewer: number): {
  bottom: number
  left: number
  top: number
  right: number
} {
  const v = viewer >= 0 ? viewer % 4 : 0
  return { bottom: v, left: (v + 1) % 4, top: (v + 2) % 4, right: (v + 3) % 4 }
}
