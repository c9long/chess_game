/**
 * Singleplayer rooms (`kind: 'solo'`): the creator at South against three bots, untimed,
 * unlisted, unrated. Plus bot pacing (BOT_MIN_MOVE_MS) in solo and timed games.
 */
import { matchEvents, matches, matchPlayers, ratings } from '@game/db'
import { CIV_SLUGS, type MatchListResponse, PROTOCOL_VERSION, ROOM_NAMES } from '@game/protocol'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pickBotCivs } from '../game/match-room.ts'
import {
  type Browser,
  createLobby,
  createSolo,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  matchmakeError,
  type Player,
  playOut,
  registered,
  sleep,
  soloOptions,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

/** Arrival time (ms) of each `events` message received so far, by seq. */
function eventTimes(p: Player): Map<number, number> {
  const times = new Map<number, number>()
  for (const m of p.messages) {
    if (m.type === 'events') times.set((m.payload as { seq: number }).seq, m.at)
  }
  return times
}

describe('pickBotCivs', () => {
  it('picks distinct civs other than the excluded one, repeating only when short', () => {
    for (let i = 0; i < 50; i++) {
      const civs = pickBotCivs(CIV_SLUGS, 'mali', 3)
      expect(civs).toHaveLength(3)
      expect(new Set(civs).size).toBe(3)
      expect(civs).not.toContain('mali')
    }
    expect(pickBotCivs(['mali', 'china'], 'mali', 3)).toEqual(['china', 'china', 'china'])
    expect(pickBotCivs(['mali'], 'mali', 3)).toEqual(['mali', 'mali', 'mali'])
  })
})

describe('solo rooms', () => {
  let h: GameHarness
  const bots = new FakeBotClient()

  beforeAll(async () => {
    // A tiny dev clock: an untimed game must ignore it (nobody can flag).
    h = await startGameHarness(
      { DEV_CLOCK_BASE_MS: '200', RECONNECT_GRACE_SECONDS: '0.5' },
      { botClient: bots },
    )
  })

  afterAll(async () => {
    await h.close()
  })

  it('seats the player at South and three bots at West, North and East, then starts by itself', async () => {
    const p = await createSolo(await guest(h), { civ: 'mali', botLevel: '1500', mode: 'teams' })
    await p.waitState((s) => s.phase === 'in_game', 5_000, 'auto start')
    const s = p.state
    expect(p.seat).toBe(0)
    expect(s.name).toBe('Practice vs bots')
    expect(s.mode).toBe('teams')
    expect(s.timeControl).toBe('untimed')
    expect(s.rated).toBe(false)
    expect(s.hostSeat).toBe(0)
    expect(s.seats[0]).toMatchObject({ isBot: false, civ: 'mali', ready: true, connected: true })
    const botSeats = s.seats.slice(1)
    for (const b of botSeats) expect(b).toMatchObject({ isBot: true, botLevel: '1500' })
    const civs = botSeats.map((b) => b.civ)
    expect(new Set(civs).size).toBe(3)
    expect(civs).not.toContain('mali')
    for (const c of civs) expect(CIV_SLUGS).toContain(c)
    // No clock runs, ever.
    expect(s.clock.runningSeat).toBe(-1)
    // Lobby edits are refused: the setup is fixed.
    expect((await p.expectError('addBot', { seat: 1, level: '600' })).code).toBe('wrong_phase')
    await p.leave()
  })

  it('names the room after the creator’s choice when given one', async () => {
    const p = await createSolo(await guest(h), { name: 'Evening practice' })
    expect(p.state.name).toBe('Evening practice')
    await p.leave()
  })

  it('bot civs vary between games', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const p = await createSolo(await guest(h), { civ: 'canada' })
      for (const b of p.state.seats.slice(1)) seen.add(b.civ)
      await p.leave()
    }
    expect(seen.size).toBeGreaterThan(3)
    expect(seen.has('canada')).toBe(false)
  })

  it('refuses bad solo options and the untimed control for lobbies', async () => {
    const b = await guest(h)
    const sdk = b.sdk()
    const bad = [
      { ...soloOptions(), timeControl: '10+0' },
      { ...soloOptions(), civ: 'atlantis' },
      { ...soloOptions(), botLevel: '1000' },
      { ...soloOptions(), password: 'x' },
      { protocolVersion: PROTOCOL_VERSION, name: 'Lobby', mode: 'ffa', timeControl: 'untimed' },
    ]
    for (const options of bad) {
      expect(await matchmakeError(sdk.create(ROOM_NAMES.match, options))).toBe('invalid_options')
    }
  })

  it('is never listed in the lobby browser', async () => {
    const watcher = await guest(h)
    const lobby = await watcher.sdk().joinOrCreate(ROOM_NAMES.lobby, {})
    const listed = new Set<string>()
    lobby.onMessage('rooms', (rooms: { roomId: string }[]) => {
      for (const r of rooms) listed.add(r.roomId)
    })
    lobby.onMessage('+', ([id]: [string, unknown]) => listed.add(id))
    lobby.send('filter', { name: ROOM_NAMES.match })
    const solo = await createSolo(await guest(h))
    // A public lobby created after it does show up, so the listing is live.
    const open = await createLobby(await guest(h), { name: 'Open table' })
    await waitFor(() => listed.has(open.room.roomId), 5_000, 'public lobby listed')
    await solo.waitState((s) => s.phase === 'in_game')
    await sleep(100)
    expect(listed.has(solo.room.roomId)).toBe(false)
    await open.leave()
    await solo.leave()
    await lobby.leave()
  })

  it('accepts no other players, while the creator can reconnect', async () => {
    const creator = await guest(h)
    const p = await createSolo(creator)
    await p.waitState((s) => s.phase === 'in_game')
    const other = await guest(h)
    const join = other.sdk().joinById(p.room.roomId, { protocolVersion: PROTOCOL_VERSION })
    expect(await matchmakeError(join)).toBe('room_not_joinable')
    p.drop()
    await sleep(50)
    await p.reconnect()
    await p.waitMessage('welcome', (w) => w.seat === 0)
    await p.waitState((s) => s.seats[0]?.connected === true, 5_000, 'reconnected')
    await p.leave()
  })

  it('after leaving a running solo game the player can start another at once', async () => {
    const creator = await guest(h)
    const p = await createSolo(creator)
    await p.waitState((s) => s.phase === 'in_game')
    await p.leave()
    const next = await createSolo(creator)
    await next.waitState((s) => s.phase === 'in_game')
    expect(next.room.roomId).not.toBe(p.room.roomId)
    await next.leave()
  })

  it('runs no clock: no flag after a long wait, and moves still work', async () => {
    const p = await createSolo(await guest(h))
    await p.waitState((s) => s.phase === 'in_game')
    // Far longer than the 200 ms dev clock.
    await sleep(800)
    expect(p.of('events')).toHaveLength(0)
    expect(p.state.seatToMove).toBe(0)
    expect(p.state.clock.runningSeat).toBe(-1)
    const before = bots.requests.length
    p.send('move', { move: greedyMove(p.state.positionString) })
    const reply = await p.waitMessage('events', (e) => e.seq === 4)
    expect(reply.clock.runningSeat).toBe(-1)
    expect(p.of('events').every((e) => e.action === 'move')).toBe(true)
    // The state patch can trail the `events` message under load.
    await p.waitState((s) => s.actionSeq === 4)
    expect(p.state.seatToMove).toBe(0)
    // bot-service gets a generous virtual clock so every level thinks for its usual time.
    const asked = bots.requests.slice(before, before + 3)
    expect(asked.map((r) => r.level)).toEqual(['1200', '1200', '1200'])
    for (const r of asked) expect(r).toMatchObject({ clockMs: 600_000, incrementMs: 0 })
    // Waiting again changes nothing.
    await sleep(500)
    expect(p.of('events')).toHaveLength(4)
    await p.leave()
  })

  it('abandons the player after the reconnect grace; the bots finish the game', async () => {
    const p = await createSolo(await guest(h))
    await p.waitState((s) => s.phase === 'in_game')
    const matchId = p.state.matchId
    p.drop()
    const db = h.server.ctx.db
    let m: typeof matches.$inferSelect | undefined
    const deadline = Date.now() + 20_000
    while (m?.status !== 'finished' && Date.now() < deadline) {
      await sleep(50)
      ;[m] = await db.select().from(matches).where(eq(matches.id, matchId))
    }
    expect(m).toMatchObject({ status: 'finished', timeControl: 'untimed', rated: false })
    const rows = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchEvents.seq))
    expect(rows.find((r) => r.type === 'abandon')?.seat).toBe(0)
    expect(rows.some((r) => r.type === 'timeout')).toBe(false)
  })

  it('saves an untimed, unrated match with no rating rows, shown in the history', async () => {
    const user: Browser = await registered(h)
    const p = await createSolo(user, { botLevel: 'max' })
    await p.waitState((s) => s.phase === 'in_game')
    const matchId = p.state.matchId
    const over = await playOut([p], 30_000)
    expect(over.rated).toBe(false)
    expect(over.ratings).toEqual([null, null, null, null])

    const db = h.server.ctx.db
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'finished', timeControl: 'untimed', rated: false })
    const events = await db.select().from(matchEvents).where(eq(matchEvents.matchId, matchId))
    expect(events.every((e) => e.clockRemainingMs === null)).toBe(true)
    const players = await db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    expect(players.every((x) => x.ratingBefore === null && x.ratingAfter === null)).toBe(true)
    // No public and no shadow rating.
    expect(await db.select().from(ratings).where(eq(ratings.userId, user.userId))).toEqual([])

    const list = (await user.get('/api/matches')).body as unknown as MatchListResponse
    const item = list.matches.find((x) => x.id === matchId)
    expect(item).toMatchObject({ timeControl: 'untimed', rated: false, seat: 0, civ: 'mali' })
    expect(item?.opponents.map((o) => o.botLevel)).toEqual(['max', 'max', 'max'])
    await p.leave()
  })
})

