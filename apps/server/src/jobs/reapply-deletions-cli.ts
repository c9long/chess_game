/**
 * Run after restoring a database backup (docs/DEPLOY.md): deletes again every account that
 * was deleted after the backup was taken, so a restore never brings a deleted account back.
 *
 *   DATABASE_URL=postgres://... node apps/server/src/jobs/reapply-deletions-cli.ts
 */
import { createDb } from '@game/db'
import { reapplyDeletionLog } from '../account/anonymize.ts'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const { db, close } = createDb(url, { max: 1 })
try {
  const removed = await reapplyDeletionLog(db)
  console.log(`re-applied deletion_log: ${removed.length} restored account(s) removed again`)
} finally {
  await close()
}
