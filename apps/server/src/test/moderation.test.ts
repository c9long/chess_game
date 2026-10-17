/**
 * Moderation (PLAN §3 "Moderation"): the username policy at sign-up and when choosing a
 * username, blocking (friendships, requests, challenges, presence, neutral errors), reports
 * (rate limits, one open report per game), the admin review queue (admin-only endpoints,
 * dismiss, warn, rename, suspend and unsuspend), account deletion, export and retention.
 */
import type { Room } from '@colyseus/sdk'
import {
  blocks,
  civilizations,
  friendships,
  matches,
  matchPlayers,
  reports,
  sessions,
  users,
} from '@game/db'
import {
  type AdminReportsResponse,
  type Challenge,
  type FriendsResponse,
  type MatchListResponse,
  type MatchRelationsResponse,
  ROOM_NAMES,
  type SocialMessages,
} from '@game/protocol'
import { and, eq, or } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymizeUser } from '../account/anonymize.ts'
import { purgeOldReports } from '../jobs/moderation-purge.ts'
import { pairOf } from '../social/friends.ts'
import {
  Browser,
  createLobby,
  FakeBotClient,
  type GameHarness,
  guest,
  joinLobby,
  matchmakeError,
  registered,
  startGameHarness,
  waitFor,
} from './game-harness.ts'
import { TURNSTILE_DUMMY_TOKEN } from './turnstile-stub.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness(
    {},
    {
      botClient: new FakeBotClient(),
      social: { presenceGraceMs: 50, maxBlocks: 3 },
      moderation: { reportsPerDay: 4 },
    },
  )
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db
const moderation = () => h.server.ctx.moderation
const del = (b: Browser, path: string) => b.request('DELETE', path)
const UNAVAILABLE = 'That username isn’t available. Try another.'

async function civId(slug = 'japan') {
  const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, slug))
  if (!civ) throw new Error('no civ')
  return civ.id
}

async function seedMatch(
  status: 'finished' | 'in_progress' | 'aborted',
  seats: (string | null)[],
): Promise<string> {
  const [match] = await db()
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 2, status })
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

async function friendsOf(b: Browser): Promise<FriendsResponse> {
  const res = await b.get('/api/friends')
  expect(res.status).toBe(200)
  return res.body as unknown as FriendsResponse
}

class SocialConn {
  readonly messages: { type: string; payload: unknown }[] = []
  readonly room: Room
  closedCode: number | undefined

