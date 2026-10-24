/**
 * The move log feed (`moveLog` on join and reconnect) and replays of finished matches
 * (`GET /api/matches/:id/replay`, participants only, rules version 2 only).
 */
import { civilizations, matches, matchPlayers } from '@game/db'
import {
  applyReplayAction,
  type MatchListResponse,
  type MatchReplayResponse,
  type ReplayAction,
} from '@game/protocol'
import { Game, type GameConfigInput, RULES_VERSION } from '@game/rules'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createLobby,
  createSolo,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  sleep,
  startGameHarness,
} from './game-harness.ts'

describe('move log and replays', () => {
  let h: GameHarness
  const bots = new FakeBotClient()
  const db = () => h.server.ctx.db

  async function finishedMatch(matchId: string) {
    let m: typeof matches.$inferSelect | undefined
    const deadline = Date.now() + 20_000
    while (m?.status !== 'finished' && m?.status !== 'aborted' && Date.now() < deadline) {
      await sleep(50)
      ;[m] = await db().select().from(matches).where(eq(matches.id, matchId))
    }
    return m
  }

  beforeAll(async () => {
    h = await startGameHarness({ RECONNECT_GRACE_SECONDS: '5' }, { botClient: bots })
  })

  afterAll(async () => {
    await h.close()
  })

  it('sends the game so far on reconnect, then replays the finished game to the same position', async () => {
    const creator = await guest(h)
    const p = await createSolo(creator, { mode: 'ffa' })
    await p.waitState((s) => s.phase === 'in_game')
    // Nothing to log before the first action.
    expect(p.of('moveLog')).toHaveLength(0)
    for (const seq of [4, 8]) {
      await p.waitState((s) => s.seatToMove === 0 && s.actionSeq === seq - 4)
      p.send('move', { move: greedyMove(p.state.positionString) })
      await p.waitMessage('events', (e) => e.seq === seq)
    }
    const live = p.of('events')

    p.drop()
    await sleep(50)
    await p.reconnect()
    const log = await p.waitMessage('moveLog')
    expect(log.entries.map((e) => e.seq)).toEqual(live.map((e) => e.seq))
    for (const [i, e] of log.entries.entries()) {
      const ev = live[i]
      expect(e).toEqual({
        seq: ev?.seq,
        action: ev?.action,
        seat: ev?.seat,
        notation: ev?.notation,
        events: ev?.events,
        positionString: ev?.positionString,
        // An untimed game has no clock times.
        clockMs: null,
      })
      expect(ev?.clockMs).toBeNull()
    }

    // Resigning ends the solo FFA game; the replay comes from the stored rows alone.
    p.send('resign')
    await p.waitState((s) => s.phase === 'finished', 10_000, 'finished')
    const matchId = p.state.matchId
    const final = p.state.positionString
    expect((await finishedMatch(matchId))?.status).toBe('finished')

    const list = (await creator.get('/api/matches')).body as unknown as MatchListResponse
    expect(list.matches.find((m) => m.id === matchId)?.rulesVersion).toBe(RULES_VERSION)

    const res = await creator.get(`/api/matches/${matchId}/replay`)
    expect(res.status).toBe(200)
    const replay = res.body as unknown as MatchReplayResponse
    expect(replay.config.mode).toBe('ffa')
    expect(replay.config.civs).toHaveLength(4)
    expect(replay.finalPosition).toBe(final)
    // Eight moves, South's resignation, and the draw between the bots that ends a solo game.
    expect(replay.actions.map((a) => a.action)).toEqual([
      ...Array(8).fill('move'),
      'resign',
      'agreed_draw',
    ])
    expect(replay.actions.slice(0, 8).map((a) => a.notation)).toEqual(live.map((e) => e.notation))

    // A client replays it the same way and lands on the same position, step by step.
    const game = Game.create(replay.config as unknown as GameConfigInput)
    try {
      replay.actions.forEach((a, i) => {
        const events = applyReplayAction(game, a as ReplayAction)
        if (i < 8) {
          expect(events).toEqual(live[i]?.events)
          expect(game.positionString()).toBe(live[i]?.positionString)
        }
      })
      expect(game.positionString()).toBe(final)
      expect(game.snapshot().isOver).toBe(true)
    } finally {
      game.free()
    }

    // Participants only: anyone else gets the same 404 as a match that doesn't exist.
    const stranger = await guest(h)
    expect((await stranger.get(`/api/matches/${matchId}/replay`)).status).toBe(404)
    expect((await creator.get('/api/matches/not-a-uuid/replay')).status).toBe(404)
    expect(
      (await creator.get('/api/matches/00000000-0000-4000-8000-000000000000/replay')).status,
    ).toBe(404)
    await p.leave()
  })

  it('timed games: each action carries the mover’s time left, live, on reconnect and in the replay', async () => {
    const creator = await guest(h)
    const host = await createLobby(creator, { name: 'Clocked', timeControl: '3+2' })
    for (const seat of [1, 2, 3]) host.send('addBot', { seat, level: '600' })
    await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'bots seated')
    host.send('setCiv', { civ: 'canada' })
    await host.waitState((s) => s.seats[0]?.civ === 'canada')
    host.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true)
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game', 10_000, 'in_game')
    await host.waitState((s) => s.seatToMove === 0 && s.actionSeq === 0)
    host.send('move', { move: greedyMove(host.state.positionString) })
    const mine = await host.waitMessage('events', (e) => e.seq === 1)
    // 3 minutes, minus the think time, plus the 2 s increment.
    expect(mine.clockMs).toBeGreaterThan(170_000)
    expect(mine.clockMs).toBeLessThanOrEqual(182_000)
    expect(mine.clockMs).toBe(Math.round(mine.clock.remainingMs[0]))
    // The bots' moves carry their own clocks.
    const bot = await host.waitMessage('events', (e) => e.seq === 2)
    expect(bot.seat).toBe(1)
    expect(typeof bot.clockMs).toBe('number')

    host.drop()
    await sleep(50)
    await host.reconnect()
    const log = await host.waitMessage('moveLog')
    expect(log.entries[0]?.clockMs).toBe(mine.clockMs)
    expect(log.entries.every((e) => typeof e.clockMs === 'number')).toBe(true)

    host.send('resign')
    const resign = await host.waitMessage('events', (e) => e.action === 'resign')
    expect(typeof resign.clockMs).toBe('number')
    await host.waitState((s) => s.phase === 'finished', 60_000, 'finished')
    const matchId = host.state.matchId
    expect((await finishedMatch(matchId))?.status).toBe('finished')
    const replay = (await creator.get(`/api/matches/${matchId}/replay`))
      .body as unknown as MatchReplayResponse
    expect(replay.actions[0]?.clockMs).toBe(mine.clockMs)
    const resigned = replay.actions.find((a) => a.action === 'resign')
    expect(resigned?.clockMs).toBe(resign.clockMs)
    await host.leave()
  }, 90_000)

  it('refuses games still in progress and games from the old 12×12 board', async () => {
    const creator = await guest(h)
    const p = await createSolo(creator)
    await p.waitState((s) => s.phase === 'in_game')
    const running = await creator.get(`/api/matches/${p.state.matchId}/replay`)
    expect(running.status).toBe(409)
    expect(running.body).toEqual({ error: 'NOT_FINISHED' })
    await p.leave()

    const [civ] = await db().select().from(civilizations).where(eq(civilizations.slug, 'canada'))
    const [old] = await db()
      .insert(matches)
      .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, status: 'finished' })
      .returning()
    if (!civ || !old) throw new Error('fixture failed')
    for (let seat = 0; seat < 4; seat++) {
      await db()
        .insert(matchPlayers)
        .values({
          matchId: old.id,
          seat,
          userId: seat === 0 ? creator.userId : null,
          botLevel: seat === 0 ? null : '600',
          civId: civ.id,
          civVersion: 1,
          placement: seat + 1,
        })
    }
    const v1 = await creator.get(`/api/matches/${old.id}/replay`)
    expect(v1.status).toBe(409)
    expect(v1.body).toEqual({ error: 'RULES_VERSION_UNSUPPORTED', rulesVersion: 1 })
  })
})
