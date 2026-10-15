import type { GameEvent, Piece, PieceKind, Seat, SeatStatus, Snapshot } from '@game/rules'
import { indexOf, seatOrder } from './geometry.ts'

/**
 * Snapshot diff -> animation plan. Pure: the renderer turns the plan into
 * tweens and effects.
 *
 * The board difference alone is enough for ordinary steps (a move, a castle's
 * two pieces, en passant's off-destination capture, a promotion's kind change,
 * a removed army). When the `applyMove` / `applyTimeout` events are passed,
 * they disambiguate which piece went where; otherwise pieces are matched by
 * owner and kind, nearest first.
 */

export interface PlannedMove {
  readonly from: number
  readonly to: number
  /** The piece as it stood on `from`. */
  readonly piece: Piece
  /** Kind after the move when it promoted, else `null`. */
  readonly promoteTo: PieceKind | null
  /** The rook of a castle (animated after the leader). */
  readonly castleRook: boolean
}

export interface PlannedCapture {
  readonly square: number
  readonly piece: Piece
  /** Whether a moving piece lands on the captured square (false for en passant). */
  readonly onDestination: boolean
}

export interface PlannedVanish {
  readonly square: number
  readonly piece: Piece
}

export interface AnimationPlan {
  /** Pieces that slide, the main move first. */
  readonly moves: readonly PlannedMove[]
  readonly captures: readonly PlannedCapture[]
  /** Pieces dissolving because their army left the board (FFA defeat, Teams game end). */
  readonly dissolves: readonly PlannedVanish[]
  /** Pieces that appear without a source (position jumps). */
  readonly appears: readonly PlannedVanish[]
  /** Seats whose status changed, with the new status. */
  readonly statusChanges: readonly { readonly seat: Seat; readonly status: SeatStatus }[]
  readonly seatToMoveChanged: boolean
  readonly gameEnded: boolean
  /** Whether the step is a small, legal-looking one (a move or status change), not a jump. */
  readonly incremental: boolean
}

const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']

function samePiece(a: Piece | null | undefined, b: Piece | null | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.owner === b.owner
}

function distance(a: number, b: number): number {
  const dx = (a % 12) - (b % 12)
  const dy = Math.floor(a / 12) - Math.floor(b / 12)
  return Math.hypot(dx, dy)
}

