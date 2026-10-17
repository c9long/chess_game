/**
 * Adversarial review of add-by-username, player search and public profiles (2026-10-17):
 * can a player learn that someone blocked them, or that someone only takes requests from
 * players they played with? The spec says neither is ever revealed. Each test asserts the
 * private behavior; all four defects found here are fixed.
 */
import { blocks, eloRatings, friendships, userSettings, users } from '@game/db'
import {
  LEADERBOARD_MIN_GAMES,
  type LeaderboardResponse,
  type PlayerSearchResponse,
  PROFILE_VIEWS_PER_MIN,
} from '@game/protocol'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultNamePolicy } from '../auth/name-policy.ts'
import { pairOf } from '../social/friends.ts'
import {
  type Browser,
  FakeBotClient,
  type GameHarness,
  guest,
  registered,
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness

/** Low caps so a prober (or a target) reaches them in a few rows. */
const MAX_OUTGOING = 2
const MAX_FRIENDS = 3

beforeAll(async () => {
  h = await startGameHarness(
    {},
    {
      botClient: new FakeBotClient(),
      social: { maxOutgoing: MAX_OUTGOING, maxFriends: MAX_FRIENDS },
    },
  )
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db
const addByName = (b: Browser, username: string) => b.post('/api/friends/requests', { username })

/** Brings `prober` to the outgoing cap with requests to fresh, ordinary players. */
async function fillOutgoing(prober: Browser) {
  for (let i = 0; i < MAX_OUTGOING; i++) {
    const other = await registered(h)
    const res = await addByName(prober, other.name)
    expect(res.status).toBe(200)
  }
}

describe('side-effect-free oracles through the sender caps', () => {
  // sendRequest used to check the target's block and privacy setting before the sender's own
  // caps, so a sender at the outgoing (or friend) cap got OUTGOING_CAP for an ordinary player
  // but the neutral NOT_ELIGIBLE for one who blocked them, with no request ever created: a
  // free, repeatable "has X blocked me?" probe on any username. Caps now come first.
  it('a sender at the outgoing cap cannot tell a blocker from anyone else', async () => {
    const prober = await registered(h)
    const ordinary = await registered(h)
    const blocker = await registered(h)
    await db().insert(blocks).values({ blockerId: blocker.userId, blockedId: prober.userId })
    await fillOutgoing(prober)

    const a = await addByName(prober, ordinary.name)
    const b = await addByName(prober, blocker.name)
    expect({ status: b.status, error: b.body.error }).toEqual({
      status: a.status,
      error: a.body.error,
    })
  })

  it('a sender at the outgoing cap cannot read the "played with only" setting', async () => {
    const prober = await registered(h)
    const open = await registered(h)
    const closed = await registered(h)
    await db().insert(userSettings).values({ userId: closed.userId, friendRequests: 'played_with' })
    await fillOutgoing(prober)

    const a = await addByName(prober, open.name)
    const b = await addByName(prober, closed.name)
    expect(a.body.error).toBe('OUTGOING_CAP')
    expect({ status: b.status, error: b.body.error }).toEqual({
      status: a.status,
      error: a.body.error,
    })
  })

  /** Gives `user` MAX_FRIENDS accepted friends (rows written directly). */
  async function fillFriends(userId: string) {
    for (let i = 0; i < MAX_FRIENDS; i++) {
      const other = await registered(h)
      const [a, b] = pairOf(userId, other.userId)
      await db().insert(friendships).values({
        userA: a,
        userB: b,
        requestedBy: userId,
        status: 'accepted',
        acceptedAt: new Date(),
      })
    }
  }

  it('a sender at the friend cap cannot tell a blocker or a closed setting from anyone else', async () => {
    const prober = await registered(h)
    const ordinary = await registered(h)
    const blocker = await registered(h)
    const closed = await registered(h)
    await db().insert(blocks).values({ blockerId: blocker.userId, blockedId: prober.userId })
    await db().insert(userSettings).values({ userId: closed.userId, friendRequests: 'played_with' })
    await fillFriends(prober.userId)
    const answers = await Promise.all(
      [ordinary, blocker, closed].map(async (t) => {
        const r = await addByName(prober, t.name)
        return { status: r.status, error: r.body.error }
      }),
    )
    expect(answers).toEqual([
      { status: 409, error: 'FRIEND_CAP' },
      { status: 409, error: 'FRIEND_CAP' },
      { status: 409, error: 'FRIEND_CAP' },
    ])
  })

  it('a target at the friend cap answers the same whether or not they blocked you', async () => {
    const prober = await registered(h)
    const full = await registered(h)
    const fullBlocker = await registered(h)
    await fillFriends(full.userId)
    await fillFriends(fullBlocker.userId)
    await db().insert(blocks).values({ blockerId: fullBlocker.userId, blockedId: prober.userId })
    const a = await addByName(prober, full.name)
    const b = await addByName(prober, fullBlocker.name)
    expect(a.body.error).toBe('TARGET_FRIEND_CAP')
    expect({ status: b.status, error: b.body.error }).toEqual({
      status: a.status,
      error: a.body.error,
    })
  })

  it('still accepts a request they sent you, and still refuses a blocker without a cap', async () => {
    const me = await registered(h)
    const asker = await registered(h)
    const blocker = await registered(h)
    expect((await addByName(asker, me.name)).status).toBe(200)
    const back = await addByName(me, asker.name)
    expect(back.body.relation).toBe('friends')
    await db().insert(blocks).values({ blockerId: blocker.userId, blockedId: me.userId })
    const refused = await addByName(me, blocker.name)
    expect({ status: refused.status, error: refused.body.error }).toEqual({
      status: 403,
      error: 'NOT_ELIGIBLE',
    })
  })
})

describe('search vs profile', () => {
  // The profile of a player who blocked you loads normally (relation "none"), and search used
  // to drop them even for their exact username: present on one and missing from the other
  // meant "they blocked me". Search now lists them like anyone else.
  it('search for a blocker’s exact username behaves like for anyone else', async () => {
    const viewer = await registered(h)
    const ordinary = await registered(h)
    const blocker = await registered(h)
    await db().insert(blocks).values({ blockerId: blocker.userId, blockedId: viewer.userId })

    const profOrdinary = await viewer.get(`/api/players/${ordinary.name}`)
    const profBlocker = await viewer.get(`/api/players/${blocker.name}`)
    expect(profOrdinary.status).toBe(200)
    expect(profBlocker.status).toBe(200) // the profile does not hide the blocker

    const found = async (name: string) => {
      const res = await viewer.get(`/api/players?q=${name}`)
      const body = res.body as unknown as PlayerSearchResponse
      return body.results.some((r) => r.username.toLowerCase() === name.toLowerCase())
    }
    expect(await found(ordinary.name)).toBe(true)
    expect(await found(blocker.name)).toBe(true)
  })
})

describe('route shadowing', () => {
  // Search used to live at GET /players/search, registered before GET /players/:username, and
  // "search" is a valid, unreserved username, so that player's profile could never be opened
  // (Express routes are case-insensitive, so "Search" too). Search is now GET /players?q=.
  it('the name policy accepts "search" as a username', () => {
    expect(defaultNamePolicy.check('search')).toEqual({ ok: true })
  })

  it('a player named "search" has a reachable profile', async () => {
    const owner = await registered(h)
    await db()
      .update(users)
      .set({ username: 'search', displayUsername: 'Search' })
      .where(eq(users.id, owner.userId))
    const viewer = await registered(h)
    for (const path of ['/api/players/Search', '/api/players/search', '/api/players/SEARCH']) {
      const res = await viewer.get(path)
      expect(res.status).toBe(200)
      expect(res.body.username).toBe('Search')
    }
    const g = await guest(h)
    expect((await g.get('/api/players/search')).status).toBe(200)
  })
})

describe('leaderboard links', () => {
  // The leaderboard used to list suspended players (it filtered deleted and guests only), and
  // every name links to /u/:name, which answers "Player not found" for a suspended account:
  // a moderation outcome readable off a dead link. Suspended accounts are now off the board.
  it('every leaderboard name opens a profile', async () => {
    const viewer = await registered(h)
    const banned = await registered(h)
    await db()
      .insert(eloRatings)
      .values({
        userId: banned.userId,
        mode: 'teams',
        timeControl: '3+2',
        rating: 3999,
        games: LEADERBOARD_MIN_GAMES + 5,
        peak: 3999,
      })
    await db().update(users).set({ suspendedAt: new Date() }).where(eq(users.id, banned.userId))
    try {
      const board = await viewer.get('/api/leaderboard?mode=teams&tc=3%2B2')
      const rows = (board.body as unknown as LeaderboardResponse).entries
      expect(rows.some((r) => r.username === banned.name)).toBe(false)
      for (const r of rows.slice(0, 10)) {
        expect((await viewer.get(`/api/players/${r.username}`)).status).toBe(200)
      }
    } finally {
      // Other specs expect this board empty.
      await db().delete(eloRatings).where(eq(eloRatings.userId, banned.userId))
    }
  })
})

describe('cost and enumeration', () => {
  // A query of only `_` has no trigrams, so the LIKE branch could not use the GIN index and
  // scanned every user (about 50x a normal search on 50k users). `a__` and `x_t` are nearly as
  // bad (no trigram, or one most names share). Search now needs 3 letters or digits in a row.
  it('refuses a search without 3 letters or digits in a row', async () => {
    const me = await registered(h)
    for (const q of ['___', '_'.repeat(20), 'a__', '_1_', 'x_t', 'ab_cd_ef']) {
      expect((await me.get(`/api/players?q=${q}`)).status, q).toBe(400)
    }
    for (const q of ['abc', 'a_bcd', '_12x_', 'kni_']) {
      expect((await me.get(`/api/players?q=${q}`)).status, q).toBe(200)
    }
  })

  // Guest sessions cost nothing (5 a minute per IP), so guest profile views count per client
  // IP rather than per guest: fresh guests don't buy fresh allowances.
  it('counts guest profile views per IP, not per guest', async () => {
    const target = await registered(h)
    const statuses: number[] = []
    // Every harness Browser has its own random client IP; these guests share one.
    const sharedIp = '203.0.113.77'
    for (let i = 0; i < 4; i++) {
      const g = await guest(h)
      ;(g as { ip: string }).ip = sharedIp
      for (let j = 0; j < 20; j++)
        statuses.push((await g.get(`/api/players/${target.name}`)).status)
    }
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(PROFILE_VIEWS_PER_MIN)
    expect(statuses).toContain(429)
    // A registered viewer on the same IP keeps their own allowance.
    const viewer = await registered(h)
    ;(viewer as { ip: string }).ip = sharedIp
    expect((await viewer.get(`/api/players/${target.name}`)).status).toBe(200)
    // A guest from another IP is not affected.
    expect((await (await guest(h)).get(`/api/players/${target.name}`)).status).toBe(200)
  })
})
