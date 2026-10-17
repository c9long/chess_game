/**
 * Colyseus on the API's own http.Server (PLAN §1): the WebSocket transport handles upgrades
 * under COLYSEUS_PATH, and matchmaking is an Express route (so it gets the API's CORS,
 * origin check and rate limits instead of Colyseus' permissive defaults).
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  type AuthContext,
  getBearerToken,
  LobbyRoom,
  LocalDriver,
  LocalPresence,
  matchMaker,
  Server,
} from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { COLYSEUS_PATH, ERROR_CODES, ROOM_NAMES } from '@game/protocol'
import { fromNodeHeaders } from 'better-auth/node'
import { type Request, type Response, Router } from 'express'
import type { AppConfig } from '../config.ts'
import { clientIp } from '../http/client-ip.ts'
import { fixedWindowLimiter } from '../http/security.ts'
import type { SocialService } from '../social/service.ts'
import { SocialRoom } from '../social/social-room.ts'
import { joinError } from './errors.ts'
import { type MatchmakeInfo, MatchRoom } from './match-room.ts'
import { resolvePlayer } from './player-auth.ts'
import type { GameService } from './service.ts'

/** The public lobby browser: Colyseus' realtime room listing, for signed-in players only. */
export class PublicLobbyRoom extends LobbyRoom {
  static override async onAuth(_token: string, _options: unknown, context: AuthContext) {
    if (!context.req) throw joinError('unauthorized')
    return resolvePlayer(MatchRoom.service.auth, MatchRoom.service.db, context.headers)
  }
}

/** Which matchmaking calls are allowed, per method (by room name, or a room id). */
function allowed(method: string, target: string): boolean {
  switch (method) {
    case 'joinOrCreate':
      return target === ROOM_NAMES.lobby || target === ROOM_NAMES.social
    case 'join':
      return target === ROOM_NAMES.lobby
    case 'create':
      return target === ROOM_NAMES.match
    case 'joinById':
    case 'reconnect':
      return /^[A-Za-z0-9_-]{1,64}$/.test(target)
    default:
      return false
  }
}

const KNOWN_CODES: readonly string[] = ERROR_CODES

/**
 * `POST {COLYSEUS_PATH}/matchmake/:method/:target`, the endpoint the Colyseus SDK calls.
 * The session cookie / bearer token is resolved in the rooms' `onAuth`.
 */
export function matchmakeRouter(config: AppConfig, svc: GameService): Router {
  const router = Router()
  const limiter = fixedWindowLimiter({
    windowMs: 60_000,
    max: 60,
    key: (req) => clientIp(req, config),
  })
  router.post('/matchmake/:method/:target', limiter, async (req: Request, res: Response) => {
    const method = String(req.params.method)
    const target = String(req.params.target)
    if (!allowed(method, target)) {
      res.status(400).json({ error: 'room_not_joinable' })
      return
    }
    if (matchMaker.state !== matchMaker.MatchMakerState.READY) {
      res.status(503).json({ error: 'maintenance' })
      return
    }
    const ip = clientIp(req, config)
    const headers = fromNodeHeaders(req.headers)
    const info: MatchmakeInfo = { method, target, ip }
    const context: AuthContext = {
      token: getBearerToken(req.headers.authorization ?? ''),
      ip,
      headers,
      req: info,
    }
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    try {
      const reservation = await matchMaker.controller.invokeMethod(method, target, body, context)
      res.json(reservation)
    } catch (err) {
      const e = err as { code?: number; message?: string }
      const known = e.message && KNOWN_CODES.includes(e.message)
      const status = known && e.code && e.code >= 400 && e.code < 600 ? e.code : 409
      if (!known) svc.logger.debug({ method, err: e.message }, 'matchmaking refused')
      res.status(status).json({ error: known ? e.message : 'room_not_joinable' })
    }
  })
  return router
}

export interface GameServerHandle {
  server: Server
  /** Disposes all rooms and closes WebSockets (the http.Server stays open). */
  shutdown(): Promise<void>
}

/** Attaches Colyseus to `httpServer` and starts accepting rooms. */
export async function attachGameServer(
  httpServer: HttpServer,
  svc: GameService,
  social: SocialService,
): Promise<GameServerHandle> {
  MatchRoom.service = svc
  SocialRoom.social = social
  const transport = new WebSocketTransport({ noServer: true, maxPayload: 4 * 1024 })
  const isGamePath = (req: IncomingMessage) => Boolean(req.url?.startsWith(`${COLYSEUS_PATH}/`))
  // Cross-site WebSocket hijacking defence in depth (a seat reservation from the
  // origin-checked matchmaking POST is needed anyway): browsers always send Origin on an
  // upgrade, so one from another site is refused; native clients send none.
  const originAllowed = (req: IncomingMessage) =>
    req.headers.origin === undefined || req.headers.origin === svc.config.webOrigin
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    if (isGamePath(req) && !originAllowed(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    }
  })
  transport.attachToServer(httpServer, {
    filter: (req) => isGamePath(req) && originAllowed(req),
  })
  const log = svc.logger.child({ component: 'colyseus' })
  const server = new Server({
    transport,
    presence: new LocalPresence(),
    driver: new LocalDriver(),
    gracefullyShutdown: false,
    greet: false,
    logger: {
      debug: (...args: unknown[]) => log.debug({}, args.map(String).join(' ')),
      info: (...args: unknown[]) => log.debug({}, args.map(String).join(' ')),
      warn: (...args: unknown[]) => log.warn({}, args.map(String).join(' ')),
      error: (...args: unknown[]) => log.error({}, args.map(String).join(' ')),
      trace: () => {},
    },
  })
  server.define(ROOM_NAMES.lobby, PublicLobbyRoom)
  server.define(ROOM_NAMES.match, MatchRoom).enableRealtimeListing()
  server.define(ROOM_NAMES.social, SocialRoom)
  await matchMaker.accept()
  return {
    server,
    shutdown: () => server.gracefullyShutdown(false),
  }
}
