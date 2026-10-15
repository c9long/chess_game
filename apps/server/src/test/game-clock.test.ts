/**
 * Clocks, timeouts, abandon and shutdown with short test clocks (DEV_CLOCK_BASE_MS) and a
 * short reconnect grace.
 */
import { matchEvents, matches, matchPlayers } from '@game/db'
import { ROOM_NAMES } from '@game/protocol'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Browser,
  createLobby,
  createOptions,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  matchmakeError,
  type Player,
  startGameHarness,
} from './game-harness.ts'

const BASE_MS = 1500
let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness(
    { DEV_CLOCK_BASE_MS: String(BASE_MS), RECONNECT_GRACE_SECONDS: '0.3' },
    { botClient: bots },
  )
})

afterAll(async () => {
  await h.close()
})

async function startGame(
  browsers: Browser[],
  opts: { mode?: 'ffa' | 'teams'; timeControl?: '10+0' | '3+2'; botSeats?: (1 | 2 | 3)[] } = {},
): Promise<Player[]> {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, {
    name: 'Clock game',
    mode: opts.mode ?? 'ffa',
    timeControl: opts.timeControl ?? '10+0',
  })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  for (const seat of opts.botSeats ?? []) host.send('addBot', { seat, level: '600' })
  await host.waitState((s) => s.seats.every((x) => x.occupied))
  for (const p of players) p.send('setCiv', { civ: 'france' })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ === 'france')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

const bySeat = (players: Player[], seat: number) => players.find((p) => p.seat === seat) as Player

describe('clocks', () => {
  it('Teams 3+2: increments after moves, a flag fall freezes the seat, a team with no active seat loses', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]), {
      mode: 'teams',
      timeControl: '3+2',
    })
    const south = bySeat(players, 0)
    const north = bySeat(players, 2)
    expect(south.state.clock.incrementMs).toBe(2000)

    south.send('move', { move: greedyMove(south.state.positionString) })
    const afterSouth = await south.waitMessage('events', (e) => e.seq === 1)
    // South paid a few ms and gained the 2 s increment; West's clock runs now.
    expect(afterSouth.clock.remainingMs[0]).toBeGreaterThan(BASE_MS + 1500)
    expect(afterSouth.clock.remainingMs[0]).toBeLessThanOrEqual(BASE_MS + 2000)
    expect(afterSouth.clock.runningSeat).toBe(1)

    // West never moves: its flag falls (no increment), West is frozen, North is to move.
    const timeout = await south.waitMessage('events', (e) => e.action === 'timeout', 5_000)
    expect(timeout.seat).toBe(1)
    expect(timeout.events.map((e) => e.type)).toContain('frozen')
    expect(timeout.clock.remainingMs[1]).toBe(0)
    expect(timeout.seatToMove).toBe(2)
    await south.waitState((s) => s.seats[1]?.status === 'frozen')

    north.send('move', { move: greedyMove(north.state.positionString) })
    // East never moves either: W+E have no active seat left, S+N win.
    const over = await south.waitMessage('gameOver', () => true, 6_000)
    expect(over.result).toEqual({ type: 'teams_winner', team: 'south_north' })
    expect(over.placements).toEqual([1, 2, 1, 2])
    expect(over.endReason).toBe('team_eliminated')

    const db = h.server.ctx.db
    const mp = await db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, south.state.matchId))
      .orderBy(asc(matchPlayers.seat))
    expect(mp.map((p) => p.team)).toEqual([0, 1, 0, 1])
    expect(mp[1]).toMatchObject({ defeatReason: 'timeout' })
    expect(mp[3]).toMatchObject({ defeatReason: 'timeout' })
    const rows = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, south.state.matchId))
      .orderBy(asc(matchEvents.seq))
    const timeouts = rows.filter((r) => r.type === 'timeout')
    expect(timeouts.map((r) => r.seat)).toEqual([1, 3])
    expect(timeouts.every((r) => r.clockRemainingMs === 0)).toBe(true)
    for (const p of players) await p.leave()
  })
})

describe('reconnect grace', () => {
  it('abandons an in-game seat after the grace period (FFA: removed; off-turn, the running clock is untouched)', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = bySeat(players, 0)
    const west = bySeat(players, 1)
    west.drop()
    const abandon = await south.waitMessage('events', (e) => e.action === 'abandon', 3_000)
    expect(abandon.seat).toBe(1)
    expect(abandon.events.map((e) => e.type)).toEqual(['defeat', 'army_removed'])
    // Still South's turn, and South's clock kept running from the start of its turn.
    expect(abandon.seatToMove).toBe(0)
    expect(abandon.clock.runningSeat).toBe(0)
    expect(abandon.clock.remainingMs[0]).toBeLessThan(BASE_MS - 250)
    await south.waitState((s) => s.seats[1]?.status === 'removed')

    south.send('move', { move: greedyMove(south.state.positionString) })
    const next = await south.waitMessage('events', (e) => e.seq === 2)
    expect(next.seatToMove).toBe(2) // West is skipped

    // The others leave (consented): each leave abandons, the last player standing wins.
    await bySeat(players, 2).leave()
    await bySeat(players, 3).leave()
    const over = await south.waitMessage('gameOver')
    expect(over.result).toEqual({ type: 'ffa_winner', seat: 'south' })
    expect(over.placements[0]).toBe(1)
    const rows = await h.server.ctx.db
      .select({ type: matchEvents.type, seat: matchEvents.seat })
      .from(matchEvents)
      .where(eq(matchEvents.matchId, south.state.matchId))
    expect(
      rows
        .filter((r) => r.type === 'abandon')
        .map((r) => r.seat)
        .sort(),
    ).toEqual([1, 2, 3])
    expect(rows.some((r) => r.type === 'disconnect' && r.seat === 1)).toBe(true)
    await south.leave()
  })

  it('frees a lobby seat when its player does not come back', async () => {
    const host = await createLobby(await guest(h), { name: 'Grace lobby' })
    const other = await joinLobby(await guest(h), host.room.roomId)
    other.drop()
    await host.waitState((s) => s.seats[1]?.connected === false && s.seats[1]?.graceDeadline > 0)
    await host.waitState((s) => !s.seats[1]?.occupied, 3_000, 'seat freed')
    await host.leave()
  })
})

describe('graceful shutdown', () => {
  it('stops new rooms, closes lobbies and aborts games still running at the cap', async () => {
    bots.delayMs = 0
    const lobbyHost = await createLobby(await guest(h), { name: 'Idle lobby' })
    const human = await guest(h)
    const players = await startGame([human], { botSeats: [1, 2, 3] })
    const p = players[0] as Player
    const matchId = p.state.matchId
    const { aborted } = await h.server.ctx.game.drain(50)
    expect(aborted).toBe(1)
    const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'aborted', endReason: 'server_shutdown', rated: false })
    expect(lobbyHost.of('error').some((e) => e.code === 'maintenance')).toBe(true)
    const late = await guest(h)
    expect(await matchmakeError(late.sdk().create(ROOM_NAMES.match, createOptions()))).toBe(
      'maintenance',
    )
  })
})
