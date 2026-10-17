/**
 * Player search, public profiles, add friend by username and the "who can send me friend
 * requests" setting (PLAN §3 "Friends", 2026-10-17): ranking, the minimum length, the result
 * cap, exclusions (self, guests, deleted, suspended, players you blocked), the rate limit,
 * case-insensitive usernames, the setting in both modes with the neutral refusal, profile
 * visibility, and block/report by username.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { blocks, civilizations, eloRatings, matches, matchPlayers, users } from '@game/db'
import {
  type FriendsResponse,
  PLAYER_SEARCHES_PER_MIN,
  type PlayerSearchResponse,
  type PublicProfileResponse,
  type SocialSettingsResponse,
} from '@game/protocol'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS } from '../social/friends.ts'
import { searchPlayers, searchQuery } from '../social/profiles.ts'
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

/** A tag no other test's usernames contain ('k' is not a hex digit). */
const newTag = () => `k${randomBytes(2).toString('hex')}`

/** A registered account row with no session; `extra` sets suspended/deleted fixtures. */
async function fakeUser(
  username: string,
  extra: { suspendedAt?: Date; deletedAt?: Date; createdAt?: Date } = {},
): Promise<string> {
  const id = randomUUID()
  await db()
    .insert(users)
    .values({
      id,
      name: username,
      username: username.toLowerCase(),
      displayUsername: username,
      email: `${username.toLowerCase()}_${id.slice(0, 6)}@example.test`,
      emailVerified: true,
      ...extra,
    })
  return id
}

/** A registered player signed in through Better Auth with the username exactly as typed. */
async function registeredAs(username: string): Promise<Browser> {
  const b = new Browser(h)
  await b.onboard()
  const email = `${username.toLowerCase()}@example.test`
  const res = await b.post(
    '/api/auth/sign-up/email',
    { email, password: 'correct horse battery staple', name: username, username },
    { 'x-captcha-response': TURNSTILE_DUMMY_TOKEN },
  )
  if (res.status !== 200) throw new Error(`sign-up failed: ${JSON.stringify(res.body)}`)
  const mail = h.mailbox
    .list(email)
    .filter((m) => m.kind === 'verify-email')
    .at(-1)
  const token = new URL(mail?.text.match(/https?:\/\/\S+/)?.[0] ?? 'http://x').searchParams.get(
    'token',
  )
  const verify = await b.get(`/api/auth/verify-email?token=${token}`)
  if (verify.status !== 200) throw new Error(`verify failed: ${verify.status}`)
  b.userId = (res.body as { user: { id: string } }).user.id
  b.name = username
  return b
}

async function civId(slug: string) {
  const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, slug))
  if (!civ) throw new Error(`no civ ${slug}`)
  return civ.id
}

/** A match with these seats (null = a bot), every seat playing `civ`. */
async function seedMatch(
  status: 'finished' | 'in_progress' | 'aborted',
  seats: (string | null)[],
  civ = 'japan',
) {
  const [match] = await db()
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, status })
    .returning()
  if (!match) throw new Error('fixture failed')
  const id = await civId(civ)
  await db()
    .insert(matchPlayers)
    .values(
      [0, 1, 2, 3].map((seat) => ({
        matchId: match.id,
        seat,
        userId: seats[seat] ?? null,
        botLevel: seats[seat] ? null : '1200',
        civId: id,
        civVersion: 1,
      })),
    )
  return match.id
}

const search = async (b: Browser, q: string) => {
  const res = await b.get(`/api/players?q=${encodeURIComponent(q)}`)
  return { status: res.status, body: res.body as unknown as PlayerSearchResponse }
}
const names = (r: PlayerSearchResponse) => r.results.map((x) => x.username)
const addByName = (b: Browser, username: string) => b.post('/api/friends/requests', { username })
const NEUTRAL = { error: 'NOT_ELIGIBLE', message: 'We couldn’t send that request.' }

