/**
 * Friends and challenges (PLAN §3 "Friends"): eligibility, caps, the rate limit, presence and
 * notifications over the `social` room, account deletion and export, and challenge lobbies
 * (invite-only, decline, expiry, start).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { matchMaker } from '@colyseus/core'
import type { Room } from '@colyseus/sdk'
import { civilizations, friendships, matches, matchPlayers, users } from '@game/db'
import {
  type Challenge,
  type ChallengesResponse,
  FRIEND_REQUESTS_PER_HOUR,
  type FriendsResponse,
  type MatchListResponse,
  type MatchRelationsResponse,
  ROOM_NAMES,
  type SocialMessages,
} from '@game/protocol'
import { eq, or } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pairOf } from '../social/friends.ts'
import {
  Browser,
  createLobby,
  FakeBotClient,
  type GameHarness,
  guest,
  joinLobby,
  matchmakeError,
  type Player,
  registered,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness(
    {},
    { botClient: new FakeBotClient(), social: { presenceGraceMs: 50 } },
  )
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db
const social = () => h.server.ctx.social

async function civId(slug = 'japan') {
  const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, slug))
  if (!civ) throw new Error('no civ')
  return civ.id
}

/** A match row with these seats (null = a bot), e.g. finished or in progress. */
async function seedMatch(
  status: 'finished' | 'in_progress' | 'aborted',
  seats: (string | null)[],
): Promise<string> {
  const [match] = await db()
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, status })
    .returning()
  if (!match) throw new Error('fixture failed')
  const civ = await civId()
  await db()
    .insert(matchPlayers)
    .values(
      [0, 1, 2, 3].map((seat) => ({
        matchId: match.id,
        seat,
        userId: seats[seat] ?? null,
        botLevel: seats[seat] ? null : '1200',
        civId: civ,
        civVersion: 1,
      })),
    )
  return match.id
}

/** A registered account row with no session (for cap fixtures). */
async function fakeUser(): Promise<string> {
  const id = randomUUID()
  const username = `f_${randomBytes(5).toString('hex')}`
  await db()
    .insert(users)
    .values({
      id,
      name: username,
      username,
      displayUsername: username,
      email: `${username}@example.test`,
      emailVerified: true,
    })
  return id
}

async function seedFriendship(a: string, b: string, status: 'pending' | 'accepted', by = a) {
  const [lo, hi] = pairOf(a, b)
  await db()
    .insert(friendships)
    .values({
      userA: lo,
      userB: hi,
      requestedBy: by,
      status,
      acceptedAt: status === 'accepted' ? new Date() : null,
    })
}

const del = (b: Browser, path: string) => b.request('DELETE', path)

async function friendsOf(b: Browser): Promise<FriendsResponse> {
  const res = await b.get('/api/friends')
  expect(res.status).toBe(200)
  return res.body as unknown as FriendsResponse
}

/** Two registered players who finished a game together (seats 0 and 1). */
async function pairWithFinishedMatch() {
  const a = await registered(h)
  const b = await registered(h)
  const matchId = await seedMatch('finished', [a.userId, b.userId, null, null])
  return { a, b, matchId }
}

/** A `social` room connection that records every message. */
class SocialConn {
  readonly messages: { type: string; payload: unknown }[] = []
  readonly room: Room

  constructor(room: Room) {
    this.room = room
    room.onMessage('*', (type, payload) => {
      this.messages.push({ type: String(type), payload })
    })
  }

  of<K extends keyof SocialMessages>(type: K): SocialMessages[K][] {
    return this.messages.filter((m) => m.type === type).map((m) => m.payload as SocialMessages[K])
  }

  async wait<K extends keyof SocialMessages>(
    type: K,
    pred: (p: SocialMessages[K]) => boolean = () => true,
  ): Promise<SocialMessages[K]> {
    let found: SocialMessages[K] | undefined
    await waitFor(
      () => {
        found = this.of(type).find(pred)
        return found !== undefined
      },
      5_000,
      `social ${type}`,
    )
    return found as SocialMessages[K]
  }

