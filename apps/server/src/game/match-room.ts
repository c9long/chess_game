/**
 * The `match` room: pre-game lobby and live game in one room, so seat binding and
 * reconnection stay simple (PLAN §3, M4/M5).
 *
 * Phases: waiting -> civ_select -> [draft_ban -> draft_pick: reserved] -> countdown -> in_game
 * -> finished. The server holds the authoritative @game/rules Game and the clocks; clients
 * only send intents (lobby actions, moves) and never report moves, clocks or results.
 */

import { type AuthContext, type Client, matchMaker, Room } from '@colyseus/core'
import { TIME_CONTROLS, type TimeControlId } from '@game/config'
import {
  CLOSE_CODES,
  type ClientMessages,
  type ClientMessageType,
  type ClockSync,
  clientMessageSchemas,
  createOptionsSchema,
  DRAW_OFFER_COOLDOWN_MOVES,
  DRAW_VOTE,
  type DrawLapseReason,
  type ErrorCode,
  type GameAction,
  isReservedMessageType,
  isUntimed,
  joinOptionsSchema,
  type LobbyMetadata,
  PROTOCOL_VERSION,
  type ResignLapseReason,
  type ServerMessages,
  SOLO_DEFAULT_NAME,
  TEAM_RESIGN_COOLDOWN_MOVES,
} from '@game/protocol'
import { createMatchState, EventState, type MatchState, type SeatState } from '@game/protocol/state'
import {
  type CivId,
  Game,
  type GameEvent,
  type Outcome,
  RULES_VERSION,
  SEATS,
  type Seat,
  seatIndex,
} from '@game/rules'
import { hash, verify } from '@node-rs/argon2'
import { BotServiceError, fallbackMove } from './bot-client.ts'
import { GameClock, monoNow } from './clock.ts'
import {
  allAccepted,
  botAcceptsDraw,
  initialVotes,
  lapseReason,
  turnsPlayed,
} from './draw-logic.ts'
import { GameError, joinError } from './errors.ts'
import {
  clearSeat,
  filledCount,
  isLobbyPhase,
  nextHost,
  refreshLobbyPhase,
  SEAT_NUMS,
  type SeatBinding,
  type SeatNum,
  seatBot,
  seatHuman,
  seatOfSession,
  seatOfUser,
  startBlocker,
  swapSeats,
} from './lobby-logic.ts'
import { type FinishResult, type MatchEventType, MatchRecorder } from './persistence.ts'
import { type PlayerAuth, resolvePlayer } from './player-auth.ts'
import { botAcceptsTeamResign, resignLapseReason, teammateOf, teamOf } from './resign-logic.ts'
import type { GameService, ManagedRoom } from './service.ts'

/** What the matchmaking route passes as `AuthContext.req`. */
export interface MatchmakeInfo {
  method: string
  /** Room name, or the room id for joinById. */
  target: string
  ip: string | undefined
}

/** Lobby passwords: argon2id like account passwords (PLAN §5), kept in memory only. */
const ARGON2 = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

type MatchClient = Client<{ auth: PlayerAuth }>

/** How long a finished room stays open for the end screen before it closes. */
const FINISHED_ROOM_TTL_MS = 10 * 60_000

/** How long a matchmaking seat reservation waits for its WebSocket (Colyseus default: 15). */
const RESERVATION_SECONDS = 10
/** Our own record of a reservation outlives Colyseus' by a little (never undercounts). */
export const CLAIM_TTL_MS = RESERVATION_SECONDS * 1000 + 2_000

/** A player as returned from onAuth: `sessionId` makes Colyseus reserve under our id. */
type ReservedPlayer = PlayerAuth & { sessionId?: string }

/** A bot's pending move: one bot-service request (or a local move), for one turn. */
interface BotTurn {
  seat: number
  /** Position the request was made for. */
  position: string
  /** No human takes turns or watches any more: quick local moves only, no bot-service. */
  local: boolean
  ctrl: AbortController
  timer: NodeJS.Timeout | undefined
  /** The computed move (undefined: local fallback), once it waits on the pacing timer. */
  pending?: { move: string | undefined }
}

/** Time a bot keeps back from its clock for the local fallback move and the round trip. */
function botSafetyMarginMs(remainingMs: number): number {
  return Math.min(300, Math.max(50, remainingMs * 0.2))
}

/**
 * The clock bot-service is told about in untimed games: generous, so every level searches
 * for its normal target time.
 */
const UNTIMED_BOT_CLOCK_MS = 600_000

/** Bot pacing: a bot with less than this on its clock moves without waiting. */
const BOT_PACE_MIN_CLOCK_MS = 10_000
/** Bot pacing never waits for more than this share of the bot's remaining time. */
const BOT_PACE_MAX_CLOCK_SHARE = 0.25
/** Bot pacing after an action that defeated, froze or removed an army (longer animations). */
const BOT_PACE_DEFEAT_FACTOR = 2.2

/** Picks `count` distinct civs from `pool` (not in `exclude`), at random; repeats only if short. */
export function pickBotCivs(pool: readonly string[], exclude: string, count: number): string[] {
  const shuffled = (list: string[]) => {
    const a = [...list]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j] as string, a[i] as string]
    }
    return a
  }
  const fresh = shuffled(pool.filter((c) => c !== exclude))
  const out = fresh.slice(0, count)
  const fallback = fresh.length > 0 ? fresh : [...pool]
  while (out.length < count && fallback.length > 0) {
    out.push(fallback[Math.floor(Math.random() * fallback.length)] as string)
  }
  return out
}

