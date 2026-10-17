/**
 * Attack review of spectating (watch room): ranked-delay leaks, the move log a late first
 * spectator gets, the spectator cap, and pre-auth watch room creation.
 */
import { matchMaker } from '@colyseus/core'
import { friendships } from '@game/db'
import { COLYSEUS_PATH, PROTOCOL_VERSION, SPECTATORS_MAX } from '@game/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pairOf } from '../social/friends.ts'
import {
  Browser,
  createLobby,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  Player,
  registered,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({ RECONNECT_GRACE_SECONDS: '30' }, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

async function watch(b: Browser, roomId: string, password?: string): Promise<Player> {
  const room = await b.sdk().joinById(roomId, {
    protocolVersion: PROTOCOL_VERSION,
    spectate: true,
    ...(password !== undefined ? { password } : {}),
  })
  const p = new Player(b, room)
  await p.waitMessage('welcome')
  return p
}

const CIVS = ['canada', 'usa', 'china', 'japan']

async function startRanked(): Promise<Player[]> {
  const browsers = await Promise.all([registered(h), registered(h), registered(h), registered(h)])
  const host = await createLobby(browsers[0] as Browser, { name: 'Attack watch', ranked: true })
  const players = [host]
  for (const b of browsers.slice(1)) players.push(await joinLobby(b, host.room.roomId))
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  players.forEach((p, i) => {
    p.send('setCiv', { civ: CIVS[i] })
  })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

async function playOne(players: Player[]) {
  const anyone = players[0] as Player
  const before = anyone.state.actionSeq
  const mover = players.find((p) => p.seat === anyone.state.seatToMove) as Player
  mover.send('move', { move: greedyMove(anyone.state.positionString) })
  for (const p of players) await p.waitState((s) => s.actionSeq > before, 5_000, 'move applied')
}

/** What the web client's live move log ends up with (lib/live-move-log.ts semantics). */
function clientLog(p: Player): number[] {
  let seqs: number[] = []
  for (const m of p.messages) {
    if (m.type === 'moveLog') {
      seqs = (m.payload as { entries: { seq: number }[] }).entries.map((e) => e.seq)
    } else if (m.type === 'events') {
      const seq = (m.payload as { seq: number }).seq
      const last = seqs.at(-1)
      if (last === undefined || seq > last) seqs.push(seq)
    }
  }
  return seqs
}

describe('ranked delay', () => {
  it('a first spectator who arrives mid-game gets a contiguous delayed move log', async () => {
    const players = await startRanked()
    const host = players[0] as Player
    // Three full rounds before anyone watches: the watch room is created now.
    for (let i = 0; i < 12; i++) await playOne(players)
    const viewer = await watch(await guest(h), host.room.roomId)
    await viewer.waitMessage('moveLog')
    await viewer.waitState((s) => s.actionSeq === 4, 5_000, 'round one shown')
    expect(clientLog(viewer)).toEqual([1, 2, 3, 4])
    // Three more rounds: rounds 2..4 become visible (actions 5..16).
    for (let i = 0; i < 12; i++) await playOne(players)
    await viewer.waitState((s) => s.actionSeq === 16, 5_000, 'round four shown')
    await sleep(200)
    // The state moved on, so the move log must have too, without holes.
    expect(clientLog(viewer)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    for (const p of [viewer, ...players]) await p.leave()
  })

  it('hides live draw-offer cooldowns while the view is delayed', async () => {
    const players = await startRanked()
    const host = players[0] as Player
    const viewer = await watch(await guest(h), host.room.roomId)
    await viewer.waitState((s) => s.phase === 'in_game' && s.delayRounds === 2)
    for (let i = 0; i < 8; i++) await playOne(players)
    const offerer = players.find((p) => p.seat === host.state.seatToMove) as Player
    offerer.send('offerDraw')
    await host.waitState((s) => s.drawOfferSeat !== -1, 5_000, 'offer')
    for (const p of players) {
      if (p.state.drawVotes[p.seat] === 0) p.send('respondDraw', { accept: false })
    }
    await host.waitState((s) => s.drawOfferSeat === -1, 5_000, 'declined')
    await sleep(200)
    // Spectators still see the start of the game (actionSeq 0) ...
    expect(viewer.state.actionSeq).toBe(0)
    // ... so they must not learn that a draw was just offered and declined.
    expect(viewer.state.drawCooldowns).toEqual([0, 0, 0, 0])
    for (const p of [viewer, ...players]) await p.leave()
  })

  it('does not show a live disconnect while the view is delayed', async () => {
    const players = await startRanked()
    const host = players[0] as Player
    const viewer = await watch(await guest(h), host.room.roomId)
    await viewer.waitState((s) => s.phase === 'in_game' && s.delayRounds === 2)
    for (let i = 0; i < 8; i++) await playOne(players)
    const victim = players[2] as Player
    const seat = victim.seat
    victim.drop()
    await host.waitState((s) => s.seats[seat]?.connected === false, 5_000, 'drop seen by players')
    await sleep(200)
    expect(viewer.state.actionSeq).toBe(0)
    // The delayed frame predates the drop.
    expect(viewer.state.seats[seat]?.connected).toBe(true)
    expect(viewer.state.seats[seat]?.graceDeadline).toBe(0)
    for (const p of [viewer, ...players]) if (p !== victim) await p.leave()
  })
})

describe('players out of a ranked game', () => {
  // Known gap, kept on purpose for now (TODO.md "Ranked: delay the view of players who are
  // out"): a player who resigned or was eliminated keeps their seat (they need it for the
  // result, the rating change and the rematch vote), so the match room still shows them the
  // game live. Delaying it needs a per-seat view; until then this is a todo, not a test.
  it.todo('a player who is out of a running ranked game sees it as delayed as spectators do')
})

describe('spectator cap', () => {
  it('one account cannot take every spectator place of a room', async () => {
    const host = await createLobby(await guest(h), { name: 'Hogged table' })
    const hog = await guest(h)
    const mine: Player[] = []
    let refused = ''
    for (let i = 0; i < SPECTATORS_MAX; i++) {
      try {
        mine.push(await watch(hog, host.room.roomId))
      } catch (err) {
        refused = String((err as Error).message)
        break
      }
    }
    // A few tabs at most, and they count as one place.
    expect(mine.length).toBeLessThanOrEqual(3)
    expect(refused).toBe('spectators_full')
    await host.waitState((s) => s.spectators === 1, 5_000, 'one account counted once')
    const other = await watch(await guest(h), host.room.roomId)
    await host.waitState((s) => s.spectators === 2, 5_000, 'the other spectator got in')
    for (const p of [other, ...mine]) await p.leave()
    await host.leave()
  })
})

describe('watch room creation', () => {
  it('an unauthenticated spectate request does not create a watch room for a challenge lobby', async () => {
    const host = await registered(h)
    const invited = await registered(h)
    const [lo, hi] = pairOf(host.userId, invited.userId)
    await h.server.ctx.db.insert(friendships).values({
      userA: lo,
      userB: hi,
      requestedBy: host.userId,
      status: 'accepted',
      acceptedAt: new Date(),
    })
    const res = await host.post('/api/challenges', {
      friendIds: [invited.userId],
      mode: 'ffa',
      timeControl: '3+2',
    })
    expect(res.status).toBe(201)
    const roomId = (res.body as { challenge: { roomId: string } }).challenge.roomId
    const hostPlayer = await joinLobby(host, roomId)
    const anon = new Browser(h)
    const r = await anon.post(`${COLYSEUS_PATH}/matchmake/joinById/${roomId}`, {
      protocolVersion: PROTOCOL_VERSION,
      spectate: true,
    })
    expect(r.status).toBeGreaterThanOrEqual(400)
    const match = matchMaker.getLocalRoomById(roomId) as unknown as { watch: unknown }
    const created = match.watch !== null
    await hostPlayer.leave()
    await waitFor(() => true)
    expect(created).toBe(false)
  })
})