  constructor(room: Room) {
    this.room = room
    room.onMessage('*', (type, payload) => {
      this.messages.push({ type: String(type), payload })
    })
    room.onLeave((code) => {
      this.closedCode = code
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
  const room = await b.sdk().joinOrCreate(ROOM_NAMES.social)
  room.reconnection.enabled = false
  return new SocialConn(room)
}

/** Signs up through the real form flow with `username`; returns the response. */
async function signUpAs(b: Browser, username: string) {
  return b.post(
    '/api/auth/sign-up/email',
    {
      email: `${username.toLowerCase()}_${Date.now()}@example.test`,
      password: 'correct horse battery staple',
      name: username,
      username,
    },
    { 'x-captcha-response': TURNSTILE_DUMMY_TOKEN },
  )
}

async function signIn(b: Browser, username: string) {
  return b.post(
    '/api/auth/sign-in/username',
    { username, password: 'correct horse battery staple' },
    { 'x-captcha-response': TURNSTILE_DUMMY_TOKEN },
  )
}

async function makeAdmin(): Promise<Browser> {
  const admin = await registered(h)
  ;(moderation().admins as Set<string>).add(admin.userId)
  return admin
}

describe('username policy', () => {
  it('refuses reserved and profane usernames at sign-up with one neutral message', async () => {
    for (const name of [
      'Admin_Team',
      'Moderator',
      'Guest_4821',
      'Bot_1500',
      'Sh1t_Lord',
      'f_u_c_k',
    ]) {
      const b = new Browser(h)
      await b.onboard()
      const res = await signUpAs(b, name)
      expect(res.status, name).toBe(400)
      expect(res.body).toMatchObject({ code: 'USERNAME_UNAVAILABLE', message: UNAVAILABLE })
    }
  })

  it('accepts innocent names that contain a blocked word', async () => {
    for (const name of [`Scunthorpe_${Date.now() % 1000}`, `Classic_${Date.now() % 1000}`]) {
      const b = new Browser(h)
      await b.onboard()
      const res = await signUpAs(b, name)
      expect(res.status, name).toBe(200)
    }
  })

  it('applies when a guest upgrades and when an account chooses its username', async () => {
    const g = await guest(h)
    await g.onboard() // the sign-up form's clickwrap
    const upgrade = await signUpAs(g, 'Official_Staff')
    expect(upgrade.status).toBe(400)
    expect(upgrade.body).toMatchObject({ code: 'USERNAME_UNAVAILABLE' })

    // An account without a username (as after an OAuth sign-up or a moderator rename).
    const a = await registered(h)
    await db()
      .update(users)
      .set({ username: null, displayUsername: null, name: 'Player-1234' })
      .where(eq(users.id, a.userId))
    const bad = await a.post('/api/auth/update-user', { username: 'administrator' })
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ code: 'USERNAME_UNAVAILABLE', message: UNAVAILABLE })
    const name = `fresh_${Date.now() % 100000}`
    const ok = await a.post('/api/auth/update-user', { username: name })
    expect(ok.status).toBe(200)
  })

  it('never locks an existing account out of username sign-in', async () => {
    const a = await registered(h)
    const legacy = `admin_${Date.now() % 100000}`
    await db()
      .update(users)
      .set({ username: legacy, displayUsername: legacy, name: legacy })
      .where(eq(users.id, a.userId))
    const fresh = new Browser(h)
    await fresh.onboard()
    expect((await signIn(fresh, legacy)).status).toBe(200)
  })

  it('filters profanity in lobby names', async () => {
    const a = await registered(h)
    const err = await matchmakeError(
      a.sdk().create(ROOM_NAMES.match, {
        protocolVersion: 1,
        kind: 'lobby',
        name: 'sh1t lobby',
        mode: 'ffa',
        timeControl: '10+0',
      }),
    )
    expect(err).toBe('invalid_options')
  })
})

describe('blocking', () => {
  async function pair() {
    const a = await registered(h)
    const b = await registered(h)
    const matchId = await seedMatch('finished', [a.userId, b.userId, null, null])
    return { a, b, matchId }
  }

  it('removes the friendship, hides it from the other side and refuses requests neutrally', async () => {
    const { a, b, matchId } = await pair()
    await seedFriendship(a.userId, b.userId, 'accepted')
    const bSocial = await connect(b)
    const res = await a.post('/api/blocks', { userId: b.userId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: { userId: b.userId, username: b.name } })
    await bSocial.wait('friendsChanged')

    const mine = await friendsOf(a)
    expect(mine.friends).toEqual([])
    expect(mine.blocked).toEqual([expect.objectContaining({ userId: b.userId, username: b.name })])
    expect(mine.limits.maxBlocked).toBe(3)
    const theirs = await friendsOf(b)
    expect(theirs.friends).toEqual([])
    expect(theirs.blocked).toEqual([])
    expect(JSON.stringify(theirs)).not.toContain(a.userId)

    // The blocked player gets exactly what any ineligible request gets.
    const ineligible = await (async () => {
      const g = await guest(h)
      const m = await seedMatch('finished', [b.userId, g.userId, null, null])
      return b.post('/api/friends/requests', { matchId: m, seat: 1 })
    })()
    const fromBlocked = await b.post('/api/friends/requests', { matchId, seat: 0 })
    expect(fromBlocked.status).toBe(ineligible.status)
    expect(fromBlocked.body).toEqual(ineligible.body)
    expect(fromBlocked.body).toMatchObject({ error: 'NOT_ELIGIBLE' })
    // The blocker is told why.
    const fromBlocker = await a.post('/api/friends/requests', { matchId, seat: 1 })
    expect(fromBlocker.status).toBe(409)
    expect(fromBlocker.body).toMatchObject({ error: 'BLOCKED' })

    // Seat relations and history show the block to the blocker only.
    const rel = (await a.get(`/api/friends/match/${matchId}`))
      .body as unknown as MatchRelationsResponse
    expect(rel.seats.find((s) => s.seat === 1)).toMatchObject({ relation: 'none', blocked: true })
    const relB = (await b.get(`/api/friends/match/${matchId}`))
      .body as unknown as MatchRelationsResponse
    expect(relB.seats.find((s) => s.seat === 0)).toMatchObject({ relation: 'none', blocked: false })
    const hist = (await a.get('/api/matches')).body as unknown as MatchListResponse
    const opp = hist.matches.find((m) => m.id === matchId)?.opponents.find((o) => o.seat === 1)
    expect(opp).toMatchObject({ blocked: true, friend: null, reportable: true })

    // Unblock: requests work again.
    expect((await del(a, `/api/blocks/${b.userId}`)).status).toBe(204)
    expect((await del(a, `/api/blocks/${b.userId}`)).status).toBe(404)
    expect((await friendsOf(a)).blocked).toEqual([])
    const again = await b.post('/api/friends/requests', { matchId, seat: 0 })
    expect(again.status).toBe(200)
    await bSocial.leave()
  })

  it('cancels pending requests both ways and blocks by seat', async () => {
    const { a, b, matchId } = await pair()
    await seedFriendship(b.userId, a.userId, 'pending', b.userId)
    const res = await a.post('/api/blocks', { matchId, seat: 1 })
    expect(res.status).toBe(200)
    const [lo, hi] = pairOf(a.userId, b.userId)
    const rows = await db()
      .select()
      .from(friendships)
      .where(and(eq(friendships.userA, lo), eq(friendships.userB, hi)))
    expect(rows).toEqual([])
    expect((await friendsOf(b)).outgoing).toEqual([])
    // Blocking twice changes nothing.
    expect((await a.post('/api/blocks', { matchId, seat: 1 })).status).toBe(200)
    const count = await db().select().from(blocks).where(eq(blocks.blockerId, a.userId))
    expect(count).toHaveLength(1)
    // Unblocking by seat (menus that know no user id).
    expect((await del(a, `/api/blocks/match/${matchId}/1`)).status).toBe(204)
    expect((await friendsOf(a)).blocked).toEqual([])
    expect((await del(a, `/api/blocks/match/${matchId}/1`)).status).toBe(404)
  })

  it('ends challenges between the two; a challenge back gets the non-friend answer', async () => {
    const a = await registered(h)
    const b = await registered(h)
    await seedFriendship(a.userId, b.userId, 'accepted')
    const aSocial = await connect(a)
    const created = await b.post('/api/challenges', {
      friendIds: [a.userId],
      mode: 'ffa',
      timeControl: '3+2',
    })
    expect(created.status).toBe(201)
    const c = (created.body as { challenge: Challenge }).challenge
    await aSocial.wait('challenge')
    expect((await a.post('/api/blocks', { userId: b.userId })).status).toBe(200)
    await aSocial.wait('challengeClosed', (x) => x.challengeId === c.id)
    expect(await matchmakeError(a.sdk().joinById(c.roomId, { protocolVersion: 1 }))).toBe(
      'not_invited',
    )
    const stranger = await registered(h)
    const toStranger = await b.post('/api/challenges', {
      friendIds: [stranger.userId],
      mode: 'ffa',
      timeControl: '3+2',
    })
    const toBlocker = await b.post('/api/challenges', {
      friendIds: [a.userId],
      mode: 'ffa',
      timeControl: '3+2',
    })
    expect(toBlocker.status).toBe(toStranger.status)
    expect(toBlocker.body).toEqual(toStranger.body)
    await aSocial.leave()
  })

  it('hides presence both ways', async () => {
    const a = await registered(h)
    const b = await registered(h)
    await seedFriendship(a.userId, b.userId, 'accepted')
    const aSocial = await connect(a)
    expect((await a.post('/api/blocks', { userId: b.userId })).status).toBe(200)
    const bSocial = await connect(b)
    await bSocial.leave()
    // Give the offline grace (50 ms) time to fire.
    await new Promise((r) => setTimeout(r, 300))
    expect(aSocial.of('presence').some((p) => p.userId === b.userId)).toBe(false)
    const bAgain = await connect(b)
    await aSocial.leave()
    await new Promise((r) => setTimeout(r, 300))
    expect(bAgain.of('presence').some((p) => p.userId === a.userId)).toBe(false)
    expect((await friendsOf(b)).friends).toEqual([])
    await bAgain.leave()
  })

  it('needs a known player: no arbitrary ids, guests, bots or yourself; capped', async () => {
    const a = await registered(h)
    const stranger = await registered(h)
    expect((await a.post('/api/blocks', { userId: stranger.userId })).status).toBe(404)
    const g = await guest(h)
    const m = await seedMatch('in_progress', [a.userId, g.userId, null, null])
    const guestBlock = await a.post('/api/blocks', { matchId: m, seat: 1 })
    expect(guestBlock.status).toBe(403)
    expect((await a.post('/api/blocks', { matchId: m, seat: 2 })).status).toBe(404)
    expect((await a.post('/api/blocks', { matchId: m, seat: 0 })).status).toBe(400)
    // Guests can't block.
    expect((await g.post('/api/blocks', { matchId: m, seat: 0 })).status).toBe(403)

    // Cap (3 in this harness).
    for (let i = 0; i < 3; i++) {
      const x = await registered(h)
      const mm = await seedMatch('finished', [a.userId, x.userId, null, null])
      expect((await a.post('/api/blocks', { matchId: mm, seat: 1 })).status).toBe(200)
    }
    const y = await registered(h)
    const my = await seedMatch('finished', [a.userId, y.userId, null, null])
    const over = await a.post('/api/blocks', { matchId: my, seat: 1 })
    expect(over.status).toBe(409)
    expect(over.body).toMatchObject({ error: 'BLOCK_CAP' })
  })
})

describe('reports', () => {
  it('guests and registered players report from a game; one open report per game', async () => {
    const a = await registered(h)
    const g = await guest(h)
    const m1 = await seedMatch('in_progress', [g.userId, a.userId, null, null])
    const res = await g.post('/api/reports', {
      matchId: m1,
      seat: 1,
      reason: 'cheating',
      note: '  moves instantly every turn  ',
    })
    expect(res.status).toBe(201)
    const [row] = await db().select().from(reports).where(eq(reports.reporterId, g.userId))
    expect(row).toMatchObject({
      reportedUserId: a.userId,
      reportedName: a.name,
      matchId: m1,
      reason: 'cheating',
      note: 'moves instantly every turn',
      status: 'open',
      resolvedAt: null,
    })
    const dup = await g.post('/api/reports', { matchId: m1, seat: 1, reason: 'other' })
    expect(dup.status).toBe(409)
    expect(dup.body).toMatchObject({ error: 'ALREADY_REPORTED' })
    // The reported player can't see anything about it.
    const exp = await a.get('/api/account/export')
    expect(JSON.stringify(exp.body)).not.toContain(g.userId)
    expect(JSON.stringify(exp.body)).not.toContain('moves instantly')

    // A registered player reports a guest (offensive behaviour) from a finished game.
    const m2 = await seedMatch('finished', [a.userId, g.userId, null, null])
    expect(
      (await a.post('/api/reports', { matchId: m2, seat: 1, reason: 'harassment' })).status,
    ).toBe(201)
  })

  it('validates the target and the note', async () => {
    const a = await registered(h)
    const b = await registered(h)
    const m = await seedMatch('finished', [a.userId, b.userId, null, null])
    expect((await a.post('/api/reports', { matchId: m, seat: 2, reason: 'other' })).status).toBe(
      404,
    )
    expect((await a.post('/api/reports', { matchId: m, seat: 0, reason: 'other' })).status).toBe(
      400,
    )
    const stranger = await registered(h)
    expect(
      (await a.post('/api/reports', { userId: stranger.userId, reason: 'other' })).status,
    ).toBe(404)
    const outsider = await registered(h)
    expect(
      (await outsider.post('/api/reports', { matchId: m, seat: 1, reason: 'other' })).status,
    ).toBe(404)
    expect(
      (
        await a.post('/api/reports', {
          matchId: m,
          seat: 1,
          reason: 'other',
          note: 'x'.repeat(501),
        })
      ).status,
    ).toBe(400)
    expect((await a.post('/api/reports', { matchId: m, seat: 1, reason: 'spam' })).status).toBe(400)
    // A friend can be reported from the Friends page by id.
    await seedFriendship(a.userId, b.userId, 'accepted')
    expect(
      (await a.post('/api/reports', { userId: b.userId, reason: 'offensive_username' })).status,
    ).toBe(201)
  })

  it('limits reports per reporter per day', async () => {
    const a = await registered(h)
    for (let i = 0; i < 4; i++) {
      const x = await registered(h)
      const m = await seedMatch('finished', [a.userId, x.userId, null, null])
      expect((await a.post('/api/reports', { matchId: m, seat: 1, reason: 'other' })).status).toBe(
        201,
      )
    }
    const y = await registered(h)
    const m = await seedMatch('finished', [a.userId, y.userId, null, null])
    const over = await a.post('/api/reports', { matchId: m, seat: 1, reason: 'other' })
    expect(over.status).toBe(429)
    expect(over.body).toMatchObject({ error: 'RATE_LIMITED' })
  })
})

describe('admin review queue', () => {
  async function reportedPair(reason: 'cheating' | 'offensive_username' = 'cheating') {
    const reporter = await registered(h)
    const target = await registered(h)
    const matchId = await seedMatch('finished', [reporter.userId, target.userId, null, null])
    const res = await reporter.post('/api/reports', { matchId, seat: 1, reason, note: 'see game' })
    expect(res.status).toBe(201)
    const [row] = await db()
      .select()
      .from(reports)
      .where(
        and(eq(reports.reporterId, reporter.userId), eq(reports.reportedUserId, target.userId)),
      )
    if (!row) throw new Error('no report')
    return { reporter, target, matchId, reportId: row.id }
  }

  it('is admins only, on every endpoint', async () => {
    const { reportId, target } = await reportedPair()
    const user = await registered(h)
    for (const [method, path, body] of [
      ['GET', '/api/admin/me', undefined],
      ['GET', '/api/admin/reports', undefined],
      ['POST', `/api/admin/reports/${reportId}/dismiss`, {}],
      ['POST', `/api/admin/reports/${reportId}/resolve`, { action: 'suspend' }],
      ['POST', `/api/admin/users/${target.userId}/unsuspend`, {}],
    ] as const) {
      const res = await user.request(method, path, body)
      expect(res.status, path).toBe(403)
      expect(res.body).toMatchObject({ error: 'FORBIDDEN' })
      const anon = await new Browser(h).request(method, path, body)
      expect(anon.status, path).toBe(401)
    }
    const [row] = await db().select().from(reports).where(eq(reports.id, reportId))
    expect(row?.status).toBe('open')
    const [u] = await db().select().from(users).where(eq(users.id, target.userId))
    expect(u?.suspendedAt).toBeNull()
  })

  it('lists open reports with counts; dismiss and warn record who and when', async () => {
    const admin = await makeAdmin()
    const first = await reportedPair()
    // A second reporter about the same player.
    const other = await registered(h)
    const m = await seedMatch('finished', [other.userId, first.target.userId, null, null])
    expect(
      (await other.post('/api/reports', { matchId: m, seat: 1, reason: 'other' })).status,
    ).toBe(201)
    const q = (await admin.get('/api/admin/reports')).body as unknown as AdminReportsResponse
    const item = q.reports.find((r) => r.id === first.reportId)
    expect(item).toMatchObject({
      reason: 'cheating',
      note: 'see game',
      matchId: first.matchId,
      reported: {
        userId: first.target.userId,
        name: first.target.name,
        reportedName: first.target.name,
        openReports: 2,
        totalReports: 2,
        openReporters: 2,
        suspendedAt: null,
      },
      reporter: { userId: first.reporter.userId, name: first.reporter.name },
    })

    expect((await admin.post(`/api/admin/reports/${first.reportId}/dismiss`)).status).toBe(204)
    expect((await admin.post(`/api/admin/reports/${first.reportId}/dismiss`)).status).toBe(404)
    const [dismissed] = await db().select().from(reports).where(eq(reports.id, first.reportId))
    expect(dismissed).toMatchObject({ status: 'dismissed', resolvedBy: admin.userId, action: null })
    expect(dismissed?.resolvedAt).toBeInstanceOf(Date)

    const second = await reportedPair()
    expect(
      (await admin.post(`/api/admin/reports/${second.reportId}/resolve`, { action: 'warn' }))
        .status,
    ).toBe(204)
    const [warned] = await db().select().from(reports).where(eq(reports.id, second.reportId))
    expect(warned).toMatchObject({ status: 'resolved', action: 'warn', resolvedBy: admin.userId })
    expect(
      (await admin.post(`/api/admin/reports/${second.reportId}/resolve`, { action: 'nope' }))
        .status,
    ).toBe(400)
  })

  it('rename resets the username; the player chooses a new one', async () => {
    const admin = await makeAdmin()
    const { target, reportId } = await reportedPair('offensive_username')
    const old = target.name
    expect(
      (await admin.post(`/api/admin/reports/${reportId}/resolve`, { action: 'rename' })).status,
    ).toBe(204)
    const session = await target.get('/api/auth/get-session')
    const user = (session.body as { user: { username: string | null; name: string } }).user
    expect(user.username).toBeNull()
    expect(user.name).toMatch(/^Player-\d{4}$/)
    expect(
      await matchmakeError(
        target.sdk().create(ROOM_NAMES.match, {
          protocolVersion: 1,
          kind: 'lobby',
          mode: 'ffa',
          timeControl: '10+0',
        }),
      ),
    ).toBe('username_required')
    const q = (await admin.get('/api/admin/reports')).body as unknown as AdminReportsResponse
    expect(q.reports.some((r) => r.id === reportId)).toBe(false)
    const fresh = `renamed_${Date.now() % 100000}`
    expect((await target.post('/api/auth/update-user', { username: fresh })).status).toBe(200)
    expect(fresh).not.toBe(old)
  })

  it('suspend signs the player out everywhere, refuses sign-in, removes them from lobbies', async () => {
    const admin = await makeAdmin()
    const { target, reportId, matchId } = await reportedPair()
    const targetSocial = await connect(target)
    // The suspended player sits in someone's lobby.
    const host = await registered(h)
    const hostPlayer = await createLobby(host)
    const seated = await joinLobby(target, hostPlayer.room.roomId)
    await hostPlayer.waitState((s) => s.seats.filter((x) => x.occupied).length === 2)

    expect(
      (await admin.post(`/api/admin/reports/${reportId}/resolve`, { action: 'suspend' })).status,
    ).toBe(204)
    const [u] = await db().select().from(users).where(eq(users.id, target.userId))
    expect(u?.suspendedAt).toBeInstanceOf(Date)
    expect(u?.suspendedBy).toBe(admin.userId)
    expect(await db().select().from(sessions).where(eq(sessions.userId, target.userId))).toEqual([])
    expect((await target.get('/api/friends')).status).toBe(401)
    await waitFor(() => targetSocial.closedCode !== undefined, 5_000, 'social closed')
    await seated.waitMessage('kicked')
    await hostPlayer.waitState((s) => s.seats.filter((x) => x.occupied).length === 1)

    const fresh = new Browser(h)
    await fresh.onboard()
    const refused = await signIn(fresh, target.name)
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ code: 'ACCOUNT_SUSPENDED' })
    // Match history stays intact.
    const seats = await db().select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    expect(seats.find((s) => s.seat === 1)?.userId).toBe(target.userId)
    // Listed for unsuspension.
    const q = (await admin.get('/api/admin/reports')).body as unknown as AdminReportsResponse
    expect(q.suspended.some((s) => s.userId === target.userId)).toBe(true)

    expect((await admin.post(`/api/admin/users/${target.userId}/unsuspend`)).status).toBe(204)
    expect((await admin.post(`/api/admin/users/${target.userId}/unsuspend`)).status).toBe(404)
    const back = await signIn(fresh, target.name)
    expect(back.status).toBe(200)
    expect((await fresh.get('/api/friends')).status).toBe(200)
    await hostPlayer.leave()
  })

