import { matchMaker } from '@colyseus/core'
import { matchEvents, matches, matchPlayers, ratings } from '@game/db'
import type { MatchDetailResponse, MatchListResponse, RatingsResponse } from '@game/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { abortOrphanedMatches, resimulate } from '../game/persistence.ts'
import {
  type Browser,
  createLobby,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  type Player,
  playOut,
  registered,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({ RECONNECT_GRACE_SECONDS: '5' }, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

/** Seats everyone, picks civs, readies up and starts. */
async function startGame(
  browsers: Browser[],
  opts: { mode?: 'ffa' | 'teams'; bots?: { seat: 0 | 1 | 2 | 3; level: string }[] } = {},
): Promise<Player[]> {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, { name: 'Game', mode: opts.mode ?? 'ffa' })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  for (const bot of opts.bots ?? []) host.send('addBot', bot)
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  const civs = ['canada', 'usa', 'china', 'japan', 'germany', 'russia', 'england', 'france', 'mali']
  players.forEach((p, i) => {
    p.send('setCiv', { civ: civs[i] })
  })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

describe('a rated FFA game between four registered players', () => {
  let players: Player[]
  let browsers: Browser[]
  let matchId: string

  it('plays a full scripted game to a winner', async () => {
    browsers = await Promise.all([registered(h), registered(h), registered(h), registered(h)])
    players = await startGame(browsers)
    const host = players[0] as Player
    matchId = host.state.matchId
    expect(host.state.rated).toBe(true)

    // Illegal moves and moves out of turn are refused without changing anything.
    const notToMove = players.find((p) => p.seat !== host.state.seatToMove) as Player
    expect((await notToMove.expectError('move', { move: 'c2c4' })).code).toBe('not_your_turn')
    const toMove = players.find((p) => p.seat === host.state.seatToMove) as Player
    expect((await toMove.expectError('move', { move: 'c2c9' })).code).toBe('illegal_move')
    expect(host.state.actionSeq).toBe(0)

    const over = await playOut(players)
    expect(over.result.type).toBe('ffa_winner')
    expect(over.rated).toBe(true)
    expect(over.endReason).toBe('last_standing')
    expect([...over.placements].sort()).toEqual([1, 2, 3, 4])
    expect(over.ratings.every((r) => r !== null)).toBe(true)
    const winner = over.placements.indexOf(1)
    expect(over.ratings[winner]?.after).toBeGreaterThan(over.ratings[winner]?.before ?? 0)
    const last = over.placements.indexOf(4)
    expect(over.ratings[last]?.after).toBeLessThan(over.ratings[last]?.before ?? 0)
    await host.waitState((s) => s.phase === 'finished')
    expect(host.state.result.placements).toEqual([...over.placements])
  })

  it('every client saw the same ordered event batches and clock syncs', async () => {
    const seqs = (players[1] as Player).of('events').map((e) => e.seq)
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
    const first = (players[2] as Player).of('events')[0]
    expect(first?.events[0]?.type).toBe('move_made')
    expect(first?.clock.remainingMs).toHaveLength(4)
    expect((players[3] as Player).of('clock').length).toBeGreaterThan(0)
  })

  it('persisted the match, its events and placements, and it re-simulates', async () => {
    const db = h.server.ctx.db
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'finished', rated: true, mode: 'ffa', timeControl: '10+0' })
    expect(m?.endReason).toBe('last_standing')
    expect(m?.rulesVersion).toBe(1)
    const rows = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchEvents.seq))
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1))
    expect(rows.filter((r) => r.type === 'defeat')).toHaveLength(3)
    expect(rows.at(-1)?.type).toBe('game_end')
    const move = rows.find((r) => r.type === 'move')
    expect(move?.clockRemainingMs).toBeGreaterThan(0)
    expect(move?.serverTs).toBeInstanceOf(Date)
    expect(await resimulate(db, matchId)).toBe((players[0] as Player).state.positionString)

    const mp = await db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(asc(matchPlayers.seat))
    expect(mp.map((p) => p.userId)).toEqual(browsers.map((b) => b.userId))
    expect(mp.every((p) => p.placement !== null && p.ratingAfter !== null)).toBe(true)
    const losers = mp.filter((p) => p.placement !== 1)
    expect(losers.every((p) => p.defeatReason === 'leader_captured' && p.defeatSeq)).toBe(true)
    expect(mp.find((p) => p.placement === 1)?.finalStatus).toBe('active')
  })

  it('updated public ratings only', async () => {
    const db = h.server.ctx.db
    const rows = await db
      .select()
      .from(ratings)
      .where(eq(ratings.userId, (browsers[0] as Browser).userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'public',
      mode: 'ffa',
      timeControl: '10+0',
      gamesPlayed: 1,
    })
  })

  it('shows up in match history, detail and ratings endpoints', async () => {
    const b = browsers[0] as Browser
    const list = (await b.get('/api/matches')).body as unknown as MatchListResponse
    expect(list.matches).toHaveLength(1)
    const item = list.matches[0]
    expect(item).toMatchObject({
      id: matchId,
      mode: 'ffa',
      timeControl: '10+0',
      seat: 0,
      civ: 'canada',
    })
    expect(item?.ratingDelta).not.toBeNull()
    expect(item?.opponents.map((o) => o.name).sort()).toEqual(
      browsers
        .slice(1)
        .map((x) => x.name)
        .sort(),
    )
    const detail = (await b.get(`/api/matches/${matchId}`)).body as unknown as MatchDetailResponse
    expect(detail.players).toHaveLength(4)
    expect(detail.players[0]?.isYou).toBe(true)
    expect(detail.events.length).toBeGreaterThan(10)
    const r = (await b.get('/api/ratings/me')).body as unknown as RatingsResponse
    expect(r.ratings).toHaveLength(1)
    expect(r.ratings[0]?.gamesPlayed).toBe(1)

    // Not a participant: the match is not visible.
    const outsider = await guest(h)
    expect((await outsider.get(`/api/matches/${matchId}`)).status).toBe(404)
    expect(
      ((await outsider.get('/api/matches')).body as unknown as MatchListResponse).matches,
    ).toEqual([])
    // Signed out: 401.
    const res = await fetch(`${h.url}/api/matches`)
    expect(res.status).toBe(401)
  })

  afterAll(async () => {
    for (const p of players ?? []) await p.leave()
  })
})

