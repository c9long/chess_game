/**
 * Rematch (PLAN §3): after a game, a seated human proposes; the other humans accept or
 * decline within REMATCH_TIMEOUT_MS; bots come along; the players who accepted find their
 * seats and civs held in a fresh lobby (a new room, so a new match id); a ranked game's
 * rematch is ranked only if all four players accepted, else casual with the declined seat
 * open to anyone.
 */
import { matchMaker } from '@colyseus/core'
import { PROTOCOL_VERSION, REMATCH_VOTE } from '@game/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MatchRoom } from '../game/match-room.ts'
import {
  type Browser,
  createLobby,
  createSolo,
  FakeBotClient,
  type GameHarness,
  guest,
  joinLobby,
  matchmakeError,
  Player,
  playOut,
  registered,
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

const CIVS = ['canada', 'usa', 'china', 'japan']

/** Humans seated in seat order (host first), bots in the rest, civs picked, game started. */
async function startGame(
  browsers: Browser[],
  opts: { ranked?: boolean; bots?: number[] } = {},
): Promise<Player[]> {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, {
    name: 'Rematch table',
    ranked: opts.ranked ?? false,
  })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  for (const seat of opts.bots ?? []) host.send('addBot', { seat, level: '600' })
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  players.forEach((p, i) => {
    p.send('setCiv', { civ: CIVS[i] })
  })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.ready || x.isBot))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

/** Everyone but the first player resigns (FFA): the game is over. */
async function resignAllBut(players: Player[]) {
  const host = players[0] as Player
  for (const p of players.slice(1)) {
    p.send('resign')
    await host.waitState((s) => s.seats[p.seat]?.status !== 'active', 5_000, 'resigned')
  }
  for (const p of players) await p.waitState((s) => s.phase === 'finished', 10_000, 'finished')
}

function roomOf(p: Player): MatchRoom {
  return matchMaker.getLocalRoomById(p.room.roomId) as unknown as MatchRoom
}

async function join(b: Browser, roomId: string): Promise<Player> {
  return joinLobby(b, roomId)
}

