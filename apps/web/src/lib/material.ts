import type { Piece, PieceKind, Seat } from '@game/rules'

/**
 * Pieces each seat has lost, read from two engine snapshots' boards (the starting position
 * and the current one). Display only: this counts what the engine reports and decides no
 * rules. The point values below are the usual chess shorthand for a material count, not
 * game rules.
 */
export const MATERIAL_VALUE: Record<Exclude<PieceKind, 'king'>, number> = {
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
}

/** Display order of lost pieces: most valuable first. */
export const LOST_ORDER = ['queen', 'rook', 'bishop', 'knight', 'pawn'] as const

export type LostKind = (typeof LOST_ORDER)[number]

export interface SeatMaterial {
  /** Lost pieces per kind (leaders are left out: losing one ends the seat's game). */
  lost: Record<LostKind, number>
  /** Sum of the lost pieces' values. */
  points: number
}

const SEAT_ORDER: readonly Seat[] = ['south', 'west', 'north', 'east']

function count(board: readonly (Piece | null)[]): Map<Seat, Map<PieceKind, number>> {
  const out = new Map<Seat, Map<PieceKind, number>>()
  for (const p of board) {
    if (!p) continue
    let m = out.get(p.owner)
    if (!m) {
      m = new Map()
      out.set(p.owner, m)
    }
    m.set(p.kind, (m.get(p.kind) ?? 0) + 1)
  }
  return out
}

/**
 * Per seat (South, West, North, East): pieces lost since the start. A promoted pawn shows up
 * as a surplus of its new kind, so that surplus is taken off the lost pawns.
 */
export function lostMaterial(
  startBoard: readonly (Piece | null)[],
  board: readonly (Piece | null)[],
): SeatMaterial[] {
  const start = count(startBoard)
  const now = count(board)
  return SEAT_ORDER.map((seat) => {
    const s = start.get(seat) ?? new Map<PieceKind, number>()
    const c = now.get(seat) ?? new Map<PieceKind, number>()
    const lost: Record<LostKind, number> = { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 }
    let promoted = 0
    for (const kind of LOST_ORDER) {
      if (kind === 'pawn') continue
      const diff = (s.get(kind) ?? 0) - (c.get(kind) ?? 0)
      if (diff > 0) lost[kind] = diff
      else promoted += -diff
    }
    lost.pawn = Math.max(0, (s.get('pawn') ?? 0) - (c.get('pawn') ?? 0) - promoted)
    const points = LOST_ORDER.reduce((sum, k) => sum + lost[k] * MATERIAL_VALUE[k], 0)
    return { lost, points }
  })
}
