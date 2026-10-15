import { LEGAL_ACCEPTANCE_KIND, LEGAL_VERSIONS, type LegalDocument } from '@game/config'
import { type Executor, legalAcceptances } from '@game/db'
import { desc, eq } from 'drizzle-orm'

/**
 * Writes one legal_acceptances row per document. Each row carries its kind (PLAN §5): the
 * Terms are `accepted`, the Privacy Policy `acknowledged`.
 */
export async function recordAcceptances(
  db: Executor,
  userId: string,
  items: { document: LegalDocument; version: string }[],
  acceptedAt: Date,
  ipHash: string | null,
) {
  if (items.length === 0) return
  await db.insert(legalAcceptances).values(
    items.map((i) => ({
      userId,
      document: i.document,
      version: i.version,
      kind: LEGAL_ACCEPTANCE_KIND[i.document],
      acceptedAt,
      ipHash,
    })),
  )
}

/** Latest accepted version per document for a user. */
export async function acceptedVersions(db: Executor, userId: string) {
  const rows = await db
    .select({ document: legalAcceptances.document, version: legalAcceptances.version })
    .from(legalAcceptances)
    .where(eq(legalAcceptances.userId, userId))
    .orderBy(desc(legalAcceptances.acceptedAt), desc(legalAcceptances.id))
  const latest: Partial<Record<string, string>> = {}
  for (const r of rows) latest[r.document] ??= r.version
  return latest
}

/** Documents whose current version the user has not accepted yet. */
export async function missingAcceptances(db: Executor, userId: string) {
  const accepted = await acceptedVersions(db, userId)
  return (Object.keys(LEGAL_VERSIONS) as LegalDocument[]).filter(
    (d) => accepted[d] !== LEGAL_VERSIONS[d],
  )
}
