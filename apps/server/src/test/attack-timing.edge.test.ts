/**
 * Review: clock edge cases — wall-clock steps, an off-turn abandon while a bot is thinking.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bySeat, startTimedGame } from './attack-timing.helpers.ts'
import {
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  type Player,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({ DEV_CLOCK_BASE_MS: '20000' }, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

async function endAll(players: Player[]) {
  bots.delayMs = 0
  for (const p of players) await p.leave()
  await waitFor(() => h.server.ctx.game.runningGames() === 0, 20_000, 'games over')
}

describe('wall-clock step', () => {
  it("a forward step of the system clock (NTP correction) does not burn the running player's time", async () => {
    bots.delayMs = 0
    const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
    const south = players[0] as Player
    const real = Date.now
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + 30_000)
    let ev: Awaited<ReturnType<typeof south.waitMessage<'events'>>>
    try {
      south.send('move', { move: greedyMove(south.state.positionString) })
      ev = await south.waitMessage('events', (e) => e.seq === 1)
    } finally {
      spy.mockRestore()
    }
    // Expected: a move with ~20 s left (only ~0 s of real time passed). Actual: South flags.
    expect(ev.action).toBe('move')
    await endAll(players)
  })
})

describe('off-turn abandon while a bot is thinking', () => {
  it("does not throw away the bot's in-flight request (one bot-service call per bot move)", async () => {
    const browsers = await Promise.all([guest(h), guest(h)])
    const players = await startTimedGame(browsers, { botSeats: [2, 3] })
    // seats: 0 host, 1 human, 2 bot, 3 bot
    const south = bySeat(players, 0)
    const west = bySeat(players, 1)
    south.send('move', { move: greedyMove(south.state.positionString) })
    await south.waitMessage('events', (e) => e.seq === 1)
    bots.delayMs = 400
    await west.waitState((st) => st.actionSeq === 1 && st.seatToMove === 1)
    west.send('move', { move: greedyMove(west.state.positionString) })
    await south.waitMessage('events', (e) => e.seq === 2)
    // North (bot) is thinking now.
    const callsBefore = bots.calls
    await sleep(200)
    await south.leave() // off-turn abandon (South) while North thinks
    const northMove = await west.waitMessage(
      'events',
      (e) => e.action === 'move' && e.seat === 2,
      3_000,
    )
    const calls = bots.calls - callsBefore
    expect(northMove.seat).toBe(2)
    // North's original request should be used, so the only new call is East's (after North's
    // move). Actual: North's request is aborted and re-sent, so North pays the time already
    // spent plus a whole new think (and bot-service does the work twice).
    expect(calls).toBeLessThanOrEqual(1)
    await endAll([west])
  })
})
