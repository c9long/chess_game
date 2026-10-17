import { CIVILIZATIONS } from '@game/config'
import { sql } from 'drizzle-orm'
import type { Executor } from './index.ts'
import { civilizations, civilizationVersions } from './schema/index.ts'

/**
 * The v1 standard roster, in the shape the rules-core crate uses (snake_case piece kinds):
 * P N B R Q K with the king as the single leader.
 */
export const STANDARD_ROSTER_V1 = {
  kinds: ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'],
  leaders: ['king'],
  defeatCondition: 'no_leaders',
} as const

/** No civ has abilities yet (all rules-core hooks empty). */
export const NO_ABILITIES = {} as const

/**
 * England version 2 (rules-core `Roster::ENGLAND_PRIME_MINISTERS`): four Prime Ministers (all
 * leaders, letter M) replace the king, queen and knights on those squares. Queen and knight stay
 * in the roster as promotion choices; England is defeated when it holds no Prime Minister. The
 * back line is listed from the long-rook end, like rules-core's.
 */
export const ENGLAND_ROSTER_V2 = {
  kinds: ['pawn', 'knight', 'bishop', 'rook', 'queen', 'prime_minister'],
  leaders: ['prime_minister'],
  promotionOptions: ['knight', 'bishop', 'rook', 'queen'],
  backLine: [
    'rook',
    'prime_minister',
    'bishop',
    'prime_minister',
    'prime_minister',
    'bishop',
    'prime_minister',
    'rook',
  ],
  defeatCondition: 'no_leaders',
} as const

/**
 * Civ versions after version 1. Rows are immutable once inserted (a trigger enforces it), so
 * a changed civ always gets a new version here, matching rules-core's `civ_definition`.
 */
export const LATER_CIV_VERSIONS: readonly {
  readonly slug: string
  readonly version: number
  readonly roster: unknown
}[] = [{ slug: 'england', version: 2, roster: ENGLAND_ROSTER_V2 }]

/**
 * Idempotently inserts the civilizations, their version-1 definitions (standard army) and every
 * later version (`LATER_CIV_VERSIONS`).
 */
export async function seedCatalog(db: Executor): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .insert(civilizations)
      .values(
        CIVILIZATIONS.map((c) => ({
          slug: c.slug,
          name: c.name,
          emblemAsset: `emblems/${c.slug}.svg`,
        })),
      )
      .onConflictDoUpdate({
        target: civilizations.slug,
        set: { name: sql`excluded.name`, emblemAsset: sql`excluded.emblem_asset` },
      })
      .returning({ id: civilizations.id, slug: civilizations.slug })
    const idOf = new Map(rows.map((r) => [r.slug, r.id]))
    await tx
      .insert(civilizationVersions)
      .values([
        ...rows.map((r) => ({
          civId: r.id,
          version: 1,
          roster: STANDARD_ROSTER_V1,
          abilities: NO_ABILITIES,
        })),
        ...LATER_CIV_VERSIONS.flatMap((v) => {
          const civId = idOf.get(v.slug)
          return civId === undefined
            ? []
            : [{ civId, version: v.version, roster: v.roster, abilities: NO_ABILITIES }]
        }),
      ])
      .onConflictDoNothing()
  })
}
