import { createDb } from '@game/db'
import { resetTestDatabase } from '@game/db/migrate'
import { seedCatalog } from '@game/db/seed'
import postgres from 'postgres'
import { TEST_DATABASE_URL } from './env.ts'

/** Arbitrary constant: "a server test run owns the test database". */
const RUN_LOCK_KEY = 7_420_115

/**
 * Fresh schema for every test run: drop everything, apply migrations, seed the catalog.
 *
 * Several runs (two workflows, or `pnpm test` beside a review run) share one test database.
 * Without coordination one run's reset drops the other's tables mid-test. A session-level
 * Postgres advisory lock, held for the whole run on a dedicated connection, makes concurrent
 * runs queue instead (advisory locks survive the schema drop: they belong to the database).
 */
export default async function setup() {
  const lock = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {}, idle_timeout: 0 })
  const reserved = await lock.reserve()
  const [got] = await reserved`SELECT pg_try_advisory_lock(${RUN_LOCK_KEY}) AS ok`
  if (!got?.ok) {
    console.warn('[test] another server test run holds the test database; waiting for it')
    await reserved`SELECT pg_advisory_lock(${RUN_LOCK_KEY})`
  }
  try {
    await resetTestDatabase(TEST_DATABASE_URL)
    const { db, close } = createDb(TEST_DATABASE_URL, { max: 1 })
    try {
      await seedCatalog(db)
    } finally {
      await close()
    }
  } catch (err) {
    reserved.release()
    await lock.end({ timeout: 5 })
    throw err
  }
  return async () => {
    await reserved`SELECT pg_advisory_unlock(${RUN_LOCK_KEY})`.catch(() => {})
    reserved.release()
    await lock.end({ timeout: 5 })
  }
}
