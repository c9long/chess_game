import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'

export * from './schema/index.ts'
export { schema }

export interface CreateDbOptions {
  /** Maximum pool size (default 10). */
  max?: number
}

/** Opens a pooled connection. Call `close()` on shutdown. */
export function createDb(url: string, options: CreateDbOptions = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} })
  const db = drizzle(client, { schema })
  return { db, client, close: () => client.end({ timeout: 5 }) }
}

export type Database = ReturnType<typeof createDb>['db']
/** A Drizzle transaction handle (same query API as `Database`). */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type Executor = Database | Transaction