describe('player search', () => {
  it('ranks prefix matches first (shortest first), then by trigram similarity', async () => {
    const me = await registered(h)
    const tag = newTag()
    await fakeUser(`${tag}_alpha`)
    await fakeUser(`${tag}zz`)
    await fakeUser(tag)
    await fakeUser(`zz${tag}`) // contains it
    await fakeUser(`${tag.slice(0, 4)}q`) // resembles it (one letter off)
    await fakeUser('nothing_alike_9')
    const { status, body } = await search(me, tag.toUpperCase())
    expect(status).toBe(200)
    expect(body.query).toBe(tag.toUpperCase())
    expect(names(body).slice(0, 3)).toEqual([tag, `${tag}zz`, `${tag}_alpha`])
    // Non-prefix matches follow, the closer one first.
    expect(names(body).slice(3)).toEqual([`${tag.slice(0, 4)}q`, `zz${tag}`])
    // Nothing beyond what the add and profile routes need: no ids, no emails.
    for (const r of body.results) {
      expect(Object.keys(r).sort()).toEqual(['gamesPlayed', 'rating', 'relation', 'username'])
      expect(r.relation).toBe('none')
    }
    expect(JSON.stringify(body)).not.toContain('@')
  })

  it('treats _ literally (not as a LIKE wildcard)', async () => {
    const me = await registered(h)
    const tag = newTag()
    await fakeUser(`${tag}_x`)
    await fakeUser(`${tag}ax`)
    const { body } = await search(me, `${tag}_`)
    expect(names(body)[0]).toBe(`${tag}_x`)
    expect(body.results.filter((r) => r.username.startsWith(tag)).length).toBeGreaterThan(0)
    // The prefix group holds only the literal match.
    const prefixOnly = await searchPlayers(db(), DEFAULT_LIMITS, me.userId, `${tag}_`, {
      trigram: false,
    })
    expect(prefixOnly.results.map((r) => r.username)).toEqual([`${tag}_x`])
  })

  it('needs 3-20 username characters, a session and a registered account', async () => {
    const me = await registered(h)
    for (const q of ['ab', '', 'a b c', 'abc%', 'x'.repeat(21)]) {
      expect((await search(me, q)).status).toBe(400)
    }
    expect((await me.get('/api/players')).status).toBe(400)
    const anon = new Browser(h)
    expect((await anon.get('/api/players?q=abc')).status).toBe(401)
    const g = await guest(h)
    const asGuest = await g.get('/api/players?q=abc')
    expect(asGuest.status).toBe(403)
    expect(asGuest.body.error).toBe('ACCOUNT_REQUIRED')
  })

  it('returns at most 10 results', async () => {
    const me = await registered(h)
    const tag = newTag()
    for (let i = 0; i < 12; i++) await fakeUser(`${tag}_${String(i).padStart(2, '0')}`)
    const { body } = await search(me, tag)
    expect(body.results).toHaveLength(10)
    expect(names(body)[0]).toBe(`${tag}_00`)
  })

  it('never lists yourself, guests, deleted or suspended accounts, or players you blocked', async () => {
    const tag = newTag()
    const me = await registeredAs(`${tag}_me`)
    const visible = await fakeUser(`${tag}_ok`)
    await fakeUser(`${tag}_susp`, { suspendedAt: new Date() })
    await fakeUser(`${tag}_gone`, { deletedAt: new Date() })
    const iBlocked = await fakeUser(`${tag}_iblk`)
    const blockedMe = await fakeUser(`${tag}_blkme`)
    await db()
      .insert(blocks)
      .values([
        { blockerId: me.userId, blockedId: iBlocked },
        { blockerId: blockedMe, blockedId: me.userId },
      ])
    // A guest's name never matches: guests have no username.
    const g = await guest(h)
    await db()
      .update(users)
      .set({ name: `${tag}_guest` })
      .where(eq(users.id, g.userId))
    const { body } = await search(me, tag)
    // A player who blocked you is listed like anyone else (hiding them would reveal the
    // block, since their profile is public); adding them fails with the neutral refusal.
    // (Only this test's names: other tests' short tags can turn up as fuzzy matches.)
    expect(
      names(body)
        .filter((n) => n.startsWith(tag))
        .sort(),
    ).toEqual([`${tag}_blkme`, `${tag}_ok`])
    expect(body.results.find((r) => r.username === `${tag}_blkme`)).toEqual({
      username: `${tag}_blkme`,
      rating: null,
      gamesPlayed: 0,
      relation: 'none',
    })
    expect(visible).toBeTruthy()
  })

  it('shows your relation, with the user id only once there is a request or friendship', async () => {
    const tag = newTag()
    const me = await registered(h)
    const other = await registeredAs(`${tag}_rel`)
    await fakeUser(`${tag}_none`)
    expect((await addByName(me, `${tag}_rel`)).status).toBe(200)
    const { body } = await search(me, tag)
    const rel = body.results.find((r) => r.username === `${tag}_rel`)
    expect(rel).toMatchObject({ relation: 'outgoing', userId: other.userId })
    const none = body.results.find((r) => r.username === `${tag}_none`)
    expect(none?.relation).toBe('none')
    expect(none && 'userId' in none).toBe(false)
    // Never yourself.
    const theirs = await search(other, `${tag}_r`)
    expect(names(theirs.body)).not.toContain(`${tag}_rel`)
    const back = await search(other, me.name)
    expect(back.body.results[0]).toMatchObject({ relation: 'incoming', userId: me.userId })
  })

  it('shows a small rating (most-played bucket) and finished games', async () => {
    const tag = newTag()
    const me = await registered(h)
    const p = await fakeUser(`${tag}_rated`)
    await db()
      .insert(eloRatings)
      .values([
        { userId: p, mode: 'ffa', timeControl: '10+0', rating: 1310, games: 9, peak: 1320 },
        { userId: p, mode: 'teams', timeControl: '3+2', rating: 1500, games: 2, peak: 1500 },
      ])
    await seedMatch('finished', [p, null, null, null])
    await seedMatch('finished', [p, null, null, null])
    await seedMatch('aborted', [p, null, null, null])
    const { body } = await search(me, `${tag}_rated`)
    expect(body.results[0]).toMatchObject({
      username: `${tag}_rated`,
      rating: { rating: 1310, mode: 'ffa', timeControl: '10+0' },
      gamesPlayed: 2,
    })
  })

  it('falls back to prefix matching without pg_trgm', async () => {
    const me = await registered(h)
    const tag = newTag()
    await fakeUser(`${tag}_b`)
    await fakeUser(`${tag}_a`)
    await fakeUser(`zz${tag}`)
    const out = await searchPlayers(db(), DEFAULT_LIMITS, me.userId, tag, { trigram: false })
    expect(out.results.map((r) => r.username)).toEqual([`${tag}_a`, `${tag}_b`])
  })

  it('rate-limits searches per user', async () => {
    const me = await registered(h)
    for (let i = 0; i < PLAYER_SEARCHES_PER_MIN; i++) {
      expect((await search(me, `zzz${i}`)).status).toBe(200)
    }
    expect((await search(me, 'zzzz')).status).toBe(429)
    // Per user: someone else still can.
    const other = await registered(h)
    expect((await search(other, 'zzzz')).status).toBe(200)
  })

  it('uses the trigram index for the search query', async () => {
    const me = await registered(h)
    const q = searchQuery(db(), me.userId, 'abc', true).toSQL()
    expect(q.sql).toContain('lower("users"."username") like')
    expect(q.sql).toContain('lower("users"."username") %')
    expect(q.sql).toContain('"users"."username" is not null')
  })
})