  async leave() {
    await this.room.leave(true).catch(() => {})
  }
}

async function connect(b: Browser): Promise<SocialConn> {
  return new SocialConn(await b.sdk().joinOrCreate(ROOM_NAMES.social))
}

describe('friend requests: eligibility', () => {
  it('allows a finished game together; the other side sees it live and accepts', async () => {
    const { a, b, matchId } = await pairWithFinishedMatch()
    const bSocial = await connect(b)
    const sent = await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ relation: 'outgoing', user: { userId: b.userId } })
    const note = await bSocial.wait('friendRequest')
    expect(note.user).toEqual({ userId: a.userId, username: a.name })

    expect((await friendsOf(a)).outgoing.map((r) => r.user.userId)).toEqual([b.userId])
    expect((await friendsOf(b)).incoming.map((r) => r.user.userId)).toEqual([a.userId])
    // Asking twice is refused.
    const again = await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('ALREADY_REQUESTED')

    const aSocial = await connect(a)
    const ok = await b.post(`/api/friends/requests/${a.userId}/accept`)
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ relation: 'friends', user: { userId: a.userId } })
    const accepted = await aSocial.wait('friendAccepted')
    expect(accepted.user.userId).toBe(b.userId)
    expect(accepted.online).toBe(true)
    const list = await friendsOf(a)
    expect(list.friends).toEqual([
      expect.objectContaining({ userId: b.userId, username: b.name, online: true }),
    ])
    expect(list.outgoing).toEqual([])
    expect(list.limits).toEqual({ maxFriends: 50, maxOutgoing: 10 })
    const dup = await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect(dup.body.error).toBe('ALREADY_FRIENDS')
    await aSocial.leave()
    await bSocial.leave()
  })

  it('allows a game in progress (a real one, by the room state match id)', async () => {
    const a = await registered(h)
    const b = await registered(h)
    const host = await createLobby(a, { name: 'Friends live' })
    const other = await joinLobby(b, host.room.roomId)
    host.send('addBot', { seat: 2, level: '1200' })
    host.send('addBot', { seat: 3, level: '1200' })
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    // A lobby is not enough: there is no match yet.
    expect(host.state.matchId).toBe('')
    host.send('setCiv', { civ: 'mali' })
    other.send('setCiv', { civ: 'japan' })
    await host.waitState((s) => s.seats[0]?.civ === 'mali' && s.seats[1]?.civ === 'japan')
    host.send('setReady', { ready: true })
    other.send('setReady', { ready: true })
    await host.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game' && s.matchId !== '', 5_000, 'in_game')
    const matchId = host.state.matchId

    const rel = await a.get(`/api/friends/match/${matchId}`)
    expect(rel.status).toBe(200)
    const seats = (rel.body as unknown as MatchRelationsResponse).seats
    expect(seats.map((s) => s.relation)).toEqual(['self', 'none', 'ineligible', 'ineligible'])

    const sent = await a.post('/api/friends/requests', { matchId, seat: other.seat })
    expect(sent.status).toBe(200)
    expect(sent.body.relation).toBe('outgoing')
    const after = await a.get(`/api/friends/match/${matchId}`)
    expect((after.body as unknown as MatchRelationsResponse).seats[1]?.relation).toBe('outgoing')
    // Someone not in the match can't look at it.
    const stranger = await registered(h)
    expect((await stranger.get(`/api/friends/match/${matchId}`)).status).toBe(404)
    await host.leave()
    await other.leave()
  })

  it('refuses players who only shared a lobby, an aborted game, bots, guests and yourself', async () => {
    const a = await registered(h)
    const b = await registered(h)
    // A lobby that never started: no match id to point at.
    const lobby = await createLobby(a, { name: 'Just a lobby' })
    const seated = await joinLobby(b, lobby.room.roomId)
    expect(lobby.state.matchId).toBe('')
    const noMatch = await a.post('/api/friends/requests', { matchId: randomUUID(), seat: 1 })
    expect(noMatch.status).toBe(404)
    await lobby.leave()
    await seated.leave()

    // A match B wasn't in: the seat is someone else (or a bot).
    const solo = await seedMatch('finished', [a.userId, null, null, null])
    const bot = await a.post('/api/friends/requests', { matchId: solo, seat: 1 })
    expect(bot.status).toBe(403)
    expect(bot.body.error).toBe('NOT_ELIGIBLE')
    const self = await a.post('/api/friends/requests', { matchId: solo, seat: 0 })
    expect(self.body.error).toBe('SELF')

    const aborted = await seedMatch('aborted', [a.userId, b.userId, null, null])
    const ab = await a.post('/api/friends/requests', { matchId: aborted, seat: 1 })
    expect(ab.status).toBe(403)
    expect(ab.body.error).toBe('NOT_ELIGIBLE')

    // Not a participant: 404, even for a real match.
    const c = await registered(h)
    const theirs = await seedMatch('finished', [b.userId, c.userId, null, null])
    expect((await a.post('/api/friends/requests', { matchId: theirs, seat: 1 })).status).toBe(404)

    const g = await guest(h)
    const withGuest = await seedMatch('finished', [a.userId, g.userId, null, null])
    const toGuest = await a.post('/api/friends/requests', { matchId: withGuest, seat: 1 })
    expect(toGuest.status).toBe(403)
    expect(toGuest.body.error).toBe('NOT_ELIGIBLE')
    // Guests can't use friends at all.
    for (const res of [
      await g.get('/api/friends'),
      await g.post('/api/friends/requests', { matchId: withGuest, seat: 0 }),
      await g.post('/api/challenges', { friendIds: [a.userId], mode: 'ffa', timeControl: '10+0' }),
    ]) {
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('ACCOUNT_REQUIRED')
    }
    expect(await matchmakeError(g.sdk().joinOrCreate(ROOM_NAMES.social))).toBe('account_required')

    const bad = await a.post('/api/friends/requests', { matchId: 'nope', seat: 1 })
    expect(bad.status).toBe(400)
  })

  it('shows friend relations in match history (finished games, registered opponents)', async () => {
    const { a, b, matchId } = await pairWithFinishedMatch()
    const list = (await a.get('/api/matches')).body as unknown as MatchListResponse
    const row = list.matches.find((m) => m.id === matchId)
    expect(row?.opponents.map((o) => o.friend)).toEqual(['none', null, null])
    await a.post('/api/friends/requests', { matchId, seat: 1 })
    const later = (await a.get('/api/matches')).body as unknown as MatchListResponse
    expect(later.matches.find((m) => m.id === matchId)?.opponents[0]?.friend).toBe('outgoing')
    const theirs = (await b.get('/api/matches')).body as unknown as MatchListResponse
    expect(theirs.matches.find((m) => m.id === matchId)?.opponents[0]?.friend).toBe('incoming')
  })
})

