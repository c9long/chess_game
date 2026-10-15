/**
 * Review: clock accuracy, flag falls with no client traffic, moves racing the flag,
 * reconnect at the edge of the grace window, two tabs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bySeat, eventRows, matchRow, startTimedGame } from './attack-timing.helpers.ts'
import {
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  matchmakeError,
  type Player,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

const BASE_MS = 800
const GRACE_S = 0.6
let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness(
    { DEV_CLOCK_BASE_MS: String(BASE_MS), RECONNECT_GRACE_SECONDS: String(GRACE_S) },
    { botClient: bots },
  )
})

afterAll(async () => {
  await h.close()
})

async function finishQuietly(players: Player[]) {
  for (const p of players) await p.leave()
  await waitFor(() => h.server.ctx.game.runningGames() === 0, 20_000, 'games over')
}

describe('flag fall', () => {
  it('falls at zero with no client messages, without increment, and the removed clock stays stopped', async () => {
    bots.delayMs = 0
    const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
    const south = players[0] as Player
    const startClock = south.of('clock')[0]
    expect(startClock?.runningSeat).toBe(0)
    const timeout = await south.waitMessage('events', (e) => e.action === 'timeout', 3_000)
    expect(timeout.seat).toBe(0)
    const elapsed = timeout.clock.serverTimestamp - (startClock?.turnStartedAt ?? 0)
    expect(elapsed).toBeGreaterThanOrEqual(BASE_MS)
    expect(elapsed).toBeLessThan(BASE_MS + 60)
    expect(timeout.clock.remainingMs[0]).toBe(0)
    // Several bot turns later South's clock is still exactly 0 (never restarted, no increment).
    await south.waitState((s) => s.actionSeq >= 4 || s.phase === 'finished', 5_000)
    expect(south.state.clock.remainingMs[0]).toBe(0)
    expect(south.state.clock.runningSeat).not.toBe(0)
    await finishQuietly(players)
  })

  it('10+0: a move never adds time (remaining after the move <= remaining before)', async () => {
    const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
    const south = players[0] as Player
    await sleep(100)
    south.send('move', { move: greedyMove(south.state.positionString) })
    const ev = await south.waitMessage('events', (e) => e.seq === 1)
    expect(ev.clock.remainingMs[0]).toBeLessThanOrEqual(BASE_MS - 100)
    expect(ev.clock.remainingMs[0]).toBeGreaterThan(BASE_MS - 200)
    await finishQuietly(players)
  })

  it('a move arriving as the flag falls is either a move or a timeout, never both, and replays consistently', async () => {
    const outcomes: string[] = []
    for (let i = 0; i < 6; i++) {
      const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
      const south = players[0] as Player
      const c = south.of('clock')[0]
      const matchId = south.state.matchId
      const move = greedyMove(south.state.positionString)
      // Aim at the flag, staggered around the exact zero.
      const target = (c?.turnStartedAt ?? Date.now()) + BASE_MS - 3 + i
      await sleep(Math.max(0, target - Date.now()))
      south.send('move', { move })
      const first = await south.waitMessage('events', (e) => e.seq === 1, 3_000)
      outcomes.push(first.action)
      expect(first.seat).toBe(0)
      if (first.action === 'move') expect(first.clock.remainingMs[0]).toBeGreaterThan(0)
      else expect(first.clock.remainingMs[0]).toBe(0)
      await sleep(50)
      // seq numbers are unique (no double action on the flag edge).
      const seqs = south.of('events').map((e) => e.seq)
      expect(new Set(seqs).size).toBe(seqs.length)
      await finishQuietly(players)
      let status = ''
      for (let t = 0; t < 100 && status !== 'finished'; t++) {
        status = (await matchRow(h, matchId))?.status ?? ''
        if (status !== 'finished') await sleep(50)
      }
      expect(status).toBe('finished')
      const rows = await eventRows(h, matchId)
      const acts = rows.filter((r) => ['move', 'promotion', 'timeout', 'abandon'].includes(r.type))
      const actionSeqs = acts.map((r) => (r.payload as { actionSeq: number }).actionSeq)
      expect(new Set(actionSeqs).size).toBe(actionSeqs.length)
    }
    expect(outcomes.length).toBe(6)
  })
})

describe('reconnect timing', () => {
  it('a reconnect just inside the grace keeps the seat; no abandon is recorded', async () => {
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const host = await (async () => {
      const ps = await startTimedGame(browsers, { timeControl: '10+0' })
      return ps
    })()
    const west = bySeat(host, 1)
    const south = bySeat(host, 0)
    west.drop()
    await south.waitState((s) => s.seats[1]?.connected === false)
    await sleep(GRACE_S * 1000 - 120)
    await west.reconnect()
    await sleep(GRACE_S * 1000)
    expect(south.of('events').some((e) => e.action === 'abandon')).toBe(false)
    expect(south.state.seats[1]?.status).toBe('active')
    expect(south.state.seats[1]?.connected).toBe(true)
    await finishQuietly(host)
  })

  it('two tabs: a second tab is refused while the first is connected; during the grace it takes the seat and the stale session never abandons it', async () => {
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const players = await startTimedGame(browsers)
    const south = bySeat(players, 0)
    const west = bySeat(players, 1)
    const roomId = west.room.roomId
    expect(await matchmakeError(west.browser.sdk().joinById(roomId, { protocolVersion: 1 }))).toBe(
      'already_seated',
    )
    west.drop()
    await south.waitState((s) => s.seats[1]?.connected === false)
    const tab2 = await joinLobby(west.browser, roomId)
    expect(tab2.seat).toBe(1)
    // The first tab's reconnection token must no longer give it the seat.
    let staleOk = false
    try {
      await west.reconnect()
      await sleep(200)
      staleOk = west.room.connection.isOpen && west.seat === 1
    } catch {}
    expect(staleOk).toBe(false)
    // Old session's grace expiry must not abandon the seat now held by tab 2.
    await sleep(GRACE_S * 1000 + 300)
    expect(south.of('events').some((e) => e.action === 'abandon')).toBe(false)
    expect(south.state.seats[1]?.connected).toBe(true)
    await finishQuietly([south, tab2, bySeat(players, 2), bySeat(players, 3)])
  })
})
