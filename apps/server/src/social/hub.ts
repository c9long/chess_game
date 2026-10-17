/**
 * Who is connected to the `social` room, and pushing messages to a user's connections.
 * A user is online while at least one connection (tab, device) is open; going offline waits
 * a short grace, so a reload or a brief network drop doesn't flash "offline" to friends.
 */
import type { ConnectionSession } from '../game/player-auth.ts'

/** One open `social` connection (a Colyseus client). */
export interface SocialConnection {
  send(type: string, payload: unknown): void
  leave(code?: number): void
}

export class SocialHub {
  readonly #conns = new Map<string, Set<SocialConnection>>()
  readonly #sessions = new Map<SocialConnection, { userId: string; session: ConnectionSession }>()
  readonly #offlineTimers = new Map<string, NodeJS.Timeout>()
  readonly #online = new Set<string>()
  readonly #graceMs: number
  readonly #onPresence: (userId: string, online: boolean) => void

  constructor(graceMs: number, onPresence: (userId: string, online: boolean) => void) {
    this.#graceMs = graceMs
    this.#onPresence = onPresence
  }

  attach(userId: string, conn: SocialConnection, session?: ConnectionSession): void {
    if (session) this.#sessions.set(conn, { userId, session })
    let set = this.#conns.get(userId)
    if (!set) {
      set = new Set()
      this.#conns.set(userId, set)
    }
    set.add(conn)
    const pending = this.#offlineTimers.get(userId)
    if (pending) {
      clearTimeout(pending)
      this.#offlineTimers.delete(userId)
    }
    if (!this.#online.has(userId)) {
      this.#online.add(userId)
      this.#onPresence(userId, true)
    }
  }

  detach(userId: string, conn: SocialConnection): void {
    this.#sessions.delete(conn)
    const set = this.#conns.get(userId)
    if (!set) return
    set.delete(conn)
    if (set.size > 0) return
    this.#conns.delete(userId)
    if (!this.#online.has(userId) || this.#offlineTimers.has(userId)) return
    const timer = setTimeout(() => {
      this.#offlineTimers.delete(userId)
      if (this.#conns.has(userId)) return
      this.#online.delete(userId)
      this.#onPresence(userId, false)
    }, this.#graceMs)
    timer.unref()
    this.#offlineTimers.set(userId, timer)
  }

  isOnline(userId: string): boolean {
    return this.#online.has(userId)
  }

  connectionCount(userId: string): number {
    return this.#conns.get(userId)?.size ?? 0
  }

  send(userId: string, type: string, payload: unknown): void {
    for (const c of this.#conns.get(userId) ?? []) c.send(type, payload)
  }

  /** Ids of the sessions behind open connections (for re-validation). */
  sessionIds(): string[] {
    return [...new Set([...this.#sessions.values()].map((v) => v.session.id))]
  }

  /**
   * Closes every connection opened with one of `sessionIds` (signed out, revoked, expired).
   * The user goes offline after the usual grace if nothing else is open.
   */
  disconnectSessions(sessionIds: Iterable<string>, code?: number): void {
    const ended = new Set(sessionIds)
    if (ended.size === 0) return
    for (const [conn, { userId, session }] of [...this.#sessions]) {
      if (!ended.has(session.id)) continue
      this.detach(userId, conn)
      conn.leave(code)
    }
  }

  /** Closes every connection of `userId` at once (account deleted); no offline grace. */
  disconnectUser(userId: string, code?: number): void {
    const conns = [...(this.#conns.get(userId) ?? [])]
    for (const c of conns) this.#sessions.delete(c)
    this.#conns.delete(userId)
    clearTimeout(this.#offlineTimers.get(userId))
    this.#offlineTimers.delete(userId)
    this.#online.delete(userId)
    for (const c of conns) c.leave(code)
  }

  close(): void {
    for (const t of this.#offlineTimers.values()) clearTimeout(t)
    this.#offlineTimers.clear()
  }
}
