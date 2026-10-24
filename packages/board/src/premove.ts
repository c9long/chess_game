import type { PieceKind, Seat, Snapshot } from '@game/rules'
import { pieceWord } from './announce.ts'
import { nameOf, seatOrder } from './geometry.ts'
import type { MoveIndex } from './moves.ts'

/**
 * Premoves (pure, unit-tested): one move queued while it isn't the player's turn, picked from
 * the engine's premove targets for their seat (`movesForSeat`: each piece's movement pattern,
 * own pieces included, so a recapture can be queued) and checked again against the engine's
 * legal moves when the turn comes. Nothing here decides legality; it only matches squares
 * against the engine's move lists.
 */

/** A queued premove. Squares are indices (see `geometry.ts`). */
export interface Premove {
  readonly from: number
  readonly to: number
  /** Kind of the piece that moves. */
  readonly piece: PieceKind
  /** The piece promotes to this (queen when it can, else the first choice); null when not. */
  readonly promotion: PieceKind | null
  /** Captures in the position it was made in (the target may be gone by the time it plays). */
  readonly capture: boolean
  /** Engine notation as it was made; the notation actually sent comes from the legal moves. */
  readonly notation: string
}

/** What became of a premove when the player's turn came. */
export type PremoveOutcome =
  | { readonly kind: 'play'; readonly notation: string; readonly premove: Premove }
  | { readonly kind: 'drop'; readonly premove: Premove }

/**
 * A premove dropped before the turn came: its piece left its square (`gone`), or the game
 * ended or the seat stopped taking turns (`out`: frozen or removed), which the step's own
 * announcements (the result, the seat's status) already say.
 */
export interface PremoveDrop {
  readonly premove: Premove
  readonly reason: 'gone' | 'out'
}

/**
 * Whether `seat` can no longer premove in `next`: the game is over, or the seat stopped taking
 * turns. A defeated Teams seat still takes its turns, so only frozen and removed seats are out.
 */
export function premovesOver(next: Pick<Snapshot, 'statuses' | 'isOver'>, seat: Seat): boolean {
  const status = next.statuses[seatOrder(seat)]
  return next.isOver || status === 'frozen' || status === 'removed'
}

/**
 * The premove `from -> to`, if `index` (the seat's out-of-turn moves) has that move. A
 * promotion takes the queen by default: there is no picker for a move that hasn't happened.
 */
export function choosePremove(
  index: MoveIndex,
  from: number,
  to: number,
  piece: PieceKind,
): Premove | null {
  const t = index.target(from, to)
  if (!t) return null
  const promotion =
    t.promotions.length === 0
      ? null
      : t.promotions.includes('queen')
        ? 'queen'
        : (t.promotions[0] as PieceKind)
  const notation = index.resolve(from, to, promotion ?? undefined)
  if (notation === null || notation === 'promotion') return null
  return { from, to, piece, promotion, capture: t.capture, notation }
}

/** "knight b7 to c9", "pawn e8 to e9, promotes to queen" (the move announcer's wording). */
export function premoveText(p: Premove): string {
  const base = `${pieceWord(p.piece)} ${nameOf(p.from)} to ${nameOf(p.to)}`
  return p.promotion ? `${base}, promotes to ${pieceWord(p.promotion)}` : base
}

/**
 * The one premove slot (a queue of one). A new premove replaces the old one; a premove is
 * dropped when its piece leaves its square before the turn comes (taken, or a takeover of the
 * position), and it is played or dropped, never kept, once the turn comes.
 */
export class PremoveSlot {
  #current: Premove | null = null

  get current(): Premove | null {
    return this.#current
  }

  /** Queues `p`, replacing any earlier premove. */
  set(p: Premove): void {
    this.#current = p
  }

  /** Clears the slot; returns the premove that was queued, if any. */
  cancel(): Premove | null {
    const p = this.#current
    this.#current = null
    return p
  }

  /**
   * A new position arrived while waiting for `seat`'s turn. Returns the premove when that
   * dropped it (see `PremoveDrop`), else null.
   */
  onPosition(
    next: Pick<Snapshot, 'board' | 'statuses' | 'isOver'>,
    seat: Seat,
  ): PremoveDrop | null {
    const p = this.#current
    if (!p) return null
    const out = premovesOver(next, seat)
    const there = next.board[p.from]
    if (!out && there && there.owner === seat && there.kind === p.piece) return null
    this.#current = null
    return { premove: p, reason: out ? 'out' : 'gone' }
  }

  /**
   * The turn came, with these legal moves (from the engine): the premove is played when it is
   * still legal, with the same promotion choice, else dropped. Either way the slot empties.
   */
  onTurn(legal: MoveIndex): PremoveOutcome | null {
    const p = this.#current
    if (!p) return null
    this.#current = null
    const r = legal.resolve(p.from, p.to, p.promotion ?? undefined)
    if (r === null || r === 'promotion') return { kind: 'drop', premove: p }
    return { kind: 'play', notation: r, premove: p }
  }
}
