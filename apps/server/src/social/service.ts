/**
 * Friends, presence and challenges (PLAN §3 "Friends"): the logic behind the REST routes
 * (routes.ts) and the `social` room (social-room.ts). Friendships live in the database;
 * presence and challenges are in memory (a challenge lasts minutes, and its lobby lives in
 * this process anyway).
 */
import { randomBytes } from 'node:crypto'
import { matchMaker } from '@colyseus/core'
import { type Database, sessions } from '@game/db'
import {
  CHALLENGE_TTL_MS,
  type Challenge,
  type ChallengeCloseReason,
  type ChallengeInviteeStatus,
  CLOSE_CODES,
  type FriendsResponse,
  PROTOCOL_VERSION,
  ROOM_NAMES,
  type SocialMessages,
  type SocialMessageType,
  type SocialUser,
} from '@game/protocol'
import { and, gt, inArray } from 'drizzle-orm'
import { CLAIM_TTL_MS, MatchRoom } from '../game/match-room.ts'
import type { GameService } from '../game/service.ts'
import type { Logger } from '../logger.ts'
import {
  acceptRequest,
  cancelRequest,
  DEFAULT_LIMITS,
  declineRequest,
  eligibleTarget,
  friendIdsOf,
  removeFriend,
  rowsOf,
  SocialError,
  type SocialLimits,
  sendRequest,
  socialUser,
} from './friends.ts'
import { SocialHub } from './hub.ts'

export interface SocialOptions extends SocialLimits {
  /** How long a challenge stays open. */
  challengeTtlMs: number
  /** Offline grace after a user's last connection closes. */
  presenceGraceMs: number
  /**
   * How often open `social` connections are checked against the sessions table (a safety
   * net: sign-out and revocation close them at once through the session-delete hook).
   */
  sessionCheckMs: number
}

export const DEFAULT_SOCIAL_OPTIONS: SocialOptions = {
  ...DEFAULT_LIMITS,
  challengeTtlMs: CHALLENGE_TTL_MS,
  presenceGraceMs: 5_000,
  sessionCheckMs: 60_000,
}

interface ChallengeRecord {
  id: string
  from: SocialUser
  roomId: string
  mode: 'ffa' | 'teams'
  timeControl: string
  createdAt: Date
  expiresAt: Date
  invitees: Map<string, { user: SocialUser; status: ChallengeInviteeStatus }>
  timer: NodeJS.Timeout
}

export class SocialService {
  readonly db: Database
  readonly game: GameService
  readonly logger: Logger
  readonly options: SocialOptions
  readonly hub: SocialHub
  readonly #challenges = new Map<string, ChallengeRecord>()
  readonly #sessionCheck: NodeJS.Timeout

  constructor(deps: {
    db: Database
    game: GameService
    logger: Logger
    options?: Partial<SocialOptions>
  }) {
    this.db = deps.db
    this.game = deps.game
    this.logger = deps.logger.child({ component: 'social' })
    this.options = { ...DEFAULT_SOCIAL_OPTIONS, ...deps.options }
    this.hub = new SocialHub(this.options.presenceGraceMs, (userId, online) => {
      void this.#announcePresence(userId, online)
    })
    this.#sessionCheck = setInterval(() => void this.#checkSessions(), this.options.sessionCheckMs)
    this.#sessionCheck.unref()
    this.game.lobbyHooks = {
      seated: (roomId, userId) => this.#onSeated(roomId, userId),
      ended: (roomId, reason) => this.#onLobbyEnded(roomId, reason),
    }
  }

  /** Pushes a `social` room message to every connection of `userId`. */
  push<K extends SocialMessageType>(userId: string, type: K, payload: SocialMessages[K]) {
    this.hub.send(userId, type, payload)
  }

