/**
 * Game-integrity probes (review): a malicious client trying to cheat or desync lobbies and
 * live games. The seat-binding and lobby-race tests were `it.fails` while the defects
 * existed and are plain regressions now that they're fixed.
 */
import type { SeatReservation } from '@colyseus/sdk'
import { matchEvents, matches } from '@game/db'
import { COLYSEUS_PATH, PROTOCOL_VERSION } from '@game/protocol'
import { Game } from '@game/rules'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resimulate } from '../game/persistence.ts'
import {
  type Browser,
  createLobby,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  Player,
  playOut,
  registered,
  sleep,
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({ RECONNECT_GRACE_SECONDS: '5' }, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

const CIVS = ['canada', 'usa', 'china', 'japan', 'germany', 'russia', 'england', 'france', 'mali']

/** A raw matchmaking call that reserves a seat without connecting (what any HTTP client can do). */
async function reserve(b: Browser, method: 'create' | 'joinById', target: string, body: object) {
  const res = await b.post(`${COLYSEUS_PATH}/matchmake/${method}/${target}`, body)
  return res
}

async function consume(b: Browser, reservation: unknown): Promise<Player> {
  const room = await b.sdk().consumeSeatReservation(reservation as SeatReservation)
  const p = new Player(b, room)
  await p.waitMessage('welcome')
  return p
}

async function startGame(browsers: Browser[]): Promise<Player[]> {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, { name: 'Integrity' })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  await host.waitState((s) => s.seats.every((x) => x.occupied))
  players.forEach((p, i) => {
    p.send('setCiv', { civ: CIVS[i] })
  })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

describe('attack-integrity: seat binding', () => {
  // GameService.seats ("a user holds at most one seat") is only written in onJoin, and onJoin
  // never checks it: a reservation taken while free can be consumed after sitting elsewhere.
  it('a user cannot hold seats in two lobbies (stale reservation)', async () => {
    const [h1, h2, x] = await Promise.all([guest(h), guest(h), guest(h)])
    const a = await createLobby(h1, { name: 'Room A' })
    const b = await createLobby(h2, { name: 'Room B' })
    const res = await reserve(x, 'joinById', a.room.roomId, { protocolVersion: PROTOCOL_VERSION })
    expect(res.status).toBe(200)
    await joinLobby(x, b.room.roomId) // now seated in B
    let seatedInA = false
    try {
      await consume(x, res.body)
      seatedInA = true
    } catch {}
    await sleep(100)
    const inA = a.state.seats.some((s) => s.displayName === x.name && s.occupied)
    const inB = b.state.seats.some((s) => s.displayName === x.name && s.occupied)
    expect(seatedInA && inA && inB).toBe(false)
  })

  it('a user cannot hold seats in two lobbies (parallel joins)', async () => {
    const [h1, h2, x] = await Promise.all([guest(h), guest(h), guest(h)])
    const a = await createLobby(h1, { name: 'Room A2' })
    const b = await createLobby(h2, { name: 'Room B2' })
    const results = await Promise.allSettled([
      joinLobby(x, a.room.roomId),
      joinLobby(x, b.room.roomId),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  // The `kicked` set is checked in onAuth only; a reservation taken before the kick still works.
  it('a kicked player cannot come back with a pre-fetched reservation', async () => {
    const [host, x] = await Promise.all([guest(h), guest(h)])
    const lobby = await createLobby(host, { name: 'Kick me' })
    const body = { protocolVersion: PROTOCOL_VERSION }
    const r1 = await reserve(x, 'joinById', lobby.room.roomId, body)
    const r2 = await reserve(x, 'joinById', lobby.room.roomId, body)
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    const first = await consume(x, r1.body)
    lobby.send('kick', { seat: first.seat })
    await first.waitMessage('kicked')
    await lobby.waitState((s) => !s.seats.some((z) => z.displayName === x.name))
    let back = false
    try {
      await consume(x, r2.body)
      back = true
    } catch {}
    await sleep(100)
    expect(back && lobby.state.seats.some((z) => z.displayName === x.name)).toBe(false)
  })

  // admit() counts occupied seats only; one account can take every Colyseus reservation
  // (maxClients = 8) and lock the lobby for everyone for the reservation time (15 s), repeatably.
  it('one account cannot lock a lobby with unconsumed reservations', async () => {
    const [host, x, legit] = await Promise.all([guest(h), guest(h), guest(h)])
    const lobby = await createLobby(host, { name: 'Lock me' })
    const body = { protocolVersion: PROTOCOL_VERSION }
    for (let i = 0; i < 7; i++) await reserve(x, 'joinById', lobby.room.roomId, body)
    const p = await joinLobby(legit, lobby.room.roomId)
    expect(p.seat).toBeGreaterThan(0)
  })

  // onJoin intends a 20 s grace for the creator, but afterSeatsChanged() hands the host role
  // to the first seated human at once: anyone watching the realtime listing can snipe it.
  it('the creator stays host if someone joins before the creator connects', async () => {
    const [creator, sniper] = await Promise.all([guest(h), guest(h)])
    const res = await reserve(creator, 'create', 'match', {
      protocolVersion: PROTOCOL_VERSION,
      name: 'Snipe me',
      mode: 'ffa',
      timeControl: '10+0',
    })
    expect(res.status).toBe(200)
    const roomId = (res.body as { roomId: string }).roomId
    const s = await joinLobby(sniper, roomId)
    const c = await consume(creator, res.body)
    expect(s.of('welcome')[0]?.isHost).toBe(false)
    expect(c.of('welcome')[0]?.isHost).toBe(true)
  })
})

describe('attack-integrity: lobby races', () => {
  // setCiv resolves the sender's seat, awaits the civ catalog, then writes to that seat index.
  // A swap during the await puts the civ on another player's seat (and keeps their ready flag).
  it('setCiv cannot land on another player after a concurrent swap', async () => {
    const civs = h.server.ctx.game.civs
    const original = civs.enabledSlugs.bind(civs)
    const [hb, pb, qb] = await Promise.all([guest(h), guest(h), guest(h)])
    const host = await createLobby(hb, { name: 'Swap race' })
    const p = await joinLobby(pb, host.room.roomId)
    const q = await joinLobby(qb, host.room.roomId)
    q.send('setCiv', { civ: 'canada' })
    await q.waitState((s) => s.seats[q.seat]?.civ === 'canada')
    // Simulate the catalog's periodic DB refresh (a real await) taking a moment.
    civs.enabledSlugs = async () => {
      await sleep(150)
      return original()
    }
    try {
      const pSeat = p.seat
      const qSeat = q.seat
      p.send('setCiv', { civ: 'mali' })
      await sleep(20)
      host.send('swapSeats', { a: pSeat, b: qSeat })
      await sleep(400)
      expect(q.state.seats[q.seat]?.civ).toBe('canada')
    } finally {
      civs.enabledSlugs = original
    }
  })
})

describe('attack-integrity: live game', () => {
  it('state, broadcast and database agree under a hostile client', async () => {
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const players = await startGame(browsers)
    const [host, a, b, c] = players as [Player, Player, Player, Player]
    const matchId = host.state.matchId

    // Hostile noise: lobby actions in game, moves for others, kicks, malformed payloads.
    for (const atk of [a, b]) {
      expect((await atk.expectError('setCiv', { civ: 'mali' })).code).toBe('wrong_phase')
      expect((await atk.expectError('kick', { seat: 0 })).code).toMatch(/not_host|wrong_phase/)
      expect((await atk.expectError('setReady', { ready: false })).code).toBe('wrong_phase')
      expect((await atk.expectError('move', { move: 'c2c4', seat: 0 })).code).toBe(
        'invalid_message',
      )
      expect((await atk.expectError('startGame')).code).toMatch(/not_host|wrong_phase/)
    }
    expect((await host.expectError('kick', { seat: 1 })).code).toBe('wrong_phase')
    expect((await host.expectError('swapSeats', { a: 0, b: 1 })).code).toBe('wrong_phase')
    expect((await host.expectError('addBot', { seat: 1, level: '600' })).code).toBe('wrong_phase')
    expect(host.state.actionSeq).toBe(0)

    // Play out while a non-mover replays the last move each turn.
    const deadline = Date.now() + 30_000
    let lastSent = -1
    let lastNotation: string | null = null
    while (!host.of('gameOver')[0] && Date.now() < deadline) {
      const s = host.state
      if (s.phase === 'in_game' && s.seatToMove >= 0 && s.actionSeq !== lastSent) {
        const mover = players.find((p) => p.seat === s.seatToMove)
        const other = players.find((p) => p.seat !== s.seatToMove && p !== mover)
        if (lastNotation && other) other.send('move', { move: lastNotation })
        const move = greedyMove(s.positionString)
        if (mover && move) {
          lastSent = s.actionSeq
          lastNotation = move
          mover.send('move', { move })
          mover.send('move', { move }) // duplicate send
        }
      }
      await sleep(5)
    }
    const over = host.of('gameOver')[0]
    expect(over).toBeTruthy()
    // Messages arrive before the next state patch: wait for the final state.
    await host.waitState((s) => s.phase === 'finished' && s.actionSeq === c.of('events').length)

    // Broadcast stream replays to the final state.
    const events = c.of('events')
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    const replay = Game.create({
      mode: 'ffa',
      civs: CIVS.slice(0, 4) as never,
    })
    try {
      for (const e of events) {
        if (e.action === 'move') replay.applyMove(e.notation as string)
        else if (e.action === 'timeout')
          replay.applyTimeout(['south', 'west', 'north', 'east'][e.seat] as never)
        else replay.applyAbandon(['south', 'west', 'north', 'east'][e.seat] as never)
        expect(replay.positionString()).toBe(e.positionString)
      }
      expect(replay.positionString()).toBe(host.state.positionString)
    } finally {
      replay.free()
    }

    // Persisted actions equal broadcast actions, and the DB re-simulates.
    const db = h.server.ctx.db
    await sleep(200)
    const rows = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchEvents.seq))
    const actions = rows.filter((r) => ['move', 'promotion', 'timeout', 'abandon'].includes(r.type))
    expect(actions.map((r) => (r.payload as { notation: string | null }).notation)).toEqual(
      events.map((e) => e.notation),
    )
    expect(actions.map((r) => (r.payload as { events: unknown }).events)).toEqual(
      events.map((e) => e.events),
    )
    expect(await resimulate(db, matchId)).toBe(host.state.positionString)
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId))
    expect(m?.status).toBe('finished')
  })

  // Invariant: a participant deleting their account mid-game (fresh session, no re-auth)
  // must not leave the match stuck in_progress (applyRatings skips deleted users).
  it('a participant deleting their account mid-game does not strand the match', async () => {
    const browsers = await Promise.all([registered(h), registered(h), registered(h), registered(h)])
    const players = await startGame(browsers)
    const host = players[0] as Player
    const matchId = host.state.matchId
    expect(host.state.rated).toBe(true)
    const quitter = browsers[3] as Browser
    const del = await quitter.request('DELETE', '/api/account', { confirm: 'DELETE' })
    expect(del.status).toBe(200)
    const over = await playOut(players, 30_000)
    expect(over).toBeTruthy()
    await sleep(300)
    const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m?.status).not.toBe('in_progress')
    expect(over.endReason).not.toBe('persist_failed')
    // No public rating could be applied (one participant is gone): stored and shown unrated.
    expect(m?.rated).toBe(false)
    expect(over.rated).toBe(false)
  })

  it('an abandoned player can rejoin to watch but never moves again', async () => {
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    bots.delayMs = 0
    const players = await startGame(browsers)
    const [host, quitter] = players as [Player, Player]
    const seat = quitter.seat
    await quitter.leave()
    await host.waitState((s) => s.seats[seat]?.status === 'removed' || s.phase === 'finished')
    if (host.state.phase === 'finished') return
    const back = await joinLobby(browsers[1] as Browser, host.room.roomId)
    expect(back.of('welcome')[0]?.seat).toBe(seat)
    const before = host.state.actionSeq
    const err = await back.expectError('move', { move: 'a4a5' })
    expect(['not_your_turn', 'wrong_phase']).toContain(err.code)
    expect(host.state.actionSeq).toBeGreaterThanOrEqual(before)
    expect(host.state.seats[seat]?.status).toBe('removed')
  })
})
