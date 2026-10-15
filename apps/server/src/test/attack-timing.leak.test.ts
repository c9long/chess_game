/**
 * Review: 200 short bot-only games (the human host abandons right after the start) must not
 * leak rooms, seats, timers, handles or engine memory.
 */
import { matchMaker } from '@colyseus/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTimedGame } from './attack-timing.helpers.ts'
import {
  type Browser,
  FakeBotClient,
  type GameHarness,
  guest,
  type Player,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({ CLOCK_SYNC_INTERVAL_MS: '50' }, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

function resources() {
  const info = process.getActiveResourcesInfo()
  const count = (t: string) => info.filter((x) => x === t).length
  return { timeouts: count('Timeout'), immediates: count('Immediate'), total: info.length }
}

async function oneGame(b: Browser) {
  const players = await startTimedGame([b], { botSeats: [1, 2, 3] })
  const p = players[0] as Player
  await p.leave()
  await waitFor(() => h.server.ctx.game.runningGames() === 0, 30_000, 'bot game end')
}

describe('many games', () => {
  it('200 bot-only games leave nothing behind', { timeout: 600_000 }, async () => {
    const svc = h.server.ctx.game
    const hosts = await Promise.all(Array.from({ length: 10 }, () => guest(h)))
    // Warm-up (lazy init, caches).
    for (const b of hosts.slice(0, 2)) await oneGame(b)
    await waitFor(() => svc.rooms.size === 0, 10_000, 'warm-up rooms disposed')
    await sleep(300)
    global.gc?.()
    const before = { ...resources(), mem: process.memoryUsage() }

    for (let i = 0; i < 200; i++) {
      await oneGame(hosts[i % hosts.length] as Browser)
      if (i % 20 === 19) await sleep(1_100) // stay under 60 matchmaking calls/min per IP
    }
    await waitFor(() => svc.rooms.size === 0, 20_000, 'rooms disposed')
    await sleep(500)
    global.gc?.()
    const after = { ...resources(), mem: process.memoryUsage() }

    console.log('before', before, 'after', after)
    expect(svc.rooms.size).toBe(0)
    expect(svc.seats.size).toBe(0)
    expect((await matchMaker.query({ name: 'match' })).length).toBe(0)
    expect(after.timeouts - before.timeouts).toBeLessThanOrEqual(3)
    expect(after.immediates).toBeLessThanOrEqual(before.immediates + 1)
    expect(after.total - before.total).toBeLessThanOrEqual(5)
    // Engine (WASM) memory lives in arrayBuffers; 200 freed games must not grow it much.
    expect(after.mem.arrayBuffers - before.mem.arrayBuffers).toBeLessThan(32 * 1024 * 1024)
  })
})