describe('native apps (bearer token)', () => {
  it('uses REST and the social room with a bearer token instead of the cookie', async () => {
    const { a, b, matchId } = await pairWithFinishedMatch()
    const token = decodeURIComponent(a.cookies.get('better-auth.session_token') as string).split(
      '.',
    )[0] as string
    const native = new Browser(h)
    const auth = { authorization: `Bearer ${token}` }
    const list = await native.request('GET', '/api/friends', undefined, auth)
    expect(list.status).toBe(200)
    const bSocial = await connect(b)
    const sent = await native.request('POST', '/api/friends/requests', { matchId, seat: 1 }, auth)
    expect(sent.status).toBe(200)
    await bSocial.wait('friendRequest', (p) => p.user.userId === a.userId)
    const sdk = native.sdk()
    sdk.auth.token = token
    const room = new SocialConn(await sdk.joinOrCreate(ROOM_NAMES.social))
    expect((await b.post(`/api/friends/requests/${a.userId}/accept`)).status).toBe(200)
    await room.wait('friendAccepted', (p) => p.user.userId === b.userId)
    await room.leave()
    await bSocial.leave()
  })
})

describe('friend requests: answers', () => {
  it('sending one back to someone who asked you accepts theirs', async () => {
    const { a, b, matchId } = await pairWithFinishedMatch()
    const aSocial = await connect(a)
    expect((await a.post('/api/friends/requests', { matchId, seat: 1 })).body.relation).toBe(
      'outgoing',
    )
    const back = await b.post('/api/friends/requests', { matchId, seat: 0 })
    expect(back.status).toBe(200)
    expect(back.body.relation).toBe('friends')
    await aSocial.wait('friendAccepted', (p) => p.user.userId === b.userId)
    expect((await friendsOf(a)).friends.map((f) => f.userId)).toEqual([b.userId])
    await aSocial.leave()
  })

  it('declines, cancels and removes', async () => {
    const { a, b, matchId } = await pairWithFinishedMatch()
    await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect((await b.post(`/api/friends/requests/${a.userId}/decline`)).status).toBe(204)
    expect((await friendsOf(a)).outgoing).toEqual([])
    expect((await b.post(`/api/friends/requests/${a.userId}/decline`)).status).toBe(404)

    await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect((await del(a, `/api/friends/requests/${b.userId}`)).status).toBe(204)
    expect((await friendsOf(b)).incoming).toEqual([])
    // Only the receiver can accept.
    await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect((await a.post(`/api/friends/requests/${b.userId}/accept`)).status).toBe(404)
    expect((await b.post(`/api/friends/requests/${a.userId}/accept`)).status).toBe(200)

    const bSocial = await connect(b)
    expect((await del(a, `/api/friends/${b.userId}`)).status).toBe(204)
    await bSocial.wait('friendsChanged')
    expect((await friendsOf(b)).friends).toEqual([])
    expect((await del(a, `/api/friends/${b.userId}`)).status).toBe(404)
    await bSocial.leave()
  })
})