describe('rematch', () => {
  it('solo: a new game with the same civs and bots starts by itself', async () => {
    const b = await guest(h)
    const old = await createSolo(b, { civ: 'mali', botLevel: '1200' })
    await old.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
    // Proposing before the end is refused.
    expect((await old.expectError('proposeRematch')).code).toBe('wrong_phase')
    const over = await playOut([old], 30_000)
    await old.waitState((s) => s.phase === 'finished')
    const botsBefore = old.state.seats.map((s) => [s.isBot, s.botLevel, s.civ])

    old.send('proposeRematch')
    const ready = await old.waitMessage('rematchEvent', (e) => e.type === 'ready', 5_000)
    expect(ready.ranked).toBe(false)
    await old.waitState((s) => s.rematchRoomId === ready.roomId)
    expect(old.state.rematchVotes).toEqual([1, -1, -1, -1])
    const fresh = await join(b, ready.roomId as string)
    expect(fresh.room.roomId).not.toBe(old.room.roomId)
    expect(fresh.seat).toBe(0)
    expect(fresh.state.seats.map((s) => [s.isBot, s.botLevel, s.civ])).toEqual(botsBefore)
    await fresh.waitState((s) => s.phase === 'in_game', 5_000, 'rematch started')
    expect(fresh.state.matchId).not.toBe(over.matchId)
    // A second proposal for the same game is refused (the lobby is open).
    expect((await old.expectError('proposeRematch')).code).toBe('wrong_phase')
    await old.leave()
    await fresh.leave()
  })

  it('casual: humans who accept get their seats and civs back, bots come along', async () => {
    const [a, b] = [await guest(h), await guest(h)]
    const players = await startGame([a, b], { bots: [2, 3] })
    const [pa, pb] = players as [Player, Player]
    // B resigns, then A: the bots finish the game.
    pb.send('resign')
    await pa.waitState((s) => s.seats[1]?.status !== 'active')
    pa.send('resign')
    for (const p of players) await p.waitState((s) => s.phase === 'finished', 20_000, 'finished')
    const seatsBefore = pa.state.seats.map((s) => [s.isBot, s.civ])

    pb.send('proposeRematch')
    await pa.waitMessage('rematchEvent', (e) => e.type === 'proposed' && e.seat === 1)
    await pa.waitState((s) => s.rematchSeat === 1 && s.rematchDeadline > Date.now())
    expect(pa.state.rematchVotes).toEqual([
      REMATCH_VOTE.pending,
      REMATCH_VOTE.accepted,
      REMATCH_VOTE.notVoter,
      REMATCH_VOTE.notVoter,
    ])
    // The proposer can't answer its own proposal; a second proposal is refused.
    expect((await pb.expectError('respondRematch', { accept: true })).code).toBe(
      'already_responded',
    )
    pa.send('respondRematch', { accept: true })
    const ready = await pa.waitMessage('rematchEvent', (e) => e.type === 'ready')
    expect(ready.ranked).toBe(false)
    const fb = await join(b, ready.roomId as string)
    // A's seat is held for A: the host can't fill it (or move anyone into it) meanwhile.
    expect((await fb.expectError('addBot', { seat: 0, level: '600' })).message).toMatch(/held for/)
    expect((await fb.expectError('swapSeats', { a: 0, b: 2 })).code).toBe('seat_occupied')
    const fa = await join(a, ready.roomId as string)
    expect([fa.seat, fb.seat]).toEqual([0, 1])
    await fa.waitState((s) => s.seats.every((x) => x.occupied))
    expect(fa.state.seats.map((s) => [s.isBot, s.civ])).toEqual(seatsBefore)
    expect(fa.state.ranked).toBe(false)
    expect(fa.state.phase).toBe('civ_select')
    // The proposer hosts the new lobby; nobody is ready yet.
    expect(fa.state.hostSeat).toBe(1)
    expect(fa.state.seats[0]?.ready).toBe(false)
    for (const p of [pa, pb, fa, fb]) await p.leave()
  })

  it('a decline, a leave or no answer counts as no; nobody accepting cancels', async () => {
    const [a, b, c] = [await guest(h), await guest(h), await guest(h)]
    const players = await startGame([a, b, c], { bots: [3] })
    const [pa, pb, pc] = players as [Player, Player, Player]
    for (const p of [pb, pc]) {
      p.send('resign')
      await pa.waitState((s) => s.seats[p.seat]?.status !== 'active')
    }
    pa.send('resign')
    for (const p of players) await p.waitState((s) => s.phase === 'finished', 20_000, 'finished')

    // B declines, C leaves the room: nobody else accepted, so no lobby.
    pa.send('proposeRematch')
    await pb.waitState((s) => s.rematchSeat === 0)
    pb.send('respondRematch', { accept: false })
    await pa.waitMessage('rematchEvent', (e) => e.type === 'declined' && e.seat === 1)
    await pc.leave()
    const cancelled = await pa.waitMessage('rematchEvent', (e) => e.type === 'cancelled')
    expect(cancelled.reason).toBe('nobody_accepted')
    await pa.waitState((s) => s.rematchSeat === -1 && s.rematchVotes.every((v) => v === -1))

    // Again (C is gone, so counted as declined at once); B doesn't answer in time: the
    // deadline counts it as no.
    pb.send('proposeRematch')
    await pa.waitState((s) => s.rematchSeat === 1)
    expect(pa.state.rematchVotes).toEqual([
      REMATCH_VOTE.pending,
      REMATCH_VOTE.accepted,
      REMATCH_VOTE.declined,
      REMATCH_VOTE.notVoter,
    ])
    ;(roomOf(pa) as unknown as { rematchTimedOut(): void }).rematchTimedOut()
    const again = await pa.waitMessage(
      'rematchEvent',
      (e) =>
        e.type === 'cancelled' &&
        pa.of('rematchEvent').filter((x) => x.type === 'cancelled').length === 2,
    )
    expect(again.reason).toBe('nobody_accepted')

    // The proposer leaving cancels a pending proposal.
    pa.send('proposeRematch')
    await pb.waitState((s) => s.rematchSeat === 0)
    await pa.leave()
    const left = await pb.waitMessage('rematchEvent', (e) => e.reason === 'proposer_left')
    expect(left.type).toBe('cancelled')
    // Three proposals per game at most.
    expect((await pb.expectError('proposeRematch')).code).toBe('wrong_phase')
    await pb.leave()
  })

  it('ranked: ranked again only if all four accept; a decline makes it casual with an open seat', async () => {
    const browsers = await Promise.all([registered(h), registered(h), registered(h), registered(h)])
    // All four accept: ranked.
    {
      const players = await startGame(browsers, { ranked: true })
      await resignAllBut(players)
      const [p0, p1, p2, p3] = players as [Player, Player, Player, Player]
      p2.send('proposeRematch')
      await p0.waitState((s) => s.rematchSeat === 2)
      for (const p of [p0, p1, p3]) p.send('respondRematch', { accept: true })
      const ready = await p0.waitMessage('rematchEvent', (e) => e.type === 'ready')
      expect(ready.ranked).toBe(true)
      const fresh = await join(browsers[0] as Browser, ready.roomId as string)
      expect(fresh.state.ranked).toBe(true)
      for (const p of [...players, fresh]) await p.leave()
    }
    // One declines: casual, their seat open to anyone (a guest even), the others held.
    {
      const players = await startGame(browsers, { ranked: true })
      await resignAllBut(players)
      const [p0, p1, p2, p3] = players as [Player, Player, Player, Player]
      p0.send('proposeRematch')
      await p1.waitState((s) => s.rematchSeat === 0)
      p1.send('respondRematch', { accept: true })
      p2.send('respondRematch', { accept: false })
      p3.send('respondRematch', { accept: true })
      const ready = await p0.waitMessage('rematchEvent', (e) => e.type === 'ready')
      expect(ready.ranked).toBe(false)
      const roomId = ready.roomId as string
      const f0 = await join(browsers[0] as Browser, roomId)
      expect(f0.state.ranked).toBe(false)
      expect(f0.state.seats[0]?.civ).toBe('canada')
      // Seats 1 and 3 are held: a newcomer gets North (the declined seat), the next is turned away.
      const g = await join(await guest(h), roomId)
      expect(g.seat).toBe(2)
      expect(await matchmakeError(joinLobby(await guest(h), roomId))).toBe('room_full')
      // The player who declined can't come back to their held seat (it's taken now).
      expect(await matchmakeError(joinLobby(browsers[2] as Browser, roomId))).toBe('room_full')
      const f3 = await join(browsers[3] as Browser, roomId)
      expect(f3.seat).toBe(3)
      expect(f3.state.seats[3]?.civ).toBe('japan')
      // Three seated; West is still held for its player.
      await f0.waitState((s) => s.seats.filter((x) => x.occupied).length === 3)
      expect(f0.state.seats[1]?.occupied).toBe(false)
      for (const p of [...players, f0, g, f3]) await p.leave()
    }
  })

  it('refuses rematch messages from spectators and in password lobbies keeps the password', async () => {
    const [a, b] = [await guest(h), await guest(h)]
    const host = await createLobby(a, { name: 'Locked rematch', password: 'pw123' })
    const pb = await joinLobby(b, host.room.roomId, 'pw123')
    for (const seat of [2, 3]) host.send('addBot', { seat, level: '600' })
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    host.send('setCiv', { civ: 'mali' })
    pb.send('setCiv', { civ: 'usa' })
    await host.waitState((s) => s.seats[0]?.civ === 'mali' && s.seats[1]?.civ === 'usa')
    host.send('setReady', { ready: true })
    pb.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true && s.seats[1]?.ready === true)
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game')
    const viewerB = await guest(h)
    const viewerRoom = await viewerB.sdk().joinById(host.room.roomId, {
      protocolVersion: PROTOCOL_VERSION,
      spectate: true,
      password: 'pw123',
    })
    const viewer = new Player(viewerB, viewerRoom)
    pb.send('resign')
    await host.waitState((s) => s.seats[1]?.status !== 'active')
    host.send('resign')
    await host.waitState((s) => s.phase === 'finished', 20_000)
    expect((await viewer.expectError('proposeRematch')).code).toBe('spectating')
    host.send('proposeRematch')
    pb.send('respondRematch', { accept: true })
    const ready = await host.waitMessage('rematchEvent', (e) => e.type === 'ready')
    // Held seats need no password; anyone else does (once a seat is free).
    const roomId = ready.roomId as string
    const fa = await join(a, roomId)
    const fb = await join(b, roomId)
    expect(fa.state.hasPassword).toBe(true)
    await fb.leave()
    await fa.waitState((s) => !s.seats[1]?.occupied)
    expect(await matchmakeError(joinLobby(await guest(h), roomId))).toBe('invalid_password')
    const other = await joinLobby(await guest(h), roomId, 'pw123')
    expect(other.seat).toBe(1)
    for (const p of [viewer, host, pb, fa, other]) await p.leave()
  })
})
