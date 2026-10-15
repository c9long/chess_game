import type { Seat } from '@game/rules'

/**
 * Board geometry for the renderer: pure coordinate math, no rules.
 *
 * Three frames are used:
 * - **board**: `index = rank * 12 + file` (a1 = 0), as in snapshots;
 * - **south frame**: the board as South sees it (file a on the left, rank 1 at
 *   the bottom). The renderer draws everything in this frame and rotates the
 *   whole board container to show another seat's perspective;
 * - **view**: what the viewer sees on screen, `col` 0 = left, `row` 0 = top,
 *   with the perspective seat's home edge at the bottom.
 */

export const BOARD_SIZE = 12
export const NUM_SQUARES = 144

const SEAT_ORDER: readonly Seat[] = ['south', 'west', 'north', 'east']

/** Index of a seat in turn order (S, W, N, E). */
export function seatOrder(seat: Seat): number {
  return SEAT_ORDER.indexOf(seat)
}

/**
 * Quarter turns (clockwise on screen) applied to the south-frame board so that
 * `perspective`'s home edge is at the bottom: S 0, E 1, N 2, W 3.
 */
export function quarterTurns(perspective: Seat): number {
  switch (perspective) {
    case 'south':
      return 0
    case 'east':
      return 1
    case 'north':
      return 2
    case 'west':
      return 3
  }
}

/** Board rotation in radians (clockwise on screen, y down) for a perspective. */
export function perspectiveAngle(perspective: Seat): number {
  return (quarterTurns(perspective) * Math.PI) / 2
}

/**
 * The angle to animate to when switching perspective: the target angle
 * equivalent to `perspectiveAngle(to)` that is nearest to `current`, so the
 * board turns by at most 180 degrees.
 */
export function nearestAngle(current: number, to: Seat): number {
  const target = perspectiveAngle(to)
  const turn = Math.PI * 2
  const k = Math.round((current - target) / turn)
  return target + k * turn
}

export interface ViewCell {
  /** 0 = left column on screen. */
  readonly col: number
  /** 0 = top row on screen. */
  readonly row: number
}

/** Screen cell of a board square for a perspective. */
export function squareToView(index: number, perspective: Seat): ViewCell {
  const file = index % BOARD_SIZE
  const rank = Math.floor(index / BOARD_SIZE)
  const max = BOARD_SIZE - 1
  switch (perspective) {
    case 'south':
      return { col: file, row: max - rank }
    case 'north':
      return { col: max - file, row: rank }
    case 'west':
      return { col: max - rank, row: max - file }
    case 'east':
      return { col: rank, row: file }
  }
}

/** Board square at a screen cell for a perspective (inverse of `squareToView`); -1 if off board. */
export function viewToSquare(col: number, row: number, perspective: Seat): number {
  const max = BOARD_SIZE - 1
  if (col < 0 || col > max || row < 0 || row > max) return -1
  let file: number
  let rank: number
  switch (perspective) {
    case 'south':
      file = col
      rank = max - row
      break
    case 'north':
      file = max - col
      rank = row
      break
    case 'west':
      file = max - row
      rank = max - col
      break
    case 'east':
      file = row
      rank = col
      break
  }
  return rank * BOARD_SIZE + file
}

/**
 * Where a seat sits relative to the viewer: 0 bottom, 1 left, 2 top, 3 right.
 * Turn order is clockwise, so the next seat is on the viewer's left.
 */
export function relativeSeat(seat: Seat, perspective: Seat): number {
  return (seatOrder(seat) - seatOrder(perspective) + 4) % 4
}

/** Whether a square is dark (a1 is dark). */
export function isDarkSquare(index: number): boolean {
  return ((index % BOARD_SIZE) + Math.floor(index / BOARD_SIZE)) % 2 === 0
}

/** Pixel layout of the board in the south frame, origin at the board centre. */
export interface BoardLayout {
  /** Side of one square, CSS px. */
  readonly square: number
  /** Width of the frame around the 12x12 field, CSS px. */
  readonly frame: number
}

/** Field size (12 squares) plus the frame on both sides. */
export function boardExtent(layout: BoardLayout): number {
  return layout.square * BOARD_SIZE + layout.frame * 2
}

/** Centre of a square in the south frame (origin at the board centre), written into `out`. */
export function squareCenter(
  index: number,
  layout: BoardLayout,
  out: { x: number; y: number },
): { x: number; y: number } {
  const half = (layout.square * BOARD_SIZE) / 2
  const file = index % BOARD_SIZE
  const rank = Math.floor(index / BOARD_SIZE)
  out.x = (file + 0.5) * layout.square - half
  out.y = (BOARD_SIZE - 1 - rank + 0.5) * layout.square - half
  return out
}

/** Square under a south-frame point (origin at the board centre); -1 when outside the field. */
export function pointToSquare(x: number, y: number, layout: BoardLayout): number {
  const half = (layout.square * BOARD_SIZE) / 2
  const file = Math.floor((x + half) / layout.square)
  const row = Math.floor((y + half) / layout.square)
  if (file < 0 || file >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return -1
  return (BOARD_SIZE - 1 - row) * BOARD_SIZE + file
}

/** Rotates a vector by `angle` (radians, clockwise on screen), written into `out`. */
export function rotateVector(
  x: number,
  y: number,
  angle: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  out.x = x * c - y * s
  out.y = x * s + y * c
  return out
}

/**
 * Moves a view cursor one step on screen and returns the new square, clamped
 * to the board. `dx`/`dy` are screen directions (+x right, +y down).
 */
export function stepCursor(index: number, dx: number, dy: number, perspective: Seat): number {
  const cell = squareToView(index, perspective)
  const col = Math.min(BOARD_SIZE - 1, Math.max(0, cell.col + dx))
  const row = Math.min(BOARD_SIZE - 1, Math.max(0, cell.row + dy))
  return viewToSquare(col, row, perspective)
}

const FILE_LETTERS = 'abcdefghijkl'

/** Square name ('a1'..'l12') of an index. */
export function nameOf(index: number): string {
  return `${FILE_LETTERS[index % BOARD_SIZE]}${Math.floor(index / BOARD_SIZE) + 1}`
}

/** Index of a square name; -1 if invalid. */
export function indexOf(name: string): number {
  const file = FILE_LETTERS.indexOf(name[0] ?? '')
  const rank = Number(name.slice(1)) - 1
  if (file < 0 || !Number.isInteger(rank) || rank < 0 || rank >= BOARD_SIZE) return -1
  return rank * BOARD_SIZE + file
}

/** File letter of a file index 0..11. */
export function fileLetter(file: number): string {
  return FILE_LETTERS[file] ?? '?'
}
