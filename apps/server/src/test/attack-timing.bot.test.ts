/**
 * Review: bot turns against a slow / unreachable bot-service (real HttpBotClient over HTTP),
 * and several bots chaining with no humans.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bySeat, eventRows, matchRow, startTimedGame } from './attack-timing.helpers.ts'
import {
  type GameHarness,
  greedyMove,
  guest,
  type Player,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

const BASE_MS = 1500

/** A bot-service that accepts the request and then never answers (hung / overloaded). */
let hung: Server
let hungUrl: string
let hungRequests = 0

beforeAll(async () => {
  hung = createServer((req) => {
    hungRequests++
    req.resume()
    // never respond
  })
  await new Promise<void>((r) => hung.listen(0, '127.0.0.1', () => r()))
  hungUrl = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`
})

afterAll(async () => {
  hung.closeAllConnections()
  await new Promise<void>((r) => hung.close(() => r()))
})

describe('slow bot-service', () => {
  let h: GameHarness
  beforeAll(async () => {
    h = await startGameHarness({
      DEV_CLOCK_BASE_MS: String(BASE_MS),
      BOT_SERVICE_URL: hungUrl,
      // default BOT_REQUEST_TIMEOUT_MS (4000) — longer than the bot's remaining clock
    })
  })
  afterAll(async () => {
    await h.close()
  })

  it('a bot whose service hangs plays a fallback move before its own flag falls', async () => {
    const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
    const south = bySeat(players, 0)
    south.send('move', { move: greedyMove(south.state.positionString) })
    // West (bot) is to move with 1.5 s on its clock; bot-service never answers.
    const next = await south.waitMessage('events', (e) => e.seq === 2, 8_000)
    expect(hungRequests).toBeGreaterThan(0)
    // Expected: a local fallback move within the bot's clock. Actual: the bot flags.
    expect(next.action).toBe('move')
    expect(next.seat).toBe(1)
    await south.leave()
    await waitFor(() => h.server.ctx.game.runningGames() === 0, 20_000, 'game end')
  })
})

describe('unreachable bot-service and bot chaining', () => {
  let h: GameHarness
  beforeAll(async () => {
    // Port 9 (discard) on loopback: connection refused immediately.
    h = await startGameHarness({ BOT_SERVICE_URL: 'http://127.0.0.1:9' })
  })
  afterAll(async () => {
    await h.close()
  })

  it('three bots chain to the end of the game after the only human leaves; the match is finished and replayable', async () => {
    const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
    const south = players[0] as Player
    const matchId = south.state.matchId
    await south.leave() // consented leave: abandon; the bots play on alone
    await waitFor(() => h.server.ctx.game.runningGames() === 0, 30_000, 'bot-only game to end')
    await waitFor(() => h.server.ctx.game.rooms.size === 0, 10_000, 'room disposed')
    const m = await matchRow(h, matchId)
    expect(m?.status).toBe('finished')
    const rows = await eventRows(h, matchId)
    expect(rows.some((r) => r.type === 'game_end')).toBe(true)
    // Seq is gap-free and starts at 1.
    rows.forEach((r, i) => {
      expect(r.seq).toBe(i + 1)
    })
    expect(h.server.ctx.game.seats.size).toBe(0)
  })
})
