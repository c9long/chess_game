/** Shared helpers for the attack-timing.*.test.ts review tests. */
import { matchEvents, matches } from '@game/db'
import { asc, eq } from 'drizzle-orm'
import {
  type Browser,
  createLobby,
  type GameHarness,
  joinLobby,
  type Player,
} from './game-harness.ts'

export async function startTimedGame(
  browsers: Browser[],
  opts: {
    mode?: 'ffa' | 'teams'
    timeControl?: '10+0' | '3+2'
    botSeats?: (1 | 2 | 3)[]
    level?: string
  } = {},
): Promise<Player[]> {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, {
    name: 'Timing game',
    mode: opts.mode ?? 'ffa',
    timeControl: opts.timeControl ?? '10+0',
  })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  for (const seat of opts.botSeats ?? []) host.send('addBot', { seat, level: opts.level ?? '600' })
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'seats filled')
  for (const p of players) p.send('setCiv', { civ: 'france' })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ === 'france')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
  host.send('startGame')
  await host
    .waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
    .catch((e: Error) => {
      throw new Error(`${e.message}: ${JSON.stringify(host.of('error'))} phase=${host.state.phase}`)
    })
  return players
}

export const bySeat = (players: Player[], seat: number) =>
  players.find((p) => p.seat === seat) as Player

export async function matchRow(h: GameHarness, matchId: string) {
  const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
  return m
}

export async function eventRows(h: GameHarness, matchId: string) {
  return h.server.ctx.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .orderBy(asc(matchEvents.seq))
}
