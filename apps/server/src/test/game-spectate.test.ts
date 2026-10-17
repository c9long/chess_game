/**
 * Spectating (PLAN §3): read-only spectators in a match's watch room. Who may watch (public,
 * password, challenge lobbies; not the room's own players), the cap, the spectator count,
 * that nothing a spectator sends reaches the game, the live mirror of casual and solo games,
 * the delayed view of ranked games (SPECTATOR_DELAY_ROUNDS full rounds behind) and the
 * Friends page list of friends' games.
 */
import { matchMaker } from '@colyseus/core'
import { friendships } from '@game/db'
import {
  type FriendGamesResponse,
  PROTOCOL_VERSION,
  type ServerMessages,
  SPECTATORS_MAX,
} from '@game/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pairOf } from '../social/friends.ts'
import {
  type Browser,
  createLobby,
  createSolo,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  matchmakeError,
  Player,
  playOut,
  registered,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({}, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

/** Watches a match room (`joinById(roomId, { spectate: true })`). */
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

async function befriend(a: Browser, b: Browser) {
  const [lo, hi] = pairOf(a.userId, b.userId)
  await h.server.ctx.db.insert(friendships).values({
    userA: lo,
    userB: hi,
    requestedBy: a.userId,
    status: 'accepted',
    acceptedAt: new Date(),
  })
}

const CIVS = ['canada', 'usa', 'china', 'japan']

/** Four registered players in a ranked lobby, ready, game started. */
async function startRanked(): Promise<Player[]> {
  const browsers = await Promise.all([registered(h), registered(h), registered(h), registered(h)])
  const host = await createLobby(browsers[0] as Browser, { name: 'Ranked watch', ranked: true })
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

/** The player to move plays a greedy move; resolves once every player saw it. */
async function playOne(players: Player[]) {
  const anyone = players[0] as Player
  const before = anyone.state.actionSeq
  const mover = players.find((p) => p.seat === anyone.state.seatToMove) as Player
  mover.send('move', { move: greedyMove(anyone.state.positionString) })
  for (const p of players) await p.waitState((s) => s.actionSeq > before, 5_000, 'move applied')
}

describe('watching a game', () => {
  it('mirrors a solo game live, read-only, and counts the spectator', async () => {
    bots.delayMs = 30
    const owner = await createSolo(await guest(h))
    await owner.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
    const viewer = await watch(await guest(h), owner.room.roomId)
    const welcome = (await viewer.waitMessage('welcome')) as ServerMessages['welcome']
    expect(welcome).toMatchObject({ seat: -1, isHost: false, spectator: true, delayRounds: 0 })
    // A room of its own: nothing reaches the match room.
    expect(viewer.room.roomId).not.toBe(owner.room.roomId)
    await viewer.waitState((s) => s.phase === 'in_game' && s.seats.every((x) => x.occupied))
    expect(viewer.state.seats.map((x) => x.sessionId)).toEqual(['', '', '', ''])
    expect(viewer.seat).toBe(-1)
    await owner.waitState((s) => s.spectators === 1, 5_000, 'spectator counted')
    await viewer.waitState((s) => s.spectators === 1)

    // Every game or lobby message is refused.
    for (const type of ['move', 'resign', 'offerDraw', 'setReady', 'startGame', 'proposeRematch']) {
      const err = await viewer.expectError(type, type === 'move' ? { move: 'e2e4' } : {})
      expect(err).toMatchObject({ code: 'spectating', requestType: type })
    }
    const clock = viewer.of('clock').length
    viewer.send('syncClock')
    await waitFor(() => viewer.of('clock').length > clock, 5_000, 'clock answer')

    // Live: the viewer follows every action and gets the result.
    bots.delayMs = 0
    const over = await playOut([owner], 30_000)
    const seen = await viewer.waitMessage('gameOver', () => true, 10_000)
    expect(seen.matchId).toBe(over.matchId)
    await viewer.waitState((s) => s.phase === 'finished')
    await owner.waitState((s) => s.phase === 'finished')
    expect(viewer.state.positionString).toBe(owner.state.positionString)
    const seqs = viewer.of('events').map((e) => e.seq)
    expect(seqs.at(-1)).toBe(owner.state.actionSeq)
    // No rematch votes reach spectators.
    expect(viewer.of('rematchEvent')).toHaveLength(0)

    await viewer.leave()
    await owner.waitState((s) => s.spectators === 0, 5_000, 'spectator gone')
    await owner.leave()
  })

  it('sends the game so far to a spectator who joins late', async () => {
    const owner = await createSolo(await guest(h))
    await owner.waitState((s) => s.phase === 'in_game', 10_000, 'in_game')
    owner.send('move', { move: greedyMove(owner.state.positionString) })
    await owner.waitState((s) => s.actionSeq >= 4, 10_000, 'a round')
    bots.delayMs = 200
    const viewer = await watch(await guest(h), owner.room.roomId)
    const log = await viewer.waitMessage('moveLog')
    expect(log.entries.length).toBeGreaterThanOrEqual(4)
    expect(log.entries.map((e) => e.seq)).toEqual(log.entries.map((_, i) => i + 1))
    bots.delayMs = 0
    await viewer.leave()
    await owner.leave()
  })

  it('refuses the room’s own players, kicked players and wrong passwords', async () => {
    const hostB = await guest(h)
    const host = await createLobby(hostB, { name: 'Secret watch', password: 'hunter2' })
    // The host is seated: no watching your own room.
    expect(
      await matchmakeError(
        hostB
          .sdk()
          .joinById(host.room.roomId, { protocolVersion: PROTOCOL_VERSION, spectate: true }),
      ),
    ).toBe('already_seated')
    const other = await guest(h)
    expect(
      await matchmakeError(
        other.sdk().joinById(host.room.roomId, {
          protocolVersion: PROTOCOL_VERSION,
          spectate: true,
          password: 'nope',
        }),
      ),
    ).toBe('invalid_password')
    const viewer = await watch(other, host.room.roomId, 'hunter2')
    expect(viewer.state.hasPassword).toBe(true)
    expect(viewer.state.phase).toBe('waiting')
    // A lobby's spectators see its seats fill.
    const joiner = await joinLobby(await guest(h), host.room.roomId, 'hunter2')
    await viewer.waitState((s) => s.seats.filter((x) => x.occupied).length === 2)
    // The host kicks the joiner: they may not watch either.
    host.send('kick', { seat: joiner.seat })
    await host.waitState((s) => s.seats.filter((x) => x.occupied).length === 1)
    expect(
      await matchmakeError(
        joiner.browser.sdk().joinById(host.room.roomId, {
          protocolVersion: PROTOCOL_VERSION,
          spectate: true,
          password: 'hunter2',
        }),
      ),
    ).toBe('kicked')
    // Unknown rooms.
    expect(
      await matchmakeError(
        other.sdk().joinById('nosuchroom', { protocolVersion: PROTOCOL_VERSION, spectate: true }),
      ),
    ).toBe('room_not_found')
    await viewer.leave()
    await host.leave()
  })

  it('lets only invitees and the host’s friends watch a challenge lobby', async () => {
    const host = await registered(h)
    const invited = await registered(h)
    const hostFriend = await registered(h)
    const stranger = await registered(h)
    await befriend(host, invited)
    await befriend(host, hostFriend)
    const res = await host.post('/api/challenges', {
      friendIds: [invited.userId],
      mode: 'ffa',
      timeControl: '3+2',
    })
    expect(res.status).toBe(201)
    const roomId = (res.body as { challenge: { roomId: string } }).challenge.roomId
    const hostPlayer = await joinLobby(host, roomId)
    expect(hostPlayer.state.inviteOnly).toBe(true)
    const watchErr = (b: Browser) =>
      matchmakeError(
        b.sdk().joinById(roomId, { protocolVersion: PROTOCOL_VERSION, spectate: true }),
      )
    expect(await watchErr(stranger)).toBe('not_invited')
    expect(await watchErr(await guest(h))).toBe('not_invited')
    const a = await watch(invited, roomId)
    const b = await watch(hostFriend, roomId)
    await hostPlayer.waitState((s) => s.spectators === 2, 5_000, 'two spectators')
    await a.leave()
    await b.leave()
    await hostPlayer.leave()
  })

  it(`admits at most ${SPECTATORS_MAX} spectators, counted per account`, async () => {
    const host = await createLobby(await guest(h), { name: 'Crowded table' })
    const fans = await Promise.all(Array.from({ length: SPECTATORS_MAX }, () => guest(h)))
    const viewers: Player[] = []
    for (const fan of fans) viewers.push(await watch(fan, host.room.roomId))
    await host.waitState((s) => s.spectators === SPECTATORS_MAX, 5_000, 'full house')
    const listed = await matchMaker.query({ name: 'match', roomId: host.room.roomId })
    expect(listed[0]?.metadata).toMatchObject({ spectators: SPECTATORS_MAX })
    expect(
      await matchmakeError(
        (await guest(h)).sdk().joinById(host.room.roomId, {
          protocolVersion: PROTOCOL_VERSION,
          spectate: true,
        }),
      ),
    ).toBe('spectators_full')
    // Someone already watching may still open it in another tab (still one place).
    viewers.push(await watch(fans[0] as Browser, host.room.roomId))
    await sleep(200)
    expect(host.state.spectators).toBe(SPECTATORS_MAX)
    await viewers.pop()?.leave()
    // A place frees up when someone stops watching.
    await viewers.pop()?.leave()
    await host.waitState((s) => s.spectators === SPECTATORS_MAX - 1, 5_000, 'one left')
    viewers.push(await watch(await guest(h), host.room.roomId))
    for (const v of viewers) await v.leave()
    await host.leave()
  })

  it('lets only its own account use a spectator’s reconnection token', async () => {
    const host = await createLobby(await guest(h), { name: 'Token table' })
    const fan = await guest(h)
    const viewer = await watch(fan, host.room.roomId)
    await host.waitState((s) => s.spectators === 1)
    const token = viewer.room.reconnectionToken
    viewer.drop()
    const thief = await guest(h)
    expect(await matchmakeError(thief.sdk().reconnect(token))).toBe('not_seated')
    await viewer.reconnect()
    await viewer.waitMessage('welcome')
    expect(viewer.room.connection.isOpen).toBe(true)
    await viewer.leave()
    await host.leave()
  })

  it('stops someone watching when they lose the right to (suspension, revoked invite)', async () => {
    const host = await createLobby(await guest(h), { name: 'Removed table' })
    const fan = await guest(h)
    const viewer = await watch(fan, host.room.roomId)
    await host.waitState((s) => s.spectators === 1)
    const room = matchMaker.getLocalRoomById(host.room.roomId) as unknown as {
      dropSpectator(userId: string): void
    }
    room.dropSpectator(fan.userId)
    await host.waitState((s) => s.spectators === 0, 5_000, 'spectator removed')
    await waitFor(() => viewer.room.connection.isOpen === false, 5_000)
    await host.leave()
  })
})

describe('ranked games', () => {
  it('show spectators the game two full rounds late, with no live offers or clocks', async () => {
    const players = await startRanked()
    const host = players[0] as Player
    const viewer = await watch(await guest(h), host.room.roomId)
    const welcome = await viewer.waitMessage('welcome')
    expect(welcome.delayRounds).toBe(2)
    await viewer.waitState((s) => s.phase === 'in_game' && s.delayRounds === 2)
    const start = viewer.state.positionString
    expect(start).toBe(host.state.positionString)
    expect(viewer.state.clock.runningSeat).toBe(-1)

    // Two full rounds (8 moves): spectators still see the start.
    const positions: string[] = [start]
    for (let i = 0; i < 8; i++) {
      await playOne(players)
      positions.push(host.state.positionString)
    }
    // A draw offer is not shown to spectators while delayed.
    const offerer = players.find((p) => p.seat === host.state.seatToMove) as Player
    offerer.send('offerDraw')
    await host.waitState((s) => s.drawOfferSeat !== -1, 5_000, 'offer')
    await sleep(150)
    expect(viewer.state.actionSeq).toBe(0)
    expect(viewer.state.positionString).toBe(start)
    expect(viewer.state.drawOfferSeat).toBe(-1)
    expect(viewer.of('events')).toHaveLength(0)
    expect(viewer.of('drawEvent')).toHaveLength(0)
    for (const p of players) {
      if (p.state.drawVotes[p.seat] === 0) p.send('respondDraw', { accept: false })
    }
    await host.waitState((s) => s.drawOfferSeat === -1, 5_000, 'offer declined')

    // A third round: the first round becomes visible, and only it.
    for (let i = 0; i < 4; i++) {
      await playOne(players)
      positions.push(host.state.positionString)
    }
    await viewer.waitState((s) => s.actionSeq === 4, 5_000, 'first round shown')
    expect(viewer.state.positionString).toBe(positions[4])
    expect(viewer.state.clock.runningSeat).toBe(-1)
    expect(viewer.of('events').map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(viewer.of('events').every((e) => e.clock.runningSeat === -1)).toBe(true)
    // A spectator joining now gets the same delayed move log.
    const late = await watch(await guest(h), host.room.roomId)
    const log = await late.waitMessage('moveLog')
    expect(log.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4])

    // Three players resign: the game is over and spectators see all of it at once.
    for (const p of players.slice(1)) {
      p.send('resign')
      await host.waitState((s) => s.seats[p.seat]?.status !== 'active', 5_000, 'resigned')
    }
    const over = await viewer.waitMessage('gameOver', () => true, 10_000)
    expect(over.result.type).toBe('ffa_winner')
    await viewer.waitState((s) => s.phase === 'finished' && s.delayRounds === 0)
    expect(viewer.state.positionString).toBe(host.state.positionString)
    const full = viewer.of('moveLog').at(-1)
    expect(full?.entries.length).toBe(host.state.actionSeq)
    for (const p of [viewer, late, ...players]) await p.leave()
  })
})

describe('GET /api/live/friends', () => {
  it('lists the running games of your friends that you may watch', async () => {
    const a = await registered(h)
    const friend = await registered(h)
    const stranger = await registered(h)
    await befriend(a, friend)
    bots.delayMs = 100
    const game = await createSolo(a)
    await game.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
    const res = await friend.get('/api/live/friends')
    expect(res.status).toBe(200)
    const games = (res.body as unknown as FriendGamesResponse).games
    expect(games).toEqual([
      expect.objectContaining({
        roomId: game.room.roomId,
        friends: [a.name],
        solo: true,
        ranked: false,
        locked: false,
      }),
    ])
    expect(
      ((await stranger.get('/api/live/friends')).body as unknown as FriendGamesResponse).games,
    ).toEqual([])
    const g = await guest(h)
    expect(
      ((await g.get('/api/live/friends')).body as unknown as FriendGamesResponse).games,
    ).toEqual([])
    expect(
      (await new (await import('./game-harness.ts')).Browser(h).get('/api/live/friends')).status,
    ).toBe(401)
    bots.delayMs = 0
    await game.leave()
  })
})
