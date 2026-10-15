/**
 * Against the real bot-service (crates/bot-service). Skipped unless BOT_SERVICE_URL is set:
 *   cargo run --release -p bot-service   # listens on 127.0.0.1:7700
 *   BOT_SERVICE_URL=http://127.0.0.1:7700 pnpm --filter @game/server test
 */
import { Game, initRulesSync } from '@game/rules'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpBotClient } from '../game/bot-client.ts'
import {
  createLobby,
  type GameHarness,
  guest,
  type Player,
  playOut,
  startGameHarness,
} from './game-harness.ts'

const url = process.env.BOT_SERVICE_URL

describe.skipIf(!url)('real bot-service', () => {
  let h: GameHarness

  beforeAll(async () => {
    initRulesSync()
    h = await startGameHarness({ BOT_SERVICE_URL: url as string })
  })

  afterAll(async () => {
    await h?.close()
  })

  it('answers a legal move for the start position', async () => {
    const game = Game.create({ mode: 'ffa' })
    const client = new HttpBotClient(url as string, 5_000)
    const res = await client.requestMove(
      { position: game.positionString(), level: '600', clockMs: 60_000, incrementMs: 0 },
      new AbortController().signal,
    )
    expect(game.legalMoveNotations()).toContain(res.move)
    game.free()
  })

  it('plays a full game: one guest and three bots', async () => {
    const host: Player = await createLobby(await guest(h), { name: 'Real bots' })
    host.send('addBot', { seat: 1, level: '600' })
    host.send('addBot', { seat: 2, level: '900' })
    host.send('addBot', { seat: 3, level: '1200' })
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    host.send('setCiv', { civ: 'canada' })
    await host.waitState((s) => s.seats[0]?.civ === 'canada')
    host.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true)
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game', 5_000)
    const over = await playOut([host], 120_000)
    expect(over.result.type).toBeTruthy()
    await host.leave()
  }, 150_000)
})
