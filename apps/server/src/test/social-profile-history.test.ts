/**
 * Opt-in public match history (TODO "Profiles: opt-in public match history"): the "show my
 * recent games on my profile" setting (off by default, partial updates, in the export), the
 * recent games on the profile (last PROFILE_RECENT_GAMES finished games of the owner only, by
 * end, the day only; neutral names for guests, deleted players and bots, links for registered
 * players, suspended ones alike), the replay id only for games the viewer played in, and no
 * history for guest viewers or across a block either way.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { blocks, civilizations, matches, matchPlayers, users } from '@game/db'
import {
  PROFILE_RECENT_GAMES,
  type PublicProfileResponse,
  type SocialSettingsResponse,
} from '@game/protocol'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Browser,
  FakeBotClient,
  type GameHarness,
  guest,
  registered,
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness({}, { botClient: new FakeBotClient() })
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db

/** A tag no other test's usernames contain ('h' is not a hex digit). */
const newTag = () => `h${randomBytes(2).toString('hex')}`

/** An account row with no session: registered unless `extra` makes it a guest or deleted. */
async function fakeUser(
  username: string,
  extra: { suspendedAt?: Date; deletedAt?: Date; isAnonymous?: boolean } = {},
): Promise<string> {
  const id = randomUUID()
  await db()
    .insert(users)
    .values({
      id,
      name: username,
      username: extra.isAnonymous || extra.deletedAt ? null : username.toLowerCase(),
      displayUsername: extra.isAnonymous ? null : username,
      email: `${username.toLowerCase()}_${id.slice(0, 6)}@example.test`,
      emailVerified: true,
      ...extra,
    })
  return id
}

const civIds = new Map<string, number>()
async function civId(slug: string) {
  const known = civIds.get(slug)
  if (known) return known
  const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, slug))
  if (!civ) throw new Error(`no civ ${slug}`)
  civIds.set(slug, civ.id)
  return civ.id
}

const CIVS = ['japan', 'england', 'mali', 'japan']

/**
 * A game with these seats (null = a bot at level '1200'), placements 1-4 by seat unless
 * given, and Elo before/after for every human seat when `elo` is set.
 */
async function seedGame(
  seats: (string | null)[],
  opts: {
    status?: 'finished' | 'in_progress' | 'aborted'
    mode?: 'ffa' | 'teams'
    ranked?: boolean
    rated?: boolean
    startedAt?: Date
    endReason?: string
    elo?: { before: number; after: number }
    botLevel?: string
    /** How long the game ran (default 10 minutes). */
    durationMs?: number
  } = {},
) {
  const status = opts.status ?? 'finished'
  const startedAt = opts.startedAt ?? new Date()
  const [match] = await db()
    .insert(matches)
    .values({
      mode: opts.mode ?? 'ffa',
      timeControl: '10+0',
      rulesVersion: 1,
      status,
      ranked: opts.ranked ?? false,
      rated: opts.rated ?? false,
      startedAt,
      endedAt:
        status === 'finished' ? new Date(startedAt.getTime() + (opts.durationMs ?? 600_000)) : null,
      endReason: status === 'finished' ? (opts.endReason ?? 'checkmate') : null,
    })
    .returning()
  if (!match) throw new Error('fixture failed')
  const rows = []
  for (const seat of [0, 1, 2, 3]) {
    const userId = seats[seat] ?? null
    rows.push({
      matchId: match.id,
      seat,
      team: opts.mode === 'teams' ? seat % 2 : null,
      userId,
      botLevel: userId ? null : (opts.botLevel ?? '1200'),
      civId: await civId(CIVS[seat] ?? 'japan'),
      civVersion: 1,
      placement: status === 'finished' ? seat + 1 : null,
      ratingBefore: userId && opts.elo ? opts.elo.before : null,
      ratingAfter: userId && opts.elo ? opts.elo.after : null,
    })
  }
  await db().insert(matchPlayers).values(rows)
  return match.id
}

const putSettings = (b: Browser, body: object) => b.request('PUT', '/api/friends/settings', body)
const settingsOf = async (b: Browser) =>
  (await b.get('/api/friends/settings')).body as unknown as SocialSettingsResponse
const profile = async (b: Browser, username: string) => {
  const res = await b.get(`/api/players/${encodeURIComponent(username)}`)
  expect(res.status).toBe(200)
  return res.body as unknown as PublicProfileResponse
}