describe('friend requests: limits', () => {
  it('caps friends at 50 for the sender and, at accept time, for both sides', async () => {
    const { a, b, matchId } = await pairWithFinishedMatch()
    const c = await registered(h)
    const withC = await seedMatch('finished', [a.userId, c.userId, null, null])
    for (let i = 0; i < 49; i++) await seedFriendship(a.userId, await fakeUser(), 'accepted')
    // B asks A while A has 49 friends; C is asked by A, too.
    expect((await b.post('/api/friends/requests', { matchId, seat: 0 })).status).toBe(200)
    expect((await a.post('/api/friends/requests', { matchId: withC, seat: 1 })).status).toBe(200)
    await seedFriendship(a.userId, await fakeUser(), 'accepted')
    expect((await friendsOf(a)).friends).toHaveLength(50)

    const accept = await a.post(`/api/friends/requests/${b.userId}/accept`)
    expect(accept.status).toBe(409)
    expect(accept.body.error).toBe('FRIEND_CAP')
    const theirs = await c.post(`/api/friends/requests/${a.userId}/accept`)
    expect(theirs.status).toBe(409)
    expect(theirs.body.error).toBe('TARGET_FRIEND_CAP')

    const d = await registered(h)
    const withD = await seedMatch('finished', [a.userId, d.userId, null, null])
    const send = await a.post('/api/friends/requests', { matchId: withD, seat: 1 })
    expect(send.body.error).toBe('FRIEND_CAP')
    const toFull = await d.post('/api/friends/requests', { matchId: withD, seat: 0 })
    expect(toFull.body.error).toBe('TARGET_FRIEND_CAP')
    const rel = (await a.get(`/api/friends/match/${withD}`))
      .body as unknown as MatchRelationsResponse
    expect(rel.capReached).toBe(true)
  })

  it('allows at most 10 pending outgoing requests', async () => {
    const { a, matchId } = await pairWithFinishedMatch()
    for (let i = 0; i < 10; i++) await seedFriendship(a.userId, await fakeUser(), 'pending')
    const res = await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('OUTGOING_CAP')
    const rel = (await a.get(`/api/friends/match/${matchId}`))
      .body as unknown as MatchRelationsResponse
    expect(rel.outgoingFull).toBe(true)
  })

  it('rate-limits friend requests per user', async () => {
    const a = await registered(h)
    for (let i = 0; i < FRIEND_REQUESTS_PER_HOUR; i++) {
      const res = await a.post('/api/friends/requests', { matchId: randomUUID(), seat: 1 })
      expect(res.status).toBe(404)
    }
    const limited = await a.post('/api/friends/requests', { matchId: randomUUID(), seat: 1 })
    expect(limited.status).toBe(429)
    // Per user: someone else on the same IP is unaffected.
    const b = await registered(h)
    expect((await b.post('/api/friends/requests', { matchId: randomUUID(), seat: 1 })).status).toBe(
      404,
    )
  })
})

