import type { Seat } from '@game/rules'

/**
 * Board geometry for the renderer: pure coordinate math, no rules.
 *
 * Three frames are used:
 * - **board**: `index = rank * 16 + file` (a1 = 0), as in snapshots;
 * - **south frame**: the board as South sees it (file a on the left, rank 1 at
 *   the bottom). The renderer draws everything in this frame and rotates the
 *   whole board container to show another seat's perspective;
 * - **view**: what the viewer sees on screen, `col` 0 = left, `row` 0 = top,
 *   with the perspective seat's home edge at the bottom.
 */

/** Squares per side (16×16 board, rules version 2; same as `BOARD_SIZE` in @game/rules). */
export const BOARD_SIZE = 16
export const NUM_SQUARES = BOARD_SIZE * BOARD_SIZE

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

/**
 * The walnut frame round the field and the transparent margin outside it, in squares. The margin
 * only has to clear the medallions, which overhang the frame by about 0.36 squares at their
 * largest (kept tight: on the 16×16 board every pixel of a phone's width goes to the squares).
 */
export const BOARD_FRAME = 0.66
export const BOARD_MARGIN = 0.42
/**
 * The canvas's transparent margin as a fraction of its width, before rounding: a first guess for
 * page layouts that line up with the frame, until the board reports where it is (`frameInset`).
 */
export const BOARD_CANVAS_MARGIN = BOARD_MARGIN / (BOARD_SIZE + 2 * (BOARD_FRAME + BOARD_MARGIN))

/** Pixel layout of the board in the south frame, origin at the board centre. */
export interface BoardLayout {
  /** Side of one square, CSS px. */
  readonly square: number
  /** Width of the frame around the field, CSS px. */
  readonly frame: number
}

/** The layout for a given square size: the frame rounded to whole device pixels (`res` per px). */
export function layoutForSquare(square: number, res: number): BoardLayout {
  return { square, frame: Math.round(square * BOARD_FRAME * res) / res }
}

/**
 * The layout that fits a canvas `side` px across (its shorter side) at `res` device pixels per
 * px: the largest square of whole device pixels whose board and margin fit.
 */
export function fitLayout(side: number, res: number): BoardLayout {
  const units = BOARD_SIZE + 2 * BOARD_FRAME + 2 * BOARD_MARGIN
  return layoutForSquare(Math.max(8, Math.floor((side / units) * res) / res), res)
}

/**
 * How far in from the edge of a canvas `side` px across (its shorter side) the frame's outer edge
 * sits, px, with `layout` centred at rest (no zoom). The board is never scaled up, so rounding
 * the squares down leaves the frame further in than `BOARD_CANVAS_MARGIN` says (scaled down
 * only when the frame's rounding would push the margin past the canvas).
 */
export function frameInset(layout: BoardLayout, side: number, res: number): number {
  const extent = boardExtent(layout)
  const scale = Math.min(1, side / (extent + 2 * BOARD_MARGIN * layout.square))
  return Math.round((side / 2) * res) / res - (extent * scale) / 2
}

/** Field size (`BOARD_SIZE` squares) plus the frame on both sides. */
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

/**
 * The legal target a slightly-off tap meant: the target whose centre is nearest to the
 * point (board-local, south frame) and within `slop`, or -1. An almost even tie between two
 * targets is ambiguous and also gives -1, so a tap between them never guesses.
 */
export function nearestTarget(
  x: number,
  y: number,
  targets: readonly number[],
  layout: BoardLayout,
  slop: number,
): number {
  const c = { x: 0, y: 0 }
  let best = -1
  let bd = Number.POSITIVE_INFINITY
  let second = Number.POSITIVE_INFINITY
  for (const t of targets) {
    squareCenter(t, layout, c)
    const d = Math.hypot(c.x - x, c.y - y)
    if (d < bd) {
      second = bd
      bd = d
      best = t
    } else if (d < second) {
      second = d
    }
  }
  if (best < 0 || bd > slop) return -1
  if (second <= slop && second - bd < layout.square * 0.15) return -1
  return best
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

const FILE_LETTERS = 'abcdefghijklmnop'

/** Square name ('a1'..'p16') of an index. */
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

/** File letter of a file index 0..15. */
export function fileLetter(file: number): string {
  return FILE_LETTERS[file] ?? '?'
}

/**
 * Peak hop offset of a flight, in board-local units, written to `out`. The
 * board is drawn rotated by `angle`; (dx, dy) is the board-local path.
 * Screen-up by default (a knight's jump). With `aside`, the offset is
 * perpendicular to the on-screen path, on its upper side (when the path is
 * exactly vertical: towards the board centre, judged from the board-local path
 * midpoint (mx, my), so a rook by the frame stays on the board), and grows to
 * 2x `size` as the path turns vertical on screen: a screen-up hop along a
 * vertical path would not clear the piece it passes (the castling rook over
 * its leader).
 */
export function hopOffset(
  dx: number,
  dy: number,
  size: number,
  angle: number,
  aside: boolean,
  out: { x: number; y: number },
  mx = 0,
  my = 0,
): { x: number; y: number } {
  const len = Math.hypot(dx, dy)
  if (!aside || len < 1e-6) return rotateVector(0, -size, -angle, out)
  // On-screen direction of the path.
  rotateVector(dx / len, dy / len, angle, out)
  const sx = out.x
  const sy = out.y
  // Screen normal on the upper side; a vertical path goes towards the centre.
  let nx = -sy
  let ny = sx
  const midRight = mx * Math.cos(angle) - my * Math.sin(angle) > 0
  if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx > 0 === midRight)) {
    nx = -nx
    ny = -ny
  }
  const k = size * (1 + Math.abs(sy))
  return rotateVector(nx * k, ny * k, -angle, out)
}