describe('add friend by username', () => {
  it('works in any case; the other side accepts', async () => {
    const tag = newTag()
    const a = await registered(h)
    const b = await registeredAs(`${tag.toUpperCase()}_Mixed`)
    const res = await addByName(a, `${tag}_MIXED`.toLowerCase())
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      relation: 'outgoing',
      user: { userId: b.userId, username: `${tag.toUpperCase()}_Mixed` },
    })
    const again = await addByName(a, `${tag.toUpperCase()}_MIXED`)
    expect(again.body.error).toBe('ALREADY_REQUESTED')
    expect((await b.post(`/api/friends/requests/${a.userId}/accept`)).status).toBe(200)
    const list = (await a.get('/api/friends')).body as unknown as FriendsResponse
    expect(list.friends.map((f) => f.userId)).toContain(b.userId)
    expect((await addByName(a, `${tag}_mixed`)).body.error).toBe('ALREADY_FRIENDS')
  })

  it('answers one neutral refusal for unknown, guest, deleted, suspended and blocking players', async () => {
    const tag = newTag()
    const a = await registered(h)
    await fakeUser(`${tag}_susp`, { suspendedAt: new Date() })
    await fakeUser(`${tag}_gone`, { deletedAt: new Date() })
    const blocker = await registeredAs(`${tag}_blkr`)
    await db().insert(blocks).values({ blockerId: blocker.userId, blockedId: a.userId })
    const g = await guest(h)
    for (const name of [`${tag}_nobody`, `${tag}_susp`, `${tag}_gone`, `${tag}_blkr`, g.name]) {
      const res = await addByName(a, name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20) || 'x')
      expect(res.status, name).toBe(403)
      expect(res.body, name).toEqual(NEUTRAL)
    }
    // About yourself, or your own block: said plainly (nothing about anyone else).
    expect((await addByName(a, a.name.toUpperCase())).body.error).toBe('SELF')
    const mine = await registeredAs(`${tag}_mine`)
    await db().insert(blocks).values({ blockerId: a.userId, blockedId: mine.userId })
    expect((await addByName(a, `${tag}_mine`)).body.error).toBe('BLOCKED')
    expect((await a.post('/api/friends/requests', { username: 'bad name' })).status).toBe(400)
    expect((await a.post('/api/friends/requests', { userId: mine.userId })).status).toBe(400)
  })

  it('keeps the caps (outgoing requests) for requests by username', async () => {
    const a = await registered(h)
    const tag = newTag()
    for (let i = 0; i < DEFAULT_LIMITS.maxOutgoing; i++) {
      await fakeUser(`${tag}_c${i}`)
      expect((await addByName(a, `${tag}_c${i}`)).status).toBe(200)
    }
    await fakeUser(`${tag}_cx`)
    expect((await addByName(a, `${tag}_cx`)).body.error).toBe('OUTGOING_CAP')
    const { body } = await search(a, `${tag}_cx`)
    expect(body.outgoingFull).toBe(true)
    expect(body.results[0]?.relation).toBe('unavailable')
  })
})