describe('a casual game with bots', () => {
  it('fills seats with bots, falls back when bot-service is busy, and updates shadow ratings', async () => {
    const human = await registered(h)
    bots.requests.length = 0
    const players = await startGame([human], {
      bots: [
        { seat: 1, level: '600' },
        { seat: 2, level: '1500' },
        { seat: 3, level: 'max' },
      ],
    })
    const host = players[0] as Player
    expect(host.state.rated).toBe(false)
    // South (the human) moves first; then bots answer instantly.
    host.send('move', { move: greedyMove(host.state.positionString) })
    await host.waitMessage('events', (e) => e.seq >= 4)
    expect(bots.requests.slice(0, 3).map((r) => r.level)).toEqual(['600', '1500', 'max'])
    expect(bots.requests[0]?.clockMs).toBeGreaterThan(590_000)
    expect(bots.requests[0]?.incrementMs).toBe(0)

    // bot-service saturated (503): the room plays a local move instead.
    bots.mode = 'saturated'
    const before = host.state.actionSeq
    const move = greedyMove(host.state.positionString)
    host.send('move', { move })
    await host.waitMessage('events', (e) => e.seq >= before + 4)
    bots.mode = 'illegal'
    await playOut(players).then((over) => {
      expect(over.rated).toBe(false)
      expect(over.ratings).toEqual([null, null, null, null])
    })
    bots.mode = 'ok'

    const db = h.server.ctx.db
    const rows = await db.select().from(ratings).where(eq(ratings.userId, human.userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('shadow')
    const [m] = await db.select().from(matches).where(eq(matches.id, host.state.matchId))
    expect(m?.status).toBe('finished')
    const mp = await db
      .select()
      .from(matchPlayers)
      .where(and(eq(matchPlayers.matchId, host.state.matchId), eq(matchPlayers.seat, 3)))
    expect(mp[0]).toMatchObject({ userId: null, botLevel: 'max' })
    expect(mp[0]?.ratingBefore).toBeNull()
    // The shadow rating is never exposed.
    const r = (await human.get('/api/ratings/me')).body as unknown as RatingsResponse
    expect(r.ratings).toEqual([])
    await host.leave()
  })

  it('guests in a bot game are never rated', async () => {
    const g = await guest(h)
    const players = await startGame([g], {
      bots: [
        { seat: 1, level: '900' },
        { seat: 2, level: '900' },
        { seat: 3, level: '900' },
      ],
    })
    await playOut(players)
    const rows = await h.server.ctx.db.select().from(ratings).where(eq(ratings.userId, g.userId))
    expect(rows).toEqual([])
    await (players[0] as Player).leave()
  })
})

describe('disconnects and restarts', () => {
  it('reconnects within the grace period and keeps the seat', async () => {
    const human = await guest(h)
    const players = await startGame([human], {
      bots: [
        { seat: 1, level: '600' },
        { seat: 2, level: '600' },
        { seat: 3, level: '600' },
      ],
    })
    const p = players[0] as Player
    const server = matchMaker.getLocalRoomById(p.room.roomId) as unknown as {
      state: { seats: { connected: boolean; graceDeadline: number }[] }
    }
    p.drop()
    // The server shows the seat as disconnected, with the grace deadline.
    await waitFor(() => server.state.seats[0]?.connected === false, 5_000, 'disconnected')
    expect(server.state.seats[0]?.graceDeadline).toBeGreaterThan(Date.now())
    await p.reconnect()
    await p.waitMessage('welcome')
    await p.waitState((s) => s.seats[0]?.connected === true && s.seats[0]?.graceDeadline === 0)
    expect(p.seat).toBe(0)
    const over = await playOut([p])
    expect(over.result.type).toBeTruthy()
    const rows = await h.server.ctx.db
      .select({ type: matchEvents.type })
      .from(matchEvents)
      .where(eq(matchEvents.matchId, p.state.matchId))
    const types = rows.map((r) => r.type)
    expect(types).toContain('disconnect')
    expect(types).toContain('reconnect')
    await p.leave()
  })

  it('aborts games left in progress when the server restarts', async () => {
    const human = await guest(h)
    const players = await startGame([human], {
      bots: [
        { seat: 1, level: '600' },
        { seat: 2, level: '600' },
        { seat: 3, level: '600' },
      ],
    })
    const p = players[0] as Player
    const matchId = p.state.matchId
    // A crash leaves the row in_progress; startup (startServer) aborts such rows.
    const aborted = await abortOrphanedMatches(h.server.ctx.db)
    expect(aborted).toContain(matchId)
    const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'aborted', endReason: 'server_restart', rated: false })
    await p.leave()
    await waitFor(() => h.server.ctx.game.runningGames() === 0, 10_000, 'bot game to end')
  })
})
