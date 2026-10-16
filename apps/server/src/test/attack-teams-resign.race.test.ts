/**
 * Adversarial tests for Teams resignation votes: answers from the wrong seats, double
 * answers, proposals in the wrong phase or from frozen seats, races with leaves, draws and
 * fallen flags, stale bot answers, and re-simulation from the stored rows.
 */
import { matchEvents, matches, matchPlayers } from '@game/db'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resimulate } from '../game/persistence.ts'
import {
  type Browser,
  createLobby,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  type Player,
  sleep,
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness(
    { RECONNECT_GRACE_SECONDS: '5', BOT_MIN_MOVE_MS: '300' },
    { botClient: bots },
  )
})

afterAll(async () => {
  await h.close()
})

const CIVS = ['canada', 'usa', 'china', 'japan']

async function startGame(
  humans: Browser[],
  opts: { mode?: 'ffa' | 'teams'; botSeats?: (1 | 2 | 3)[] } = {},
): Promise<Player[]> {
  const [first, ...rest] = humans
  const host = await createLobby(first as Browser, {
    name: 'Team resign attack',
    mode: opts.mode ?? 'teams',
    timeControl: '10+0',
  })
  for (const seat of opts.botSeats ?? []) host.send('addBot', { seat, level: '1200' })
  await host.waitState((s) => (opts.botSeats ?? []).every((i) => s.seats[i]?.isBot))
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  players.forEach((p, i) => {
    p.send('setCiv', { civ: CIVS[i] })
  })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ !== '')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

const fourGuests = () => Promise.all([guest(h), guest(h), guest(h), guest(h)])

function at(players: Player[], seat: number): Player {
  const p = players.find((x) => x.seat === seat)
  if (!p) throw new Error(`no player at seat ${seat}`)
  return p
}

async function moveOnce(players: Player[]): Promise<void> {
  const s = (players[0] as Player).state
  const mover = at(players, s.seatToMove)
  const m = greedyMove(s.positionString)
  if (!m) throw new Error('no legal move')
  const seq = s.actionSeq
  mover.send('move', { move: m })
  await (players[0] as Player).waitState((x) => x.actionSeq > seq, 5_000, 'move applied')
}

async function rowsOf(matchId: string) {
  return h.server.ctx.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .orderBy(asc(matchEvents.seq))
}

async function seatsOf(matchId: string) {
  return h.server.ctx.db
    .select()
    .from(matchPlayers)
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(asc(matchPlayers.seat))
}