  async #announcePresence(userId: string, online: boolean) {
    try {
      for (const id of await friendIdsOf(this.db, userId)) {
        this.push(id, 'presence', { userId, online })
      }
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'presence fan-out failed')
    }
  }

  // -------------------------------------------------------------------------
  // Sessions behind social connections
  // -------------------------------------------------------------------------

  /** A session was deleted (sign-out, revoke, password reset): close its connections. */
  sessionEnded(sessionId: string) {
    this.hub.disconnectSessions([sessionId], CLOSE_CODES.sessionEnded)
  }

  /** Closes connections whose session is gone or expired (sessions deleted outside Better Auth). */
  async #checkSessions() {
    const ids = this.hub.sessionIds()
    if (ids.length === 0) return
    try {
      const live = await this.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(inArray(sessions.id, ids), gt(sessions.expiresAt, new Date())))
      const ok = new Set(live.map((r) => r.id))
      this.hub.disconnectSessions(
        ids.filter((id) => !ok.has(id)),
        CLOSE_CODES.sessionEnded,
      )
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'social session check failed')
    }
  }

  // -------------------------------------------------------------------------
  // Friends
  // -------------------------------------------------------------------------

  async list(me: string): Promise<FriendsResponse> {
    const rows = await rowsOf(this.db, me)
    const newest = (a: { createdAt: Date }, b: { createdAt: Date }) =>
      b.createdAt.getTime() - a.createdAt.getTime()
    return {
      friends: rows
        .filter((r) => r.status === 'accepted')
        .map((r) => ({
          userId: r.userId,
          username: r.username,
          online: this.hub.isOnline(r.userId),
          since: (r.acceptedAt ?? r.createdAt).toISOString(),
        })),
      incoming: rows
        .filter((r) => r.status === 'pending' && r.requestedBy !== me)
        .sort(newest)
        .map((r) => ({
          user: { userId: r.userId, username: r.username },
          createdAt: r.createdAt.toISOString(),
        })),
      outgoing: rows
        .filter((r) => r.status === 'pending' && r.requestedBy === me)
        .sort(newest)
        .map((r) => ({
          user: { userId: r.userId, username: r.username },
          createdAt: r.createdAt.toISOString(),
        })),
      limits: { maxFriends: this.options.maxFriends, maxOutgoing: this.options.maxOutgoing },
    }
  }

  /** A friend request to the player in `seat` of `matchId`. */
  async request(me: SocialUser, matchId: string, seat: number) {
    const target = await eligibleTarget(this.db, me.userId, matchId, seat)
    const relation = await sendRequest(this.db, this.options, me.userId, target.userId)
    if (relation === 'friends') {
      this.push(target.userId, 'friendAccepted', {
        user: me,
        online: this.hub.isOnline(me.userId),
      })
    } else {
      this.push(target.userId, 'friendRequest', { user: me, createdAt: new Date().toISOString() })
    }
    // Other tabs and devices of the sender.
    this.push(me.userId, 'friendsChanged', {})
    return { relation, user: target }
  }

  async accept(me: SocialUser, otherId: string) {
    await acceptRequest(this.db, this.options, me.userId, otherId)
    const other = await socialUser(this.db, otherId)
    this.push(otherId, 'friendAccepted', { user: me, online: this.hub.isOnline(me.userId) })
    this.push(me.userId, 'friendsChanged', {})
    return {
      relation: 'friends' as const,
      user: other ?? { userId: otherId, username: 'Player' },
    }
  }

  async decline(me: string, otherId: string) {
    if (!(await declineRequest(this.db, me, otherId))) throw notFound('friend request')
    this.push(otherId, 'friendsChanged', {})
    this.push(me, 'friendsChanged', {})
  }

  async cancel(me: string, otherId: string) {
    if (!(await cancelRequest(this.db, me, otherId))) throw notFound('friend request')
    this.push(otherId, 'friendsChanged', {})
    this.push(me, 'friendsChanged', {})
  }

  async remove(me: string, otherId: string) {
    if (!(await removeFriend(this.db, me, otherId))) throw notFound('friend')
    // A challenge only invites friends: open ones between the two end with the friendship.
    for (const c of [...this.#challenges.values()]) {
      if (c.from.userId === me) this.#withdraw(c, otherId)
      else if (c.from.userId === otherId) this.#withdraw(c, me)
    }
    this.push(otherId, 'friendsChanged', {})
    this.push(me, 'friendsChanged', {})
  }

  /**
   * After an account deletion: tell everyone who had a friendship or a request with the user
   * (`counterparts`), end the user's challenges and invitations, and close their connections.
   */
  accountDeleted(userId: string, counterparts: string[]) {
    for (const c of [...this.#challenges.values()]) {
      if (c.from.userId === userId) this.#close(c, 'cancelled')
      else this.#withdraw(c, userId)
    }
    for (const id of new Set(counterparts)) this.push(id, 'friendsChanged', {})
    this.hub.disconnectUser(userId, CLOSE_CODES.sessionEnded)
  }

  // -------------------------------------------------------------------------
  // Challenges
  // -------------------------------------------------------------------------

  /**
   * The challenge as `viewer` sees it: the challenger sees every invitee's id; an invitee sees
   * co-invitees' ids only when they are friends of theirs (`viewerFriends`).
   */
  #view(c: ChallengeRecord, viewer: string, viewerFriends?: ReadonlySet<string>): Challenge {
    const full = viewer === c.from.userId
    return {
      id: c.id,
      from: c.from,
      roomId: c.roomId,
      mode: c.mode,
      timeControl: c.timeControl,
      createdAt: c.createdAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
      invitees: [...c.invitees.values()].map((i) => ({
        user:
          full || i.user.userId === viewer || viewerFriends?.has(i.user.userId)
            ? i.user
            : { username: i.user.username },
        status: i.status,
      })),
    }
  }

  /**
   * Takes `userId` off challenge `c` (the friendship ended, or the account was deleted): their
   * prompt closes, the challenger is told, and they can no longer join the lobby unless they
   * already sit in it. A challenge left with nobody invited is cancelled.
   */
  #withdraw(c: ChallengeRecord, userId: string) {
    const inv = c.invitees.get(userId)
    if (!inv) return
    c.invitees.delete(userId)
    const room = matchMaker.getLocalRoomById(c.roomId)
    if (room instanceof MatchRoom) room.revokeInvite(userId)
    if (inv.status === 'pending') {
      this.push(userId, 'challengeClosed', { challengeId: c.id, reason: 'cancelled' })
    }
    if (c.invitees.size === 0) {
      this.#close(c, 'cancelled')
      return
    }
    if (inv.status === 'pending') {
      this.push(c.from.userId, 'challengeUpdate', {
        challengeId: c.id,
        user: inv.user,
        status: 'expired',
      })
    }
  }

  /**
   * Creates an invite-only casual lobby hosted by `me` for `friendIds` (accepted friends),
   * and notifies each invitee. The challenger then joins it like any lobby (`joinById`),
   * within the usual seat-reservation window.
   */
  async challenge(
    me: SocialUser,
    body: {
      friendIds: string[]
      mode: 'ffa' | 'teams'
      timeControl: string
      roomId?: string | undefined
    },
  ): Promise<Challenge> {
    const svc = this.game
    if (svc.maintenance || svc.rooms.size >= svc.config.game.maxMatchRooms) {
      throw new SocialError(
        'MAINTENANCE',
        503,
        'The server is restarting for maintenance. Try again in a few minutes.',
      )
    }
    const friends = new Set(await friendIdsOf(this.db, me.userId))
    if (body.friendIds.some((id) => !friends.has(id))) {
      throw new SocialError('NOT_FRIENDS', 403, 'You can only challenge your friends.')
    }
    const invitees: SocialUser[] = []
    for (const id of body.friendIds) {
      const u = await socialUser(this.db, id)
      if (!u) throw new SocialError('NOT_FRIENDS', 403, 'You can only challenge your friends.')
      invitees.push(u)
    }
    if (body.roomId) return this.#reinvite(me, body.roomId, invitees)
    if (svc.seats.has(me.userId) || svc.liveClaim(me.userId)) {
      throw new SocialError(
        'ALREADY_IN_ROOM',
        409,
        'You are already in a lobby or game. Leave it first.',
      )
    }
    // An earlier challenge of yours whose lobby you aren't in is over.
    for (const c of [...this.#challenges.values()]) {
      if (c.from.userId === me.userId) this.#close(c, 'cancelled')
    }
    const id = randomBytes(9).toString('base64url')
    const sessionId = svc.claimSeat(me.userId, '', CLAIM_TTL_MS)
    const ticket = svc.issueCreatorTicket(
      { userId: me.userId, displayName: me.username, isGuest: false },
      sessionId,
      { challengeId: id, userIds: invitees.map((i) => i.userId) },
    )
    const proposed = `${me.username}'s challenge`
    const name = svc.namePolicy.checkLobbyName(proposed).ok ? proposed : 'Friends challenge'
    let roomId: string
    try {
      const room = await matchMaker.createRoom(ROOM_NAMES.match, {
        protocolVersion: PROTOCOL_VERSION,
        kind: 'lobby',
        name,
        mode: body.mode,
        timeControl: body.timeControl,
        creatorTicket: ticket,
      })
      roomId = room.roomId
    } catch (err) {
      svc.releaseClaim(me.userId, '')
      this.logger.error({ err: (err as Error).message }, 'challenge lobby create failed')
      throw new SocialError('MAINTENANCE', 503, 'Could not create the lobby. Try again.')
    }
    return this.#open(id, me, roomId, body.mode, body.timeControl, invitees)
  }

  /**
   * Invites friends again to the challenge lobby `roomId` that `me` hosts (its invitation
   * expired or was withdrawn, and the game hasn't started).
   */
  async #reinvite(me: SocialUser, roomId: string, invitees: SocialUser[]): Promise<Challenge> {
    const room = matchMaker.getLocalRoomById(roomId)
    if (!(room instanceof MatchRoom) || !room.canReinvite(me.userId)) {
      throw new SocialError('CHALLENGE_CLOSED', 409, 'That lobby can no longer take invitations.')
    }
    const waiting = invitees.filter((u) => !room.hasSeated(u.userId))
    if (waiting.length === 0) {
      throw new SocialError('BAD_REQUEST', 400, 'Everyone you picked is already in the lobby.')
    }
    for (const c of [...this.#challenges.values()]) {
      if (c.from.userId === me.userId) this.#close(c, 'cancelled')
    }
    const id = randomBytes(9).toString('base64url')
    room.reopenInvites(
      id,
      waiting.map((u) => u.userId),
    )
    const s = room.state
    return this.#open(id, me, roomId, s.mode as 'ffa' | 'teams', s.timeControl, waiting)
  }

  /** Records a challenge for lobby `roomId` and notifies the invitees. */
  async #open(
    id: string,
    me: SocialUser,
    roomId: string,
    mode: 'ffa' | 'teams',
    timeControl: string,
    invitees: SocialUser[],
  ): Promise<Challenge> {
    const now = new Date()
    const record: ChallengeRecord = {
      id,
      from: me,
      roomId,
      mode,
      timeControl,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.options.challengeTtlMs),
      invitees: new Map(invitees.map((u) => [u.userId, { user: u, status: 'pending' }])),
      timer: setTimeout(() => {
        const c = this.#challenges.get(id)
        if (c) this.#close(c, 'expired')
      }, this.options.challengeTtlMs),
    }
    record.timer.unref()
    this.#challenges.set(id, record)
    for (const u of invitees) {
      const theirFriends = new Set(await friendIdsOf(this.db, u.userId))
      this.push(u.userId, 'challenge', this.#view(record, u.userId, theirFriends))
    }
    return this.#view(record, me.userId)
  }

  /** Open challenges to `me` (still pending for me) and from `me`. */
  async challenges(me: string): Promise<{ incoming: Challenge[]; outgoing: Challenge[] }> {
    const outgoing: Challenge[] = []
    const waiting: ChallengeRecord[] = []
    for (const c of this.#challenges.values()) {
      if (c.from.userId === me) outgoing.push(this.#view(c, me))
      else if (c.invitees.get(me)?.status === 'pending') waiting.push(c)
    }
    const myFriends = waiting.length > 0 ? new Set(await friendIdsOf(this.db, me)) : undefined
    return { incoming: waiting.map((c) => this.#view(c, me, myFriends)), outgoing }
  }

  #find(id: string, me: string): ChallengeRecord {
    const c = this.#challenges.get(id)
    if (!c || (c.from.userId !== me && !c.invitees.has(me))) {
      throw new SocialError('CHALLENGE_CLOSED', 409, 'That challenge has ended.')
    }
    return c
  }

  declineChallenge(id: string, me: string) {
    const c = this.#find(id, me)
    const inv = c.invitees.get(me)
    if (!inv) throw new SocialError('NOT_FOUND', 404, 'That challenge is not for you.')
    if (inv.status !== 'pending') {
      throw new SocialError('CHALLENGE_CLOSED', 409, 'You already answered that challenge.')
    }
    inv.status = 'declined'
    this.push(c.from.userId, 'challengeUpdate', {
      challengeId: c.id,
      user: inv.user,
      status: 'declined',
    })
    // The invitee's other tabs drop the prompt too.
    this.push(me, 'challengeClosed', { challengeId: c.id, reason: 'answered' })
  }

  cancelChallenge(id: string, me: string) {
    const c = this.#find(id, me)
    if (c.from.userId !== me) throw new SocialError('NOT_FOUND', 404, 'That is not your challenge.')
    this.#close(c, 'cancelled')
  }

  #onSeated(roomId: string, userId: string) {
    for (const c of this.#challenges.values()) {
      if (c.roomId !== roomId) continue
      const inv = c.invitees.get(userId)
      if (inv && inv.status !== 'joined') {
        inv.status = 'joined'
        this.push(c.from.userId, 'challengeUpdate', {
          challengeId: c.id,
          user: inv.user,
          status: 'joined',
        })
        // The invitee's other tabs drop the prompt.
        this.push(userId, 'challengeClosed', { challengeId: c.id, reason: 'answered' })
      }
    }
  }

  #onLobbyEnded(roomId: string, reason: 'started' | 'closed') {
    for (const c of [...this.#challenges.values()]) {
      if (c.roomId === roomId) this.#close(c, reason)
    }
  }

  #close(c: ChallengeRecord, reason: ChallengeCloseReason) {
    if (!this.#challenges.delete(c.id)) return
    clearTimeout(c.timer)
    for (const inv of c.invitees.values()) {
      if (inv.status === 'pending') inv.status = 'expired'
    }
    if (reason === 'expired' || reason === 'cancelled') {
      // The lobby stays open (bots can fill it), but the invitation is over.
      const room = matchMaker.getLocalRoomById(c.roomId)
      if (room instanceof MatchRoom) room.revokeInvites()
    }
    const payload = { challengeId: c.id, reason }
    this.push(c.from.userId, 'challengeClosed', payload)
    for (const id of c.invitees.keys()) this.push(id, 'challengeClosed', payload)
  }

  close() {
    clearInterval(this.#sessionCheck)
    for (const c of this.#challenges.values()) clearTimeout(c.timer)
    this.#challenges.clear()
    this.hub.close()
  }
}

function notFound(what: string) {
  return new SocialError('NOT_FOUND', 404, `That ${what} is no longer there.`)
}
