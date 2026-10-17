import type { MoveView, PieceKind } from '@game/rules'
import { indexOf } from './geometry.ts'

/**
 * Lookup over the engine's legal moves for the interaction layer. This only
 * indexes `MoveView`s the engine produced; it never decides legality itself.
 */

/** One destination of the selected piece. */
export interface MoveTarget {
  /** Destination square index. */
  readonly to: number
  readonly capture: boolean
  /** Castling: the leader's two-square move. */
  readonly castle: boolean
  readonly enPassant: boolean
  /** Promotion choices (empty when the move does not promote), in `PROMOTION_ORDER`. */
  readonly promotions: readonly PieceKind[]
  /** Notation of the non-promoting move, or of the first promotion choice. */
  readonly notation: string
}

/** Display order of promotion choices. */
export const PROMOTION_ORDER: readonly PieceKind[] = [
  'queen',
  'rook',
  'bishop',
  'knight',
  'prime_minister',
  'king',
  'pawn',
]

/** Indexed legal moves of the seat to move. */
export class MoveIndex {
  readonly #byFrom = new Map<number, Map<number, MoveTarget>>()
  readonly #moves: readonly MoveView[]

  constructor(moves: readonly MoveView[]) {
    this.#moves = moves
    const grouped = new Map<number, Map<number, MoveView[]>>()
    for (const m of moves) {
      const from = indexOf(m.from)
      const to = indexOf(m.to)
      let targets = grouped.get(from)
      if (!targets) {
        targets = new Map()
        grouped.set(from, targets)
      }
      const list = targets.get(to)
      if (list) list.push(m)
      else targets.set(to, [m])
    }
    for (const [from, targets] of grouped) {
      const out = new Map<number, MoveTarget>()
      for (const [to, list] of targets) {
        const promotions = list
          .map((m) => m.promotion)
          .filter((p): p is PieceKind => p !== null)
          .sort((a, b) => PROMOTION_ORDER.indexOf(a) - PROMOTION_ORDER.indexOf(b))
        const first = list[0] as MoveView
        const plain = list.find((m) => m.promotion === null)
        out.set(to, {
          to,
          capture: list.some((m) => m.capture),
          castle: list.some((m) => m.flag === 'castle'),
          enPassant: list.some((m) => m.flag === 'en_passant'),
          promotions,
          notation:
            plain?.notation ??
            list.find((m) => m.promotion === promotions[0])?.notation ??
            first.notation,
        })
      }
      this.#byFrom.set(from, out)
    }
  }

  /** All moves, as given. */
  get moves(): readonly MoveView[] {
    return this.#moves
  }

  /** Whether the piece on `from` has at least one legal move. */
  canMoveFrom(from: number): boolean {
    return this.#byFrom.has(from)
  }

  /** Squares holding a piece that can move. */
  movableSquares(): number[] {
    return [...this.#byFrom.keys()].sort((a, b) => a - b)
  }

  /** Destinations of the piece on `from` (empty when it cannot move). */
  targetsFrom(from: number): MoveTarget[] {
    const t = this.#byFrom.get(from)
    return t ? [...t.values()].sort((a, b) => a.to - b.to) : []
  }

  /** The target `from -> to`, if legal. */
  target(from: number, to: number): MoveTarget | undefined {
    return this.#byFrom.get(from)?.get(to)
  }

  /**
   * Resolves a from/to (and optional promotion choice) to the notation the
   * engine accepts. Returns `null` when illegal and `'promotion'` when the
   * move must promote and no (valid) choice was given.
   */
  resolve(from: number, to: number, promotion?: PieceKind): string | 'promotion' | null {
    const t = this.target(from, to)
    if (!t) return null
    if (t.promotions.length === 0) return t.notation
    if (promotion === undefined || !t.promotions.includes(promotion)) return 'promotion'
    const m = this.#moves.find(
      (mv) => indexOf(mv.from) === from && indexOf(mv.to) === to && mv.promotion === promotion,
    )
    return m ? m.notation : null
  }
}
