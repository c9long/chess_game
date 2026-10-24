/**
 * Ranked challenges (TODO "Friends: ranked challenges"): an invite-only lobby that is ranked in
 * every way (registered accounts only, no bots, Elo, three friends to fill the table), and the
 * repeat limit of every ranked lobby (RANKED_REPEAT_MAX rated games together per
 * RANKED_REPEAT_WINDOW_MS, past which the game is played unrated).
 */
import { civilizations, eloRatings, friendships, matches, matchPlayers } from '@game/db'
import {
  type Challenge,
  type ChallengesResponse,
  RANKED_REPEAT_MAX,
  RANKED_REPEAT_WINDOW_MS,
  ROOM_NAMES,
  type SocialMessages,
} from '@game/protocol'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ratedGamesTogether } from '../game/ratings.ts'
import { pairOf } from '../social/friends.ts'
import {
  type Browser,
  createLobby,
  type GameHarness,
  guest,
  joinLobby,
  matchmakeError,
  type Player,
  registered,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness()
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db
const CIVS = ['canada', 'usa', 'china', 'japan']

async function befriend(a: string, b: string) {
  const [lo, hi] = pairOf(a, b)
  await db()
    .insert(friendships)
    .values({ userA: lo, userB: hi, requestedBy: a, status: 'accepted', acceptedAt: new Date() })
}

/** A host and `n` registered friends of theirs. */
async function friends(n: number) {
  const host = await registered(h)
  const others: Browser[] = []
  for (let i = 0; i < n; i++) {
    const f = await registered(h)
    await befriend(host.userId, f.userId)
    others.push(f)
  }
  return { host, others }
}

function rankedChallenge(host: Browser, invitees: Browser[], extra: Record<string, unknown> = {}) {
  return host.post('/api/challenges', {
    friendIds: invitees.map((b) => b.userId),
    mode: 'ffa',
    timeControl: '10+0',
    ranked: true,
    ...extra,
  })
}

/** The four players seated in the challenge lobby, with civs chosen. */
async function seatAll(c: Challenge, browsers: Browser[]): Promise<Player[]> {
  const players: Player[] = []
  for (const b of browsers) players.push(await joinLobby(b, c.roomId))
  return chooseCivs(players)
}

async function chooseCivs(players: Player[]): Promise<Player[]> {
  const host = players[0] as Player
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  players.forEach((p, i) => {
    p.send('setCiv', { civ: CIVS[i] })
  })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
  return players
}

async function start(players: Player[]) {
  const host = players[0] as Player
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
}

/** Everyone but the host resigns: the game ends (FFA), and the host's gameOver comes back. */
async function finish(players: Player[]) {
  const host = players[0] as Player
  for (const p of players.slice(1)) p.send('resign')
  return host.waitMessage('gameOver')
}

async function leaveAll(players: Player[]) {
  for (const p of players) await p.leave()
}

/** A finished rated game of these four players, ended `agoMs` ago. */
async function seedRatedGame(userIds: string[], agoMs = 60_000) {
  const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, 'japan'))
  if (!civ) throw new Error('no civ')
  const endedAt = new Date(Date.now() - agoMs)
  const [m] = await db()
    .insert(matches)
    .values({
      mode: 'ffa',
      timeControl: '10+0',
      rulesVersion: 1,
      status: 'finished',
      rated: true,
      ranked: true,
      startedAt: new Date(endedAt.getTime() - 600_000),
      endedAt,
      endReason: 'last_standing',
    })
    .returning()
  if (!m) throw new Error('fixture failed')
  await db()
    .insert(matchPlayers)
    .values(
      userIds.map((userId, seat) => ({
        matchId: m.id,
        seat,
        userId,
        civId: civ.id,
        civVersion: 1,
        placement: seat + 1,
      })),
    )
  return m.id
}

