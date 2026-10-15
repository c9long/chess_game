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

/** v1 civs have no abilities (all rules-core hooks empty). */
export const NO_ABILITIES = {} as const

/** Idempotently inserts the nine v1 civilizations and their version-1 definitions. */
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
      .returning({ id: civilizations.id })
    await tx
      .insert(civilizationVersions)
      .values(
        rows.map((r) => ({
          civId: r.id,
          version: 1,
          roster: STANDARD_ROSTER_V1,
          abilities: NO_ABILITIES,
        })),
      )
      .onConflictDoNothing()
  })
}
