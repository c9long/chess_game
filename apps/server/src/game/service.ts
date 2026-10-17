import { randomBytes } from 'node:crypto'
import type { Database } from '@game/db'
import type { Auth } from '../auth/auth.ts'
import type { NamePolicy } from '../auth/name-policy.ts'
import type { AppConfig } from '../config.ts'
import type { Logger } from '../logger.ts'
import type { BotClient } from './bot-client.ts'
import { CivCatalog } from './persistence.ts'
import type { PlayerAuth } from './player-auth.ts'

/**
 * Fixed-window failure counter: `limit` failures per `windowMs` per key. Used for lobby
 * password attempts (PLAN §1: 5 per minute per IP and per room).
 */
export class AttemptLimiter {
  #hits = new Map<string, { count: number; resetAt: number }>()

  readonly limit: number
  readonly windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  #live(key: string, now: number) {
    const e = this.#hits.get(key)
    return e && e.resetAt > now ? e : undefined
  }

  /** Whether `key` has used up its failures in the current window. */
  blocked(key: string, now = Date.now()): boolean {
    return (this.#live(key, now)?.count ?? 0) >= this.limit
  }

  fail(key: string, now = Date.now()): void {
    if (this.#hits.size > 50_000) {
      for (const [k, v] of this.#hits) if (v.resetAt <= now) this.#hits.delete(k)
    }
    const e = this.#live(key, now)
    if (e) e.count += 1
    else this.#hits.set(key, { count: 1, resetAt: now + this.windowMs })
  }

  /** Takes back one counted attempt (counted up front, then turned out fine). */
  refund(key: string, now = Date.now()): void {
    const e = this.#live(key, now)
    if (e && e.count > 0) e.count -= 1
  }
}

/**
 * A user's outstanding seat reservation(s): matchmaking has handed out reservation(s) for
 * `roomId` that the user has not consumed yet. A user has at most one claim at a time, so
 * reservations count toward "a user holds at most one seat" before the WebSocket connects:
 * a claim for another room supersedes this one (its reservations are refused on connect),
 * and further reservations for the same room join it (they still count as one pending seat).
 */
export interface SeatClaim {
  /** '' until the room of a `create` exists (set in onCreate). */
  roomId: string
  sessionIds: Set<string>
  expiresAt: number
}

/** A room as the service sees it (implemented by MatchRoom). */
export interface ManagedRoom {
  readonly roomId: string
  /** True while a game is running (counts for draining). */
  isGameRunning(): boolean
  /**
   * A running game with nothing at stake that never ends by itself (untimed, unrated
   * solo): a drain aborts it at once instead of waiting for it.
   */
  abortsOnDrain(): boolean
  /** Closes a pre-game lobby (maintenance). */
  closeLobby(reason: string): Promise<void>
  /** Aborts a running game (shutdown cap reached). */
  abortGame(reason: string): Promise<void>
}

/**
 * A challenge lobby's invitation, handed to the room with its creator ticket: the lobby is
 * invite-only (only `userIds` may take a seat) and never listed.
 */
export interface LobbyInvite {
  challengeId: string
  /** Who may join: the challenger and the invited friends. */
  userIds: string[]
}

/** What match rooms tell the social service about challenge lobbies. */
export interface LobbyHooks {
  /** A user took a seat in the room. */
  seated?(roomId: string, userId: string): void
  /** The lobby is over: its game started, or the room closed. */
  ended?(roomId: string, reason: 'started' | 'closed'): void
}

export interface GameServiceDeps {
  config: AppConfig
  db: Database
  auth: Auth
  logger: Logger
  namePolicy: NamePolicy
  botClient: BotClient
}

/** Shared state of all match rooms in this process. */
export class GameService {
  readonly config: AppConfig
  readonly db: Database
  readonly auth: Auth
  readonly logger: Logger
  readonly namePolicy: NamePolicy
  readonly botClient: BotClient
  readonly civs: CivCatalog
  readonly passwordAttempts = new AttemptLimiter(5, 60_000)
  /** Live match rooms. */
  readonly rooms = new Set<ManagedRoom>()
  /** userId -> roomId of the seat the user holds (a user holds at most one seat). */
  readonly seats = new Map<string, string>()
  /** userId -> unconsumed seat reservation(s) (see SeatClaim). */
  readonly claims = new Map<string, SeatClaim>()
  /** Stop accepting new rooms and game starts (graceful shutdown). */
  maintenance = false
  /** Set by the social service (challenge lobbies). */
  lobbyHooks: LobbyHooks = {}
  #creatorTickets = new Map<
    string,
    { player: PlayerAuth; sessionId: string; expires: number; invite?: LobbyInvite }
  >()
  /** In-flight database work of finishing games; shutdown waits for it. */
  #pending = new Set<Promise<unknown>>()

  constructor(deps: GameServiceDeps) {
    this.config = deps.config
    this.db = deps.db
    this.auth = deps.auth
    this.logger = deps.logger.child({ component: 'game' })
    this.namePolicy = deps.namePolicy
    this.botClient = deps.botClient
    this.civs = new CivCatalog(deps.db)
  }

  /**
   * Hands the authenticated creator from `onAuth` to the new room's `onCreate` (Colyseus
   * passes only the client options between them). The ticket is random and short-lived;
   * clients can't send their own (create options are parsed strictly first).
   */
  issueCreatorTicket(player: PlayerAuth, sessionId: string, invite?: LobbyInvite): string {
    const now = Date.now()
    for (const [k, v] of this.#creatorTickets) if (v.expires < now) this.#creatorTickets.delete(k)
    const ticket = randomBytes(18).toString('base64url')
    this.#creatorTickets.set(ticket, {
      player,
      sessionId,
      expires: now + 30_000,
      ...(invite ? { invite } : {}),
    })
    return ticket
  }

  takeCreatorTicket(
    ticket: unknown,
  ): { player: PlayerAuth; sessionId: string; invite?: LobbyInvite } | undefined {
    if (typeof ticket !== 'string') return undefined
    const entry = this.#creatorTickets.get(ticket)
    this.#creatorTickets.delete(ticket)
    return entry && entry.expires >= Date.now() ? entry : undefined
  }

  /**
   * Records a reservation for `userId` in `roomId` ('' for a room still being created) and
   * returns the Colyseus session id to reserve it under. Synchronous, so concurrent
   * matchmaking requests can't both pass the one-seat checks.
   */
  claimSeat(userId: string, roomId: string, ttlMs: number, now = Date.now()): string {
    if (this.claims.size > 1_000) {
      for (const [k, v] of this.claims) if (v.expiresAt <= now) this.claims.delete(k)
    }
    const sessionId = randomBytes(12).toString('base64url')
    const current = this.liveClaim(userId, now)
    if (current && roomId !== '' && current.roomId === roomId) {
      current.sessionIds.add(sessionId)
      current.expiresAt = now + ttlMs
    } else {
      this.claims.set(userId, { roomId, sessionIds: new Set([sessionId]), expiresAt: now + ttlMs })
    }
    return sessionId
  }

  liveClaim(userId: string, now = Date.now()): SeatClaim | undefined {
    const c = this.claims.get(userId)
    if (c && c.expiresAt <= now) {
      this.claims.delete(userId)
      return undefined
    }
    return c
  }

  /** Users (other than `exceptUserId`) holding a live claim on `roomId`. */
  pendingClaims(roomId: string, exceptUserId?: string, now = Date.now()): string[] {
    const out: string[] = []
    for (const [userId, c] of this.claims) {
      if (c.roomId === roomId && c.expiresAt > now && userId !== exceptUserId) out.push(userId)
    }
    return out
  }

  /** Whether `sessionId` is one of `userId`'s live reservations for `roomId`. */
  holdsClaim(userId: string, roomId: string, sessionId: string, now = Date.now()): boolean {
    const c = this.liveClaim(userId, now)
    return Boolean(c && c.roomId === roomId && c.sessionIds.has(sessionId))
  }

  releaseClaim(userId: string, roomId: string): void {
    if (this.claims.get(userId)?.roomId === roomId) this.claims.delete(userId)
  }

  /** Registers in-flight work that must complete before the database closes. */
  track<T>(work: Promise<T>): Promise<T> {
    this.#pending.add(work)
    void work.finally(() => this.#pending.delete(work)).catch(() => {})
    return work
  }

  runningGames(): number {
    let n = 0
    for (const r of this.rooms) if (r.isGameRunning()) n++
    return n
  }

  /**
   * Graceful shutdown, step 1: no new rooms or game starts, lobbies closed. Then waits for
   * running games to finish, at most `maxMs`; games still running are aborted.
   */
  async drain(maxMs: number, pollMs = 500): Promise<{ aborted: number }> {
    this.maintenance = true
    for (const r of [...this.rooms]) {
      if (!r.isGameRunning()) await r.closeLobby('maintenance').catch(() => {})
    }
    let aborted = 0
    // Untimed solo games may never end on their own: abort them now (each poll catches one
    // that was still starting).
    const abortUnstaked = async () => {
      for (const r of [...this.rooms]) {
        if (r.isGameRunning() && r.abortsOnDrain()) {
          aborted++
          await r.abortGame('server_shutdown').catch((err: unknown) => {
            this.logger.error({ room: r.roomId, err: (err as Error).message }, 'abort failed')
          })
        }
      }
    }
    await abortUnstaked()
    const deadline = Date.now() + maxMs
    while (this.runningGames() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, maxMs)))
      await abortUnstaked()
    }
    for (const r of [...this.rooms]) {
      if (r.isGameRunning()) {
        aborted++
        await r.abortGame('server_shutdown').catch((err: unknown) => {
          this.logger.error({ room: r.roomId, err: (err as Error).message }, 'abort failed')
        })
      }
    }
    await Promise.allSettled([...this.#pending])
    return { aborted }
  }
}
