/**
 * Attack review of the replay endpoint: access by non-participants (spectators of the game,
 * strangers) and the per-request cost of the server-side re-simulation.
 */
import { PROTOCOL_VERSION } from '@game/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSolo,
  FakeBotClient,
  type GameHarness,
  guest,
  Player,
  playOut,
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({}, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

describe('GET /api/matches/:id/replay', () => {
  it('refuses a spectator of the game, and its cost per request is bounded', async () => {
    const owner = await guest(h)
    const p = await createSolo(owner)
    await p.waitState((s) => s.phase === 'in_game', 10_000, 'in_game')
    const viewerB = await guest(h)
    const viewer = new Player(
      viewerB,
      await viewerB
        .sdk()
        .joinById(p.room.roomId, { protocolVersion: PROTOCOL_VERSION, spectate: true }),
    )
    await viewer.waitState((s) => typeof s.matchId === 'string' && s.matchId.length > 0)
    const matchId = viewer.state.matchId
    // Spectators learn the match id but may not fetch its events, live or finished.
    expect((await viewerB.get(`/api/matches/${matchId}`)).status).toBe(404)
    expect((await viewerB.get(`/api/matches/${matchId}/replay`)).status).toBe(404)
    await playOut([p], 60_000)
    await p.waitState((s) => s.phase === 'finished', 10_000, 'finished')
    await new Promise((r) => setTimeout(r, 300))
    expect((await viewerB.get(`/api/matches/${matchId}/replay`)).status).toBe(404)

    const first = await owner.get(`/api/matches/${matchId}/replay`)
    expect(first.status).toBe(200)
    const actions = (first.body as { actions: unknown[] }).actions.length

    // Event-loop stall while one participant fires replay requests in parallel.
    let maxGap = 0
    let last = performance.now()
    const ticker = setInterval(() => {
      const now = performance.now()
      maxGap = Math.max(maxGap, now - last)
      last = now
    }, 5)
    const t0 = performance.now()
    const N = 40
    const results = await Promise.all(
      Array.from({ length: N }, () => owner.get(`/api/matches/${matchId}/replay`)),
    )
    const elapsed = performance.now() - t0
    clearInterval(ticker)
    const limited = results.filter((r) => r.status === 429).length
    console.log(
      `replay: ${actions} actions, ${N} requests in ${elapsed.toFixed(0)} ms, ` +
        `max event-loop gap ${maxGap.toFixed(0)} ms, ${limited} rate-limited`,
    )
    // Expected: some per-user limit on an endpoint that re-runs the whole game each time.
    expect(limited).toBeGreaterThan(0)
    await viewer.leave()
    await p.leave()
  })
})
