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

/** Screen-reader name of a piece kind, as the engine reports it (`prime_minister` -> "Prime Minister"). */
export function pieceName(kind: string): string {
  return kind
    .split('_')
    .map((w) => (w ? `${w[0]?.toUpperCase()}${w.slice(1)}` : w))
    .join(' ')
}