export class MatchRoom
  extends Room<{ state: MatchState; metadata: LobbyMetadata; client: MatchClient }>
  implements ManagedRoom
{
  /** Set by `attachGameServer` before the room type is defined. */
  static service: GameService

  /**
   * Seats are counted by the room itself (occupied seats plus other users' pending
   * reservations, see `openSeats`), not by Colyseus: its client count includes every
   * unconsumed reservation, so a low limit would let one account lock the room with raw
   * matchmaking calls. This only bounds memory.
   */
  override maxClients = 64
  override seatReservationTimeout = RESERVATION_SECONDS
  /** Flooding clients are disconnected (and get the usual reconnect grace). */
  override maxMessagesPerSecond = 40
  override state = createMatchState()

  private svc!: GameService
  private bindings: (SeatBinding | null)[] = [null, null, null, null]
  private hostUserId: string | null = null
  private passwordHash: string | null = null
  private kicked = new Set<string>()

  private game: Game | null = null
  private gameClock: GameClock | null = null
  private recorder: MatchRecorder | null = null
  private starting = false
  private countdownTimer: NodeJS.Timeout | undefined
  private flagTimer: NodeJS.Timeout | undefined
  private syncTimer: NodeJS.Timeout | undefined
  private closeTimer: NodeJS.Timeout | undefined
  private hostGraceTimer: NodeJS.Timeout | undefined
  private botTurn: BotTurn | null = null
  /** Singleplayer room (`kind: 'solo'`): the creator's civ. Null for multiplayer lobbies. */
  private solo: { civ: string } | null = null
  /** Untimed game: no clock ever runs (solo rooms). */
  private untimed = false
  /** Ranked lobby: registered accounts only, no bots, Elo-rated (fixed at create). */
  private ranked = false
  /**
   * Challenge lobby (fixed at create): invite-only, never listed. `userIds` may take a seat
   * (the challenger and the invited friends); everyone else gets `not_invited`.
   */
  private invite: { challengeId: string; userIds: Set<string> } | null = null
  /** Bot pacing: monotonic time of the latest game action (or the game start). */
  private lastActionAt = 0
  /** Bot pacing: how long after `lastActionAt` a bot's move may be applied. */
  private paceGapMs = 0
  /** Pending bot answers to the current draw offer. */
  private drawBotTimers: NodeJS.Timeout[] = []
  /** Seats that took a turn (moved or passed) since the pending draw offer. */
  private drawTurnsTaken = new Set<number>()
  /** Teams resignation votes, per team: a bot teammate's pending answer. */
  private resignBotTimers: (NodeJS.Timeout | undefined)[] = [undefined, undefined]
  /** Per team: seats that took a turn (moved or passed) since the pending proposal. */
  private resignTurnsTaken: Set<number>[] = [new Set(), new Set()]
  /** Per team: id of the pending proposal (tells proposals apart for bot answers). */
  private resignProposalIds = [0, 0]
  private resignProposalSeq = 0

  // -------------------------------------------------------------------------
  // Authentication (matchmaking request: cookie or bearer token)
  // -------------------------------------------------------------------------

  static override async onAuth(
    _token: string,
    options: unknown,
    context: AuthContext,
  ): Promise<ReservedPlayer> {
    const svc = MatchRoom.service
    const info = context.req as MatchmakeInfo | undefined
    if (!info) throw joinError('unauthorized') // server-initiated joins are not supported
    const player = await resolvePlayer(svc.auth, svc.db, context.headers)

    if (info.method === 'create') {
      if (svc.maintenance) throw joinError('maintenance')
      if (svc.rooms.size >= svc.config.game.maxMatchRooms) throw joinError('maintenance')
      if ((options as { protocolVersion?: unknown })?.protocolVersion !== PROTOCOL_VERSION) {
        throw joinError('protocol_mismatch')
      }
      const parsed = createOptionsSchema.safeParse(options)
      if (!parsed.success) throw joinError('invalid_options')
      const opts = parsed.data
      if (opts.kind === 'lobby' && opts.pickMode === 'draft') throw joinError('not_implemented')
      if (opts.kind === 'lobby' && opts.ranked && player.isGuest) {
        throw joinError('account_required')
      }
      if (opts.name !== undefined && !svc.namePolicy.checkLobbyName(opts.name).ok) {
        throw joinError('invalid_options')
      }
      if (opts.kind === 'solo') {
        const civs = svc.civs.enabledSlugsCached() ?? (await svc.civs.enabledSlugs())
        if (!civs.includes(opts.civ)) throw joinError('invalid_options')
      }
      if (svc.seats.has(player.userId)) throw joinError('already_in_room')
      // Synchronous from the last check on: concurrent creates can't both claim the seat.
      const sessionId = svc.claimSeat(player.userId, '', CLAIM_TTL_MS)
      // Hand the creator to onCreate (see GameService.issueCreatorTicket).
      ;(options as Record<string, unknown>).creatorTicket = svc.issueCreatorTicket(
        player,
        sessionId,
      )
      return { ...player, sessionId }
    }

    if (info.method === 'joinById') {
      const room = matchMaker.getLocalRoomById(info.target)
      if (!(room instanceof MatchRoom)) throw joinError('room_not_found')
      if ((options as { protocolVersion?: unknown })?.protocolVersion !== PROTOCOL_VERSION) {
        throw joinError('protocol_mismatch')
      }
      const parsed = joinOptionsSchema.safeParse(options)
      if (!parsed.success) throw joinError('invalid_options')
      return room.admit(player, parsed.data.password ?? '', info.ip)
    }

    throw joinError('room_not_joinable')
  }

  /**
   * Matchmaking checks that need the room: seat rules, kicks, the password with its attempt
   * limits. A newcomer's reservation is recorded as a seat claim (GameService.claimSeat),
   * which onJoin requires and which counts toward the room's open seats until it is used.
   */
  private async admit(
    player: PlayerAuth,
    password: string,
    ip: string | undefined,
  ): Promise<ReservedPlayer> {
    if (this.isRejoin(player)) return player
    this.newSeatChecks(player)
    if (this.passwordHash) {
      const limiter = this.svc.passwordAttempts
      const keys = [`ip:${ip ?? 'unknown'}`, `room:${this.roomId}`]
      if (keys.some((k) => limiter.blocked(k))) throw joinError('too_many_attempts')
      // Count the attempt before the slow verify, so a burst of parallel guesses can't run
      // more checks than the limit; a correct password is refunded.
      for (const k of keys) limiter.fail(k)
      const ok = await verify(this.passwordHash, password).catch(() => false)
      if (!ok) throw joinError('invalid_password')
      for (const k of keys) limiter.refund(k)
      // The room may have changed during the verify.
      if (this.isRejoin(player)) return player
      this.newSeatChecks(player)
    }
    const sessionId = this.svc.claimSeat(player.userId, this.roomId, CLAIM_TTL_MS)
    return { ...player, sessionId }
  }

  /** The player already has a seat here (rejoin); refused while that seat is connected. */
  private isRejoin(player: PlayerAuth): boolean {
    const own = seatOfUser(this.bindings, player.userId)
    if (own === -1) return false
    if (this.state.seats[own]?.connected) throw joinError('already_seated')
    return true
  }

  /** Seat rules for a newcomer, checked at matchmaking (admit) and again on connect (onJoin). */
  private newSeatChecks(player: PlayerAuth) {
    const svc = this.svc
    // A solo room seats its creator only (who rejoins through isRejoin).
    if (this.solo && player.userId !== this.hostUserId) throw joinError('room_not_joinable')
    // Ranked lobbies seat registered accounts only.
    if (this.ranked && player.isGuest) throw joinError('account_required')
    // Challenge lobbies seat the challenger and the invited friends only.
    if (this.invite && !this.invite.userIds.has(player.userId)) throw joinError('not_invited')
    if (this.kicked.has(player.userId)) throw joinError('kicked')
    const elsewhere = svc.seats.get(player.userId)
    if (elsewhere && elsewhere !== this.roomId) throw joinError('already_in_room')
    if (!isLobbyPhase(this.state.phase) || this.starting || svc.maintenance) {
      throw joinError('room_not_joinable')
    }
    if (this.openSeats(player.userId) <= 0) throw joinError('room_full')
  }

  /** Empty seats not spoken for by other users' pending reservations. */
  private openSeats(userId: string): number {
    const empty = this.state.seats.filter((s) => !s.occupied).length
    return empty - this.svc.pendingClaims(this.roomId, userId).length
  }

  /** The creator (host) still holds an unconsumed reservation for this room. */
  private hostClaimPending(): boolean {
    return this.hostUserId !== null && this.svc.liveClaim(this.hostUserId)?.roomId === this.roomId
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  override async onCreate(options: Record<string, unknown>) {
    this.svc = MatchRoom.service
    const creator = this.svc.takeCreatorTicket(options.creatorTicket)
    const { creatorTicket: _ignored, ...rest } = options
    const parsed = createOptionsSchema.parse(rest)
    const name =
      parsed.name === undefined
        ? { ok: true as const, name: SOLO_DEFAULT_NAME }
        : this.svc.namePolicy.checkLobbyName(parsed.name)
    if (!creator || !name.ok) throw joinError('unauthorized')
    this.hostUserId = creator.player.userId
    // The creator's reservation now belongs to this room (unless a newer claim replaced it).
    const claim = this.svc.liveClaim(creator.player.userId)
    if (claim && claim.roomId === '' && claim.sessionIds.has(creator.sessionId)) {
      claim.roomId = this.roomId
    }
    if (parsed.kind === 'lobby' && parsed.password) {
      this.passwordHash = await hash(parsed.password, ARGON2)
    }

    const s = this.state
    s.protocolVersion = PROTOCOL_VERSION
    s.name = name.name
    s.mode = parsed.mode
    s.timeControl = parsed.timeControl
    s.pickMode = parsed.kind === 'lobby' ? parsed.pickMode : 'blind'
    s.hasPassword = Boolean(this.passwordHash)
    this.ranked = parsed.kind === 'lobby' && parsed.ranked
    s.ranked = this.ranked
    if (creator.invite && parsed.kind === 'lobby' && !this.ranked && !this.passwordHash) {
      this.invite = {
        challengeId: creator.invite.challengeId,
        userIds: new Set([creator.player.userId, ...creator.invite.userIds]),
      }
      s.inviteOnly = true
      void this.setPrivate(true).catch(() => {})
    }
    s.phase = 'waiting'
    s.reconnectGraceMs = this.svc.config.game.reconnectGraceMs
    this.untimed = isUntimed(parsed.timeControl)
    s.clock.incrementMs = this.untimed
      ? 0
      : TIME_CONTROLS[parsed.timeControl as TimeControlId].incrementMs
    if (parsed.kind === 'solo') {
      // Singleplayer: never in the lobby browser; three bots at West, North and East with
      // random civs (distinct from each other and from the player's), at the chosen level.
      this.solo = { civ: parsed.civ }
      void this.setPrivate(true).catch(() => {})
      const civs = await this.enabledCivs()
      const botCivs = pickBotCivs(civs, parsed.civ, 3)
      for (const seat of [1, 2, 3] as const) {
        seatBot(s, seat, parsed.botLevel, botCivs[seat - 1] ?? parsed.civ)
      }
      refreshLobbyPhase(s)
    }
    this.metadata = this.listing()
    this.svc.rooms.add(this)
    this.registerHandlers()
    // If the creator never connects, the host role passes on once their reservation lapses.
    this.hostGraceTimer = setTimeout(() => {
      this.hostGraceTimer = undefined
      if (isLobbyPhase(this.state.phase) && !this.hostSeated()) this.afterSeatsChanged()
    }, CLAIM_TTL_MS + 100)
  }

  override onJoin(client: MatchClient, _options: unknown, auth?: PlayerAuth) {
    const player = auth ?? client.auth
    if (!player) throw joinError('unauthorized')
    if (this.isRejoin(player)) {
      this.rebind(seatOfUser(this.bindings, player.userId) as SeatNum, client, player)
      return
    }
    // A newcomer must hold the reservation matchmaking handed out (a newer one elsewhere
    // replaces it), and the seat rules are checked again: the room may have changed since
    // (a kick, a seat taken elsewhere, the game starting, maintenance).
    if (this.kicked.has(player.userId)) throw joinError('kicked')
    const claim = this.svc.liveClaim(player.userId)
    if (!claim || claim.roomId !== this.roomId || !claim.sessionIds.has(client.sessionId)) {
      throw joinError(
        claim && claim.roomId !== this.roomId ? 'already_in_room' : 'room_not_joinable',
      )
    }
    this.newSeatChecks(player)
    const seat = this.pickSeat(player.userId)
    if (seat === -1) throw joinError('room_full')
    this.svc.claims.delete(player.userId)
    this.bindings[seat] = {
      userId: player.userId,
      displayName: player.displayName,
      isGuest: player.isGuest,
      sessionId: client.sessionId,
    }
    seatHuman(this.state, seat, { ...player, sessionId: client.sessionId })
    if (this.solo) {
      const mine = this.state.seats[seat] as SeatState
      mine.civ = this.solo.civ
      mine.ready = true
    }
    this.svc.seats.set(player.userId, this.roomId)
    if (!this.hostUserId || (!this.hostSeated() && !this.hostClaimPending())) {
      this.hostUserId = player.userId
    }
    this.afterSeatsChanged()
    this.welcome(client)
    if (this.invite) this.svc.lobbyHooks.seated?.(this.roomId, player.userId)
  }

  /** First empty seat; seat 0 is kept for a creator who hasn't connected yet. */
  private pickSeat(userId: string): SeatNum | -1 {
    const free = SEAT_NUMS.filter((i) => !this.state.seats[i]?.occupied)
    if (free[0] === 0 && free.length > 1 && userId !== this.hostUserId && this.hostClaimPending()) {
      return free[1] as SeatNum
    }
    return free[0] ?? -1
  }

  /** The same user connects again while their seat waits for a reconnection. */
  private rebind(seat: SeatNum, client: MatchClient, player: PlayerAuth) {
    const binding = this.bindings[seat] as SeatBinding
    const old = this.clients.find((c) => c.sessionId === binding.sessionId)
    binding.sessionId = client.sessionId
    binding.displayName = player.displayName
    const s = this.state.seats[seat] as SeatState
    s.sessionId = client.sessionId
    s.connected = true
    s.graceDeadline = 0
    const phase = this.state.phase
    if (isLobbyPhase(phase) || (phase === 'in_game' && this.takesTurns(seat))) {
      this.svc.seats.set(player.userId, this.roomId)
    }
    if (old && old !== client) old.leave(CLOSE_CODES.seatLost)
    if (this.state.phase === 'in_game') this.record(seat, 'reconnect', { via: 'rejoin' }, null)
    this.afterSeatsChanged()
    this.welcome(client)
  }

  override async onDrop(client: MatchClient) {
    const seat = seatOfSession(this.bindings, client.sessionId)
    if (seat === -1) return // kicked or replaced
    const s = this.state.seats[seat] as SeatState
    const phase = this.state.phase
    if (phase === 'finished') return
    const graceMs = this.svc.config.game.reconnectGraceMs
    s.connected = false
    s.graceDeadline = Date.now() + graceMs
    if (phase === 'countdown') this.cancelCountdown()
    if (phase === 'in_game') {
      this.record(seat, 'disconnect', { graceDeadline: s.graceDeadline }, null)
    }
    this.updateListing()
    // Not awaited: resolves on reconnect (onReconnect) or rejects on expiry (then onLeave).
    this.allowReconnection(client, graceMs / 1000).catch(() => {})
  }

  override onReconnect(client: MatchClient) {
    const seat = seatOfSession(this.bindings, client.sessionId)
    if (seat === -1) {
      // Kicked (or replaced by a rejoin) while away: no seat to come back to.
      client.leave(CLOSE_CODES.seatLost)
      return
    }
    const s = this.state.seats[seat] as SeatState
    s.connected = true
    s.graceDeadline = 0
    if (this.state.phase === 'in_game') this.record(seat, 'reconnect', {}, null)
    this.updateListing()
    this.maybeAutoStart()
    this.welcome(client)
  }

  override onLeave(client: MatchClient) {
    const seat = seatOfSession(this.bindings, client.sessionId)
    if (seat === -1) return // kicked, replaced by a rejoin, or never seated
    const binding = this.bindings[seat] as SeatBinding
    const s = this.state.seats[seat] as SeatState
    const phase = this.state.phase
    if (phase === 'in_game') {
      // Consented leave or reconnect grace expired: abandon (PLAN §2, treated like a timeout).
      s.connected = false
      s.graceDeadline = 0
      this.svc.seats.delete(binding.userId)
      if (this.takesTurns(seat as SeatNum) && this.abandonPolicy(seat as SeatNum) === 'abandon') {
        const now = monoNow()
        this.settleFallenFlag(now)
        if (this.state.phase === 'in_game' && this.takesTurns(seat as SeatNum)) {
          this.runAction('abandon', seat as SeatNum, null, now)
        }
      }
      return
    }
    if (phase === 'finished') {
      s.connected = false
      this.svc.seats.delete(binding.userId)
      return
    }
    // Pre-game: the seat is freed.
    if (phase === 'countdown') this.cancelCountdown()
    this.bindings[seat] = null
    clearSeat(s)
    this.svc.seats.delete(binding.userId)
    if (binding.userId === this.hostUserId)
      this.hostUserId = nextHost(this.bindings, binding.userId)
    this.afterSeatsChanged()
  }

  override async onDispose() {
    this.svc.rooms.delete(this)
    if (this.invite) this.svc.lobbyHooks.ended?.(this.roomId, 'closed')
    this.clearTimers()
    for (const b of this.bindings) {
      if (b && this.svc.seats.get(b.userId) === this.roomId) this.svc.seats.delete(b.userId)
    }
    if (this.state.phase === 'in_game' && this.recorder) {
      await this.recorder.abort('room_disposed').catch(() => {})
    }
    this.game?.free()
    this.game = null
  }

  /**
   * A challenge lobby's invitation ended (expired or cancelled): from now on only players
   * already seated (who may rejoin) can take a seat.
   */
  revokeInvites() {
    if (!this.invite) return
    const seated = this.bindings.filter((b): b is SeatBinding => b !== null).map((b) => b.userId)
    this.invite.userIds = new Set(seated)
  }

  /** Whether `userId` hosts this challenge lobby, seated, before the game: may invite again. */
  canReinvite(userId: string): boolean {
    return (
      this.invite !== null &&
      isLobbyPhase(this.state.phase) &&
      !this.starting &&
      this.hostUserId === userId &&
      this.bindings.some((b) => b?.userId === userId)
    )
  }

  /**
   * The account whose seat a reconnection token belongs to, or undefined when the token
   * matches no seat here. Read-only (unlike Colyseus' `checkReconnectionToken`, which closes a
   * still-connected client): matchmaking checks it before letting a reconnect through.
   */
  reconnectionOwner(token: string): string | undefined {
    const pending = (this as unknown as { _reconnections: Record<string, [string] | undefined> })
      ._reconnections[token]?.[0]
    const sessionId = pending ?? this.clients.find((c) => c.reconnectionToken === token)?.sessionId
    if (!sessionId) return undefined
    return this.bindings[seatOfSession(this.bindings, sessionId)]?.userId
  }

  /** Whether `userId` holds a seat here. */
  hasSeated(userId: string): boolean {
    return this.bindings.some((b) => b?.userId === userId)
  }

  /** A new challenge for this lobby: `userIds` may take a seat again. */
  reopenInvites(challengeId: string, userIds: string[]) {
    if (!this.invite) return
    this.invite.challengeId = challengeId
    for (const id of userIds) this.invite.userIds.add(id)
  }

  /** One invited player may no longer join (unless already seated). */
  revokeInvite(userId: string) {
    if (!this.invite) return
    if (this.bindings.some((b) => b?.userId === userId)) return
    this.invite.userIds.delete(userId)
  }

  // -------------------------------------------------------------------------
  // ManagedRoom (graceful shutdown)
  // -------------------------------------------------------------------------

  isGameRunning(): boolean {
    return this.state.phase === 'in_game' || this.starting
  }

  abortsOnDrain(): boolean {
    return this.untimed && this.state.phase === 'in_game'
  }

  async closeLobby(reason: string) {
    this.cancelCountdown()
    this.broadcast('error', { code: 'maintenance', message: reason })
    await this.disconnect(CLOSE_CODES.roomClosed)
  }

  async abortGame(reason: string) {
    if (this.state.phase !== 'in_game') return
    this.state.phase = 'finished'
    this.clearTimers()
    this.cancelBotTurn()
    this.clearDrawOffer()
    this.clearTeamResign(0)
    this.clearTeamResign(1)
    this.state.result.type = 'aborted'
    this.state.result.endReason = reason
    this.state.seatToMove = -1
    this.updateListing()
    await this.recorder?.abort(reason)
    this.broadcast('error', { code: 'maintenance', message: reason })
    this.releaseSeats()
    await this.disconnect(CLOSE_CODES.roomClosed)
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private registerHandlers() {
    this.handle('setCiv', async (client, { civ }) => {
      this.requireSeat(client)
      this.requireLobby()
      const civs = await this.enabledCivs()
      // Resolve the seat after any await: a swap meanwhile may have moved the sender.
      const seat = this.requireSeat(client)
      this.requireLobby()
      if (!civs.includes(civ)) throw new GameError('civ_unavailable')
      ;(this.state.seats[seat] as SeatState).civ = civ
      this.updateListing()
    })
    this.handle('setReady', (client, { ready }) => {
      const seat = this.requireSeat(client)
      this.requireLobby()
      const s = this.state.seats[seat] as SeatState
      if (ready && !s.civ) throw new GameError('civ_required')
      s.ready = ready
    })
    this.handle('addBot', async (client, { seat, level }) => {
      this.requireHost(client)
      this.requireLobby()
      if (this.ranked) throw new GameError('ranked_no_bots', 'ranked games are for people only')
      if ((this.state.seats[seat] as SeatState).occupied) throw new GameError('seat_occupied')
      const civs = await this.enabledCivs()
      this.requireHost(client)
      this.requireLobby()
      if ((this.state.seats[seat] as SeatState).occupied) throw new GameError('seat_occupied')
      const civ = civs[Math.floor(Math.random() * civs.length)] ?? 'canada'
      seatBot(this.state, seat, level, civ)
      this.afterSeatsChanged()
    })
    this.handle('removeBot', (client, { seat }) => {
      this.requireHost(client)
      this.requireLobby()
      const s = this.state.seats[seat] as SeatState
      if (!s.isBot) throw new GameError('not_a_bot')
      clearSeat(s)
      this.afterSeatsChanged()
    })
    this.handle('setBotCiv', async (client, { seat, civ }) => {
      this.requireHost(client)
      this.requireLobby()
      if (!(this.state.seats[seat] as SeatState).isBot) throw new GameError('not_a_bot')
      const civs = await this.enabledCivs()
      this.requireHost(client)
      this.requireLobby()
      if (!civs.includes(civ)) throw new GameError('civ_unavailable')
      const s = this.state.seats[seat] as SeatState
      if (!s.isBot) throw new GameError('not_a_bot')
      s.civ = civ
      this.updateListing()
    })
    this.handle('kick', (client, { seat }) => {
      const hostSeat = this.requireHost(client)
      this.requireLobby()
      if (seat === hostSeat) throw new GameError('invalid_seat')
      const s = this.state.seats[seat] as SeatState
      if (!s.occupied) throw new GameError('seat_empty')
      const binding = this.bindings[seat]
      if (s.isBot || !binding) {
        clearSeat(s)
      } else {
        this.kicked.add(binding.userId)
        this.bindings[seat] = null
        clearSeat(s)
        this.svc.seats.delete(binding.userId)
        this.svc.releaseClaim(binding.userId, this.roomId)
        const target = this.clients.find((c) => c.sessionId === binding.sessionId)
        target?.send('kicked', { reason: 'host' })
        target?.leave(CLOSE_CODES.kicked)
      }
      this.afterSeatsChanged()
    })
    this.handle('swapSeats', (client, { a, b }) => {
      this.requireHost(client)
      this.requireLobby()
      if (a === b) throw new GameError('invalid_seat')
      swapSeats(this.state, a, b)
      const tmp = this.bindings[a] ?? null
      this.bindings[a] = this.bindings[b] ?? null
      this.bindings[b] = tmp
      this.afterSeatsChanged()
    })
    this.handle('startGame', (client) => {
      this.requireHost(client)
      if (this.svc.maintenance) throw new GameError('maintenance')
      const blocker = startBlocker(this.state)
      if (blocker) throw new GameError(blocker)
      this.startCountdown()
    })
    this.handle('move', (client, { move }) => {
      const seat = this.requireSeat(client)
      if (this.state.phase !== 'in_game' || !this.game || !this.gameClock) {
        throw new GameError('wrong_phase')
      }
      if (seat !== this.state.seatToMove) throw new GameError('not_your_turn')
      const now = monoNow()
      if (this.gameClock.hasFlagged(now)) {
        this.runAction('timeout', seat, null, now)
        throw new GameError('not_your_turn', 'flag fell')
      }
      if (!this.game.legalMoveNotations().includes(move)) throw new GameError('illegal_move')
      this.runAction('move', seat, move, now)
    })
    this.handle('resign', (client) => {
      const seat = this.requireSeat(client)
      this.requireGame()
      if (!this.takesTurns(seat)) throw new GameError('not_playing')
      const now = monoNow()
      // A flag that fell before the resign arrived is a timeout first (the resigner's own
      // or the seat to move's); the resign then applies only if the game and seat go on.
      if (this.settleFallenFlag(now)) {
        if (this.state.phase !== 'in_game' || !this.takesTurns(seat)) return
      }
      // Teams: a resignation resigns the whole team, so the teammate votes first.
      if (this.state.mode === 'teams') {
        this.proposeTeamResign(seat, now)
        return
      }
      this.runAction('resign', seat, null, now)
    })
    this.handle('respondResign', (client, { accept }) => {
      const seat = this.requireSeat(client)
      this.requireGame()
      // A flag that fell first is a timeout; it may change the voters (the proposal lapses).
      this.settleFallenFlag(monoNow())
      this.requireGame()
      this.respondTeamResign(seat, accept)
    })
    this.handle('offerDraw', (client) => {
      const seat = this.requireSeat(client)
      this.requireGame()
      this.settleFallenFlag(monoNow())
      const game = this.requireGame()
      const voters = game.drawVoters()
      if (!voters[seat]) throw new GameError('not_playing')
      const s = this.state
      if (s.drawOfferSeat !== -1) throw new GameError('draw_offer_pending')
      const wait = s.drawCooldowns[seat] ?? 0
      if (wait > 0) {
        throw new GameError(
          'draw_offer_cooldown',
          `Make ${wait} more move${wait === 1 ? '' : 's'} before offering another draw.`,
        )
      }
      this.offerDraw(seat, voters)
    })
    this.handle('respondDraw', (client, { accept }) => {
      const seat = this.requireSeat(client)
      this.requireGame()
      // A flag that fell first is a timeout; it changes the voters, so the offer lapses.
      this.settleFallenFlag(monoNow())
      this.requireGame()
      this.respondDraw(seat, accept)
    })
    this.handle('syncClock', (client) => {
      if (this.gameClock) client.send('clock', this.clockSync())
    })
    this.onMessage('*', (client, type) => {
      const t = String(type)
      if (isReservedMessageType(t)) {
        this.sendError(client, 'not_implemented', t)
      } else {
        this.sendError(client, 'unknown_message', t)
      }
    })
  }

  private handle<K extends ClientMessageType>(
    type: K,
    fn: (client: MatchClient, payload: ClientMessages[K]) => void | Promise<void>,
  ) {
    const schema = clientMessageSchemas[type]
    this.onMessage(type, async (client: MatchClient, raw: unknown) => {
      const parsed = schema.safeParse(raw ?? {})
      if (!parsed.success) {
        this.sendError(client, 'invalid_message', type, parsed.error.issues[0]?.message)
        return
      }
      try {
        await fn(client, parsed.data as ClientMessages[K])
      } catch (err) {
        if (err instanceof GameError) {
          this.sendError(client, err.code, type, err.message === err.code ? undefined : err.message)
        } else {
          this.svc.logger.error(
            { room: this.roomId, type, err: (err as Error).message },
            'message handler failed',
          )
          this.sendError(client, 'internal', type)
        }
      }
    })
  }

  private sendError(client: MatchClient, code: ErrorCode, requestType?: string, message?: string) {
    const payload: ServerMessages['error'] = { code }
    if (requestType) payload.requestType = requestType
    if (message) payload.message = message
    client.send('error', payload)
  }

  /**
   * Enabled civ slugs: the cached catalog without awaiting when it has loaded once (so seat
   * lookups and writes happen in one synchronous step), else one database load.
   */
  private async enabledCivs(): Promise<string[]> {
    return this.svc.civs.enabledSlugsCached() ?? (await this.svc.civs.enabledSlugs())
  }

  private requireSeat(client: MatchClient): SeatNum {
    const seat = seatOfSession(this.bindings, client.sessionId)
    if (seat === -1) throw new GameError('not_seated')
    return seat as SeatNum
  }

  private requireHost(client: MatchClient): SeatNum {
    const seat = this.requireSeat(client)
    if (this.bindings[seat]?.userId !== this.hostUserId) throw new GameError('not_host')
    return seat
  }

  /** The live game (phase `in_game`), or `wrong_phase`. */
  private requireGame(): Game {
    if (this.state.phase !== 'in_game' || !this.game || !this.gameClock) {
      throw new GameError('wrong_phase')
    }
    return this.game
  }

  private requireLobby() {
    if (!isLobbyPhase(this.state.phase) || this.starting) throw new GameError('wrong_phase')
    // A solo room's seats, civs and bots are fixed at create; it starts by itself.
    if (this.solo) throw new GameError('wrong_phase', 'solo games start by themselves')
  }

  private hostSeated(): boolean {
    return this.hostUserId !== null && seatOfUser(this.bindings, this.hostUserId) !== -1
  }

  private welcome(client: MatchClient) {
    const seat = seatOfSession(this.bindings, client.sessionId)
    client.send('welcome', {
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      sessionId: client.sessionId,
      seat: seat === -1 ? -1 : (seat as SeatNum),
      isHost: seat !== -1 && this.bindings[seat]?.userId === this.hostUserId,
    })
    if (this.gameClock) client.send('clock', this.clockSync())
  }

  // -------------------------------------------------------------------------
  // Lobby state
  // -------------------------------------------------------------------------

  private listing(): LobbyMetadata {
    const s = this.state
    return {
      name: s.name,
      mode: s.mode as LobbyMetadata['mode'],
      timeControl: s.timeControl as LobbyMetadata['timeControl'],
      seatsFilled: filledCount(s),
      locked: s.hasPassword,
      phase: s.phase,
      pickMode: s.pickMode as LobbyMetadata['pickMode'],
      ranked: s.ranked,
      civs: [0, 1, 2, 3].map((i) => {
        const seat = s.seats[i] as SeatState | undefined
        return seat?.occupied ? seat.civ : ''
      }),
      occupied: [0, 1, 2, 3].map((i) => Boolean((s.seats[i] as SeatState | undefined)?.occupied)),
    }
  }

  private updateListing() {
    void this.setMetadata(this.listing()).catch(() => {})
  }

  private afterSeatsChanged() {
    refreshLobbyPhase(this.state)
    // The creator keeps the host role while their reservation is pending (no sniping it by
    // joining between create and the creator's connect).
    if (
      this.hostUserId &&
      !this.hostSeated() &&
      !this.hostClaimPending() &&
      isLobbyPhase(this.state.phase)
    ) {
      this.hostUserId = nextHost(this.bindings, null) ?? this.hostUserId
    }
    const host = this.hostUserId ? seatOfUser(this.bindings, this.hostUserId) : -1
    this.state.hostSeat = host
    this.updateListing()
    this.maybeAutoStart()
  }

  /** A solo room starts (countdown) as soon as its player is seated and connected. */
  private maybeAutoStart() {
    if (!this.solo || this.starting || this.svc.maintenance) return
    if (this.state.phase !== 'civ_select' || startBlocker(this.state)) return
    this.startCountdown()
  }

  private startCountdown() {
    const ms = this.svc.config.game.countdownMs
    this.state.phase = 'countdown'
    this.state.countdownEndsAt = Date.now() + ms
    this.updateListing()
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = undefined
      void this.beginGame()
    }, ms)
  }

  private cancelCountdown() {
    if (this.state.phase !== 'countdown' || this.starting) return
    clearTimeout(this.countdownTimer)
    this.countdownTimer = undefined
    this.state.countdownEndsAt = 0
    this.state.phase = 'civ_select'
    refreshLobbyPhase(this.state)
    this.updateListing()
  }

  // -------------------------------------------------------------------------
  // Game
  // -------------------------------------------------------------------------

  /**
   * What happens when a seated human is gone for good mid-game. v1: abandon (PLAN §2,
   * treated like a timeout). Hook for AFK bot takeover in casual lobbies (designed, built
   * later): return 'bot_takeover' and seat a bot instead.
   */
  protected abandonPolicy(_seat: SeatNum): 'abandon' | 'bot_takeover' {
    return 'abandon'
  }

  /**
   * Whether this is a singleplayer FFA game, still running, whose player no longer takes
   * turns (leader captured, stalemated, resigned or abandoned). Teams is left alone: a team
   * out already ends the game, and a defeated player whose partner plays on hasn't lost.
   */
  private soloPlayerOut(game: Game): boolean {
    if (!this.solo || this.state.mode !== 'ffa' || game.snapshot().isOver) return false
    const human = this.state.seats.findIndex((s) => s.occupied && !s.isBot)
    return human !== -1 && !game.drawVoters()[human]
  }

  private takesTurns(seat: SeatNum): boolean {
    const status = this.game?.snapshot().statuses[seat]
    return status === 'active' || status === 'defeated'
  }

  private async beginGame() {
    if (this.state.phase !== 'countdown' || this.starting) return
    this.starting = true
    const s = this.state
    const svc = this.svc
    let game: Game | null = null
    let recorder: MatchRecorder | null = null
    try {
      const blocker = startBlocker(s, { ignorePhase: true })
      if (blocker) throw new GameError(blocker)
      const civs = s.seats.map((seat) => seat.civ as CivId) as [CivId, CivId, CivId, CivId]
      game = Game.create({ mode: s.mode as 'ffa' | 'teams', civs })
      const snap = game.snapshot()
      const players = await Promise.all(
        SEAT_NUMS.map(async (i) => {
          const seat = s.seats[i] as SeatState
          return {
            seat: i,
            team: s.mode === 'teams' ? i % 2 : null,
            userId: seat.isBot ? null : (this.bindings[i]?.userId ?? null),
            botLevel: seat.isBot ? seat.botLevel : null,
            civId: await svc.civs.idOf(seat.civ),
            civVersion: snap.config.civs[i]?.version ?? 1,
          }
        }),
      )
      if (players.some((p) => !p.userId && !p.botLevel)) throw new GameError('not_ready')
      // Only ranked lobbies are rated (Elo); casual games never are, even with four
      // registered players. Untimed (solo) games are never rated in any pool. A ranked
      // lobby seats registered people only, so the seat check is a safety net.
      const rated =
        this.ranked && !this.untimed && s.seats.every((seat) => !seat.isBot && !seat.isGuest)
      if (this.ranked && !rated) throw new GameError('not_ready')
      recorder = await MatchRecorder.start(
        svc.db,
        svc.logger,
        {
          mode: s.mode as 'ffa' | 'teams',
          timeControl: s.timeControl,
          rated,
          rulesVersion: RULES_VERSION,
          startedAt: new Date(),
          players,
        },
        svc.config.game.eventFlushIntervalMs,
      )
      // Seats must still be intact after the database round trip.
      if (
        s.phase !== 'countdown' ||
        SEAT_NUMS.some((i) => !s.seats[i]?.occupied || (!s.seats[i]?.isBot && !this.bindings[i]))
      ) {
        throw new GameError('not_ready')
      }
      // Untimed: the clock object exists for bookkeeping but is never started.
      const tc = this.untimed ? null : TIME_CONTROLS[s.timeControl as TimeControlId]
      const base = tc ? (svc.config.game.devClockBaseMs ?? tc.baseMs) : 0
      this.game = game
      this.recorder = recorder
      this.gameClock = new GameClock(base, tc?.incrementMs ?? 0)
      game = null
      recorder = null
      s.matchId = this.recorder.matchId
      s.rated = rated
      s.phase = 'in_game'
      s.countdownEndsAt = 0
      this.autoDispose = false
      if (this.invite) this.svc.lobbyHooks.ended?.(this.roomId, 'started')
      // Off the lobby browser (a running game isn't a lobby); seated players still rejoin
      // by id.
      void this.setPrivate(true).catch(() => {})
      for (const i of SEAT_NUMS) (s.seats[i] as SeatState).status = snap.statuses[i]
      s.positionString = this.game.positionString()
      s.actionSeq = 0
      const now = monoNow()
      if (!this.untimed) this.gameClock.startTurn(seatIndex(snap.seatToMove) as SeatNum, now)
      s.seatToMove = seatIndex(snap.seatToMove)
      this.syncClockState(now)
      this.updateListing()
      this.broadcast('clock', this.clockSync(now))
      if (!this.untimed) {
        this.syncTimer = setInterval(() => {
          if (this.gameClock && this.state.phase === 'in_game') {
            const t = monoNow()
            this.syncClockState(t)
            this.broadcast('clock', this.clockSync(t))
          }
        }, svc.config.game.clockSyncIntervalMs)
      }
      this.lastActionAt = now
      this.paceGapMs = svc.config.game.botMinMoveMs
      this.armFlagTimer()
      this.maybeBotTurn()
    } catch (err) {
      game?.free()
      if (recorder) await recorder.abort('start_failed').catch(() => {})
      if (!(err instanceof GameError)) {
        svc.logger.error({ room: this.roomId, err: (err as Error).message }, 'game start failed')
      }
      if (s.phase === 'countdown') {
        s.phase = 'civ_select'
        s.countdownEndsAt = 0
        refreshLobbyPhase(s)
        this.updateListing()
      }
      this.broadcast('error', {
        code: err instanceof GameError ? err.code : 'internal',
        requestType: 'startGame',
      })
    } finally {
      this.starting = false
    }
  }

  /**
   * Applies one game action (a move, a timeout, an abandon, a resign or an agreed draw) with
   * the clock bookkeeping, then records, broadcasts and either finishes the game or starts
   * the next turn. `now` is monotonic time (monoNow()).
   */
  private runAction(
    kind: GameAction,
    seat: SeatNum,
    notation: string | null,
    now = monoNow(),
    extra: Record<string, unknown> = {},
  ) {
    const game = this.game
    const clock = this.gameClock
    if (!game || !clock || this.state.phase !== 'in_game') return
    const rulesSeat = SEATS[seat] as Seat
    const wasRunning = clock.running
    let events: GameEvent[]
    if (kind === 'move') {
      events = game.applyMove(notation as string)
      clock.endTurn(now, { increment: true })
    } else if (kind === 'timeout') {
      clock.endTurn(now, { increment: false })
      clock.remaining[seat] = 0
      events = game.applyTimeout(rulesSeat)
    } else if (kind === 'abandon') {
      events = game.applyAbandon(rulesSeat)
    } else if (kind === 'resign') {
      events = game.applyResign(rulesSeat)
    } else {
      events = game.applyAgreedDraw()
    }
    // Singleplayer FFA: once the player is out, the game ends there instead of being played
    // out between the bots. It ends as an agreed draw (the bots share 1st, the player keeps
    // their defeat-order place), recorded with its own end reason.
    const playerEliminated = kind !== 'agreed_draw' && this.soloPlayerOut(game)
    if (playerEliminated) events = [...events, ...game.applyAgreedDraw()]
    const snap = game.snapshot()
    // Abandons and resigns can come off-turn: the running clock then keeps running.
    const offTurnKind = kind === 'abandon' || kind === 'resign'
    if (snap.isOver) {
      clock.endTurn(now, { increment: false })
    } else {
      const next = seatIndex(snap.seatToMove) as SeatNum
      if (!offTurnKind || wasRunning === seat || clock.running !== next) {
        clock.endTurn(now, { increment: false })
        if (!this.untimed) clock.startTurn(next, now)
      }
    }

    const s = this.state
    s.actionSeq += 1
    s.positionString = game.positionString()
    s.seatToMove = snap.isOver ? -1 : seatIndex(snap.seatToMove)
    for (const i of SEAT_NUMS) (s.seats[i] as SeatState).status = snap.statuses[i]
    this.setLastEvents(events)
    this.syncClockState(now)

    // Persist: one row for the action, plus derived rows (passes, defeats, game end). An
    // agreed draw's action row is its game_end row (after the deciding draw_response); a
    // solo player's elimination ends the game with such a row too (replayed as a draw).
    const promotion = events.some((e) => e.type === 'promotion')
    if (kind !== 'agreed_draw') {
      const actionType: MatchEventType = kind === 'move' ? (promotion ? 'promotion' : 'move') : kind
      const remaining = this.untimed
        ? null
        : offTurnKind
          ? clock.remainingAt(seat, now)
          : clock.remaining[seat]
      this.record(
        seat,
        actionType,
        { actionSeq: s.actionSeq, notation, events, ...extra },
        remaining,
      )
    }
    let endReason = ''
    for (const e of events) {
      if (e.type === 'pass') {
        const p = seatIndex(e.seat)
        this.record(
          p,
          'pass',
          { actionSeq: s.actionSeq, derived: true },
          this.untimed ? null : clock.remaining[p as SeatNum],
        )
      } else if (e.type === 'defeat') {
        const d = seatIndex(e.seat)
        this.record(d, 'defeat', { actionSeq: s.actionSeq, reason: e.reason, derived: true }, null)
      } else if (e.type === 'game_ended') {
        // A Teams resignation ends the game as a team win; say how it was won.
        endReason = playerEliminated
          ? 'player_eliminated'
          : kind === 'resign' && e.outcome.result.type === 'teams_winner'
            ? 'team_resigned'
            : endReasonOf(e.outcome)
        this.record(
          null,
          'game_end',
          kind === 'agreed_draw' || playerEliminated
            ? { actionSeq: s.actionSeq, outcome: e.outcome, endReason, agreedDraw: true }
            : { actionSeq: s.actionSeq, outcome: e.outcome, endReason, derived: true },
          null,
        )
      }
    }

    const sync = this.clockSync(now)
    this.broadcast('events', {
      seq: s.actionSeq,
      action: kind,
      seat,
      notation,
      events,
      positionString: s.positionString,
      seatToMove: s.seatToMove as SeatNum | -1,
      clock: sync,
    })
    this.drawAfterAction(kind, seat, events)
    this.resignAfterAction(kind, seat, events)

    if (snap.isOver && snap.outcome) {
      void this.finishGame(snap.outcome, endReason || endReasonOf(snap.outcome), now)
      return
    }
    // Bot pacing: the next bot move waits for this action's animation (a defeat's longer).
    const minGap = this.svc.config.game.botMinMoveMs
    const heavy = events.some(
      (e) => e.type === 'defeat' || e.type === 'frozen' || e.type === 'army_removed',
    )
    this.lastActionAt = monoNow()
    this.paceGapMs = heavy ? Math.round(minGap * BOT_PACE_DEFEAT_FACTOR) : minGap
    this.armFlagTimer()
    this.maybeBotTurn()
  }

  private record(
    seat: number | null,
    type: MatchEventType,
    payload: Record<string, unknown>,
    clockRemainingMs: number | null,
  ) {
    try {
      this.recorder?.append({ seat, type, payload, clockRemainingMs, serverTs: new Date() })
    } catch (err) {
      this.svc.logger.error({ room: this.roomId, err: (err as Error).message }, 'record failed')
    }
  }

  private setLastEvents(events: GameEvent[]) {
    const list = this.state.lastEvents
    list.clear()
    for (const e of events) list.push(flattenEvent(e))
  }

  /** Clock snapshot for clients as of monotonic `now`. */
  private clockSync(now = monoNow()): ClockSync {
    return (
      this.gameClock?.sync(now, Date.now()) ?? {
        remainingMs: [0, 0, 0, 0],
        runningSeat: -1,
        serverTimestamp: Date.now(),
        turnStartedAt: 0,
      }
    )
  }

  private syncClockState(now: number) {
    if (!this.gameClock) return
    const sync = this.gameClock.sync(now, Date.now())
    const c = this.state.clock
    for (const i of SEAT_NUMS) c.remainingMs[i] = sync.remainingMs[i]
    c.runningSeat = sync.runningSeat
    c.serverTimestamp = sync.serverTimestamp
    c.turnStartedAt = sync.turnStartedAt
  }

  private armFlagTimer() {
    clearTimeout(this.flagTimer)
    const clock = this.gameClock
    if (!clock || clock.running === -1) return
    const token = this.state.actionSeq
    const wait = clock.msUntilFlag(monoNow())
    this.flagTimer = setTimeout(() => this.onFlagTimer(token), Math.max(0, wait) + 1)
  }

  /**
   * Runs a flag fall the flag timer hasn't handled yet (it fires a moment after the flag
   * falls, later on a busy event loop) as the timeout it is, so an off-turn message that
   * arrives in that window (a resign, a draw answer, a leave) can't overtake it. Returns
   * whether a timeout ran; callers re-check the phase and the sender's seat afterwards.
   */
  private settleFallenFlag(now: number): boolean {
    const clock = this.gameClock
    if (this.state.phase !== 'in_game' || !clock || clock.running === -1) return false
    if (!clock.hasFlagged(now)) return false
    this.runAction('timeout', clock.running, null, now)
    return true
  }

  private onFlagTimer(token: number) {
    const clock = this.gameClock
    if (this.state.phase !== 'in_game' || !clock || token !== this.state.actionSeq) return
    const now = monoNow()
    if (!clock.hasFlagged(now) || clock.running === -1) {
      this.armFlagTimer()
      return
    }
    this.runAction('timeout', clock.running, null, now)
  }

  /** Whether any human seat still takes turns. */
  private humansStillPlaying(): boolean {
    return this.state.seats.some(
      (s) => s.occupied && !s.isBot && (s.status === 'active' || s.status === 'defeated'),
    )
  }

  /** Whether a seated human is still connected (e.g. eliminated but watching the end). */
  private humanWatching(): boolean {
    return this.state.seats.some((s) => s.occupied && !s.isBot && s.connected)
  }

  private cancelBotTurn() {
    const turn = this.botTurn
    if (!turn) return
    this.botTurn = null
    clearTimeout(turn.timer)
    turn.ctrl.abort()
  }

  /**
   * A bot seat's turn: ask bot-service, with a deadline taken from the bot's own clock; if
   * it fails or the deadline passes, play a quick local move instead, so a slow or hung
   * bot-service never makes a bot lose on time. While a human still takes turns or watches,
   * bots play at their level with pacing (in Teams a knocked-out player's partner's result
   * is still theirs; a solo FFA game ends when its player is out). Once nobody is left, bots play
   * quick local moves only (no bot-service capacity or waiting spent on a game nobody sees).
   */
  private maybeBotTurn() {
    const seat = this.state.seatToMove
    const game = this.game
    const clock = this.gameClock
    if (seat < 0 || !game || !clock || this.state.phase !== 'in_game') {
      this.cancelBotTurn()
      return
    }
    const s = this.state.seats[seat] as SeatState
    if (!s.isBot) {
      this.cancelBotTurn()
      return
    }
    const local = !this.humansStillPlaying() && !this.humanWatching()
    const current = this.botTurn
    // Same bot still to move (an off-turn abandon or reconnect): keep its request. Its turn
    // and clock kept running, so a new request would pay for the same think twice. A move
    // already waiting on its pacing timer is paced again from this action (e.g. an army
    // removed off-turn gets its longer animation).
    if (current && current.seat === seat && current.local === local) {
      if (current.pending) this.deliverBotMove(current, current.pending.move)
      return
    }
    this.cancelBotTurn()
    const turn: BotTurn = {
      seat,
      position: game.positionString(),
      local,
      ctrl: new AbortController(),
      timer: undefined,
    }
    this.botTurn = turn
    if (local) {
      // Yield to the event loop so bot-only stretches never starve client traffic.
      setImmediate(() => this.playBotMove(turn, undefined))
      return
    }
    const remaining = this.untimed
      ? UNTIMED_BOT_CLOCK_MS
      : clock.remainingAt(seat as SeatNum, monoNow())
    const budget = Math.max(
      0,
      Math.min(this.svc.config.game.botRequestTimeoutMs, remaining - botSafetyMarginMs(remaining)),
    )
    turn.timer = setTimeout(() => {
      if (this.botTurn !== turn) return
      this.svc.logger.warn(
        { room: this.roomId, seat, level: s.botLevel, budgetMs: Math.round(budget) },
        'bot-service missed the deadline: playing a local fallback move',
      )
      this.deliverBotMove(turn, undefined)
      turn.ctrl.abort()
    }, budget)
    this.svc.botClient
      .requestMove(
        {
          position: turn.position,
          level: s.botLevel,
          clockMs: Math.floor(remaining),
          incrementMs: this.untimed ? 0 : clock.incrementMs,
        },
        turn.ctrl.signal,
      )
      .then(
        (res) => res.move,
        (err: unknown) => {
          if (this.botTurn !== turn) return null
          const kind = err instanceof BotServiceError ? err.kind : 'unavailable'
          this.svc.logger.warn(
            { room: this.roomId, seat, level: s.botLevel, kind, err: (err as Error).message },
            'bot-service failed: playing a local fallback move',
          )
          return undefined // fallback
        },
      )
      .then((move) => {
        // null: the turn moved on; pending: the deadline already chose the fallback.
        if (move === null || turn.pending) return
        this.deliverBotMove(turn, move)
      })
  }

  /**
   * Bot pacing (BOT_MIN_MOVE_MS): applies `turn`'s move (or its local fallback) no earlier
   * than the pacing gap after the previous action, so clients play each move's animation
   * and several bots in a row don't land at once. The bot's think time already spent
   * counts toward the gap. In timed games the wait runs on the bot's own clock, so it is
   * skipped when the bot is low on time and never takes more than a share of its clock.
   */
  private deliverBotMove(turn: BotTurn, move: string | undefined) {
    if (this.botTurn !== turn) return
    const wait = this.botPaceWaitMs(turn.seat)
    clearTimeout(turn.timer)
    turn.pending = { move }
    if (wait <= 0) {
      turn.timer = undefined
      setImmediate(() => this.playBotMove(turn, move))
      return
    }
    turn.timer = setTimeout(() => this.playBotMove(turn, move), wait)
  }

  /** How much longer `seat`'s bot move must wait for the pacing gap (0 = none). */
  private botPaceWaitMs(seat: number): number {
    if (this.paceGapMs <= 0) return 0
    const now = monoNow()
    const wait = this.lastActionAt + this.paceGapMs - now
    if (wait <= 0) return 0
    if (this.untimed || !this.gameClock) return wait
    const remaining = this.gameClock.remainingAt(seat as SeatNum, now)
    if (remaining < BOT_PACE_MIN_CLOCK_MS) return 0
    return Math.min(wait, remaining * BOT_PACE_MAX_CLOCK_SHARE)
  }

  /** Plays `turn`'s move (or a local fallback move when `move` is missing or illegal). */
  private playBotMove(turn: BotTurn, move: string | undefined) {
    const game = this.game
    if (
      this.botTurn !== turn ||
      !game ||
      this.state.phase !== 'in_game' ||
      this.state.seatToMove !== turn.seat
    ) {
      return
    }
    this.botTurn = null
    clearTimeout(turn.timer)
    turn.ctrl.abort()
    let notation = move
    if (notation && !game.legalMoveNotations().includes(notation)) {
      if (!turn.local && turn.position !== game.positionString()) {
        // Computed before an off-turn change of the position (e.g. an army removed): ask
        // again for the current position, within what is left of the bot's clock.
        this.maybeBotTurn()
        return
      }
      this.svc.logger.warn(
        { room: this.roomId, seat: turn.seat, move: notation },
        'bot move illegal: fallback',
      )
      notation = undefined
    }
    notation ??= fallbackMove(game) ?? undefined
    if (!notation) return
    try {
      this.runAction('move', turn.seat as SeatNum, notation)
    } catch (err) {
      this.svc.logger.error({ room: this.roomId, err: (err as Error).message }, 'bot move failed')
    }
  }

  // -------------------------------------------------------------------------
  // Draw offers
  // -------------------------------------------------------------------------

  /**
   * `seat` (a voter, no offer pending, no cooldown) offers a draw: its own vote counts as
   * accepted, every other voter is pending. Bot voters answer after a short paced delay.
   */
  private offerDraw(seat: SeatNum, voters: readonly [boolean, boolean, boolean, boolean]) {
    const s = this.state
    const votes = initialVotes(voters, seat)
    s.drawOfferSeat = seat
    s.drawOfferActionSeq = s.actionSeq
    this.drawTurnsTaken = new Set()
    for (const i of SEAT_NUMS) s.drawVotes[i] = votes[i] ?? DRAW_VOTE.notVoter
    this.record(seat, 'draw_offer', { actionSeq: s.actionSeq, votes }, null)
    this.broadcast('drawEvent', { type: 'offered', seat, offerSeat: seat })
    if (allAccepted(votes)) {
      this.runAction('agreed_draw', seat, null)
      return
    }
    // Bots answer one after another, spaced like their moves, so clients see each answer.
    const base = Math.max(0, this.svc.config.game.botMinMoveMs)
    let k = 0
    for (const i of SEAT_NUMS) {
      if (votes[i] !== DRAW_VOTE.pending || !(s.seats[i] as SeatState).isBot) continue
      const delay = Math.round(base * (1 + 0.5 * k++))
      const token = s.drawOfferActionSeq
      const timer = setTimeout(() => {
        this.drawBotTimers = this.drawBotTimers.filter((t) => t !== timer)
        this.botRespondDraw(i, seat, token)
      }, delay)
      this.drawBotTimers.push(timer)
    }
  }

  /** A bot voter answers the offer `offerSeat` made at `token` (if it still stands). */
  private botRespondDraw(seat: SeatNum, offerSeat: number, token: number) {
    const s = this.state
    if (s.phase !== 'in_game' || !this.game) return
    this.settleFallenFlag(monoNow())
    const game = this.game
    if (s.phase !== 'in_game' || !game) return
    if (s.drawOfferSeat !== offerSeat || s.drawOfferActionSeq !== token) return
    if (s.drawVotes[seat] !== DRAW_VOTE.pending) return
    try {
      this.respondDraw(seat, botAcceptsDraw(game.snapshot(), seat), true)
    } catch (err) {
      if (!(err instanceof GameError)) {
        this.svc.logger.error(
          { room: this.roomId, err: (err as Error).message },
          'bot draw answer failed',
        )
      }
    }
  }

  /** A pending voter answers: a decline ends the offer; the last acceptance draws the game. */
  private respondDraw(seat: SeatNum, accept: boolean, bot = false) {
    const s = this.state
    const offerSeat = s.drawOfferSeat
    if (offerSeat === -1) throw new GameError('no_draw_offer')
    const vote = s.drawVotes[seat]
    if (vote === DRAW_VOTE.notVoter || vote === undefined) throw new GameError('not_playing')
    if (vote !== DRAW_VOTE.pending) throw new GameError('already_responded')
    const offer = offerSeat as SeatNum
    this.record(
      seat,
      'draw_response',
      { actionSeq: s.actionSeq, offerSeat: offer, accept, ...(bot ? { bot: true } : {}) },
      null,
    )
    if (!accept) {
      this.endDrawOffer()
      this.broadcast('drawEvent', { type: 'declined', seat, offerSeat: offer })
      return
    }
    s.drawVotes[seat] = DRAW_VOTE.accepted
    this.broadcast('drawEvent', { type: 'accepted', seat, offerSeat: offer })
    if (allAccepted([...s.drawVotes])) this.runAction('agreed_draw', seat, null)
  }

  /**
   * Draw bookkeeping after a game action: a turn played (a move or an automatic pass) counts
   * down its seat's cooldown; a pending
   * offer lapses when the voters changed or the turn came back to the offerer; a finished
   * game drops it silently.
   */
  private drawAfterAction(kind: GameAction, seat: SeatNum, events: readonly GameEvent[]) {
    const s = this.state
    const game = this.game
    // A move or an automatic pass (a seat with no legal move) counts down its seat's
    // cooldown, so a seat that can only pass isn't locked out of offering for good.
    for (const i of turnsPlayed(kind, seat, events)) {
      if ((s.drawCooldowns[i] ?? 0) > 0) s.drawCooldowns[i] = (s.drawCooldowns[i] ?? 1) - 1
    }
    if (s.drawOfferSeat === -1 || !game) return
    // The offerer's own moves don't count (its turn coming back is the round's end); its
    // automatic passes do, since a seat that passes is never the seat to move.
    if (kind === 'move' && seat !== s.drawOfferSeat) this.drawTurnsTaken.add(seat)
    for (const e of events) if (e.type === 'pass') this.drawTurnsTaken.add(seatIndex(e.seat))
    if (game.snapshot().isOver) {
      this.clearDrawOffer()
      return
    }
    const reason = lapseReason(
      [...s.drawVotes],
      game.drawVoters(),
      s.drawOfferSeat,
      s.seatToMove,
      this.drawTurnsTaken,
    )
    if (reason) this.lapseDrawOffer(reason)
  }

  private lapseDrawOffer(reason: DrawLapseReason) {
    const offerSeat = this.state.drawOfferSeat as SeatNum
    this.endDrawOffer()
    this.broadcast('drawEvent', { type: 'lapsed', seat: offerSeat, offerSeat, reason })
  }

  /** Ends the pending offer unanswered or declined: the offerer waits before offering again. */
  private endDrawOffer() {
    const offerSeat = this.state.drawOfferSeat
    if (offerSeat === -1) return
    this.state.drawCooldowns[offerSeat] = DRAW_OFFER_COOLDOWN_MOVES
    this.clearDrawOffer()
  }

  /** Drops any pending offer and the bots' pending answers (no cooldown, no message). */
  private clearDrawOffer() {
    for (const t of this.drawBotTimers) clearTimeout(t)
    this.drawBotTimers = []
    const s = this.state
    if (s.drawOfferSeat === -1) return
    s.drawOfferSeat = -1
    s.drawOfferActionSeq = 0
    for (const i of SEAT_NUMS) s.drawVotes[i] = DRAW_VOTE.notVoter
  }

  // -------------------------------------------------------------------------
  // Teams resignation votes
  // -------------------------------------------------------------------------

  /**
   * Teams: `seat` (still taking turns) wants to resign. With a teammate still taking turns
   * this proposes it and waits for the teammate's answer (a bot answers after a paced delay);
   * with a teammate who no longer takes turns (frozen) nobody can be asked, so the team
   * resigns at once. Sending it while the teammate's own proposal is pending agrees to that.
   */
  private proposeTeamResign(seat: SeatNum, now: number) {
    const s = this.state
    const team = teamOf(seat)
    const pending = s.teamResignSeat[team] ?? -1
    if (pending === seat) throw new GameError('resign_proposal_pending')
    if (pending !== -1) {
      this.respondTeamResign(seat, true)
      return
    }
    // Nobody to ask (no cooldown either: the cooldown only stops repeated asking).
    const partner = teammateOf(seat) as SeatNum
    if (!this.takesTurns(partner)) {
      this.record(seat, 'resign_proposal', { actionSeq: s.actionSeq, immediate: true }, null)
      this.broadcast('resignEvent', { type: 'immediate', seat, team })
      this.runAction('resign', seat, null, now, { team: true, immediate: true })
      return
    }
    const wait = s.teamResignCooldowns[seat] ?? 0
    if (wait > 0) {
      throw new GameError(
        'resign_proposal_cooldown',
        `Make ${wait} more move${wait === 1 ? '' : 's'} before proposing to resign again.`,
      )
    }
    s.teamResignSeat[team] = seat
    this.resignProposalIds[team] = ++this.resignProposalSeq
    this.resignTurnsTaken[team] = new Set()
    this.record(seat, 'resign_proposal', { actionSeq: s.actionSeq, teammate: partner }, null)
    this.broadcast('resignEvent', { type: 'proposed', seat, team })
    if ((s.seats[partner] as SeatState).isBot) {
      const id = this.resignProposalIds[team]
      const delay = Math.max(0, this.svc.config.game.botMinMoveMs)
      clearTimeout(this.resignBotTimers[team])
      this.resignBotTimers[team] = setTimeout(() => {
        this.resignBotTimers[team] = undefined
        this.botRespondTeamResign(partner, team, id)
      }, delay)
    }
  }

  /** A bot teammate answers proposal `id` of `team` (if it still stands). */
  private botRespondTeamResign(seat: SeatNum, team: 0 | 1, id: number) {
    const s = this.state
    if (s.phase !== 'in_game' || !this.game) return
    this.settleFallenFlag(monoNow())
    const game = this.game
    if (s.phase !== 'in_game' || !game) return
    if ((s.teamResignSeat[team] ?? -1) === -1 || this.resignProposalIds[team] !== id) return
    try {
      this.respondTeamResign(seat, botAcceptsTeamResign(game.snapshot(), seat), true)
    } catch (err) {
      if (!(err instanceof GameError)) {
        this.svc.logger.error(
          { room: this.roomId, err: (err as Error).message },
          'bot resign answer failed',
        )
      }
    }
  }

  /**
   * The teammate answers its partner's pending proposal: agreeing resigns the whole team
   * (the game ends, the other team wins); declining ends the proposal and both play on.
   */
  private respondTeamResign(seat: SeatNum, accept: boolean, bot = false) {
    const s = this.state
    if (s.mode !== 'teams') throw new GameError('no_resign_proposal')
    const team = teamOf(seat)
    const proposer = s.teamResignSeat[team] ?? -1
    if (proposer === -1) throw new GameError('no_resign_proposal')
    if (proposer === seat) throw new GameError('already_responded')
    if (!this.takesTurns(seat)) throw new GameError('not_playing')
    const from = proposer as SeatNum
    this.record(
      seat,
      'resign_response',
      { actionSeq: s.actionSeq, proposer: from, accept, ...(bot ? { bot: true } : {}) },
      null,
    )
    if (!accept) {
      this.endTeamResign(team)
      this.broadcast('resignEvent', { type: 'declined', seat, team })
      return
    }
    this.clearTeamResign(team)
    this.broadcast('resignEvent', { type: 'accepted', seat, team })
    this.runAction('resign', from, null, monoNow(), { team: true, acceptedBy: seat })
  }

  /**
   * Resignation bookkeeping after a game action: a turn played (a move or an automatic pass)
   * counts down its seat's cooldown; a
   * pending proposal lapses when the proposer or its teammate stopped taking turns or the
   * turn came back round to the proposer; a finished game drops it silently.
   */
  private resignAfterAction(kind: GameAction, seat: SeatNum, events: readonly GameEvent[]) {
    const s = this.state
    const game = this.game
    for (const i of turnsPlayed(kind, seat, events)) {
      if ((s.teamResignCooldowns[i] ?? 0) > 0) {
        s.teamResignCooldowns[i] = (s.teamResignCooldowns[i] ?? 1) - 1
      }
    }
    if (!game) return
    for (const team of [0, 1] as const) {
      const proposer = s.teamResignSeat[team] ?? -1
      if (proposer === -1) continue
      const taken = this.resignTurnsTaken[team] as Set<number>
      // The proposer's own moves don't count (its turn coming back is the round's end); its
      // automatic passes do.
      if (kind === 'move' && seat !== proposer) taken.add(seat)
      for (const e of events) if (e.type === 'pass') taken.add(seatIndex(e.seat))
      if (game.snapshot().isOver) {
        this.clearTeamResign(team)
        continue
      }
      const reason = resignLapseReason(proposer, game.drawVoters(), s.seatToMove, taken)
      if (reason) this.lapseTeamResign(team, reason)
    }
  }

  private lapseTeamResign(team: 0 | 1, reason: ResignLapseReason) {
    const proposer = this.state.teamResignSeat[team] as SeatNum
    const outSeat =
      reason === 'voters_changed'
        ? [proposer, teammateOf(proposer)].find((i) => !this.takesTurns(i as SeatNum))
        : undefined
    this.endTeamResign(team)
    this.broadcast('resignEvent', {
      type: 'lapsed',
      seat: proposer,
      team,
      reason,
      ...(outSeat === undefined ? {} : { outSeat }),
    })
  }

  /** Ends `team`'s proposal unanswered or declined: the proposer waits before proposing again. */
  private endTeamResign(team: 0 | 1) {
    const proposer = this.state.teamResignSeat[team] ?? -1
    if (proposer === -1) return
    this.state.teamResignCooldowns[proposer] = TEAM_RESIGN_COOLDOWN_MOVES
    this.clearTeamResign(team)
  }

  /** Drops `team`'s pending proposal and a bot's pending answer (no cooldown, no message). */
  private clearTeamResign(team: 0 | 1) {
    clearTimeout(this.resignBotTimers[team])
    this.resignBotTimers[team] = undefined
    this.resignTurnsTaken[team] = new Set()
    this.resignProposalIds[team] = 0
    if ((this.state.teamResignSeat[team] ?? -1) !== -1) this.state.teamResignSeat[team] = -1
  }

  private async finishGame(outcome: Outcome, endReason: string, now: number) {
    const s = this.state
    s.phase = 'finished'
    this.clearTimers()
    this.cancelBotTurn()
    this.clearDrawOffer()
    this.clearTeamResign(0)
    this.clearTeamResign(1)
    const game = this.game
    const recorder = this.recorder
    s.result.type = outcome.result.type
    s.result.winnerSeat = outcome.result.type === 'ffa_winner' ? seatIndex(outcome.result.seat) : -1
    s.result.winnerTeam = outcome.result.type === 'teams_winner' ? outcome.result.team : ''
    s.result.endReason = endReason
    s.result.placements.clear()
    for (const p of outcome.placements) s.result.placements.push(p)
    this.syncClockState(now)
    this.updateListing()

    let result: FinishResult = {
      status: 'aborted',
      endReason: 'persist_failed',
      rated: false,
      ratingChanges: [],
    }
    if (game && recorder) {
      const snap = game.snapshot()
      const defeatReasons = SEAT_NUMS.map(
        (i) => snap.defeats.find((d) => d.seat === SEATS[i])?.reason ?? null,
      )
      try {
        result = await this.svc.track(
          recorder.finish({
            finalPosition: game.positionString(),
            outcome,
            endReason,
            endedAt: new Date(),
            finalStatuses: [...snap.statuses],
            defeatReasons,
            ratingSeats: SEAT_NUMS.map((i) => {
              const seat = s.seats[i] as SeatState
              return {
                seat: i,
                team: i % 2,
                placement: outcome.placements[i] ?? 4,
                userId: seat.isBot ? null : (this.bindings[i]?.userId ?? null),
                isGuest: seat.isGuest,
                botLevel: seat.isBot ? seat.botLevel : null,
              }
            }),
          }),
        )
      } catch (err) {
        this.svc.logger.error(
          { room: this.roomId, err: (err as Error).message },
          'finishing match failed',
        )
      }
    }
    if (result.status === 'aborted') s.result.endReason = result.endReason
    s.rated = result.rated
    this.broadcast('gameOver', {
      matchId: s.matchId,
      result: outcome.result,
      placements: [...outcome.placements] as [number, number, number, number],
      endReason: result.endReason,
      rated: result.rated,
      ratings: SEAT_NUMS.map((i) => {
        const c = result.ratingChanges.find((r) => r.seat === i)
        return c ? { before: c.before, after: c.after } : null
      }),
    })
    this.releaseSeats()
    this.autoDispose = true
    if (this.clients.length === 0) {
      void this.disconnect().catch(() => {})
    } else {
      this.closeTimer = setTimeout(
        () => void this.disconnect().catch(() => {}),
        FINISHED_ROOM_TTL_MS,
      )
    }
  }

  private releaseSeats() {
    for (const b of this.bindings) {
      if (b && this.svc.seats.get(b.userId) === this.roomId) this.svc.seats.delete(b.userId)
    }
  }

  private clearTimers() {
    for (const t of this.drawBotTimers) clearTimeout(t)
    this.drawBotTimers = []
    for (const t of this.resignBotTimers) clearTimeout(t)
    this.resignBotTimers = [undefined, undefined]
    clearTimeout(this.countdownTimer)
    clearTimeout(this.flagTimer)
    clearInterval(this.syncTimer)
    clearTimeout(this.closeTimer)
    clearTimeout(this.hostGraceTimer)
    this.hostGraceTimer = undefined
    this.countdownTimer = undefined
    this.flagTimer = undefined
    this.syncTimer = undefined
    this.closeTimer = undefined
  }
}

