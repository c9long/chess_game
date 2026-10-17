/**
 * Starts the API for E2E: resets the E2E database (migrate fresh + seed), then runs the
 * normal server entry point with E2E settings.
 *
 * A spec that needs a second, restartable API (e.g. restart-session.spec) runs this with
 * E2E_SERVER_PORT / E2E_SERVER_WEB_ORIGIN set to its own ports and E2E_SECONDARY=1: it shares
 * the database the main E2E server already prepared (no reset), and it doesn't abort the
 * in-progress matches it finds at startup, because those belong to the main server's live
 * rooms.
 */
import { createDb } from '@game/db'
import { resetTestDatabase } from '@game/db/migrate'
import { seedCatalog } from '@game/db/seed'
import { E2E_ADMIN_USER_ID, E2E_API_PORT, E2E_DATABASE_URL, E2E_WEB_ORIGIN } from './env.ts'

const port = process.env.E2E_SERVER_PORT ?? String(E2E_API_PORT)
const webOrigin = process.env.E2E_SERVER_WEB_ORIGIN ?? E2E_WEB_ORIGIN

const secondary = process.env.E2E_SECONDARY === '1'

if (!secondary) {
  await resetTestDatabase(E2E_DATABASE_URL)
  const { db, close } = createDb(E2E_DATABASE_URL, { max: 1 })
  await seedCatalog(db)
  await close()
}

Object.assign(process.env, {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: port,
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  DATABASE_URL: E2E_DATABASE_URL,
  API_PUBLIC_URL: webOrigin,
  WEB_ORIGIN: webOrigin,
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
  // Bot pacing as in production, so the specs see bot moves spaced for their animations.
  BOT_MIN_MOVE_MS: '700',
  ABORT_ORPHANED_MATCHES: secondary ? 'false' : 'true',
  // The review queue's admin (moderation.spec creates the account with this id).
  ADMIN_USER_IDS: E2E_ADMIN_USER_ID,
})
await import('../apps/server/src/main.ts')