async function settledMatch(matchId: string) {
  let m: typeof matches.$inferSelect | undefined
  for (let i = 0; i < 300 && (m === undefined || m.status === 'in_progress'); i++) {
    ;[m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    if (m?.status === 'in_progress') await sleep(20)
  }
  return m
}

async function leaveAll(players: Player[]) {
  for (const p of players) await p.leave()
}

// biome-ignore lint/suspicious/noExplicitAny: reaching into the room's private state
type AnyRoom = any

function roomOf(roomId: string): AnyRoom {
  for (const r of h.server.ctx.game.rooms) {
    if ((r as AnyRoom).roomId === roomId) return r
  }
  throw new Error('room not found')
}

function flagFallsWithTimerPending(room: AnyRoom) {
  clearTimeout(room.flagTimer)
  room.armFlagTimer = () => {}
  const clock = room.gameClock
  clock.remaining[clock.running] = 0
}

describe('answers from the wrong seats', () => {
  it('a double accept resigns once; the second answer is refused', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    const matchId = south.state.matchId
    north.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 2)
    south.send('respondResign', { accept: true })
    south.send('respondResign', { accept: true })
    south.send('respondResign', { accept: false })
    await south.waitState((s) => s.phase === 'finished')
    await sleep(100)
    expect(south.of('resignEvent').filter((e) => e.type === 'accepted')).toHaveLength(1)
    expect(south.of('resignEvent').filter((e) => e.type === 'declined')).toHaveLength(0)
    expect(south.of('error').map((e) => e.code)).toEqual(['wrong_phase', 'wrong_phase'])
    const m = await settledMatch(matchId)
    expect(m?.status).toBe('finished')
    const rows = await rowsOf(matchId)
    expect(rows.filter((r) => r.type === 'resign')).toHaveLength(1)
    expect(rows.filter((r) => r.type === 'resign_response')).toHaveLength(1)
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })

  it('decline then accept in the same tick: the accept finds no proposal', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    south.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    north.send('respondResign', { accept: false })
    north.send('respondResign', { accept: true })
    north.send('resign') // now its own proposal (no cooldown for North)
    await south.waitState((s) => s.teamResignSeat[0] === 2)
    await sleep(50)
    expect(north.of('error').map((e) => e.code)).toEqual(['no_resign_proposal'])
    expect(south.state.phase).toBe('in_game')
    expect(south.state.teamResignCooldowns).toEqual([2, 0, 0, 0])
    // South (on cooldown) may still agree to North's proposal: that resigns the team.
    south.send('respondResign', { accept: true })
    const over = await south.waitMessage('gameOver')
    expect(over.endReason).toBe('team_resigned')
    expect(over.placements).toEqual([2, 1, 2, 1])
    await leaveAll(players)
  })

  it('opponents and proposers cannot answer another team’s or their own proposal', async () => {
    const players = await startGame(await fourGuests())
    const [south, west, north, east] = [0, 1, 2, 3].map((i) => at(players, i)) as [
      Player,
      Player,
      Player,
      Player,
    ]
    south.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    // West/East have no proposal: their answers never reach South–North's vote.
    expect((await west.expectError('respondResign', { accept: true })).code).toBe(
      'no_resign_proposal',
    )
    expect((await east.expectError('respondResign', { accept: false })).code).toBe(
      'no_resign_proposal',
    )
    west.send('resign')
    await south.waitState((s) => s.teamResignSeat[1] === 1)
    expect((await west.expectError('respondResign', { accept: true })).code).toBe(
      'already_responded',
    )
    expect((await south.expectError('respondResign', { accept: true })).code).toBe(
      'already_responded',
    )
    // East declines its own team's proposal; South–North's stays.
    east.send('respondResign', { accept: false })
    await south.waitState((s) => s.teamResignSeat[1] === -1)
    expect(south.state.teamResignSeat[0]).toBe(0)
    expect(south.state.phase).toBe('in_game')
    north.send('respondResign', { accept: false })
    await south.waitState((s) => s.teamResignSeat[0] === -1)
    expect(south.state.teamResignCooldowns).toEqual([2, 2, 0, 0])
    await leaveAll(players)
  })

  it('both teammates press Resign in the same tick: the second agrees', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    const matchId = south.state.matchId
    north.send('resign')
    south.send('resign')
    const over = await south.waitMessage('gameOver')
    expect(over.endReason).toBe('team_resigned')
    expect(over.result).toEqual({ type: 'teams_winner', team: 'west_east' })
    await south.waitState((s) => s.phase === 'finished')
    await settledMatch(matchId)
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    const mp = await seatsOf(matchId)
    expect(mp.map((p) => p.placement)).toEqual([2, 1, 2, 1])
    await leaveAll(players)
  })
})

describe('wrong phase and frozen seats', () => {
  it('lobby, finished game and a frozen seat are refused; the frozen seat’s partner resigns at once', async () => {
    const browsers = await fourGuests()
    const lobbyHost = await createLobby(browsers[0] as Browser, {
      name: 'Pre-game',
      mode: 'teams',
      timeControl: '10+0',
    })
    expect((await lobbyHost.expectError('resign')).code).toBe('wrong_phase')
    expect((await lobbyHost.expectError('respondResign', { accept: true })).code).toBe(
      'wrong_phase',
    )
    await lobbyHost.leave()

    const players = await startGame(browsers)
    const south = at(players, 0)
    const north = at(players, 2)
    const west = at(players, 1)
    const matchId = south.state.matchId
    // South's flag falls; West's request settles it first.
    flagFallsWithTimerPending(roomOf(south.room.roomId))
    west.send('offerDraw')
    await south.waitState((s) => s.seats[0]?.status === 'frozen')
    expect((await south.expectError('resign')).code).toBe('not_playing')
    expect((await south.expectError('respondResign', { accept: true })).code).toBe(
      'no_resign_proposal',
    )
    north.send('resign')
    const imm = await south.waitMessage('resignEvent', (e) => e.type === 'immediate')
    expect(imm).toEqual({ type: 'immediate', seat: 2, team: 0 })
    const over = await south.waitMessage('gameOver')
    expect(over.endReason).toBe('team_resigned')
    expect((await north.expectError('resign')).code).toBe('wrong_phase')
    expect((await west.expectError('respondResign', { accept: true })).code).toBe('wrong_phase')
    await settledMatch(matchId)
    const mp = await seatsOf(matchId)
    expect(mp.map((p) => p.defeatReason)).toEqual(['timeout', null, 'resign', null])
    expect(mp.map((p) => p.placement)).toEqual([2, 1, 2, 1])
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })
})