describe('presence', () => {
  it('tells friends when you come online and go offline (after the grace)', async () => {
    const { a, b } = await pairWithFinishedMatch()
    await seedFriendship(a.userId, b.userId, 'accepted')
    const stranger = await registered(h)
    const aSocial = await connect(a)
    const strangerSocial = await connect(stranger)
    expect((await friendsOf(a)).friends[0]?.online).toBe(false)
    const bSocial = await connect(b)
    await aSocial.wait('presence', (p) => p.userId === b.userId && p.online)
    expect((await friendsOf(a)).friends[0]?.online).toBe(true)
    await bSocial.leave()
    await aSocial.wait('presence', (p) => p.userId === b.userId && !p.online)
    expect((await friendsOf(a)).friends[0]?.online).toBe(false)
    // Presence goes to friends only.
    expect(strangerSocial.of('presence').some((p) => p.userId === b.userId)).toBe(false)
    await aSocial.leave()
    await strangerSocial.leave()
  })
})

describe('account deletion and export', () => {
  it('exports friends and requests; deleting the account deletes them (not re-keyed)', async () => {
    const { a, b } = await pairWithFinishedMatch()
    const c = await registered(h)
    await seedFriendship(a.userId, b.userId, 'accepted')
    await seedFriendship(a.userId, c.userId, 'pending')
    const exp = await a.get('/api/account/export')
    expect(exp.status).toBe(200)
    const friends = (exp.body as { friends: { username: string; status: string }[] }).friends
    expect(friends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: b.name, status: 'friends' }),
        expect.objectContaining({ username: c.name, status: 'sent' }),
      ]),
    )

    const bSocial = await connect(b)
    const gone = await a.request('DELETE', '/api/account', { confirm: 'DELETE' })
    expect(gone.status).toBe(200)
    await bSocial.wait('friendsChanged')
    const rows = await db()
      .select()
      .from(friendships)
      .where(
        or(
          eq(friendships.userA, a.userId),
          eq(friendships.userB, a.userId),
          eq(friendships.requestedBy, a.userId),
        ),
      )
    expect(rows).toEqual([])
    expect((await friendsOf(b)).friends).toEqual([])
    expect((await friendsOf(c)).incoming).toEqual([])
    // Nothing moved to the placeholder that holds A's match history either.
    const all = await db().select().from(friendships)
    expect(all.some((r) => r.userA === b.userId || r.userB === b.userId)).toBe(false)
    await bSocial.leave()
  })
})

