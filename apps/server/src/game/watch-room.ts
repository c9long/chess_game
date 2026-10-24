/**
 * The `watch` room: read-only spectators of one match room (PLAN §3 "Spectating").
 *
 * Spectators never join the match room itself, so nothing they send can reach the game: this
 * room answers every game message with `spectating`. Its state is a copy of the match room's
 * state (the same schema, so clients render it with the same code), refreshed before each of
 * the match room's patches, and the match room passes its broadcasts on (`relay`).
 *
 * Ranked games are shown delayed while they run (anti-cheat, SPECTATOR_DELAY_ROUNDS): the
 * copy carries an older position, clocks and move log, draw offers and resignation votes are
 * hidden, and live game messages are held back until spectators may see them. Once the game
 * is over the room shows everything.
 */
import { type AuthContext, type Client, matchMaker, Room } from '@colyseus/core'
import {
  CLOSE_CODES,
  type ClockSync,
  joinOptionsSchema,
  type MoveLogEntry,
  PROTOCOL_VERSION,
  type ServerMessages,
  SPECTATORS_MAX,
} from '@game/protocol'
import { createMatchState, type MatchState } from '@game/protocol/state'
import { joinError } from './errors.ts'
import { DelayedFeed, frozenClock, LIVE_ONLY, mirrorState } from './game-view.ts'
import { type MatchmakeInfo, MatchRoom } from './match-room.ts'
import { type PlayerAuth, resolvePlayer } from './player-auth.ts'

type WatchClient = Client<{ auth: PlayerAuth }>

/** Tabs or devices one account may watch a room from at once (one place either way). */
const SPECTATOR_CONNECTIONS_PER_ACCOUNT = 3

/** How long a dropped spectator may come back with its reconnection token. */
const SPECTATOR_RECONNECT_SECONDS = 20

export class WatchRoom extends Room<{ state: MatchState; client: WatchClient }> {
  /**
   * Places are counted per account by the room itself (see `isFull`); Colyseus' own count
   * includes every unconsumed reservation, so a limit this low would let one account lock
   * the room with raw matchmaking calls. This only bounds memory.
   */
  override maxClients = SPECTATORS_MAX * SPECTATOR_CONNECTIONS_PER_ACCOUNT
  override seatReservationTimeout = 10
  override maxMessagesPerSecond = 10
  override state = createMatchState()

  /** The watched match room (null once it is gone). */
  match: MatchRoom | null = null
  /** Where spectators are in the move log (set when the room is created). */
  private feed = new DelayedFeed(0)
  /** Accounts removed from this room (see `removeSpectator`): no reconnecting. */
  removed = new Set<string>()
  /** Connections the room closed itself. */
  private closing = new WeakSet<WatchClient>()

  static override async onAuth(
    _token: string,
    options: unknown,
    context: AuthContext,
  ): Promise<PlayerAuth> {
    const info = context.req as MatchmakeInfo | undefined
    if (info?.method !== 'joinById') throw joinError('room_not_joinable')
    const room = matchMaker.getLocalRoomById(info.target)
    if (!(room instanceof WatchRoom) || !room.match) throw joinError('room_not_found')
    if ((options as { protocolVersion?: unknown })?.protocolVersion !== PROTOCOL_VERSION) {
      throw joinError('protocol_mismatch')
    }
    const parsed = joinOptionsSchema.safeParse(options)
    if (!parsed.success) throw joinError('invalid_options')
    const svc = MatchRoom.service
    const player = await resolvePlayer(svc.auth, svc.db, context.headers)
    // Matchmaking already admitted this player to the match before creating this room (a
    // server-side mark, see colyseus.ts): the password isn't checked (or counted) twice.
    if (info.admittedSpectator !== player.userId) {
      await room.match.admitSpectator(player, parsed.data.password ?? '', info.ip)
    }
    if (room.isFull(player.userId)) throw joinError('spectators_full')
    // Admitted again (e.g. invited again after a revoke): reconnecting works again too.
    room.removed.delete(player.userId)
    return player
  }

  /**
   * Whether a new connection of `userId` would go over the limits: places are counted per
   * account (connected, reserved or waiting to reconnect), at most SPECTATORS_MAX accounts,
   * and one account may watch from a few tabs or devices (SPECTATOR_CONNECTIONS_PER_ACCOUNT)
   * but never fill the room.
   */
  isFull(userId?: string): boolean {
    const users = this.connectionsByUser()
    const mine = userId === undefined ? undefined : users.get(userId)
    if (mine !== undefined) return mine >= SPECTATOR_CONNECTIONS_PER_ACCOUNT
    return users.size >= SPECTATORS_MAX
  }

  /** Per account: its connections here, connected, reserved or waiting to reconnect. */
  private connectionsByUser(): Map<string, number> {
    const users = new Map<string, number>()
    const add = (userId: string | undefined) => {
      if (userId) users.set(userId, (users.get(userId) ?? 0) + 1)
    }
    const reserved =
      (this as unknown as { _reservedSeats?: Record<string, [unknown, PlayerAuth | undefined]> })
        ._reservedSeats ?? {}
    for (const c of this.clients) if (!reserved[c.sessionId]) add(c.auth?.userId)
    for (const seat of Object.values(reserved)) add(seat[1]?.userId)
    return users
  }

