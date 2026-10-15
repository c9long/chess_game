import { APP_NAME, LEGAL_VERSIONS } from '@game/config'
import { createDb } from '@game/db'
import { COLYSEUS_PATH } from '@game/protocol'
import { toNodeHandler } from 'better-auth/node'
import cors from 'cors'
import { sql } from 'drizzle-orm'
import express, {
  type Request as ExpressRequest,
  type Response as ExpressResponse,
  type NextFunction,
} from 'express'
import { accountRouter } from './account/routes.ts'
import { createAuth } from './auth/auth.ts'
import { lengthCharsetPolicy, type NamePolicy } from './auth/name-policy.ts'
import type { AppConfig } from './config.ts'
import { type EmailSender, MemoryEmailSender, ResendEmailSender } from './email/sender.ts'
import { type BotClient, createBotClient } from './game/bot-client.ts'
import { matchmakeRouter } from './game/colyseus.ts'
import { gameRouter } from './game/routes.ts'
import { GameService } from './game/service.ts'
import { normalizeForwardedFor } from './http/client-ip.ts'
import { devMailRouter } from './http/dev-routes.ts'
import { requestLogger } from './http/request-log.ts'
import { requireTrustedOrigin, securityHeaders } from './http/security.ts'
import { legalRouter } from './legal/routes.ts'
import { createLogger, type Logger } from './logger.ts'

export interface AppOverrides {
  email?: EmailSender
  logger?: Logger
  namePolicy?: NamePolicy
  /** Source of bot moves (tests inject fakes). Default: bot-service at BOT_SERVICE_URL. */
  botClient?: BotClient
}

/**
 * Builds the Express application (REST API + Better Auth) without listening. The entry
 * point (main.ts) owns the http.Server so Colyseus can attach to the same server (M4).
 */
export function createApp(config: AppConfig, overrides: AppOverrides = {}) {
  const logger = overrides.logger ?? createLogger(config.logLevel)
  const namePolicy = overrides.namePolicy ?? lengthCharsetPolicy
  const { db, close: closeDb } = createDb(config.databaseUrl)
  const email =
    overrides.email ??
    (config.email.resendApiKey
      ? new ResendEmailSender(config.email.resendApiKey, config.email.from, logger)
      : new MemoryEmailSender(logger))
  const auth = createAuth({ config, db, email, logger, namePolicy })
  const game = new GameService({
    config,
    db,
    auth,
    logger,
    namePolicy,
    botClient:
      overrides.botClient ??
      createBotClient(config.game.botServiceUrl, config.game.botRequestTimeoutMs, logger),
  })

  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders(config))
  app.use(requestLogger(logger))
  app.use(normalizeForwardedFor(config))
  app.use(cors({ origin: config.webOrigin, credentials: true, maxAge: 600 }))

  // Better Auth parses its own bodies, so it is mounted before express.json().
  app.all(
    '/api/auth/{*path}',
    toNodeHandler(async (request) => withoutBearerHeader(await auth.handler(request))),
  )

  app.use(express.json({ limit: '32kb' }))
  app.use('/api', requireTrustedOrigin(config))

  app.get('/api/health', async (_req, res) => {
    try {
      await db.execute(sql`select 1`)
      res.json({ status: 'ok', db: 'ok' })
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' })
    }
  })

  /** Public, non-secret settings the web client needs before signing in. */
  app.get('/api/config', (_req, res) => {
    res.json({
      appName: APP_NAME,
      turnstileSiteKey: config.turnstile.siteKey,
      oauthProviders: Object.keys(config.oauth),
      legalVersions: LEGAL_VERSIONS,
      username: {
        minLength: namePolicy.minLength,
        maxLength: namePolicy.maxLength,
        description: namePolicy.description,
      },
      passwordMinLength: 10,
    })
  })

  app.use('/api/legal', legalRouter({ config, db, auth }))
  app.use('/api/account', accountRouter({ config, db, auth, logger }))
  app.use('/api', gameRouter({ db, auth }))
  // Colyseus matchmaking (the WebSocket side is attached to the http.Server in server.ts).
  app.use(COLYSEUS_PATH, matchmakeRouter(config, game))
  if (config.devMailEndpoint && email instanceof MemoryEmailSender) {
    app.use('/api/dev', devMailRouter(email))
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' })
  })
  app.use(
    (
      err: Error & { status?: number; type?: string },
      req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ) => {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500
      if (status >= 500) logger.error({ path: req.path, err: err.message }, 'unhandled error')
      res.status(status).json({ error: status === 500 ? 'INTERNAL' : 'BAD_REQUEST' })
    },
  )

  return {
    app,
    auth,
    db,
    email,
    game,
    logger,
    close: async () => {
      await closeDb()
    },
  }
}

export type AppContext = ReturnType<typeof createApp>

/**
 * The bearer plugin copies the session token into a `set-auth-token` response header (and
 * exposes it to CORS), which would hand page scripts a token the HttpOnly cookie is meant to
 * hide. Native clients get their token from the device flow's JSON body instead.
 */
export function withoutBearerHeader(res: Response): Response {
  if (!res.headers.has('set-auth-token')) return res
  const headers = new Headers(res.headers)
  headers.delete('set-auth-token')
  const exposed = (headers.get('access-control-expose-headers') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h && h.toLowerCase() !== 'set-auth-token')
  if (exposed.length > 0) headers.set('access-control-expose-headers', exposed.join(', '))
  else headers.delete('access-control-expose-headers')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