describe('challenges', () => {
  async function friends(n: number) {
    const host = await registered(h)
    const others: Browser[] = []
    for (let i = 0; i < n; i++) {
      const f = await registered(h)
      await seedFriendship(host.userId, f.userId, 'accepted')
      others.push(f)
    }
    return { host, others }
  }

  async function challenge(host: Browser, invitees: Browser[], mode: 'ffa' | 'teams' = 'ffa') {
    const res = await host.post('/api/challenges', {
      friendIds: invitees.map((b) => b.userId),
      mode,
      timeControl: '3+2',
    })
    expect(res.status).toBe(201)
    return (res.body as { challenge: Challenge }).challenge
  }

  it('creates an invite-only lobby: invitees join without a password, others are refused', async () => {
    const { host, others } = await friends(2)
    const [f1, f2] = others as [Browser, Browser]
    const f1Social = await connect(f1)
    const hostSocial = await connect(host)
    const c = await challenge(host, [f1, f2])
    expect(c.from).toEqual({ userId: host.userId, username: host.name })
    expect(c.invitees.map((i) => i.status)).toEqual(['pending', 'pending'])
    const note = await f1Social.wait('challenge')
    expect(note.id).toBe(c.id)
    expect(note.roomId).toBe(c.roomId)
    const listed = (await f2.get('/api/challenges')).body as unknown as ChallengesResponse
    expect(listed.incoming.map((x) => x.id)).toEqual([c.id])
    expect(
      ((await host.get('/api/challenges')).body as unknown as ChallengesResponse).outgoing,
    ).toHaveLength(1)

    const hostPlayer = await joinLobby(host, c.roomId)
    expect(hostPlayer.state.inviteOnly).toBe(true)
    expect(hostPlayer.state.hasPassword).toBe(false)
    expect(hostPlayer.state.ranked).toBe(false)
    expect(hostPlayer.state.timeControl).toBe('3+2')
    expect(hostPlayer.state.hostSeat).toBe(hostPlayer.seat)
    // Never in the lobby browser.
    const publicRooms = await matchMaker.query({ name: ROOM_NAMES.match, private: false })
    expect(publicRooms.some((r) => r.roomId === c.roomId)).toBe(false)

    const stranger = await registered(h)
    expect(
      await matchmakeError(
        stranger.sdk().joinById(c.roomId, { protocolVersion: 1, password: 'guess' }),
      ),
    ).toBe('not_invited')
    const g = await guest(h)
    expect(await matchmakeError(g.sdk().joinById(c.roomId, { protocolVersion: 1 }))).toBe(
      'not_invited',
    )

    const joined = await joinLobby(f1, c.roomId)
    expect(joined.seat).toBeGreaterThanOrEqual(0)
    const upd = await hostSocial.wait('challengeUpdate')
    expect(upd).toMatchObject({ challengeId: c.id, user: { userId: f1.userId }, status: 'joined' })

    // The host can still fill seats with bots (casual).
    hostPlayer.send('addBot', { seat: 3, level: '1200' })
    await hostPlayer.waitState((s) => s.seats[3]?.isBot === true)
    for (const p of [hostPlayer, joined]) await p.leave()
    await f1Social.leave()
    await hostSocial.leave()
  })

  it('only friends can be challenged, and not while you sit in another lobby', async () => {
    const { host, others } = await friends(1)
    const stranger = await registered(h)
    const res = await host.post('/api/challenges', {
      friendIds: [stranger.userId],
      mode: 'ffa',
      timeControl: '10+0',
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('NOT_FRIENDS')
    const four = await host.post('/api/challenges', {
      friendIds: ['a', 'b', 'c', 'd'],
      mode: 'ffa',
      timeControl: '10+0',
    })
    expect(four.status).toBe(400)
    const elsewhere = await createLobby(host, { name: 'Busy' })
    const busy = await host.post('/api/challenges', {
      friendIds: [others[0]?.userId],
      mode: 'ffa',
      timeControl: '10+0',
    })
    expect(busy.status).toBe(409)
    expect(busy.body.error).toBe('ALREADY_IN_ROOM')
    await elsewhere.leave()
  })

  it('decline tells the challenger; the invitee no longer sees it', async () => {
    const { host, others } = await friends(2)
    const [f1, f2] = others as [Browser, Browser]
    const hostSocial = await connect(host)
    const c = await challenge(host, [f1, f2])
    const hostPlayer = await joinLobby(host, c.roomId)
    expect((await f1.post(`/api/challenges/${c.id}/decline`)).status).toBe(204)
    const upd = await hostSocial.wait('challengeUpdate', (u) => u.status === 'declined')
    expect(upd.user.userId).toBe(f1.userId)
    const mine = (await f1.get('/api/challenges')).body as unknown as ChallengesResponse
    expect(mine.incoming).toEqual([])
    expect((await f1.post(`/api/challenges/${c.id}/decline`)).status).toBe(409)
    // A stranger can't answer it.
    const stranger = await registered(h)
    expect((await stranger.post(`/api/challenges/${c.id}/decline`)).status).toBe(409)
    // f2 can still accept by joining.
    const p2 = await joinLobby(f2, c.roomId)
    await p2.leave()
    await hostPlayer.leave()
    await hostSocial.leave()
  })

  it('expires after its time: invitees are told and can no longer join', async () => {
    const { host, others } = await friends(1)
    const f1 = others[0] as Browser
    const f1Social = await connect(f1)
    const ttl = social().options.challengeTtlMs
    social().options.challengeTtlMs = 400
    let hostPlayer: Player | undefined
    try {
      const c = await challenge(host, [f1])
      hostPlayer = await joinLobby(host, c.roomId)
      const closed = await f1Social.wait('challengeClosed')
      expect(closed).toEqual({ challengeId: c.id, reason: 'expired' })
      expect(
        ((await f1.get('/api/challenges')).body as unknown as ChallengesResponse).incoming,
      ).toEqual([])
      expect(await matchmakeError(f1.sdk().joinById(c.roomId, { protocolVersion: 1 }))).toBe(
        'not_invited',
      )
    } finally {
      social().options.challengeTtlMs = ttl
      await hostPlayer?.leave()
      await f1Social.leave()
    }
  })

  it('the host can invite again after the invitation ends, into the same lobby', async () => {
    const { host, others } = await friends(2)
    const [f1, f2] = others as [Browser, Browser]
    const f1Social = await connect(f1)
    const ttl = social().options.challengeTtlMs
    social().options.challengeTtlMs = 300
    let hostPlayer: Player | undefined
    let p2: Player | undefined
    let p1: Player | undefined
    try {
      const c = await challenge(host, [f1, f2])
      hostPlayer = await joinLobby(host, c.roomId)
      p2 = await joinLobby(f2, c.roomId)
      await f1Social.wait('challengeClosed', (p) => p.challengeId === c.id)
      expect(await matchmakeError(f1.sdk().joinById(c.roomId, { protocolVersion: 1 }))).toBe(
        'not_invited',
      )
      social().options.challengeTtlMs = ttl
      // Someone else (even a seated invitee) can't reopen it.
      const notHost = await f2.post('/api/challenges', {
        friendIds: [host.userId],
        mode: 'ffa',
        timeControl: '3+2',
        roomId: c.roomId,
      })
      expect(notHost.status).toBe(409)
      // The host reopens it: seated players are left out, the rest are invited again.
      const again = await host.post('/api/challenges', {
        friendIds: [f1.userId, f2.userId],
        mode: 'teams',
        timeControl: '10+0',
        roomId: c.roomId,
      })
      expect(again.status).toBe(201)
      const c2 = (again.body as { challenge: Challenge }).challenge
      expect(c2.roomId).toBe(c.roomId)
      expect(c2.timeControl).toBe('3+2')
      expect(c2.mode).toBe('ffa')
      expect(c2.invitees.map((i) => i.user.userId)).toEqual([f1.userId])
      const note = await f1Social.wait('challenge', (x) => x.id === c2.id)
      expect(note.roomId).toBe(c.roomId)
      p1 = await joinLobby(f1, c.roomId)
      expect(p1.seat).toBeGreaterThanOrEqual(0)
      // Everyone picked is seated now: nothing to reopen.
      const none = await host.post('/api/challenges', {
        friendIds: [f1.userId],
        mode: 'ffa',
        timeControl: '3+2',
        roomId: c.roomId,
      })
      expect(none.status).toBe(400)
    } finally {
      social().options.challengeTtlMs = ttl
      for (const p of [p1, p2, hostPlayer]) await p?.leave()
      await f1Social.leave()
    }
  })

  it('a lobby you are not hosting can not be reopened', async () => {
    const { host, others } = await friends(1)
    const other = await createLobby(others[0] as Browser, { name: 'Theirs' })
    const res = await host.post('/api/challenges', {
      friendIds: [others[0]?.userId],
      mode: 'ffa',
      timeControl: '10+0',
      roomId: other.room.roomId,
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('CHALLENGE_CLOSED')
    await other.leave()
  })

  it('the host removing an invitee withdraws the invitation to them', async () => {
    const { host, others } = await friends(2)
    const [f1, f2] = others as [Browser, Browser]
    const f1Social = await connect(f1)
    const hostSocial = await connect(host)
    const c = await challenge(host, [f1, f2])
    const hostPlayer = await joinLobby(host, c.roomId)
    expect((await host.request('DELETE', `/api/friends/${f1.userId}`)).status).toBe(204)
    expect(await f1Social.wait('challengeClosed', (p) => p.challengeId === c.id)).toEqual({
      challengeId: c.id,
      reason: 'cancelled',
    })
    const upd = await hostSocial.wait('challengeUpdate', (u) => u.status === 'expired')
    expect(upd.user.userId).toBe(f1.userId)
    expect(await matchmakeError(f1.sdk().joinById(c.roomId, { protocolVersion: 1 }))).toBe(
      'not_invited',
    )
    // f2's invitation is untouched.
    const out = ((await host.get('/api/challenges')).body as unknown as ChallengesResponse)
      .outgoing[0]
    expect(out?.invitees.map((i) => i.user.userId)).toEqual([f2.userId])
    const p2 = await joinLobby(f2, c.roomId)
    await p2.leave()
    await hostPlayer.leave()
    await f1Social.leave()
    await hostSocial.leave()
  })

  it('closes when the lobby starts or closes', async () => {
    const { host, others } = await friends(2)
    const [f1, f2] = others as [Browser, Browser]
    const f2Social = await connect(f2)
    const c = await challenge(host, [f1, f2])
    const hostPlayer = await joinLobby(host, c.roomId)
    const p1 = await joinLobby(f1, c.roomId)
    hostPlayer.send('addBot', { seat: 2, level: '1200' })
    hostPlayer.send('addBot', { seat: 3, level: '1200' })
    await hostPlayer.waitState((s) => s.seats.every((x) => x.occupied))
    hostPlayer.send('setCiv', { civ: 'mali' })
    p1.send('setCiv', { civ: 'japan' })
    await hostPlayer.waitState((s) => s.seats.every((x) => x.civ !== ''))
    hostPlayer.send('setReady', { ready: true })
    p1.send('setReady', { ready: true })
    await hostPlayer.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
    hostPlayer.send('startGame')
    await hostPlayer.waitState((s) => s.phase === 'in_game')
    expect(await f2Social.wait('challengeClosed')).toEqual({ challengeId: c.id, reason: 'started' })
    await hostPlayer.leave()
    await p1.leave()

    // A lobby everyone left closes, and its challenge with it.
    const { host: h2, others: o2 } = await friends(1)
    const o2Social = await connect(o2[0] as Browser)
    const c2 = await challenge(h2, o2)
    const hp2 = await joinLobby(h2, c2.roomId)
    await hp2.leave()
    expect(await o2Social.wait('challengeClosed')).toEqual({
      challengeId: c2.id,
      reason: 'closed',
    })
    await f2Social.leave()
    await o2Social.leave()
  })
})