describe('show my recent games on my profile (setting)', () => {
  it('is off by default; a PUT changes only what it names; in the export', async () => {
    const b = await registered(h)
    expect(await settingsOf(b)).toEqual({ friendRequests: 'anyone', publicHistory: false })

    const on = await putSettings(b, { publicHistory: true })
    expect(on.status).toBe(200)
    expect(on.body).toEqual({ friendRequests: 'anyone', publicHistory: true })
    // Changing the other setting keeps this one (and the reverse).
    await putSettings(b, { friendRequests: 'played_with' })
    expect(await settingsOf(b)).toEqual({ friendRequests: 'played_with', publicHistory: true })
    await putSettings(b, { publicHistory: false })
    expect(await settingsOf(b)).toEqual({ friendRequests: 'played_with', publicHistory: false })

    expect((await putSettings(b, {})).status).toBe(400)
    expect((await putSettings(b, { publicHistory: 'yes' })).status).toBe(400)
    expect((await putSettings(b, { publicHistory: true, extra: 1 })).status).toBe(400)

    await putSettings(b, { publicHistory: true })
    const exp = await b.get('/api/account/export')
    expect((exp.body as { settings: unknown }).settings).toEqual({
      friendRequests: 'played_with',
      publicHistory: true,
    })
  })

  it('needs a registered account', async () => {
    const g = await guest(h)
    expect((await putSettings(g, { publicHistory: true })).body.error).toBe('ACCOUNT_REQUIRED')
  })
})

