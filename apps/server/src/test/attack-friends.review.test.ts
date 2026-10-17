/**
 * Adversarial review of friends & challenges: session revocation vs the social channel,
 * cap races, deleted-user leftovers, invite-only lobbies, privacy of challenge views.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { Room } from '@colyseus/sdk'
import { civilizations, friendships, matches, matchPlayers, sessions, users } from '@game/db'
import { type Challenge, type ChallengesResponse, CLOSE_CODES, ROOM_NAMES } from '@game/protocol'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, pairOf, SocialError, sendRequest } from '../social/friends.ts'
import {
  type Browser,
  FakeBotClient,
  type GameHarness,
  joinLobby,
  matchmakeError,
  registered,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness(
    {},
    { botClient: new FakeBotClient(), social: { presenceGraceMs: 50, sessionCheckMs: 150 } },
  )
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db

async function seedMatch(status: 'finished' | 'in_progress', seats: (string | null)[]) {
  const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, 'japan'))
  const [match] = await db()
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, status })
    .returning()
  if (!match || !civ) throw new Error('fixture')
  await db()
    .insert(matchPlayers)
    .values(
      [0, 1, 2, 3].map((seat) => ({
        matchId: match.id,
        seat,
        userId: seats[seat] ?? null,
        botLevel: seats[seat] ? null : '1200',
        civId: civ.id,
        civVersion: 1,
      })),
    )
  return match.id
}

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

class Conn {
  readonly messages: { type: string; payload: unknown }[] = []
  readonly room: Room
  closeCode: number | undefined
  constructor(room: Room) {
    this.room = room
    room.reconnection.enabled = false
    room.onMessage('*', (type, payload) => {
      this.messages.push({ type: String(type), payload })
    })
    room.onLeave((code) => {
      this.closeCode = code
    })
  }
  has(type: string, pred: (p: unknown) => boolean = () => true) {
    return this.messages.some((m) => m.type === type && pred(m.payload))
  }
  async leave() {
    // A connection the server already closed never answers a leave.
    if (this.closeCode !== undefined) return
    await this.room.leave(true).catch(() => {})
  }
}

const connect = async (b: Browser) => new Conn(await b.sdk().joinOrCreate(ROOM_NAMES.social))

describe('social channel vs session revocation', () => {
  it('a signed-out session stops receiving friends presence and stops showing online', async () => {
    const a = await registered(h)
    const b = await registered(h)
    await seedFriendship(a.userId, b.userId, 'accepted')
    const aConn = await connect(a)
    const out = await a.post('/api/auth/sign-out', {})
    expect(out.status).toBe(200)
    // The session is gone for REST...
    expect((await a.get('/api/friends')).status).toBe(401)
    await sleep(200)
    // ...but the realtime channel opened with it should not keep pushing friends' data.
    const bConn = await connect(b)
    await sleep(300)
    const leaked = aConn.has('presence', (p) => (p as { userId: string }).userId === b.userId)
    const list = await b.get('/api/friends')
    const aOnline = (list.body as { friends: { userId: string; online: boolean }[] }).friends.find(
      (f) => f.userId === a.userId,
    )?.online
    await aConn.leave()
    await bConn.leave()
    expect({ leaked, aOnline }).toEqual({ leaked: false, aOnline: false })
    expect(aConn.closeCode).toBe(CLOSE_CODES.sessionEnded)
  })
})

describe('social channel vs sessions removed outside Better Auth', () => {
  it('the periodic check closes a connection whose session row is gone', async () => {
    const a = await registered(h)
    const aConn = await connect(a)
    await db().delete(sessions).where(eq(sessions.userId, a.userId))
    await waitFor(() => aConn.closeCode !== undefined, 5_000, 'connection closed')
    expect(aConn.closeCode).toBe(CLOSE_CODES.sessionEnded)
  })

  it('a live session keeps its connection across checks', async () => {
    const a = await registered(h)
    const aConn = await connect(a)
    await sleep(500)
    expect(aConn.closeCode).toBeUndefined()
    await aConn.leave()
  })
})

describe('requests racing an account deletion', () => {
  it('a request to an account deleted after the eligibility check is a 404, not a 500', async () => {
    const x = await registered(h)
    const y = await registered(h)
    expect((await y.request('DELETE', '/api/account', { confirm: 'DELETE' })).status).toBe(200)
    const err = await sendRequest(db(), DEFAULT_LIMITS, x.userId, y.userId).catch((e) => e)
    expect(err).toBeInstanceOf(SocialError)
    expect((err as SocialError).status).toBe(404)
  })
})

describe('caps under concurrency', () => {
  it('two parallel accepts at 49 friends: only one succeeds', async () => {
    const a = await registered(h)
    for (let i = 0; i < 49; i++) await seedFriendship(a.userId, await fakeUser(), 'accepted')
    const b = await registered(h)
    const c = await registered(h)
    await seedFriendship(b.userId, a.userId, 'pending', b.userId)
    await seedFriendship(c.userId, a.userId, 'pending', c.userId)
    const [r1, r2] = await Promise.all([
      a.post(`/api/friends/requests/${b.userId}/accept`),
      a.post(`/api/friends/requests/${c.userId}/accept`),
    ])
    expect([r1.status, r2.status].sort()).toEqual([200, 409])
  })

  it('parallel requests cannot exceed 10 outgoing', async () => {
    const a = await registered(h)
    const targets: { matchId: string }[] = []
    for (let i = 0; i < 4; i++) {
      const t = [await registered(h), await registered(h), await registered(h)]
      targets.push({ matchId: await seedMatch('finished', [a.userId, ...t.map((x) => x.userId)]) })
    }
    const sends = targets.flatMap(({ matchId }) =>
      [1, 2, 3].map((seat) => a.post('/api/friends/requests', { matchId, seat })),
    )
    const res = await Promise.all(sends)
    expect(res.filter((r) => r.status === 200)).toHaveLength(10)
  })
})

describe('deleted-user leftovers', () => {
  it('a pending request from a deleted account is withdrawn live on the receiver', async () => {
    const x = await registered(h)
    const y = await registered(h)
    const matchId = await seedMatch('finished', [x.userId, y.userId, null, null])
    expect((await x.post('/api/friends/requests', { matchId, seat: 1 })).status).toBe(200)
    const yConn = await connect(y)
    const del = await x.request('DELETE', '/api/account', { confirm: 'DELETE' })
    expect(del.status).toBe(200)
    await sleep(400)
    const told = yConn.has('friendsChanged')
    await yConn.leave()
    expect(told).toBe(true)
  })

  it('a deleted invitee disappears from the challenger’s open challenge', async () => {
    const host = await registered(h)
    const f1 = await registered(h)
    await seedFriendship(host.userId, f1.userId, 'accepted')
    const res = await host.post('/api/challenges', {
      friendIds: [f1.userId],
      mode: 'ffa',
      timeControl: '10+0',
    })
    expect(res.status).toBe(201)
    const c = (res.body as { challenge: Challenge }).challenge
    const hp = await joinLobby(host, c.roomId)
    expect((await f1.request('DELETE', '/api/account', { confirm: 'DELETE' })).status).toBe(200)
    const out = (await host.get('/api/challenges')).body as unknown as ChallengesResponse
    const still = out.outgoing
      .find((x) => x.id === c.id)
      ?.invitees.some((i) => i.user.userId === f1.userId)
    await hp.leave()
    expect(still ?? false).toBe(false)
  })
})

describe('challenges: privacy and friendship changes', () => {
  it('an invitee does not learn the user id of a co-invitee who is not their friend', async () => {
    const host = await registered(h)
    const f1 = await registered(h)
    const f2 = await registered(h)
    await seedFriendship(host.userId, f1.userId, 'accepted')
    await seedFriendship(host.userId, f2.userId, 'accepted')
    const res = await host.post('/api/challenges', {
      friendIds: [f1.userId, f2.userId],
      mode: 'ffa',
      timeControl: '10+0',
    })
    const c = (res.body as { challenge: Challenge }).challenge
    const hp = await joinLobby(host, c.roomId)
    const seen = ((await f1.get('/api/challenges')).body as unknown as ChallengesResponse).incoming
    const leaksId = JSON.stringify(seen).includes(f2.userId)
    await hp.leave()
    expect(leaksId).toBe(false)
  })

  it('removing the friend withdraws their open challenge to you', async () => {
    const host = await registered(h)
    const f1 = await registered(h)
    await seedFriendship(host.userId, f1.userId, 'accepted')
    const res = await host.post('/api/challenges', {
      friendIds: [f1.userId],
      mode: 'ffa',
      timeControl: '10+0',
    })
    const c = (res.body as { challenge: Challenge }).challenge
    const hp = await joinLobby(host, c.roomId)
    expect((await f1.request('DELETE', `/api/friends/${host.userId}`)).status).toBe(204)
    const incoming = ((await f1.get('/api/challenges')).body as unknown as ChallengesResponse)
      .incoming
    const err = await matchmakeError(f1.sdk().joinById(c.roomId, { protocolVersion: 1 })).catch(
      () => 'joined',
    )
    await hp.leave()
    expect({ incoming: incoming.length, err }).toEqual({ incoming: 0, err: 'not_invited' })
  })

  it('a challenger who never joins: the invitee is told the challenge closed', async () => {
    const host = await registered(h)
    const f1 = await registered(h)
    await seedFriendship(host.userId, f1.userId, 'accepted')
    const f1Conn = await connect(f1)
    const res = await host.post('/api/challenges', {
      friendIds: [f1.userId],
      mode: 'ffa',
      timeControl: '10+0',
    })
    expect(res.status).toBe(201)
    const c = (res.body as { challenge: Challenge }).challenge
    await waitFor(
      () =>
        f1Conn.has('challengeClosed', (p) => (p as { challengeId: string }).challengeId === c.id),
      20_000,
      'challengeClosed',
    )
    await f1Conn.leave()
  }, 30_000)
})