export function endReasonOf(outcome: Outcome): string {
  switch (outcome.result.type) {
    case 'ffa_winner':
      return 'last_standing'
    case 'teams_winner':
      // (A Teams resignation is reported as 'team_resigned' by runAction.)
      return 'team_eliminated'
    case 'ffa_agreed_draw':
    case 'teams_agreed_draw':
      return 'agreed_draw'
    default:
      return 'move_limit'
  }
}

function flattenEvent(e: GameEvent): EventState {
  const out = new EventState()
  out.type = e.type
  if ('seat' in e) out.seat = seatIndex(e.seat)
  switch (e.type) {
    case 'move_made':
      out.notation = e.notation
      out.from = e.from
      out.to = e.to
      out.piece = e.piece
      out.promotion = e.promotion ?? ''
      out.flag = e.flag
      break
    case 'capture':
      out.square = e.square
      out.piece = e.captured.kind
      out.pieceOwner = seatIndex(e.captured.owner)
      break
    case 'en_passant':
      out.square = e.capturedSquare
      break
    case 'promotion':
      out.square = e.square
      out.piece = e.kind
      break
    case 'castle':
      out.from = e.rookFrom
      out.to = e.rookTo
      break
    case 'pass':
      out.notation = e.notation
      break
    case 'defeat':
      out.reason = e.reason
      break
    default:
      break
  }
  return out
}