describe('races', () => {
  it('the proposer leaving and the teammate agreeing at once stay consistent', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    const west = at(players, 1)
    const matchId = south.state.matchId
    north.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 2)
    const leaving = north.leave()
    south.send('respondResign', { accept: true })
    await leaving
    await west.waitState((s) => s.phase === 'finished' || s.seats[2]?.status === 'frozen')
    await sleep(100)
    const st = west.state
    if (st.phase === 'finished') {
      expect(st.result.endReason).toBe('team_resigned')
    } else {
      expect(st.teamResignSeat).toEqual([-1, -1])
      expect(st.seats[0]?.status).toBe('active')
    }
    await leaveAll(players.filter((p) => p !== north))
    await settledMatch(matchId)
    const m = await settledMatch(matchId)
    if (m?.status === 'finished') {
      expect(await resimulate(h.server.ctx.db, matchId)).toBeTypeOf('string')
    }
  })

  it('a team resignation and a draw acceptance in the same tick: the first wins, cleanly', async () => {
    const players = await startGame(await fourGuests())
    const [south, west, north, east] = [0, 1, 2, 3].map((i) => at(players, i)) as [
      Player,
      Player,
      Player,
      Player,
    ]
    const matchId = south.state.matchId
    west.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 1)
    south.send('respondDraw', { accept: true })
    east.send('respondDraw', { accept: true })
    await south.waitState((s) => s.drawVotes[0] === 1 && s.drawVotes[3] === 1)
    south.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    north.send('respondResign', { accept: true })
    north.send('respondDraw', { accept: true })
    const over = await south.waitMessage('gameOver')
    expect(over.endReason).toBe('team_resigned')
    expect((await north.waitMessage('error')).code).toBe('wrong_phase')
    await south.waitState((s) => s.phase === 'finished')
    const m = await settledMatch(matchId)
    expect(m?.status).toBe('finished')
    const rows = await rowsOf(matchId)
    expect(rows.filter((r) => r.type === 'game_end')).toHaveLength(1)
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })

  it("the teammate's own flag falling before its agreement: no resignation, the proposer plays on", async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    await moveOnce(players) // South
    await moveOnce(players) // West; North to move
    south.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    flagFallsWithTimerPending(roomOf(south.room.roomId)) // North's flag
    expect((await north.expectError('respondResign', { accept: true })).code).toBe(
      'no_resign_proposal',
    )
    await south.waitState((s) => s.seats[2]?.status === 'frozen')
    expect(south.state.teamResignSeat).toEqual([-1, -1])
    expect(south.state.phase).toBe('in_game')
    await leaveAll(players)
  })
})

describe('bot teammates', () => {
  it('a stale bot answer (the proposal lapsed before the paced delay) does nothing', async () => {
    // South (person) + North (bot) vs West + East (people).
    const players = await startGame([await guest(h), await guest(h), await guest(h)], {
      botSeats: [2],
    })
    const south = at(players, 0)
    const west = at(players, 1)
    const matchId = south.state.matchId
    south.send('resign') // South is to move; the bot answers after 300 ms
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    flagFallsWithTimerPending(roomOf(south.room.roomId)) // South's flag
    west.send('offerDraw') // settles South's timeout: the proposal lapses
    await south.waitState((s) => s.seats[0]?.status === 'frozen')
    expect(south.state.teamResignSeat[0]).toBe(-1)
    await sleep(600)
    expect(south.of('resignEvent').map((e) => e.type)).toEqual(['proposed', 'lapsed'])
    const rows = await rowsOf(matchId)
    expect(rows.filter((r) => r.type === 'resign_response')).toHaveLength(0)
    await leaveAll(players)
  })

  it('a bot answer after a new proposal answers the new one only once', async () => {
    const players = await startGame([await guest(h), await guest(h), await guest(h)], {
      botSeats: [2],
    })
    const south = at(players, 0)
    const matchId = south.state.matchId
    south.send('resign')
    const first = await south.waitMessage('resignEvent', (e) => e.type === 'declined', 3_000)
    expect(first.seat).toBe(2)
    await sleep(500)
    expect(south.of('resignEvent').filter((e) => e.type === 'declined')).toHaveLength(1)
    const rows = await rowsOf(matchId)
    expect(rows.filter((r) => r.type === 'resign_response')).toHaveLength(1)
    await leaveAll(players)
  })
})