  /**
   * The account a reconnection token belongs to, or undefined when it matches no spectator
   * here. Matchmaking checks it before letting a reconnect through (colyseus.ts), as for seats.
   */
  reconnectionOwner(token: string): string | undefined {
    const internals = this as unknown as {
      _reconnections: Record<string, [string] | undefined>
      _reservedSeats: Record<string, [unknown, PlayerAuth | undefined] | undefined>
    }
    const pending = internals._reconnections[token]?.[0]
    if (pending) return internals._reservedSeats[pending]?.[1]?.userId
    return this.clients.find((c) => c.reconnectionToken === token)?.auth?.userId
  }

  /**
   * Stops `userId` watching (suspended, kicked, or no longer invited): connected spectators
   * are closed, and one waiting to reconnect can't come back.
   */
  removeSpectator(userId: string) {
    this.removed.add(userId)
    for (const c of [...this.clients]) {
      if (c.auth?.userId === userId) this.close(c, CLOSE_CODES.kicked)
    }
  }

  override onCreate(options: { matchRoomId?: unknown }) {
    const match =
      typeof options.matchRoomId === 'string'
        ? matchMaker.getLocalRoomById(options.matchRoomId)
        : undefined
    if (!(match instanceof MatchRoom)) throw joinError('room_not_found')
    this.match = match
    match.attachWatch(this)
    void this.setPrivate(true).catch(() => {})
    // What spectators may see now: on a delayed (ranked) game, the actions after the delayed
    // frame still have to be sent as `events` when their turn comes.
    const view = match.spectatorView()
    this.feed.resetTo(view ? view.entries : match.moveLogEntries().length)
    this.sync()
    this.onMessage('syncClock', (client: WatchClient) => {
      const clock = this.spectatorClock()
      if (clock) client.send('clock', clock)
    })
    this.onMessage('*', (client: WatchClient, type) => {
      client.send('error', { code: 'spectating', requestType: String(type) })
    })
  }

  override onJoin(client: WatchClient, _options?: unknown, auth?: PlayerAuth) {
    // Removed between its reservation and connecting (admitted again, onAuth clears this).
    const userId = (auth ?? client.auth)?.userId
    if (userId && this.removed.has(userId)) throw joinError('kicked')
    this.sync()
    this.welcome(client)
    this.countSpectators()
  }

  /** Closes a spectator's connection for good (no reconnection, see onDrop). */
  private close(client: WatchClient, code: number) {
    this.closing.add(client)
    client.leave(code)
  }

  override async onDrop(client: WatchClient) {
    // Closed by the room (the spectator was removed): nothing to come back to.
    if (this.closing.has(client)) return
    if (client.auth?.userId && this.removed.has(client.auth.userId)) return
    this.allowReconnection(client, SPECTATOR_RECONNECT_SECONDS).catch(() => {})
  }

  override onReconnect(client: WatchClient) {
    if (client.auth?.userId && this.removed.has(client.auth.userId)) {
      this.close(client, CLOSE_CODES.kicked)
      return
    }
    this.sync()
    this.welcome(client)
  }

  override onLeave(client: WatchClient) {
    this.countSpectators(client)
  }

  override onDispose() {
    if (this.match) this.match.attachWatch(null)
    this.match = null
  }

  /** The count shown to everyone ("3 watching"): accounts, not connections. */
  private countSpectators(leaving?: WatchClient) {
    const users = new Set(
      this.clients.filter((c) => c !== leaving).map((c) => c.auth?.userId ?? c.sessionId),
    )
    this.match?.setSpectators(users.size)
  }

  private welcome(client: WatchClient) {
    client.send('welcome', {
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      sessionId: client.sessionId,
      seat: -1,
      isHost: false,
      spectator: true,
      delayRounds: this.state.delayRounds,
    })
    const entries = this.visibleEntries()
    if (entries.length > 0 || this.state.phase === 'in_game') {
      client.send('moveLog', { entries })
    }
    const clock = this.spectatorClock()
    if (clock && this.state.matchId) client.send('clock', clock)
  }

  /** The move log entries spectators may see right now. */
  private visibleEntries(): MoveLogEntry[] {
    const match = this.match
    if (!match) return []
    const all = match.moveLogEntries()
    const view = match.spectatorView()
    return [...(view ? all.slice(0, view.entries) : all)]
  }

  /** The clock spectators may see: live, or the delayed frame's (not running). */
  private spectatorClock(): ClockSync | null {
    const match = this.match
    if (!match) return null
    const view = match.spectatorView()
    return view ? frozenClock(view.frame.clock) : match.liveClock()
  }

  /**
   * Refreshes the state copy (the match room calls this before each of its patches) and, for
   * a delayed view, sends the actions spectators may now see.
   */
  sync() {
    const match = this.match
    if (!match) return
    const view = match.spectatorView()
    mirrorState(this.state, match.state, view?.frame ?? null)
    this.feed.advance(view, match, (type, payload) => {
      ;(this.broadcast as (t: string, m: unknown) => void)(type, payload)
    })
  }

  /** A broadcast of the match room, passed on unless spectators mustn't see it (yet). */
  relay<K extends keyof ServerMessages>(type: K, payload: ServerMessages[K]) {
    const match = this.match
    if (!match) return
    // The players' business: rematch votes, and refusals of their lobby actions.
    if (type === 'rematchEvent' || type === 'kicked') return
    if (type === 'error' && (payload as ServerMessages['error']).code !== 'maintenance') return
    // The result may come right after the delay ended: catch up first.
    if (type === 'gameOver') this.sync()
    if (match.spectatorView() && LIVE_ONLY.includes(type)) return
    if (type === 'events') {
      this.feed.seen((payload as ServerMessages['events']).seq)
    }
    ;(this.broadcast as (t: string, m: unknown) => void)(type, payload)
  }
}
