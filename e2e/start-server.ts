/**
 * Starts the API for E2E: resets the E2E database (migrate fresh + seed), then runs the
 * normal server entry point with E2E settings.
 */
import { createDb } from '@game/db'
import { resetTestDatabase } from '@game/db/migrate'
import { seedCatalog } from '@game/db/seed'
import { E2E_API_PORT, E2E_DATABASE_URL, E2E_WEB_ORIGIN } from './env.ts'

await resetTestDatabase(E2E_DATABASE_URL)
const { db, close } = createDb(E2E_DATABASE_URL, { max: 1 })
await seedCatalog(db)
await close()

Object.assign(process.env, {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(E2E_API_PORT),
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  DATABASE_URL: E2E_DATABASE_URL,
  API_PUBLIC_URL: E2E_WEB_ORIGIN,
  WEB_ORIGIN: E2E_WEB_ORIGIN,
  PASSKEY_RP_ID: 'localhost',
  TRUST_CLOUDFLARE: 'false',
  // Every browser request here comes from 127.0.0.1, so back-to-back flows would trip the
  // per-IP auth limits. Rate limiting is covered by the server integration tests instead.
  RATE_LIMIT_ENABLED: 'false',
  DEV_MAIL_ENDPOINT: 'true',
  // Keep E2E mail in memory, out of the developer's own dev mailbox file.
  DEV_MAILBOX_FILE: '',
  GUEST_PURGE_INTERVAL_MINUTES: '0',
  RESEND_API_KEY: '',
})
await import('../apps/server/src/main.ts')
