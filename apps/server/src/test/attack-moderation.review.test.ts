/**
 * Attack review of moderation (blocks, reports, admin queue, suspension, deletion). Each `it`
 * states the behavior the moderation brief asks for; failures are findings.
 */
import { civilizations, matches, matchPlayers, reports, users } from '@game/db'
import { type MatchListResponse, type MatchRelationsResponse, ROOM_NAMES } from '@game/protocol'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Browser,
  FakeBotClient,
  type GameHarness,
  guest,
  registered,
  startGameHarness,
} from './game-harness.ts'
import { TURNSTILE_DUMMY_TOKEN } from './turnstile-stub.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness({}, { botClient: new FakeBotClient() })
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db
const moderation = () => h.server.ctx.moderation

async function seedMatch(seats: (string | null)[]): Promise<string> {
  const [match] = await db()
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 2, status: 'finished' })
    .returning()
  const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, 'japan'))
  if (!match || !civ) throw new Error('fixture failed')
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

async function makeAdmin(): Promise<Browser> {
  const admin = await registered(h)
  ;(moderation().admins as Set<string>).add(admin.userId)
  return admin
}

async function reportOf(reporter: Browser, target: Browser) {
  const matchId = await seedMatch([reporter.userId, target.userId, null, null])
  const res = await reporter.post('/api/reports', {
    matchId,
    seat: 1,
    reason: 'offensive_username',
  })
  expect(res.status).toBe(201)
  const [row] = await db().select().from(reports).where(eq(reports.matchId, matchId))
  if (!row) throw new Error('no report')
  return row.id
}

function sessionToken(b: Browser): string {
  for (const [k, v] of b.cookies) if (k.endsWith('session_token')) return decodeURIComponent(v)
  throw new Error('no session cookie')
}

describe('rename (moderator username reset)', () => {
  it('the renamed player cannot simply choose the same name again', async () => {
    const admin = await makeAdmin()
    const reporter = await registered(h)
    const target = await registered(h)
    const old = target.name
    const id = await reportOf(reporter, target)
    expect(
      (await admin.post(`/api/admin/reports/${id}/resolve`, { action: 'rename' })).status,
    ).toBe(204)
    const again = await target.post('/api/auth/update-user', { username: old })
    expect(again.status).toBe(400)
  })

  it('another account cannot immediately claim the reset name', async () => {
    const admin = await makeAdmin()
    const reporter = await registered(h)
    const target = await registered(h)
    const old = target.name
    const id = await reportOf(reporter, target)
    expect(
      (await admin.post(`/api/admin/reports/${id}/resolve`, { action: 'rename' })).status,
    ).toBe(204)
    const other = await registered(h)
    await db()
      .update(users)
      .set({ username: null, displayUsername: null, name: 'Player-5555' })
      .where(eq(users.id, other.userId))
    const claim = await other.post('/api/auth/update-user', { username: old })
    expect(claim.status).toBe(400)
  })
})

describe('blocking is not revealed to the blocked player', () => {
  it('the blocked player is not offered an "Add friend" that always fails', async () => {
    const a = await registered(h)
    const b = await registered(h)
    const matchId = await seedMatch([a.userId, b.userId, null, null])
    expect((await a.post('/api/blocks', { matchId, seat: 1 })).status).toBe(200)

    // B is shown A as addable ('none') in seat relations and in match history...
    const rel = (await b.get(`/api/friends/match/${matchId}`))
      .body as unknown as MatchRelationsResponse
    const hist = (await b.get('/api/matches')).body as unknown as MatchListResponse
    const opp = hist.matches.find((m) => m.id === matchId)?.opponents.find((o) => o.seat === 0)
    // ...but the request is refused with "you can add players you have finished a game with",
    // a contradiction that only a block produces.
    const req = await b.post('/api/friends/requests', { matchId, seat: 0 })
    expect(req.body).toMatchObject({ error: 'NOT_ELIGIBLE' })
    const offered =
      rel.seats.find((s) => s.seat === 0)?.relation === 'none' || opp?.friend === 'none'
    expect(offered).toBe(false)
  })
})

