/**
 * Ranked lobbies and Elo (PLAN §5): registered accounts only, no bots, rated only when
 * ranked; Elo per mode x time control (wins, ties, seeded K factors); the public
 * leaderboard; and /api/ratings/me.
 */
import { matchMaker } from '@colyseus/core'
import { eloRatings, matches, matchPlayers, ratings } from '@game/db'
import type { LeaderboardResponse, RatingsResponse } from '@game/protocol'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Browser,
  createLobby,
  createSolo,
  type GameHarness,
  guest,
  joinLobby,
  matchmakeError,
  type Player,
  registered,
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness({ RECONNECT_GRACE_SECONDS: '5' })
})

afterAll(async () => {
  await h.close()
})

const CIVS = ['canada', 'usa', 'china', 'japan']

/** Four people seated (host at South, joiners West, North, East), ready, game started. */
async function startGame(
  browsers: Browser[],
  opts: { mode?: 'ffa' | 'teams'; timeControl?: '10+0' | '3+2'; ranked?: boolean } = {},
): Promise<Player[]> {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, {
    name: 'Ladder game',
    mode: opts.mode ?? 'ffa',
    timeControl: opts.timeControl ?? '10+0',
    ranked: opts.ranked ?? true,
  })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  players.forEach((p, i) => {
    p.send('setCiv', { civ: CIVS[i] })
  })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

function at(players: Player[], seat: number): Player {
  const p = players.find((x) => x.seat === seat)
  if (!p) throw new Error(`no player at seat ${seat}`)
  return p
}

async function leaveAll(players: Player[]) {
  for (const p of players) await p.leave()
}

async function eloOf(userId: string) {
  return h.server.ctx.db
    .select()
    .from(eloRatings)
    .where(eq(eloRatings.userId, userId))
    .orderBy(asc(eloRatings.mode), asc(eloRatings.timeControl))
}

async function seatsOf(matchId: string) {
  return h.server.ctx.db
    .select()
    .from(matchPlayers)
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(asc(matchPlayers.seat))
}

const four = () => Promise.all([registered(h), registered(h), registered(h), registered(h)])

describe('ranked lobbies', () => {
  it('refuse guests: creating and joining answer account_required', async () => {
    const g = await guest(h)
    expect(await matchmakeError(createLobby(g, { name: 'Guest ladder', ranked: true }))).toBe(
      'account_required',
    )
    const host = await createLobby(await registered(h), { name: 'Members only', ranked: true })
    expect(host.state.ranked).toBe(true)
    expect(await matchmakeError(joinLobby(g, host.room.roomId))).toBe('account_required')
    // A registered player gets in.
    const member = await joinLobby(await registered(h), host.room.roomId)
    await host.waitState((s) => s.seats.filter((x) => x.occupied).length === 2)
    // A guest can still create a casual lobby.
    const casual = await createLobby(await guest(h), { name: 'Casual table' })
    expect(casual.state.ranked).toBe(false)
    await leaveAll([member, host, casual])
  })

  it('refuse bots (ranked_no_bots) and are listed with ranked: true', async () => {
    const host = await createLobby(await registered(h), { name: 'No bots here', ranked: true })
    const err = await host.expectError('addBot', { seat: 1, level: '1200' })
    expect(err.code).toBe('ranked_no_bots')
    expect(host.state.seats[1]?.occupied).toBe(false)
    const listed = await matchMaker.query({ name: 'match', roomId: host.room.roomId })
    expect(listed[0]?.metadata).toMatchObject({ name: 'No bots here', ranked: true })
    await host.leave()
  })

  it('are not available for solo games', async () => {
    const b = await registered(h)
    expect(await matchmakeError(createSolo(b, { ranked: true } as never))).toBe('invalid_options')
  })
})