describe('a defeated seat still playing', () => {
  it('may propose; the agreement ends the game with both seats recorded as resigned', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    const room = roomOf(south.room.roomId)
    const { Game } = await import('@game/rules')
    // South lost its king (DEFEATED, still playing); South to move.
    const pos = (south.state.positionString as string)
      .replace('sK', '1')
      .replace(' S AAAA Sc1,Sj1,', ' S DAAA ')
      .replace('def=-', 'def=Sl')
    room.game.free()
    room.game = Game.fromPosition(pos)
    expect(room.game.snapshot().statuses).toEqual(['defeated', 'active', 'active', 'active'])
    south.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    north.send('respondResign', { accept: true })
    const ev = await south.waitMessage('events', (e) => e.action === 'resign')
    expect(ev.events.slice(0, 3)).toEqual([
      { type: 'frozen', seat: 'south' },
      { type: 'defeat', seat: 'north', reason: 'resign' },
      { type: 'frozen', seat: 'north' },
    ])
    expect(ev.events.at(-1)).toEqual({
      type: 'game_ended',
      outcome: { result: { type: 'teams_winner', team: 'west_east' }, placements: [2, 1, 2, 1] },
    })
    // South took part in the vote, so its earlier leader capture is now recorded as a
    // resignation (it keeps its first place in the defeat order).
    expect(room.game.snapshot().defeats).toEqual([
      { seat: 'south', reason: 'resign' },
      { seat: 'north', reason: 'resign' },
    ])
    // (The injected position isn't in the stored rows, so the stored match is aborted as a
    // re-simulation mismatch; only the live behaviour is checked here.)
    await south.waitMessage('gameOver')
    await leaveAll(players)
  })
})

describe('cooldown of a seat that can only pass', () => {
  // Was `it.fails`: the cooldowns counted only real moves, so a DEFEATED seat that can only
  // pass was locked out of proposing (and offering draws) for the rest of the game.
  it('a defeated seat with no legal move works off its cooldowns by passing', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const room = roomOf(south.room.roomId)
    const { Game } = await import('@game/rules')
    // South lost its king and has no pieces left (it passes every turn). West to move.
    const parts = (south.state.positionString as string).split(' ')
    const ranks = (parts[1] as string).split('/')
    ranks[10] = '12'
    ranks[11] = '12'
    parts[1] = ranks.join('/')
    parts[2] = 'W'
    parts[3] = 'DAAA'
    parts[4] = 'Wa3,Wa10,Nc12,Nj12,El3,El10'
    const pos = parts.join(' ').replace('def=-', 'def=Sl')
    room.game.free()
    room.game = Game.fromPosition(pos)
    room.state.seatToMove = 1
    room.state.teamResignCooldowns[0] = 2
    room.state.drawCooldowns[0] = 2
    expect(room.game.snapshot().statuses).toEqual(['defeated', 'active', 'active', 'active'])
    // Two full rounds: South passes automatically each time.
    for (let i = 0; i < 6; i++) {
      const s = room.state
      const mover = at(players, s.seatToMove)
      const m = room.game.legalMoveNotations()[0]
      const seq = s.actionSeq
      mover.send('move', { move: m })
      await south.waitState((x) => x.actionSeq > seq)
    }
    expect(room.game.snapshot().statuses[0]).toBe('defeated')
    // South still takes turns (it passed twice): it should be able to ask again.
    expect(room.state.teamResignCooldowns[0]).toBe(0)
    expect(room.state.drawCooldowns[0]).toBe(0)
    south.send('resign')
    await south.waitState((x) => x.teamResignSeat[0] === 0)
    await leaveAll(players)
  })
})