describe('bot pacing', () => {
  let h: GameHarness
  const bots = new FakeBotClient()
  const GAP = 300

  beforeAll(async () => {
    h = await startGameHarness({ BOT_MIN_MOVE_MS: String(GAP) }, { botClient: bots })
  })

  afterAll(async () => {
    await h.close()
  })

  it('spaces bot moves by BOT_MIN_MOVE_MS, overlapping the bots’ think time', async () => {
    const p = await createSolo(await guest(h))
    await p.waitState((s) => s.phase === 'in_game')
    p.send('move', { move: greedyMove(p.state.positionString) })
    const fourth = await p.waitMessage('events', (e) => e.seq === 4, 5_000)
    let times = eventTimes(p)
    for (const seq of [2, 3, 4]) {
      const gap = (times.get(seq) ?? 0) - (times.get(seq - 1) ?? 0)
      expect(gap).toBeGreaterThanOrEqual(GAP - 30)
    }

    // A slow bot (200 ms think) waits only for the rest of the gap, not the gap on top.
    bots.delayMs = 200
    p.send('move', { move: greedyMove(fourth.positionString) })
    await p.waitMessage('events', (e) => e.seq === 8, 5_000)
    bots.delayMs = 0
    times = eventTimes(p)
    for (const seq of [6, 7, 8]) {
      const gap = (times.get(seq) ?? 0) - (times.get(seq - 1) ?? 0)
      expect(gap).toBeGreaterThanOrEqual(GAP - 30)
      expect(gap).toBeLessThan(GAP + 200 - 20)
    }
    await p.leave()
  })

  it('paces bots in timed games too, on the bot’s own clock', async () => {
    const host = await createLobby(await guest(h), { name: 'Timed bots' })
    for (const seat of [1, 2, 3] as const) host.send('addBot', { seat, level: '600' })
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    host.send('setCiv', { civ: 'france' })
    await host.waitState((s) => s.seats[0]?.civ === 'france')
    host.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true)
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game')
    host.send('move', { move: greedyMove(host.state.positionString) })
    const last = await host.waitMessage('events', (e) => e.seq === 4, 5_000)
    const times = eventTimes(host)
    for (const seq of [2, 3, 4]) {
      const gap = (times.get(seq) ?? 0) - (times.get(seq - 1) ?? 0)
      expect(gap).toBeGreaterThanOrEqual(GAP - 30)
    }
    // The wait was paid from the bots' clocks (10 minutes each), well within them.
    for (const seat of [1, 2, 3]) {
      const left = last.clock.remainingMs[seat] ?? 0
      expect(left).toBeLessThanOrEqual(600_000 - GAP + 30)
      expect(left).toBeGreaterThan(590_000)
    }
    await host.leave()
  })

  it('paces local fallback moves too (bot-service failing)', async () => {
    const p = await createSolo(await guest(h))
    await p.waitState((s) => s.phase === 'in_game')
    bots.mode = 'saturated'
    try {
      p.send('move', { move: greedyMove(p.state.positionString) })
      await p.waitMessage('events', (e) => e.seq === 4, 5_000)
    } finally {
      bots.mode = 'ok'
    }
    const times = eventTimes(p)
    for (const seq of [2, 3, 4]) {
      const gap = (times.get(seq) ?? 0) - (times.get(seq - 1) ?? 0)
      expect(gap).toBeGreaterThanOrEqual(GAP - 30)
    }
    await p.leave()
  })

  it('waits the longer gap after an army is removed, even for a move already waiting', async () => {
    // South (human), West (bot), North (human), East (bot), FFA.
    const host = await createLobby(await guest(h), { name: 'Pace abandon', mode: 'ffa' })
    host.send('addBot', { seat: 1, level: '600' })
    await host.waitState((s) => s.seats[1]?.occupied === true)
    const north = await joinLobby(await guest(h), host.room.roomId)
    expect(north.seat).toBe(2)
    host.send('addBot', { seat: 3, level: '600' })
    await host.waitState((s) => s.seats[3]?.occupied === true)
    for (const p of [host, north]) {
      p.send('setCiv', { civ: 'france' })
      await p.waitState((s) => s.seats[p.seat]?.civ === 'france')
      p.send('setReady', { ready: true })
    }
    await host.waitState((s) => s.seats[0]?.ready === true && s.seats[2]?.ready === true)
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game')
    host.send('move', { move: greedyMove(host.state.positionString) })
    await host.waitMessage('events', (e) => e.seq === 1)
    // West's move is computed and waiting on its pacing timer when North leaves (off-turn).
    await sleep(GAP / 3)
    await north.leave()
    const ab = await host.waitMessage('events', (e) => e.action === 'abandon')
    expect(ab.events.some((e) => e.type === 'army_removed' || e.type === 'defeat')).toBe(true)
    await host.waitMessage('events', (e) => e.action === 'move' && e.seat === 1, 5_000)
    const times = eventTimes(host)
    const gap = (times.get(ab.seq + 1) ?? 0) - (times.get(ab.seq) ?? 0)
    expect(gap).toBeGreaterThanOrEqual(GAP * 2.2 - 30)
    await host.leave()
  })
})

