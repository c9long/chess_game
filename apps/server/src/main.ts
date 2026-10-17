import { ConfigError, loadConfig } from './config.ts'
import { purgeInactiveGuests } from './jobs/guest-purge.ts'
import { purgeExpiredNameHolds, purgeOldReports } from './jobs/moderation-purge.ts'
import { startServer } from './server.ts'

let config: ReturnType<typeof loadConfig>
try {
  config = loadConfig()
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
}

// One http.Server for the REST API, Better Auth and Colyseus (WebSocket + matchmaking).
const running = await startServer(config)
const { ctx } = running
const { logger } = ctx

async function runGuestPurge() {
  try {
    const r = await purgeInactiveGuests(ctx.db, { inactiveDays: config.guestInactiveDays })
    logger.info(
      { anonymized: r.anonymized.length, deleted: r.deleted.length },
      'guest purge finished',
    )
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'guest purge failed')
  }
}

/**
 * Moderation retention (same schedule): resolved reports go one year after resolution, and
 * held usernames when their hold ends.
 */
async function runReportPurge() {
  try {
    const deleted = await purgeOldReports(ctx.db)
    if (deleted > 0) logger.info({ deleted }, 'old reports purged')
    const released = await purgeExpiredNameHolds(ctx.db)
    if (released > 0) logger.info({ released }, 'expired username holds purged')
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'report purge failed')
  }
}

let purgeTimer: NodeJS.Timeout | undefined
if (config.guestPurgeIntervalMinutes > 0) {
  purgeTimer = setInterval(() => {
    void runGuestPurge()
    void runReportPurge()
  }, config.guestPurgeIntervalMinutes * 60_000)
  purgeTimer.unref()
  setTimeout(() => {
    void runGuestPurge()
    void runReportPurge()
  }, 30_000).unref()
}

logger.info(
  {
    port: config.port,
    env: config.env,
    email: ctx.email.name,
    oauth: Object.keys(config.oauth),
    botService: config.game.botServiceUrl ?? 'local fallback only',
  },
  'server listening',
)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) {
    // A second signal skips the drain.
    logger.warn({ signal }, 'forced exit')
    process.exit(1)
  }
  shuttingDown = true
  logger.info(
    { signal, runningGames: ctx.game.runningGames(), drainMaxMs: config.game.shutdownDrainMaxMs },
    'shutting down: no new rooms; waiting for running games',
  )
  if (purgeTimer) clearInterval(purgeTimer)
  try {
    await running.stop()
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'shutdown error')
  }
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