/** Builds the plan for going from `prev` to `next`. */
export function planTransition(
  prev: Snapshot,
  next: Snapshot,
  events: readonly GameEvent[] = [],
): AnimationPlan {
  const vanished = new Map<number, Piece>()
  const appeared = new Map<number, Piece>()
  for (let i = 0; i < 144; i++) {
    const a = prev.board[i]
    const b = next.board[i]
    if (samePiece(a, b)) continue
    if (a) vanished.set(i, a)
    if (b) appeared.set(i, b)
  }

  const moves: PlannedMove[] = []
  const captures: PlannedCapture[] = []
  const dissolves: PlannedVanish[] = []
  const appears: PlannedVanish[] = []

  const matchMove = (from: number, to: number, castleRook: boolean): boolean => {
    const piece = vanished.get(from)
    const landed = appeared.get(to)
    if (!piece || !landed || piece.owner !== landed.owner) return false
    vanished.delete(from)
    appeared.delete(to)
    moves.push({
      from,
      to,
      piece,
      promoteTo: landed.kind !== piece.kind ? landed.kind : null,
      castleRook,
    })
    return true
  }

  // 1. Moves named by events.
  const removedByEvent = new Set<Seat>()
  for (const e of events) {
    if (e.type === 'move_made') matchMove(indexOf(e.from), indexOf(e.to), false)
    else if (e.type === 'castle') matchMove(indexOf(e.rookFrom), indexOf(e.rookTo), true)
    else if (e.type === 'army_removed') removedByEvent.add(e.seat)
  }

  // 2. Remaining arrivals: same owner and kind first, then a pawn (promotion); nearest wins.
  //    The leader of a castle is matched before its rook, so it comes first in `moves`.
  const arrivals = [...appeared.entries()].sort(
    ([, a], [, b]) => (a.kind === 'king' ? 0 : 1) - (b.kind === 'king' ? 0 : 1),
  )
  for (const [to, piece] of arrivals) {
    let best = -1
    let bestScore = Number.POSITIVE_INFINITY
    for (const [from, p] of vanished) {
      if (p.owner !== piece.owner) continue
      const kindPenalty = p.kind === piece.kind ? 0 : p.kind === 'pawn' ? 100 : -1
      if (kindPenalty < 0) continue
      const score = kindPenalty + distance(from, to)
      if (score < bestScore) {
        bestScore = score
        best = from
      }
    }
    if (best >= 0) matchMove(best, to, false)
  }

  // A rook moving with its own leader's two-square step is the rook half of a castle.
  const leaderCastle = moves.find(
    (m) => m.piece.kind === 'king' && !m.castleRook && distance(m.from, m.to) === 2,
  )
  if (leaderCastle) {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i] as PlannedMove
      if (m.piece.kind === 'rook' && m.piece.owner === leaderCastle.piece.owner && !m.castleRook) {
        moves[i] = { ...m, castleRook: true }
      }
    }
  }
  moves.sort((a, b) => Number(a.castleRook) - Number(b.castleRook))

  // 3. Leftover departures: captured, or dissolving with their army.
  const destinations = new Set(moves.map((m) => m.to))
  const removedSeats = new Set<Seat>(removedByEvent)
  for (let s = 0; s < 4; s++) {
    if (next.statuses[s] === 'removed' && prev.statuses[s] !== 'removed') {
      removedSeats.add(SEATS[s] as Seat)
    }
  }
  const capturedByEvent = new Set<number>()
  for (const e of events) {
    if (e.type === 'capture') capturedByEvent.add(indexOf(e.square))
  }
  for (const [square, piece] of vanished) {
    const onDestination = destinations.has(square)
    if (onDestination || capturedByEvent.has(square) || !removedSeats.has(piece.owner)) {
      captures.push({ square, piece, onDestination })
    } else {
      dissolves.push({ square, piece })
    }
  }
  for (const [square, piece] of appeared) appears.push({ square, piece })

  const statusChanges: { seat: Seat; status: SeatStatus }[] = []
  for (let s = 0; s < 4; s++) {
    const st = next.statuses[s] as SeatStatus
    if (st !== prev.statuses[s]) statusChanges.push({ seat: SEATS[s] as Seat, status: st })
  }

  const incremental = appears.length === 0 && moves.filter((m) => !m.castleRook).length <= 1

  return {
    moves,
    captures: captures.sort((a, b) => a.square - b.square),
    dissolves: dissolves.sort((a, b) => a.square - b.square),
    appears: appears.sort((a, b) => a.square - b.square),
    statusChanges: statusChanges.sort((a, b) => seatOrder(a.seat) - seatOrder(b.seat)),
    seatToMoveChanged: prev.seatToMove !== next.seatToMove,
    gameEnded: !prev.isOver && next.isOver,
    incremental,
  }
}

/** Sound cues for a plan, most important first. */
export type SoundCue = 'move' | 'capture' | 'castle' | 'promotion' | 'defeat' | 'freeze' | 'end'

export function soundCues(plan: AnimationPlan): SoundCue[] {
  const cues: SoundCue[] = []
  if (plan.captures.length > 0) cues.push('capture')
  else if (plan.moves.some((m) => m.castleRook)) cues.push('castle')
  else if (plan.moves.length > 0) cues.push('move')
  if (plan.moves.some((m) => m.promoteTo !== null)) cues.push('promotion')
  if (plan.statusChanges.some((c) => c.status === 'frozen')) cues.push('freeze')
  if (plan.statusChanges.some((c) => c.status === 'removed' || c.status === 'defeated')) {
    cues.push('defeat')
  }
  if (plan.gameEnded) cues.push('end')
  return cues
}