describe('suspension', () => {
  it('revokes bearer tokens (native clients) immediately', async () => {
    const admin = await makeAdmin()
    const reporter = await registered(h)
    const target = await registered(h)
    const token = sessionToken(target)
    const bearer = () =>
      new Browser(h).request('GET', '/api/friends', undefined, { authorization: `Bearer ${token}` })
    expect((await bearer()).status).toBe(200)
    const id = await reportOf(reporter, target)
    expect(
      (await admin.post(`/api/admin/reports/${id}/resolve`, { action: 'suspend' })).status,
    ).toBe(204)
    expect((await bearer()).status).toBe(401)
    await moderation().unsuspend(target.userId, admin.userId)
  })

  it('a guest is not offered a suspension that a fresh guest session undoes', async () => {
    // Guests can't be durably banned (a new guest session is one click away), so the server
    // refuses the action instead of pretending; the queue offers Dismiss or Warn.
    const admin = await makeAdmin()
    const reporter = await registered(h)
    const g = await guest(h)
    const id = await reportOf(reporter, g)
    const res = await admin.post(`/api/admin/reports/${id}/resolve`, { action: 'suspend' })
    expect(res.status).toBe(400)
    const [row] = await db().select().from(reports).where(eq(reports.id, id))
    expect(row?.status).toBe('open')
  })

  it('a suspended account keeps match history and cannot join a lobby', async () => {
    const admin = await makeAdmin()
    const reporter = await registered(h)
    const target = await registered(h)
    const id = await reportOf(reporter, target)
    expect(
      (await admin.post(`/api/admin/reports/${id}/resolve`, { action: 'suspend' })).status,
    ).toBe(204)
    const create = target.sdk().create(ROOM_NAMES.match, {
      protocolVersion: 1,
      kind: 'lobby',
      mode: 'ffa',
      timeControl: '10+0',
    })
    await expect(create).rejects.toBeTruthy()
    await moderation().unsuspend(target.userId, admin.userId)
  })
})

describe('account deletion completeness', () => {
  it('a deleted admin’s real user id does not stay in reports.resolved_by / users.suspended_by', async () => {
    const admin = await makeAdmin()
    const reporter = await registered(h)
    const target = await registered(h)
    const id = await reportOf(reporter, target)
    expect(
      (await admin.post(`/api/admin/reports/${id}/resolve`, { action: 'suspend' })).status,
    ).toBe(204)
    ;(moderation().admins as Set<string>).delete(admin.userId)
    expect((await admin.request('DELETE', '/api/account', { confirm: 'DELETE' })).status).toBe(200)
    const [r] = await db().select().from(reports).where(eq(reports.id, id))
    const [u] = await db().select().from(users).where(eq(users.id, target.userId))
    expect(r?.resolvedBy).not.toBe(admin.userId)
    expect(u?.suspendedBy).not.toBe(admin.userId)
  })
})

describe('username policy checks the name that is shown', () => {
  it('a lower-case username cannot carry a camel-case displayUsername the filter refuses', async () => {
    // "BigNazi" is refused (camel-case whole word); "bignazi" is not, and the display name
    // only has to match it case-insensitively.
    const suffix = String(Date.now() % 100000)
    const username = `bignazi${suffix}`
    const shown = `BigNazi${suffix}`
    const direct = new Browser(h)
    await direct.onboard()
    const refusedDirect = await direct.post(
      '/api/auth/sign-up/email',
      {
        email: `d${suffix}@example.test`,
        password: 'correct horse battery staple',
        name: shown,
        username: shown,
      },
      { 'x-captcha-response': TURNSTILE_DUMMY_TOKEN },
    )
    expect(refusedDirect.status).toBe(400)

    const b = new Browser(h)
    await b.onboard()
    const res = await b.post(
      '/api/auth/sign-up/email',
      {
        email: `c${suffix}@example.test`,
        password: 'correct horse battery staple',
        name: shown,
        username,
        displayUsername: shown,
      },
      { 'x-captcha-response': TURNSTILE_DUMMY_TOKEN },
    )
    expect(res.status).toBe(400)
  })
})
