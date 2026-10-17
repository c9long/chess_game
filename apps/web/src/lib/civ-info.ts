/**
 * Player-facing copy about civilizations whose army differs from the standard one. This is
 * text only: the rules (what the pieces do, who leads) live in the rules engine, and the
 * engine's snapshot is what the board shows. Keep the wording in step with docs/RULES.md
 * ("Civilizations with special armies").
 */

export interface SpecialArmy {
  /** Short tag next to the civ's name. */
  readonly tag: string
  /** One line for the civilization list. */
  readonly summary: string
  /** A few sentences for the lobby and the Play page. */
  readonly details: string
}

const SPECIAL_ARMIES: Readonly<Record<string, SpecialArmy>> = {
  england: {
    tag: 'Special army',
    summary: 'Four Prime Ministers replace the king, queen and knights',
    details:
      'England has no king, queen or knights. Four Prime Ministers stand on their squares: each moves like a knight or a king, and England is out only when all four are captured. England can’t castle; its pawns still promote to a queen, rook, bishop or knight.',
  },
}

/** The special army of a civ (by slug), or null for the standard army. */
export function specialArmy(slug: string): SpecialArmy | null {
  return Object.hasOwn(SPECIAL_ARMIES, slug) ? (SPECIAL_ARMIES[slug] ?? null) : null
}

/** Spoken names of the piece kinds (singular, plural), as the engine names the kinds. */
const PIECE_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  king: ['king', 'kings'],
  queen: ['queen', 'queens'],
  rook: ['rook', 'rooks'],
  bishop: ['bishop', 'bishops'],
  knight: ['knight', 'knights'],
  pawn: ['pawn', 'pawns'],
  prime_minister: ['Prime Minister', 'Prime Ministers'],
}

/**
 * The name of a piece kind for text and screen readers (`prime_minister` -> "Prime
 * Minister"; `count` other than 1 gives the plural). The one source for spoken piece names.
 */
export function pieceName(kind: string, count = 1): string {
  const names = Object.hasOwn(PIECE_NAMES, kind) ? PIECE_NAMES[kind] : undefined
  const fallback = kind.replaceAll('_', ' ')
  if (!names) return count === 1 ? fallback : `${fallback}s`
  return names[count === 1 ? 0 : 1]
}