  it('never suspends an admin', async () => {
    const admin = await makeAdmin()
    const other = await makeAdmin()
    const m = await seedMatch('finished', [admin.userId, other.userId, null, null])
    expect(
      (await admin.post('/api/reports', { matchId: m, seat: 1, reason: 'other' })).status,
    ).toBe(201)
    const [row] = await db().select().from(reports).where(eq(reports.reportedUserId, other.userId))
    const res = await admin.post(`/api/admin/reports/${row?.id}/resolve`, { action: 'suspend' })
    expect(res.status).toBe(400)
  })
})

describe('account deletion, export and retention', () => {
  it('exports blocks and filed reports; deletion drops blocks and re-keys reports', async () => {
    const a = await registered(h)
    const b = await registered(h)
    const c = await registered(h)
    const m = await seedMatch('finished', [a.userId, b.userId, c.userId, null])
    expect((await a.post('/api/blocks', { matchId: m, seat: 1 })).status).toBe(200)
    expect((await c.post('/api/blocks', { matchId: m, seat: 0 })).status).toBe(200)
    expect(
      (await a.post('/api/reports', { matchId: m, seat: 1, reason: 'cheating', note: 'n1' }))
        .status,
    ).toBe(201)
    expect((await c.post('/api/reports', { matchId: m, seat: 0, reason: 'other' })).status).toBe(
      201,
    )

    const exp = (await a.get('/api/account/export')).body as {
      blocked: { username: string }[]
      reportsFiled: { reason: string; note: string | null; matchId: string; status: string }[]
      profile: { suspendedAt: string | null }
    }
    expect(exp.blocked).toEqual([expect.objectContaining({ username: b.name })])
    expect(exp.reportsFiled).toEqual([
      expect.objectContaining({ reason: 'cheating', note: 'n1', matchId: m, status: 'open' }),
    ])
    expect(exp.profile.suspendedAt).toBeNull()
    expect(JSON.stringify(exp.reportsFiled)).not.toContain(b.userId)

    expect((await a.request('DELETE', '/api/account', { confirm: 'DELETE' })).status).toBe(200)
    const left = await db()
      .select()
      .from(blocks)
      .where(or(eq(blocks.blockerId, a.userId), eq(blocks.blockedId, a.userId)))
    expect(left).toEqual([])
    const filed = await db().select().from(reports).where(eq(reports.matchId, m))
    expect(filed).toHaveLength(2)
    for (const r of filed) {
      expect(r.reporterId).not.toBe(a.userId)
      expect(r.reportedUserId).not.toBe(a.userId)
    }
    const about = filed.find((r) => r.reason === 'other')
    expect(about?.reportedName).toBeNull()
    expect((await friendsOf(c)).blocked).toEqual([])
  })

  it('a guest upgrade carries the guest’s reports to the account', async () => {
    const x = await registered(h)
    const g = await guest(h)
    const m = await seedMatch('finished', [g.userId, x.userId, null, null])
    expect((await g.post('/api/reports', { matchId: m, seat: 1, reason: 'other' })).status).toBe(
      201,
    )
    const target = await registered(h)
    // Through the same helper the guest upgrade uses.
    const { mergeGuestInto } = await import('../auth/guest-link.ts')
    expect(await mergeGuestInto(db(), g.userId, target.userId)).toBe(true)
    const rows = await db().select().from(reports).where(eq(reports.matchId, m))
    expect(rows.map((r) => r.reporterId)).toEqual([target.userId])
  })

  it('anonymizing directly keeps reports intact', async () => {
    const a = await registered(h)
    const b = await registered(h)
    const m = await seedMatch('finished', [a.userId, b.userId, null, null])
    expect((await a.post('/api/reports', { matchId: m, seat: 1, reason: 'other' })).status).toBe(
      201,
    )
    await anonymizeUser(db(), b.userId, 'user_request')
    const [r] = await db().select().from(reports).where(eq(reports.matchId, m))
    expect(r?.reporterId).toBe(a.userId)
    expect(r?.reportedName).toBeNull()
  })

  it('purges resolved reports a year after resolution, never open ones', async () => {
    const admin = await makeAdmin()
    const a = await registered(h)
    const b = await registered(h)
    const m1 = await seedMatch('finished', [a.userId, b.userId, null, null])
    const m2 = await seedMatch('finished', [a.userId, b.userId, null, null])
    await a.post('/api/reports', { matchId: m1, seat: 1, reason: 'other' })
    await a.post('/api/reports', { matchId: m2, seat: 1, reason: 'other' })
    const [r1] = await db().select().from(reports).where(eq(reports.matchId, m1))
    await admin.post(`/api/admin/reports/${r1?.id}/dismiss`)
    const soon = await purgeOldReports(db(), { now: new Date(Date.now() + 300 * 86_400_000) })
    expect(soon).toBe(0)
    await purgeOldReports(db(), { now: new Date(Date.now() + 366 * 86_400_000) })
    expect(await db().select().from(reports).where(eq(reports.matchId, m1))).toEqual([])
    expect(await db().select().from(reports).where(eq(reports.matchId, m2))).toHaveLength(1)
  })
})