describe('who can send me friend requests', () => {
  it('defaults to anyone; played_with refuses strangers neutrally and allows co-players', async () => {
    const tag = newTag()
    const a = await registered(h)
    const b = await registeredAs(`${tag}_priv`)
    const get = async (x: Browser) =>
      (await x.get('/api/friends/settings')).body as unknown as SocialSettingsResponse
    expect(await get(b)).toEqual({ friendRequests: 'anyone' })

    const set = await b.request('PUT', '/api/friends/settings', { friendRequests: 'played_with' })
    expect(set.status).toBe(200)
    expect(await get(b)).toEqual({ friendRequests: 'played_with' })
    expect(
      (await b.request('PUT', '/api/friends/settings', { friendRequests: 'nobody' })).status,
    ).toBe(400)

    const refused = await addByName(a, `${tag}_priv`)
    expect(refused.status).toBe(403)
    // Exactly what an unknown username gets: the setting isn't revealed.
    expect(refused.body).toEqual(NEUTRAL)
    expect((await addByName(a, `${tag}_unknown`)).body).toEqual(NEUTRAL)
    // Search and the profile still offer "Add friend" (nothing reveals the setting).
    const found = await search(a, `${tag}_priv`)
    expect(found.body.results[0]?.relation).toBe('none')

    // An aborted game doesn't count; a finished one does.
    await seedMatch('aborted', [a.userId, b.userId, null, null])
    expect((await addByName(a, `${tag}_priv`)).body).toEqual(NEUTRAL)
    await seedMatch('finished', [a.userId, null, b.userId, null])
    expect((await addByName(a, `${tag}_priv`)).body).toMatchObject({ relation: 'outgoing' })

    // In the export.
    const exp = await b.get('/api/account/export')
    expect((exp.body as { settings: unknown }).settings).toEqual({ friendRequests: 'played_with' })

    // Back to anyone: strangers can add again.
    await b.request('PUT', '/api/friends/settings', { friendRequests: 'anyone' })
    const c = await registered(h)
    expect((await addByName(c, `${tag}_priv`)).body).toMatchObject({ relation: 'outgoing' })
  })

  it('a request they sent you can still be answered by username (auto-accept)', async () => {
    const tag = newTag()
    const a = await registeredAs(`${tag}_aa`)
    const b = await registeredAs(`${tag}_bb`)
    await b.request('PUT', '/api/friends/settings', { friendRequests: 'played_with' })
    expect((await addByName(b, `${tag}_aa`)).body).toMatchObject({ relation: 'outgoing' })
    expect((await addByName(a, `${tag}_bb`)).body).toMatchObject({ relation: 'friends' })
  })

  it('needs a registered account', async () => {
    const g = await guest(h)
    expect((await g.get('/api/friends/settings')).body.error).toBe('ACCOUNT_REQUIRED')
  })
})

