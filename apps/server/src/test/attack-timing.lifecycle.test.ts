/**
 * Review: server restart mid-game, persistence failures at the end of a game, graceful
 * shutdown with games still running.
 */
import { matchPlayers } from '@game/db'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { MatchRecorder } from '../game/persistence.ts'
import { matchRow, startTimedGame } from './attack-timing.helpers.ts'
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

async function waitStatus(h: GameHarness, matchId: string, pred: (s: string) => boolean) {
  let status = ''
  for (let t = 0; t < 200; t++) {
    status = (await matchRow(h, matchId))?.status ?? ''
    if (pred(status)) return status
    await sleep(50)
  }
  return status
}

describe('restart while an old process is still running a game', () => {
  const harnesses: GameHarness[] = []
  afterAll(async () => {
    for (const x of harnesses) await x.close().catch(() => {})
  })

  it('a match aborted as server_restart is not resurrected as finished (with ratings) by the old room', async () => {
    const bots = new FakeBotClient()
    bots.delayMs = 30
    const oldProc = await startGameHarness({}, { botClient: bots })
    harnesses.push(oldProc)
    const players = await startTimedGame([await guest(oldProc)], { botSeats: [1, 2, 3] })
    const p = players[0] as Player
    const matchId = p.state.matchId
    // A new process boots against the same database (deploy overlapping a 45-minute drain,
    // or a supervisor restarting a hung-but-alive process): startup aborts in_progress rows.
    const newProc = await startGameHarness({}, { botClient: new FakeBotClient() })
    harnesses.push(newProc)
    expect((await matchRow(newProc, matchId))?.status).toBe('aborted')
    // The old room keeps going; the bots finish the game.
    await p.leave()
    await waitFor(() => oldProc.server.ctx.game.runningGames() === 0, 30_000, 'old game end')
    await sleep(500)
    const m = await matchRow(newProc, matchId)
    expect(m).toMatchObject({ status: 'aborted', endReason: 'server_restart', rated: false })
    const mp = await newProc.server.ctx.db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
    expect(mp.every((r) => r.placement === null)).toBe(true)
  })
})

describe('persistence failure at the end of a game', () => {
  let h: GameHarness
  afterAll(async () => {
    await h.close()
  })

  it('does not leave the match row in_progress when the final flush fails', async () => {
    h = await startGameHarness(
      { EVENT_FLUSH_INTERVAL_MS: '60000' },
      { botClient: new FakeBotClient() },
    )
    const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
    const p = players[0] as Player
    const matchId = p.state.matchId
    const orig = MatchRecorder.prototype.flush
    MatchRecorder.prototype.flush = async () => {
      throw new Error('db down')
    }
    try {
      await p.leave()
      await waitFor(() => h.server.ctx.game.runningGames() === 0, 20_000, 'game end')
      await sleep(1_500) // flushWithRetry backoff
    } finally {
      MatchRecorder.prototype.flush = orig
    }
    await sleep(300)
    const m = await matchRow(h, matchId)
    // Expected: aborted (persist_failed), like the room reported. Actual: stays in_progress
    // until the next process restart.
    expect(m?.status).not.toBe('in_progress')
  })
})

describe('graceful shutdown', () => {
  it('a game that finishes during the drain is recorded as finished and the drain returns promptly', async () => {
    const bots = new FakeBotClient()
    const h = await startGameHarness({}, { botClient: bots })
    try {
      const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
      const p = players[0] as Player
      const matchId = p.state.matchId
      bots.delayMs = 20
      const t0 = Date.now()
      const draining = h.server.ctx.game.drain(20_000, 50)
      await sleep(50)
      await p.leave() // bots finish the game during the drain
      const { aborted } = await draining
      expect(aborted).toBe(0)
      expect(Date.now() - t0).toBeLessThan(15_000)
      expect(await waitStatus(h, matchId, (s) => s !== 'in_progress')).toBe('finished')
    } finally {
      await h.close()
    }
  })

  it('stop() with a bot request in flight aborts the game and leaves no in_progress row', async () => {
    const bots = new FakeBotClient()
    const h = await startGameHarness({}, { botClient: bots })
    const players = await startTimedGame([await guest(h)], { botSeats: [1, 2, 3] })
    const p = players[0] as Player
    const matchId = p.state.matchId
    bots.delayMs = 2_000
    // South moves and stays seated (bots stop asking bot-service once no human plays), so
    // West (bot) now thinks for 2 s.
    p.send('move', { move: greedyMove(p.state.positionString) })
    await p.waitMessage('events', (e) => e.seq === 1)
    await sleep(100)
    await h.close()
    await sleep(2_200) // the late bot answer must not touch anything
    const { createDb, matches } = await import('@game/db')
    const { TEST_DATABASE_URL } = await import('./env.ts')
    const { db, close } = createDb(TEST_DATABASE_URL, { max: 1 })
    try {
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId))
      expect(m).toMatchObject({ status: 'aborted', endReason: 'server_shutdown' })
    } finally {
      await close()
    }
  })
})