describe('bot pacing on a short clock', () => {
  let h: GameHarness

  beforeAll(async () => {
    // 1.5 s clocks: under the 10 s floor, so bots never wait (a wait could make them flag).
    h = await startGameHarness(
      { BOT_MIN_MOVE_MS: '1000', DEV_CLOCK_BASE_MS: '1500' },
      { botClient: new FakeBotClient() },
    )
  })

  afterAll(async () => {
    await h.close()
  })

  it('skips the wait when the bot is low on time, so it never flags because of pacing', async () => {
    const host = await createLobby(await guest(h), { name: 'Blitz bots' })
    for (const seat of [1, 2, 3] as const) host.send('addBot', { seat, level: '600' })
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    host.send('setCiv', { civ: 'france' })
    await host.waitState((s) => s.seats[0]?.civ === 'france')
    host.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true)
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game')
    host.send('move', { move: greedyMove(host.state.positionString) })
    await host.waitMessage('events', (e) => e.seq === 4, 5_000)
    const times = eventTimes(host)
    const events = host.of('events').slice(0, 4)
    expect(events.every((e) => e.action === 'move')).toBe(true)
    for (const seq of [2, 3, 4]) {
      const gap = (times.get(seq) ?? 0) - (times.get(seq - 1) ?? 0)
      expect(gap).toBeLessThan(500)
    }
    await host.leave()
  })
})

describe('draining with a solo game', () => {
  let h: GameHarness

  beforeAll(async () => {
    h = await startGameHarness({}, { botClient: new FakeBotClient() })
  })

  afterAll(async () => {
    await h.close()
  })

  it('aborts a running solo game at once instead of waiting for it', async () => {
    const p = await createSolo(await guest(h))
    await p.waitState((s) => s.phase === 'in_game')
    const t0 = Date.now()
    const { aborted } = await h.server.ctx.game.drain(3_000, 50)
    expect(aborted).toBe(1)
    expect(Date.now() - t0).toBeLessThan(1_500)
    const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, p.state.matchId))
    expect(m?.status).toBe('aborted')
  })
})