describe('recent games on the public profile', () => {
  it('stay private until the owner opts in, and hide again at once when they opt out', async () => {
    const owner = await registered(h)
    const viewer = await registered(h)
    await seedGame([owner.userId, null, null, null])
    expect((await profile(viewer, owner.name)).recentGames).toBeNull()
    expect((await profile(owner, owner.name)).recentGames).toBeNull()

    await putSettings(owner, { publicHistory: true })
    expect((await profile(viewer, owner.name)).recentGames).toHaveLength(1)
    expect((await profile(owner, owner.name)).recentGames).toHaveLength(1)

    await putSettings(owner, { publicHistory: false })
    expect((await profile(viewer, owner.name)).recentGames).toBeNull()
  })

  it('lists the last 10 finished games of the owner only, newest first, by day', async () => {
    const owner = await registered(h)
    const stranger = await registered(h)
    const viewer = await registered(h)
    await putSettings(owner, { publicHistory: true })
    const base = Date.now() - 3_600_000
    const ids: string[] = []
    for (let i = 0; i < PROFILE_RECENT_GAMES + 2; i++) {
      ids.push(await seedGame([owner.userId, null, null, null], { startedAt: new Date(base + i) }))
    }
    // Never shown: running and cancelled games, and games the owner didn't sit in.
    await seedGame([owner.userId, null, null, null], { status: 'in_progress' })
    await seedGame([owner.userId, null, null, null], { status: 'aborted' })
    const notTheirs = await seedGame([stranger.userId, viewer.userId, null, null])

    const games = (await profile(viewer, owner.name)).recentGames ?? []
    expect(games).toHaveLength(PROFILE_RECENT_GAMES)
    // Only the UTC day the game ended, never the time.
    expect(games[0]?.playedOn).toBe(
      new Date(base + ids.length - 1 + 600_000).toISOString().slice(0, 10),
    )
    expect(games.every((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.playedOn))).toBe(true)
    // The owner sees the ids: the newest 10, newest first.
    const own = (await profile(owner, owner.name)).recentGames ?? []
    expect(own.map((g) => g.id)).toEqual(ids.slice(2).reverse())
    // The viewer played in none of them: no ids at all (and nothing of the other game).
    expect(games.every((g) => g.id === undefined)).toBe(true)
    expect(JSON.stringify(games)).not.toContain(notTheirs)
    expect(JSON.stringify(games)).not.toContain(stranger.name)
  })

  it('orders by when each game ended, not when it started', async () => {
    const owner = await registered(h)
    await putSettings(owner, { publicHistory: true })
    const t = Date.now() - 3 * 3_600_000
    // A long game that started first but ended last, and a short one in between.
    const long = await seedGame([owner.userId, null, null, null], {
      startedAt: new Date(t),
      durationMs: 2 * 3_600_000,
    })
    const short = await seedGame([owner.userId, null, null, null], {
      startedAt: new Date(t + 600_000),
    })
    const own = (await profile(owner, owner.name)).recentGames ?? []
    expect(own.map((g) => g.id)).toEqual([long, short])
  })

  it('names guests, deleted players and bots neutrally; links registered players', async () => {
    const tag = newTag()
    const owner = await registered(h)
    const viewer = await registered(h)
    await putSettings(owner, { publicHistory: true })
    const friend = await fakeUser(`${tag}_Live`)
    const susp = await fakeUser(`${tag}_susp`, { suspendedAt: new Date() })
    const gst = await fakeUser(`${tag}_GuestName`, { isAnonymous: true })
    const gone = await fakeUser(`Deleted player #123456`, { deletedAt: new Date() })
    await seedGame([owner.userId, friend, gst, null], { botLevel: 'max' })
    await seedGame([owner.userId, susp, gone, null])

    const [second, first] = (await profile(viewer, owner.name)).recentGames ?? []
    expect(first?.others).toEqual([
      {
        seat: 1,
        team: null,
        kind: 'player',
        name: `${tag}_Live`,
        username: `${tag}_Live`,
        civ: 'england',
        placement: 2,
      },
      { seat: 2, team: null, kind: 'guest', name: 'Guest', civ: 'mali', placement: 3 },
      { seat: 3, team: null, kind: 'bot', name: 'Bot Max', civ: 'japan', placement: 4 },
    ])
    expect(second?.others.map((o) => [o.kind, o.name, o.username])).toEqual([
      // Suspended: exactly like a live player, so the list doesn't reveal the suspension.
      ['player', `${tag}_susp`, `${tag}_susp`],
      ['deleted', 'Deleted player', undefined],
      ['bot', 'Bot 1200', undefined],
    ])
    const shape = (o: object) => Object.keys(o).sort()
    expect(shape(second?.others[0] ?? {})).toEqual(shape(first?.others[0] ?? {}))
    const text = JSON.stringify([first, second])
    expect(text).not.toContain('GuestName')
    expect(text).not.toContain('#123456')
    expect(text).not.toContain('@')
    expect(text).not.toContain(friend)
  })

  it('shows mode, placement, civs and the Elo change of rated ranked games only', async () => {
    const owner = await registered(h)
    const viewer = await registered(h)
    await putSettings(owner, { publicHistory: true })
    const t = Date.now() - 60_000
    await seedGame([null, owner.userId, null, null], {
      mode: 'teams',
      ranked: true,
      rated: true,
      elo: { before: 1200, after: 1214 },
      startedAt: new Date(t),
    })
    // Ranked but not rated (Elo couldn't be applied): no change shown.
    await seedGame([owner.userId, null, null, null], {
      ranked: true,
      rated: false,
      elo: { before: 1200, after: 1190 },
      startedAt: new Date(t + 1),
      endReason: 'agreed_draw',
    })
    const [unrated, teams] = (await profile(viewer, owner.name)).recentGames ?? []
    expect(teams).toMatchObject({
      mode: 'teams',
      timeControl: '10+0',
      ranked: true,
      rated: true,
      rulesVersion: 1,
      seat: 1,
      team: 1,
      civ: 'england',
      placement: 2,
      ratingDelta: 14,
      endReason: 'checkmate',
    })
    expect(teams?.others.map((o) => o.team)).toEqual([0, 0, 1])
    expect(unrated).toMatchObject({
      ranked: true,
      rated: false,
      ratingDelta: null,
      endReason: 'agreed_draw',
    })
  })

  it('gives the game id only for games the viewer played in (replays stay private)', async () => {
    const owner = await registered(h)
    const viewer = await registered(h)
    await putSettings(owner, { publicHistory: true })
    const t = Date.now() - 60_000
    const shared = await seedGame([owner.userId, viewer.userId, null, null], {
      startedAt: new Date(t + 1),
    })
    await seedGame([owner.userId, null, null, null], { startedAt: new Date(t) })
    const games = (await profile(viewer, owner.name)).recentGames ?? []
    expect(games.map((g) => g.id)).toEqual([shared, undefined])
    // The owner gets every id on their own profile.
    const own = (await profile(owner, owner.name)).recentGames ?? []
    expect(own.every((g) => typeof g.id === 'string')).toBe(true)
    // Replays didn't widen: a non-participant still gets 404.
    const other = await registered(h)
    const unshared = own[1]?.id ?? ''
    expect((await other.get(`/api/matches/${unshared}/replay`)).status).toBe(404)
    expect((await other.get(`/api/matches/${unshared}`)).status).toBe(404)
  })

  it('shows nothing across a block either way, nor to guests', async () => {
    const owner = await registered(h)
    const blockedByOwner = await registered(h)
    const blocker = await registered(h)
    await putSettings(owner, { publicHistory: true })
    await seedGame([owner.userId, blockedByOwner.userId, blocker.userId, null])
    await db()
      .insert(blocks)
      .values([
        { blockerId: owner.userId, blockedId: blockedByOwner.userId },
        { blockerId: blocker.userId, blockedId: owner.userId },
      ])
    expect((await profile(blockedByOwner, owner.name)).recentGames).toBeNull()
    expect((await profile(blocker, owner.name)).recentGames).toBeNull()
    // Every other registered player still sees it, the owner included.
    expect((await profile(owner, owner.name)).recentGames).toHaveLength(1)
    expect((await profile(await registered(h), owner.name)).recentGames).toHaveLength(1)
    // Guests see the profile but not the list: a guest session would get around the block.
    const g = await guest(h)
    expect((await profile(g, owner.name)).recentGames).toBeNull()
  })

  it('never exists for guests or deleted accounts (no profile at all)', async () => {
    const viewer = await registered(h)
    const g = await guest(h)
    await putSettings(g, { publicHistory: true })
    expect((await viewer.get(`/api/players/${encodeURIComponent(g.name)}`)).status).toBe(404)
  })
})
