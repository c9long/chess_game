import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url))

/** Applies all pending SQL migrations from packages/db/drizzle. */
export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await client.end({ timeout: 5 })
  }
}

/**
 * Drops everything in the database and re-applies all migrations. Test-only: refuses to
 * run unless the database name ends in `_test`.
 */
export async function resetTestDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) {
    throw new Error(`refusing to reset non-test database "${name}"`)
  }
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await client.unsafe(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
    )
  } finally {
    await client.end({ timeout: 5 })
  }
  await runMigrations(url)
}
