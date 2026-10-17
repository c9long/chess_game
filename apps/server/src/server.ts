import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { initRulesSync } from '@game/rules'
import { type AppContext, type AppOverrides, createApp } from './app.ts'
import type { AppConfig } from './config.ts'
import { attachGameServer, type GameServerHandle } from './game/colyseus.ts'
import { abortOrphanedMatches } from './game/persistence.ts'

export interface RunningServer {
  ctx: AppContext
  httpServer: HttpServer
  gameServer: GameServerHandle
  /** Base URL, e.g. http://127.0.0.1:3000 */
  url: string
  /**
   * Graceful shutdown: no new rooms or game starts, lobbies closed, running games may finish
   * for up to `drainMs` (then they are aborted), then everything is closed.
   */
  stop(drainMs?: number): Promise<void>
}

/**
 * Boots the API: Express app, one http.Server, Colyseus attached to it. Matches left
 * in_progress by a previous process are aborted first (PLAN §5 live-game durability).
 */
export async function startServer(
  config: AppConfig,
  overrides: AppOverrides = {},
): Promise<RunningServer> {
  initRulesSync()
  const ctx = createApp(config, overrides)
  const aborted = config.abortOrphanedMatches ? await abortOrphanedMatches(ctx.db) : []
  if (aborted.length > 0) {
    ctx.logger.warn({ count: aborted.length }, 'aborted matches left in progress by a restart')
  }
  const httpServer = createServer(ctx.app)
  const gameServer = await attachGameServer(httpServer, ctx.game, ctx.social)
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })
  const addr = httpServer.address() as AddressInfo
  const host = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address
  let stopping: Promise<void> | undefined
  return {
    ctx,
    httpServer,
    gameServer,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${addr.port}`,
    stop(drainMs = config.game.shutdownDrainMaxMs) {
      stopping ??= (async () => {
        const { aborted: cut } = await ctx.game.drain(drainMs)
        if (cut > 0) ctx.logger.warn({ count: cut }, 'games aborted by shutdown')
        await gameServer.shutdown()
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve())
          httpServer.closeAllConnections()
        })
        await ctx.close()
      })()
      return stopping
    },
  }
}