describe('public profiles', () => {
  it('shows public numbers only, in any case, with the relation', async () => {
    const tag = newTag()
    const viewer = await registered(h)
    const p = await fakeUser(`${tag}_Prof`, { createdAt: new Date('2026-03-14T10:00:00Z') })
    await db()
      .insert(eloRatings)
      .values([
        { userId: p, mode: 'ffa', timeControl: '10+0', rating: 1288, games: 7, peak: 1301 },
        { userId: p, mode: 'teams', timeControl: '3+2', rating: 1190, games: 2, peak: 1205 },
        { userId: p, mode: 'ffa', timeControl: '3+2', rating: 1200, games: 0, peak: 1200 },
      ])
    await seedMatch('finished', [p, null, null, null], 'england')
    await seedMatch('finished', [p, null, null, null], 'england')
    await seedMatch('finished', [p, null, null, null], 'mali')
    await seedMatch('aborted', [p, null, null, null], 'mali')
    await seedMatch('aborted', [p, null, null, null], 'mali')
    const res = await viewer.get(`/api/players/${tag.toUpperCase()}_PROF`)
    expect(res.status).toBe(200)
    const body = res.body as unknown as PublicProfileResponse
    expect(body).toEqual({
      username: `${tag}_Prof`,
      memberSince: '2026-03',
      gamesPlayed: 3,
      ratings: [
        {
          mode: 'ffa',
          timeControl: '10+0',
          rating: 1288,
          gamesPlayed: 7,
          peak: 1301,
          provisional: false,
        },
        {
          mode: 'teams',
          timeControl: '3+2',
          rating: 1190,
          gamesPlayed: 2,
          peak: 1205,
          provisional: true,
        },
      ],
      favoriteCiv: { slug: 'england', games: 2 },
      relation: 'none',
      blockedByYou: false,
      capReached: false,
      outgoingFull: false,
    })
    expect(JSON.stringify(body)).not.toContain('@')
  })

  it('answers the same 404 for unknown, guest, deleted and suspended players', async () => {
    const tag = newTag()
    const viewer = await registered(h)
    await fakeUser(`${tag}_susp`, { suspendedAt: new Date() })
    await fakeUser(`${tag}_gone`, { deletedAt: new Date() })
    const g = await guest(h)
    for (const name of [`${tag}_nobody`, `${tag}_susp`, `${tag}_gone`, g.name, 'bad%20name']) {
      const res = await viewer.get(`/api/players/${encodeURIComponent(name)}`)
      expect(res.status, name).toBe(404)
      expect(res.body, name).toEqual({ error: 'NOT_FOUND', message: 'Player not found.' })
    }
  })

  it('needs a session; guests may look (no relation); your own profile says self', async () => {
    const tag = newTag()
    const me = await registeredAs(`${tag}_self`)
    expect((await new Browser(h).get(`/api/players/${tag}_self`)).status).toBe(401)
    const g = await guest(h)
    const asGuest = await g.get(`/api/players/${tag}_self`)
    expect(asGuest.status).toBe(200)
    expect(asGuest.body).toMatchObject({ relation: 'unavailable' })
    const own = await me.get(`/api/players/${tag}_self`)
    expect(own.body).toMatchObject({ relation: 'self', blockedByYou: false })
    expect('userId' in (own.body as object)).toBe(false)
  })

  it('never reveals a block by them; shows yours with the id for Unblock', async () => {
    const tag = newTag()
    const viewer = await registered(h)
    const blocker = await registeredAs(`${tag}_blkr`)
    const blocked = await registeredAs(`${tag}_blkd`)
    await db()
      .insert(blocks)
      .values([
        { blockerId: blocker.userId, blockedId: viewer.userId },
        { blockerId: viewer.userId, blockedId: blocked.userId },
      ])
    const byThem = (await viewer.get(`/api/players/${tag}_blkr`)).body
    expect(byThem).toMatchObject({ relation: 'none', blockedByYou: false })
    expect('userId' in (byThem as object)).toBe(false)
    const mine = (await viewer.get(`/api/players/${tag}_blkd`)).body
    expect(mine).toMatchObject({ blockedByYou: true, userId: blocked.userId })
  })

  it('includes the id once you are friends (for Challenge)', async () => {
    const tag = newTag()
    const a = await registered(h)
    const b = await registeredAs(`${tag}_fr`)
    await addByName(a, `${tag}_fr`)
    await b.post(`/api/friends/requests/${a.userId}/accept`)
    const body = (await a.get(`/api/players/${tag}_fr`)).body
    expect(body).toMatchObject({ relation: 'friends', userId: b.userId })
  })

  it('blocks and reports by username (the profile menu)', async () => {
    const tag = newTag()
    const a = await registered(h)
    const b = await registeredAs(`${tag}_ply`)
    const rep = await a.post('/api/reports', { username: `${tag}_PLY`, reason: 'other' })
    expect(rep.status).toBe(201)
    const blk = await a.post('/api/blocks', { username: `${tag}_ply` })
    expect(blk.status).toBe(200)
    expect(blk.body).toMatchObject({ user: { userId: b.userId } })
    expect((await a.post('/api/blocks', { username: `${tag}_none` })).status).toBe(404)
    expect((await a.post('/api/blocks', { username: a.name })).body.error).toBe('SELF')
    // Gone from search for both.
    expect(names((await search(a, `${tag}_ply`)).body)).toEqual([])
  })
})