describe('Elo', () => {
  it('a casual game is never rated, even with four registered players', async () => {
    const browsers = await four()
    const players = await startGame(browsers, { ranked: false })
    const host = at(players, 0)
    expect(host.state.ranked).toBe(false)
    expect(host.state.rated).toBe(false)
    const matchId = host.state.matchId
    for (const seat of [1, 2, 3]) at(players, seat).send('resign')
    const over = await host.waitMessage('gameOver')
    expect(over.rated).toBe(false)
    expect(over.ratings).toEqual([null, null, null, null])
    const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'finished', rated: false, ranked: false })
    expect((await seatsOf(matchId)).every((p) => p.ratingBefore === null)).toBe(true)
    const ids = browsers.map((b) => b.userId)
    const db = h.server.ctx.db
    expect(await db.select().from(eloRatings).where(inArray(eloRatings.userId, ids))).toEqual([])
    // No OpenSkill rows either (the public OpenSkill pool is retired).
    expect(await db.select().from(ratings).where(inArray(ratings.userId, ids))).toEqual([])
    await leaveAll(players)
  })

  it('a ranked Teams game applies Elo with each player’s own K, per mode x time control', async () => {
    const browsers = await four()
    const db = h.server.ctx.db
    // Seeded Teams 3+2 ratings: [rating, games, peak] per seat (seat = browser index).
    const seeds: [number, number, number][] = [
      [1300, 40, 1300],
      [1700, 40, 1750],
      [1100, 10, 1100],
      [1900, 40, 2450],
    ]
    await db.insert(eloRatings).values(
      browsers.map((b, i) => {
        const [rating, games, peak] = seeds[i] as [number, number, number]
        return { userId: b.userId, mode: 'teams' as const, timeControl: '3+2', rating, games, peak }
      }),
    )
    // Another bucket that must not move.
    await db.insert(eloRatings).values({
      userId: (browsers[0] as Browser).userId,
      mode: 'ffa',
      timeControl: '3+2',
      rating: 1444,
      games: 7,
      peak: 1450,
    })
    const players = await startGame(browsers, { mode: 'teams', timeControl: '3+2' })
    expect(players.map((p) => p.seat)).toEqual([0, 1, 2, 3])
    const host = at(players, 0)
    expect(host.state.rated).toBe(true)
    const matchId = host.state.matchId
    // West and East resign: South+North (team mean 1200) beat West+East (mean 1800).
    at(players, 1).send('resign')
    await host.waitState((s) => s.seats[1]?.status === 'frozen' || s.phase === 'finished')
    at(players, 3).send('resign')
    const over = await host.waitMessage('gameOver')
    expect(over.result.type).toBe('teams_winner')
    expect(over.rated).toBe(true)
    // Golden values (elo.test.ts): +19, -19, +39 (K 40), -10 (K 10: peak 2450).
    expect(over.ratings).toEqual([
      { before: 1300, after: 1319 },
      { before: 1700, after: 1681 },
      { before: 1100, after: 1139 },
      { before: 1900, after: 1890 },
    ])
    const mp = await seatsOf(matchId)
    expect(mp.map((p) => [p.ratingBefore, p.ratingAfter])).toEqual([
      [1300, 1319],
      [1700, 1681],
      [1100, 1139],
      [1900, 1890],
    ])
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({
      status: 'finished',
      rated: true,
      ranked: true,
      mode: 'teams',
      timeControl: '3+2',
    })
    const south = await eloOf((browsers[0] as Browser).userId)
    expect(south.map((r) => [r.mode, r.timeControl, r.rating, r.games, r.peak])).toEqual([
      ['ffa', '3+2', 1444, 7, 1450],
      ['teams', '3+2', 1319, 41, 1319],
    ])
    const east = await eloOf((browsers[3] as Browser).userId)
    expect(east[0]).toMatchObject({ rating: 1890, games: 41, peak: 2450 })

    // /api/ratings/me returns Elo (rating, games, peak) per bucket.
    const me = (await (browsers[0] as Browser).get('/api/ratings/me'))
      .body as unknown as RatingsResponse
    expect(me.ratings).toEqual(
      expect.arrayContaining([
        { mode: 'ffa', timeControl: '3+2', rating: 1444, gamesPlayed: 7, peak: 1450 },
        { mode: 'teams', timeControl: '3+2', rating: 1319, gamesPlayed: 41, peak: 1319 },
      ]),
    )
    expect(me.ratings).toHaveLength(2)
    // History shows the Elo change.
    const list = (await (browsers[2] as Browser).get('/api/matches')).body as unknown as {
      matches: { id: string; rated: boolean; ranked: boolean; ratingDelta: number | null }[]
    }
    expect(list.matches.find((x) => x.id === matchId)).toMatchObject({
      rated: true,
      ranked: true,
      ratingDelta: 39,
    })
    await leaveAll(players)
  })

  it('an aborted ranked game stays ranked (but unrated) in history', async () => {
    const browsers = await four()
    const players = await startGame(browsers, { ranked: true })
    const host = at(players, 0)
    const matchId = host.state.matchId
    // As a new process does on startup for a game it finds in progress.
    await h.server.ctx.db
      .update(matches)
      .set({ status: 'aborted', rated: false, endedAt: new Date(), endReason: 'server_restart' })
      .where(eq(matches.id, matchId))
    for (const seat of [1, 2, 3]) at(players, seat).send('resign')
    const over = await host.waitMessage('gameOver')
    expect(over.rated).toBe(false)
    const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'aborted', rated: false, ranked: true })
    const list = (await (browsers[0] as Browser).get('/api/matches')).body as unknown as {
      matches: { id: string; rated: boolean; ranked: boolean; ratingDelta: number | null }[]
    }
    expect(list.matches.find((x) => x.id === matchId)).toMatchObject({
      rated: false,
      ranked: true,
      ratingDelta: null,
    })
    await leaveAll(players)
  })

  it('a ranked FFA ending in an agreed draw rates the survivors as tied', async () => {
    const browsers = await four()
    const players = await startGame(browsers, { mode: 'ffa', timeControl: '10+0' })
    const host = at(players, 0)
    // East resigns (4th); the other three agree a draw and share 1st.
    at(players, 3).send('resign')
    await host.waitState((s) => s.seats[3]?.status === 'removed', 5_000, 'east removed')
    at(players, 0).send('offerDraw')
    await host.waitState((s) => s.drawOfferSeat === 0)
    at(players, 1).send('respondDraw', { accept: true })
    at(players, 2).send('respondDraw', { accept: true })
    const over = await host.waitMessage('gameOver')
    expect(over.endReason).toBe('agreed_draw')
    expect(over.placements).toEqual([1, 1, 1, 4])
    expect(over.rated).toBe(true)
    // Fresh players (K 40): each survivor +40/3 x 0.5 = +6.67 -> +7; East 3 x -0.5 x 40/3 = -20.
    expect(over.ratings).toEqual([
      { before: 1200, after: 1207 },
      { before: 1200, after: 1207 },
      { before: 1200, after: 1207 },
      { before: 1200, after: 1180 },
    ])
    const rows = await eloOf((browsers[3] as Browser).userId)
    expect(rows).toEqual([
      expect.objectContaining({ mode: 'ffa', timeControl: '10+0', rating: 1180, peak: 1200 }),
    ])
    const winner = await eloOf((browsers[1] as Browser).userId)
    expect(winner[0]).toMatchObject({ rating: 1207, games: 1, peak: 1207 })
    await leaveAll(players)
  })
})

