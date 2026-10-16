import { SEAT_STYLES } from '@game/board'
import { seatName } from './labels.ts'

export * from './labels.ts'

/** The seat's piece colour (shared with the board renderer). */
export function seatHex(index: number): string {
  return SEAT_STYLES[seatName(index)].base
}

export function seatColorName(index: number): string {
  return SEAT_STYLES[seatName(index)].name
}
