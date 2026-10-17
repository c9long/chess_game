/**
 * Review tests: spectator views created mid-game, and replays of FFA / Teams / England /
 * timeout games matching the live game and the live move log.
 */
import {
  applyReplayAction,
  type MatchReplayResponse,
  PROTOCOL_VERSION,
  type ReplayAction,
} from '@game/protocol'
import { Game, type GameConfigInput } from '@game/rules'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Browser,
  createLobby,
  createSolo,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  Player,
  playOut,
  registered,
  sleep,
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

async function watch(b: Browser, roomId: string): Promise<Player> {
  const room = await b.sdk().joinById(roomId, { protocolVersion: PROTOCOL_VERSION, spectate: true })
  const p = new Player(b, room)
  await p.waitMessage('welcome')
  return p
}

const CIVS = ['canada', 'usa', 'china', 'japan']

async function startRanked(): Promise<Player[]> {
  const browsers = await Promise.all([registered(h), registered(h), registered(h), registered(h)])
  const host = await createLobby(browsers[0] as Browser, { name: 'Ranked late', ranked: true })
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

async function waitFinished(p: Player) {
  await p.waitState((s) => s.phase === 'finished', 30_000, 'finished')
  // The result is recorded after the re-simulation check.
  await p.waitMessage('gameOver', () => true, 30_000)
}

async function fetchReplay(b: Browser, matchId: string): Promise<MatchReplayResponse> {
  let res = await b.get(`/api/matches/${matchId}/replay`)
  const deadline = Date.now() + 10_000
  while (res.status === 409 && Date.now() < deadline) {
    await sleep(50)
    res = await b.get(`/api/matches/${matchId}/replay`)
  }
  expect(res.status).toBe(200)
  return res.body as unknown as MatchReplayResponse
}

/** Replays like the browser does; checks every step against the live move log. */
function checkReplayAgainstLive(replay: MatchReplayResponse, live: Player) {
  const log = live.of('events')
  const game = Game.create(replay.config as unknown as GameConfigInput)
  try {
    const positions: string[] = []
    for (const a of replay.actions) {
      applyReplayAction(game, a as ReplayAction)
      positions.push(game.positionString())
    }
    expect(game.positionString()).toBe(replay.finalPosition)
    expect(game.positionString()).toBe(live.state.positionString)
    return { positions, log }
  } finally {
    game.free()
  }
}

describe('spectator view created mid-game (ranked)', () => {
  it('sends every action once it may be shown, with no gap in the move log', async () => {
    const players = await startRanked()
    const host = players[0] as Player
    // Three full rounds before anyone watches: the watch room is created now.
    for (let i = 0; i < 12; i++) await playOne(players)
    const viewer = await watch(await guest(h), host.room.roomId)
    const log = await viewer.waitMessage('moveLog')
    expect(log.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    // One more round: actions 5..8 become visible to spectators.
    for (let i = 0; i < 4; i++) await playOne(players)
    await viewer.waitState((s) => s.actionSeq === 8, 5_000, 'second round shown')
    await sleep(200)
    expect(viewer.of('events').map((e) => e.seq)).toEqual([5, 6, 7, 8])
    for (const p of [viewer, ...players]) await p.leave()
  })
})

describe('replays match the live game', () => {
  it('Teams solo with England, played out', async () => {
    const b = await guest(h)
    const p = await createSolo(b, { mode: 'teams', civ: 'england', botLevel: '1200' })
    await p.waitState((s) => s.phase === 'in_game')
    await playOut([p], 60_000)
    await waitFinished(p)
    const replay = await fetchReplay(b, p.state.matchId)
    expect(replay.config.mode).toBe('teams')
    expect(replay.config.civs[0]?.id).toBe('england')
    const { positions, log } = checkReplayAgainstLive(replay, p)
    // The live move log and the replay agree action for action.
    expect(replay.actions.map((a) => a.action)).toEqual(log.map((e) => e.action))
    expect(positions).toEqual(log.map((e) => e.positionString))
    await p.leave()
  })

  it('FFA solo ended by resignation: live log and replay agree', async () => {
    const b = await guest(h)
    const p = await createSolo(b, { mode: 'ffa', civ: 'england' })
    await p.waitState((s) => s.phase === 'in_game')
    await p.waitState((s) => s.seatToMove === 0)
    p.send('move', { move: greedyMove(p.state.positionString) })
    await p.waitState((s) => s.actionSeq >= 4 && s.seatToMove === 0, 10_000)
    p.send('resign')
    await waitFinished(p)
    const replay = await fetchReplay(b, p.state.matchId)
    const { positions, log } = checkReplayAgainstLive(replay, p)
    // The solo end (agreed draw) is folded into the resign entry live.
    expect(replay.actions.at(-1)?.action).toBe('agreed_draw')
    expect(log.at(-1)?.positionString).toBe(positions.at(-1))
    await p.leave()
  })

  it('Teams lobby: a team resignation accepted by the partner', async () => {
    const bs = [await guest(h), await guest(h), await guest(h), await guest(h)]
    const host = await createLobby(bs[0] as Browser, { name: 'Teams replay', mode: 'teams' })
    const ps = [host]
    for (const b of bs.slice(1)) ps.push(await joinLobby(b, host.room.roomId))
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    const civs = ['england', 'usa', 'china', 'england']
    ps.forEach((p, i) => {
      p.send('setCiv', { civ: civs[i] })
    })
    for (const p of ps) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
    for (const p of ps) p.send('setReady', { ready: true })
    await host.waitState((s) => s.seats.every((x) => x.ready))
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game')
    for (let i = 0; i < 6; i++) {
      const s = host.state
      const mover = ps.find((x) => x.seat === s.seatToMove)
      const before = s.actionSeq
      if (mover) mover.send('move', { move: greedyMove(s.positionString) })
      await host.waitState((x) => x.actionSeq > before, 10_000)
    }
    const south = ps.find((p) => p.seat === 0) as Player
    const north = ps.find((p) => p.seat === 2) as Player
    south.send('resign')
    await north.waitState((s) => s.teamResignSeat[0] === 0, 5_000, 'proposal')
    north.send('respondResign', { accept: true })
    await waitFinished(host)
    const replay = await fetchReplay(bs[0] as Browser, host.state.matchId)
    const { positions, log } = checkReplayAgainstLive(replay, host)
    expect(replay.actions.filter((x) => x.action === 'resign')).toHaveLength(1)
    expect(log.map((e) => e.action)).toEqual(replay.actions.map((x) => x.action))
    expect(log.map((e) => e.positionString)).toEqual(positions)
    for (const p of ps) await p.leave()
  })
})

describe('replay of a timeout', () => {
  let ht: GameHarness
  const bots2 = new FakeBotClient()
  beforeAll(async () => {
    ht = await startGameHarness({ DEV_CLOCK_BASE_MS: '1500' }, { botClient: bots2 })
  })
  afterAll(async () => {
    await ht.close()
  })

  it('FFA lobby where the human runs out of time', async () => {
    const [a, c] = [await guest(ht), await guest(ht)]
    const host = await createLobby(a, { name: 'Timeout replay', timeControl: '3+2' })
    const pc = await joinLobby(c, host.room.roomId)
    for (const seat of [2, 3]) host.send('addBot', { seat, level: '600' })
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    host.send('setCiv', { civ: 'canada' })
    pc.send('setCiv', { civ: 'england' })
    await host.waitState((s) => s.seats[0]?.civ === 'canada' && s.seats[1]?.civ === 'england')
    host.send('setReady', { ready: true })
    pc.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true && s.seats[1]?.ready === true)
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game')
    // South never moves: it times out; West plays on until the end.
    await host.waitState((s) => s.seats[0]?.status !== 'active', 10_000, 'south timed out')
    await playOut([pc], 60_000)
    await waitFinished(host)
    const replay = await fetchReplay(a, host.state.matchId)
    expect(replay.actions.some((x) => x.action === 'timeout')).toBe(true)
    const { positions, log } = checkReplayAgainstLive(replay, host)
    expect(log.map((e) => e.action)).toEqual(replay.actions.map((x) => x.action))
    expect(log.map((e) => e.positionString)).toEqual(positions)
    for (const p of [host, pc]) await p.leave()
  })
})