describe('leaderboard', () => {
  async function board(query: string) {
    const res = await fetch(`${h.url}/api/leaderboard${query}`)
    return { status: res.status, body: (await res.json()) as LeaderboardResponse }
  }

  it('lists registered players with 5+ ranked games, best first, without a session', async () => {
    const db = h.server.ctx.db
    const [a, b, c, d, few] = await Promise.all([
      registered(h),
      registered(h),
      registered(h),
      registered(h),
      registered(h),
    ])
    const g = await guest(h)
    const doomed = await registered(h)
    const row = (u: Browser, rating: number, games: number) => ({
      userId: u.userId,
      mode: 'teams' as const,
      timeControl: '10+0',
      rating,
      games,
      peak: rating + 5,
    })
    await db
      .insert(eloRatings)
      .values([
        row(a, 5000, 9),
        row(b, 4000, 12),
        row(c, 4000, 5),
        row(d, 3000, 30),
        row(few, 6000, 4),
        row(g, 7000, 50),
        row(doomed, 8000, 50),
      ])
    // A deleted account's rows are re-keyed to a placeholder and never listed.
    expect((await doomed.request('DELETE', '/api/account', { confirm: 'DELETE' })).status).toBe(200)

    // '+' must be encoded; an unencoded one (a space) is accepted too.
    for (const tc of ['10%2B0', '10+0']) {
      const { status, body } = await board(`?mode=teams&tc=${tc}`)
      expect(status).toBe(200)
      expect(body.mode).toBe('teams')
      expect(body.timeControl).toBe('10+0')
      expect(body.minGames).toBe(5)
      expect(body.entries.slice(0, 4)).toEqual([
        { rank: 1, username: a.name, rating: 5000, gamesPlayed: 9, peak: 5005 },
        { rank: 2, username: b.name, rating: 4000, gamesPlayed: 12, peak: 4005 },
        { rank: 2, username: c.name, rating: 4000, gamesPlayed: 5, peak: 4005 },
        { rank: 4, username: d.name, rating: 3000, gamesPlayed: 30, peak: 3005 },
      ])
      const names = body.entries.map((e) => e.username)
      expect(names).not.toContain(few.name)
      expect(names).not.toContain(g.name)
      expect(names).not.toContain(doomed.name)
      expect(names.some((n) => n.startsWith('Deleted player'))).toBe(false)
      expect(body.entries.every((e) => e.rating < 6000)).toBe(true)
      // Usernames only: no ids or emails.
      expect(JSON.stringify(body)).not.toMatch(/@example\.test|"userId"|"id"/)
    }
    const placeholder = await db
      .select()
      .from(eloRatings)
      .where(and(eq(eloRatings.rating, 8000), eq(eloRatings.mode, 'teams')))
    expect(placeholder).toHaveLength(1)
    expect(placeholder[0]?.userId).not.toBe(doomed.userId)

    expect((await board('?mode=teams&tc=10%2B0&limit=1')).body.entries).toHaveLength(1)
    // Other buckets are separate.
    const ffa = (await board('?mode=ffa&tc=3%2B2')).body
    expect(ffa.entries.map((e) => e.username)).not.toContain(a.name)
  })

  it('rejects bad parameters', async () => {
    expect((await board('?mode=duel')).status).toBe(400)
    expect((await board('?tc=1%2B0')).status).toBe(400)
    expect((await board('?tc=untimed')).status).toBe(400)
    expect((await board('?limit=0')).status).toBe(400)
    expect((await board('?limit=101')).status).toBe(400)
    // Defaults: FFA 10+0.
    const def = await board('')
    expect(def.status).toBe(200)
    expect(def.body).toMatchObject({ mode: 'ffa', timeControl: '10+0', minGames: 5 })
  })
})
