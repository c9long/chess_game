/**
 * Player-facing copy about each civilization: its emblem, a one-line identity and the abilities
 * that change how it plays. This is display text only: the rules themselves (which pieces a civ
 * fields, how they move, who leads) live in the rules engine, and every client reads the board
 * from the engine. Plain JSON-serializable data, so any client (web, Unity) can ship it.
 *
 * Keep in step with docs/RULES.md "Civilization abilities".
 */
import type { CivSlug } from './index.ts'

/** Something a civilization does differently from the standard army. */
export interface CivAbility {
  /** Kebab-case, unique within the civ and stable (used in test ids). */
  readonly id: string
  /** The ability's title, at most 28 characters. */
  readonly name: string
  /** One line, at most 80 characters, no final period. */
  readonly summary: string
  /** A few sentences explaining the ability. */
  readonly details: string
  /** Optional engine piece kind whose art illustrates the ability (display only). */
  readonly piece?: string
}

export interface CivInfo {
  /** Short noun phrase naming the emblem, at most 20 characters (search keyword, screen readers). */
  readonly emblem: string
  /** One neutral sentence about the emblem, at most 90 characters, ending with a period. */
  readonly identity: string
  /** What the civ does differently; empty for the standard army. */
  readonly abilities: readonly CivAbility[]
}

/** Copy for a civilization without abilities. */
export const STANDARD_ARMY = {
  title: 'Standard army',
  text: 'Eight pawns, two rooks, two knights, two bishops, a queen and a king. The emblem marks the seat; nothing else changes.',
} as const

export const CIV_INFO = {
  canada: {
    emblem: 'Maple leaf',
    identity: 'The maple leaf, from the sugar maples that turn its forests red each autumn.',
    abilities: [],
  },
  usa: {
    emblem: 'Bald eagle',
    identity: 'The bald eagle with wings spread, a bird native only to North America.',
    abilities: [],
  },
  china: {
    emblem: 'Dragon',
    identity: 'The Chinese dragon, a bringer of rain and good fortune in folklore.',
    abilities: [],
  },
  japan: {
    emblem: 'Cherry blossom',
    identity: 'The cherry blossom, whose brief spring bloom is celebrated across Japan.',
    abilities: [],
  },
  germany: {
    emblem: 'Oak branch',
    identity: 'An oak branch with acorns, as struck on its euro coins.',
    abilities: [],
  },
  russia: {
    emblem: 'Firebird',
    identity: 'The Firebird of Russian folk tales, whose glowing feathers light the dark.',
    abilities: [],
  },
  england: {
    emblem: 'Tudor rose',
    identity: 'The Tudor rose: a red rose and a white rose joined in one bloom.',
    abilities: [
      {
        id: 'magna-carta',
        name: 'Magna Carta',
        summary: 'Four Prime Ministers replace the king, queen and knights',
        details:
          'England has no king, queen or knights. Four Prime Ministers stand on their squares: each moves like a knight or a king, and England is out only when all four are captured. England can’t castle; its pawns still promote to a queen, rook, bishop or knight.',
        piece: 'prime_minister',
      },
    ],
  },
  france: {
    emblem: 'Fleur-de-lis',
    identity: 'The fleur-de-lis, a stylized lily used in French heraldry for centuries.',
    abilities: [],
  },
  mali: {
    emblem: 'Chiwara',
    identity: 'The Chiwara, a carved antelope headdress worn by Bamana dancers to honor farming.',
    abilities: [],
  },
} as const satisfies Record<CivSlug, CivInfo>

/** A civ's display copy by slug, or null for a slug that isn't on the roster. */
export function civInfo(slug: string): CivInfo | null {
  return Object.hasOwn(CIV_INFO, slug) ? (CIV_INFO[slug as CivSlug] as CivInfo) : null
}