describe('ranked challenges', () => {
  it('make a ranked invite-only lobby; invitees see it is ranked', async () => {
    const { host, others } = await friends(3)
    const room = await (others[0] as Browser).sdk().joinOrCreate(ROOM_NAMES.social)
    const seen: SocialMessages['challenge'][] = []
    room.onMessage('challenge', (c: SocialMessages['challenge']) => seen.push(c))
    const res = await rankedChallenge(host, others, { mode: 'teams', timeControl: '3+2' })
    expect(res.status).toBe(201)
    const c = (res.body as { challenge: Challenge }).challenge
    expect(c.ranked).toBe(true)
    await waitFor(() => seen.length > 0, 5_000, 'challenge note')
    expect(seen[0]).toMatchObject({ id: c.id, ranked: true })
    const listed = (await (others[1] as Browser).get('/api/challenges'))
      .body as unknown as ChallengesResponse
    expect(listed.incoming[0]).toMatchObject({ id: c.id, ranked: true })

    const hostPlayer = await joinLobby(host, c.roomId)
    expect(hostPlayer.state).toMatchObject({
      ranked: true,
      inviteOnly: true,
      hasPassword: false,
      mode: 'teams',
      timeControl: '3+2',
      unratedRepeat: false,
    })
    // Bots can't take a ranked seat, even the host's.
    const err = await hostPlayer.expectError('addBot', { seat: 1, level: '1200' })
    expect(err.code).toBe('ranked_no_bots')
    // Guests are refused as in any ranked lobby; strangers as in any challenge lobby.
    const g = await guest(h)
    expect(await matchmakeError(g.sdk().joinById(c.roomId, { protocolVersion: 1 }))).toBe(
      'account_required',
    )
    const stranger = await registered(h)
    expect(await matchmakeError(stranger.sdk().joinById(c.roomId, { protocolVersion: 1 }))).toBe(
      'not_invited',
    )
    await hostPlayer.leave()
    await room.leave(true).catch(() => {})
  })

  it('are for registered challengers only, with three friends', async () => {
    const g = await guest(h)
    const asGuest = await g.post('/api/challenges', {
      friendIds: ['someone'],
      mode: 'ffa',
      timeControl: '10+0',
      ranked: true,
    })
    expect(asGuest.status).toBe(403)
    expect(asGuest.body.error).toBe('ACCOUNT_REQUIRED')

    const { host, others } = await friends(2)
    const short = await rankedChallenge(host, others)
    expect(short.status).toBe(400)
    expect(short.body.error).toBe('BAD_REQUEST')
    expect(String(short.body.message)).toMatch(/three friends/)
    // The same two friends are fine for a casual challenge (bots may fill the rest).
    const casual = await host.post('/api/challenges', {
      friendIds: others.map((b) => b.userId),
      mode: 'ffa',
      timeControl: '10+0',
    })
    expect(casual.status).toBe(201)
    expect((casual.body as { challenge: Challenge }).challenge.ranked).toBe(false)
    expect(
      (
        await host.post('/api/challenges', {
          friendIds: ['x'],
          mode: 'ffa',
          timeControl: '10+0',
          ranked: 'yes',
        })
      ).status,
    ).toBe(400)
  })

  it('apply Elo like any ranked lobby', async () => {
    const { host, others } = await friends(3)
    const c = (await rankedChallenge(host, others)).body as { challenge: Challenge }
    const players = await seatAll(c.challenge, [host, ...others])
    await start(players)
    const hp = players[0] as Player
    expect(hp.state.rated).toBe(true)
    expect(hp.state.ranked).toBe(true)
    const matchId = hp.state.matchId
    const over = await finish(players)
    expect(over.rated).toBe(true)
    expect(over.ratings.every((r) => r !== null)).toBe(true)
    const [m] = await db().select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'finished', rated: true, ranked: true })
    const ids = [host, ...others].map((b) => b.userId)
    const elo = await db().select().from(eloRatings).where(inArray(eloRatings.userId, ids))
    expect(elo).toHaveLength(4)
    expect(elo.every((r) => r.mode === 'ffa' && r.timeControl === '10+0' && r.games === 1)).toBe(
      true,
    )
    await leaveAll(players)
  })

  it(`are played unrated after ${RANKED_REPEAT_MAX} rated games together in the window`, async () => {
    const { host, others } = await friends(3)
    const ids = [host, ...others].map((b) => b.userId)
    for (let i = 0; i < RANKED_REPEAT_MAX; i++) await seedRatedGame(ids)
    const c = (await rankedChallenge(host, others)).body as { challenge: Challenge }
    const players = await seatAll(c.challenge, [host, ...others])
    const hp = players[0] as Player
    // The lobby says so before the start.
    await hp.waitState((s) => s.unratedRepeat, 5_000, 'unratedRepeat')
    for (const p of players) await p.waitState((s) => s.unratedRepeat)
    await start(players)
    expect(hp.state.ranked).toBe(true)
    expect(hp.state.rated).toBe(false)
    const matchId = hp.state.matchId
    const over = await finish(players)
    expect(over.rated).toBe(false)
    expect(over.ratings).toEqual([null, null, null, null])
    const [m] = await db().select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'finished', rated: false, ranked: true })
    expect(await db().select().from(eloRatings).where(inArray(eloRatings.userId, ids))).toEqual([])
    await leaveAll(players)
  })

  it('count only rated games of the same four players, inside the window', async () => {
    const { host, others } = await friends(4)
    const four = [host, ...others.slice(0, 3)].map((b) => b.userId)
    // Two recent games, one just outside the window, and one with a different fourth player.
    await seedRatedGame(four)
    await seedRatedGame(four)
    await seedRatedGame(four, RANKED_REPEAT_WINDOW_MS + 60_000)
    await seedRatedGame([...four.slice(0, 3), (others[3] as Browser).userId])
    const since = new Date(Date.now() - RANKED_REPEAT_WINDOW_MS)
    expect(await ratedGamesTogether(db(), four, since)).toBe(2)

    const c = (await rankedChallenge(host, others.slice(0, 3))).body as { challenge: Challenge }
    const players = await seatAll(c.challenge, [host, ...others.slice(0, 3)])
    const hp = players[0] as Player
    await start(players)
    expect(hp.state.unratedRepeat).toBe(false)
    expect(hp.state.rated).toBe(true)
    // This third rated game reaches the limit: the next lobby of the same four says so.
    expect((await finish(players)).rated).toBe(true)
    expect(await ratedGamesTogether(db(), four, since)).toBe(3)
    await leaveAll(players)
  })

  it('share the repeat limit with every ranked lobby, password ones included', async () => {
    const browsers: Browser[] = []
    for (let i = 0; i < 4; i++) browsers.push(await registered(h))
    for (let i = 0; i < RANKED_REPEAT_MAX; i++) {
      await seedRatedGame(browsers.map((b) => b.userId))
    }
    const host = await createLobby(browsers[0] as Browser, {
      name: 'Same four again',
      ranked: true,
      password: 'four',
    })
    const players = [host]
    for (const b of browsers.slice(1)) players.push(await joinLobby(b, host.room.roomId, 'four'))
    await chooseCivs(players)
    await host.waitState((s) => s.unratedRepeat, 5_000, 'unratedRepeat')
    await start(players)
    expect(host.state).toMatchObject({ ranked: true, rated: false, inviteOnly: false })
    expect((await finish(players)).rated).toBe(false)
    await leaveAll(players)
  })

  it('stay ranked when the host invites again into the same lobby', async () => {
    const { host, others } = await friends(3)
    const ttl = h.server.ctx.social.options.challengeTtlMs
    h.server.ctx.social.options.challengeTtlMs = 300
    let hostPlayer: Player | undefined
    try {
      const c = ((await rankedChallenge(host, others)).body as { challenge: Challenge }).challenge
      hostPlayer = await joinLobby(host, c.roomId)
      // Wait for the invitation to expire.
      for (let i = 0; i < 50; i++) {
        const mine = (await host.get('/api/challenges')).body as unknown as ChallengesResponse
        if (mine.outgoing.length === 0) break
        await sleep(100)
      }
      h.server.ctx.social.options.challengeTtlMs = ttl
      const again = await host.post('/api/challenges', {
        friendIds: [(others[0] as Browser).userId],
        mode: 'ffa',
        timeControl: '10+0',
        roomId: c.roomId,
      })
      expect(again.status).toBe(201)
      expect((again.body as { challenge: Challenge }).challenge).toMatchObject({
        roomId: c.roomId,
        ranked: true,
      })
    } finally {
      h.server.ctx.social.options.challengeTtlMs = ttl
      await hostPlayer?.leave()
    }
  })
})
