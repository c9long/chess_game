import { civilizations, civilizationVersions, matchPlayers } from '@game/db'
import { ENGLAND_ROSTER_V2 } from '@game/db/seed'
import { Game, type GameEvent } from '@game/rules'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resimulate } from '../game/persistence.ts'
import {
  type Browser,
  createLobby,
  type GameHarness,
  guest,
  joinLobby,
  type Player,
  playOut,
  startGameHarness,
} from './game-harness.ts'

// England civ version 2: four Prime Ministers replace the king, queen and knights.

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness({ RECONNECT_GRACE_SECONDS: '5' })
})

afterAll(async () => {
  await h.close()
})

async function startCasual(browsers: Browser[], civs: string[], mode: 'ffa' | 'teams') {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, { name: 'England', mode, ranked: false })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  for (const p of players) p.send('setCiv', { civ: civs[p.seat] })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ === civs[p.seat])
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

describe('England (civ version 2)', () => {
  it('the catalog holds England v1 (standard) and v2 (Prime Ministers)', async () => {
    const db = h.server.ctx.db
    const rows = await db
      .select({ version: civilizationVersions.version, roster: civilizationVersions.roster })
      .from(civilizationVersions)
      .innerJoin(civilizations, eq(civilizations.id, civilizationVersions.civId))
      .where(eq(civilizations.slug, 'england'))
      .orderBy(asc(civilizationVersions.version))
    expect(rows.map((r) => r.version)).toEqual([1, 2])
    expect((rows[0]?.roster as { leaders: string[] } | undefined)?.leaders).toEqual(['king'])
    expect(rows[1]?.roster).toEqual(ENGLAND_ROSTER_V2)
    expect(ENGLAND_ROSTER_V2.promotionOptions).not.toContain('prime_minister')
    // Other civs have only version 1.
    const canada = await db
      .select({ version: civilizationVersions.version })
      .from(civilizationVersions)
      .innerJoin(civilizations, eq(civilizations.id, civilizationVersions.civId))
      .where(eq(civilizations.slug, 'canada'))
    expect(canada.map((r) => r.version)).toEqual([1])
  })

  it('a lobby game with England plays v2, stores the version and re-simulates', async () => {
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const civs = ['england', 'canada', 'japan', 'mali']
    const players = await startCasual(browsers, civs, 'ffa')
    const host = players[0] as Player
    const matchId = host.state.matchId
    // The engine started England with four Prime Ministers on f1, h1, i1 and k1.
    const game = Game.fromPosition(host.state.positionString)
    const snap = game.snapshot()
    game.free()
    expect(snap.config.civs[0]).toEqual({ id: 'england', version: 2 })
    expect(snap.config.civs[1]).toEqual({ id: 'canada', version: 1 })
    expect(snap.leaderSquares[0]).toEqual(['f1', 'h1', 'i1', 'k1'])
    expect(host.state.positionString).toContain('civ=england.2,canada.1,japan.1,mali.1')

    const over = await playOut(players, 60_000)
    expect(['ffa_winner', 'ffa_move_limit_tie']).toContain(over.result.type)
    await host.waitState((st) => st.phase === 'finished')

    // England is out only once all four Prime Ministers are gone: every event batch seen by
    // a client, in order, with captures of South's Prime Ministers counted up to its defeat.
    const events: GameEvent[] = (players[1] as Player)
      .of('events')
      .flatMap((m) => m.events as GameEvent[])
    let pmCaptured = 0
    let defeated = false
    for (const e of events) {
      if (
        e.type === 'capture' &&
        e.captured.owner === 'south' &&
        e.captured.kind === 'prime_minister' &&
        !defeated
      ) {
        pmCaptured++
      }
      if (e.type === 'defeat' && e.seat === 'south') {
        defeated = true
        if (e.reason === 'leader_captured') expect(pmCaptured).toBe(4)
      }
    }
    // This greedy game (deterministic) takes all four Prime Ministers, one by one, before
    // England is out.
    expect(defeated).toBe(true)
    expect(pmCaptured).toBe(4)
    expect(over.placements[0]).toBe(4)

    const db = h.server.ctx.db
    const mp = await db
      .select({ seat: matchPlayers.seat, civVersion: matchPlayers.civVersion })
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(asc(matchPlayers.seat))
    expect(mp.map((p) => p.civVersion)).toEqual([2, 1, 1, 1])
    expect(await resimulate(db, matchId)).toBe(host.state.positionString)
    for (const p of players) await p.leave()
  }, 90_000)

  it('England is eliminated when its fourth Prime Minister falls (Teams)', async () => {
    // England in South and North (partners): greedy play until the game ends; any England
    // seat defeated by leader capture must have lost all four Prime Ministers first.
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const civs = ['england', 'usa', 'england', 'france']
    const players = await startCasual(browsers, civs, 'teams')
    const host = players[0] as Player
    const matchId = host.state.matchId
    await playOut(players, 60_000)
    await host.waitState((st) => st.phase === 'finished')
    const events: GameEvent[] = (players[0] as Player)
      .of('events')
      .flatMap((m) => m.events as GameEvent[])
    const lost = { south: 0, north: 0 } as Record<string, number>
    const leaderDefeats: string[] = []
    for (const e of events) {
      if (e.type === 'capture' && e.captured.kind === 'prime_minister') {
        lost[e.captured.owner] = (lost[e.captured.owner] ?? 0) + 1
      }
      if (e.type === 'defeat' && e.reason === 'leader_captured') {
        leaderDefeats.push(e.seat)
        if (e.seat === 'south' || e.seat === 'north') expect(lost[e.seat]).toBe(4)
      }
    }
    // This greedy game (deterministic) knocks South's England out by capturing all four.
    expect(leaderDefeats).toContain('south')
    expect(lost.south).toBe(4)
    const db = h.server.ctx.db
    const mp = await db
      .select({ civVersion: matchPlayers.civVersion })
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(asc(matchPlayers.seat))
    expect(mp.map((p) => p.civVersion)).toEqual([2, 1, 2, 1])
    expect(await resimulate(db, matchId)).toBe(host.state.positionString)
    for (const p of players) await p.leave()
  }, 90_000)
})
