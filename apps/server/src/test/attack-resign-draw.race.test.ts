/**
 * Review (attack) tests for resignation and draw offers: races with flag falls, integrity of
 * the voter set, persistence and re-simulation, and the anti-spam cooldown.
 *
 * Flag races: the flag timer fires a millisecond after a flag falls, so a resign or a draw
 * answer can be handled after the seat to move has run out of time but before the timer
 * runs (a busy event loop widens that window). These tests hold the flag timer back and
 * drain the mover's clock so the message arrives in exactly that window.
 */
import { matches } from '@game/db'
import { eq } from 'drizzle-orm'
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
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({ RECONNECT_GRACE_SECONDS: '5' }, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

const CIVS = ['canada', 'usa', 'china', 'japan']

async function startGame(
  humans: Browser[],
  opts: { mode?: 'ffa' | 'teams'; timeControl?: '10+0' | '3+2'; botSeats?: (1 | 2 | 3)[] } = {},
): Promise<Player[]> {
  const [first, ...rest] = humans
  const host = await createLobby(first as Browser, {
    name: 'Attack resign draw',
    mode: opts.mode ?? 'ffa',
    timeControl: opts.timeControl ?? '10+0',
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

function at(players: Player[], seat: number): Player {
  const p = players.find((x) => x.seat === seat)
  if (!p) throw new Error(`no player at seat ${seat}`)
  return p
}

async function moveOnce(players: Player[]): Promise<void> {
  const s = (players[0] as Player).state
  const mover = at(players, s.seatToMove)
  const move = greedyMove(s.positionString)
  if (!move) throw new Error('no legal move')
  const seq = s.actionSeq
  mover.send('move', { move })
  await (players[0] as Player).waitState((x) => x.actionSeq > seq, 5_000, 'move applied')
}

// biome-ignore lint/suspicious/noExplicitAny: reaching into the room's private clock state
type AnyRoom = any

/** The live room of `roomId` (white-box: clock and flag timer). */
function roomOf(roomId: string): AnyRoom {
  for (const r of h.server.ctx.game.rooms) {
    if ((r as AnyRoom).roomId === roomId) return r
  }
  throw new Error('room not found')
}

/**
 * The seat to move's flag has fallen but the flag timer hasn't run yet (as when a message
 * is already queued behind it): hold the timer back and drain the running clock.
 */
function flagFallsWithTimerPending(room: AnyRoom) {
  clearTimeout(room.flagTimer)
  room.armFlagTimer = () => {}
  const clock = room.gameClock
  expect(clock.running).not.toBe(-1)
  clock.remaining[clock.running] = 0
  expect(clock.hasFlagged(performance.now())).toBe(true)
}

async function leaveAll(players: Player[]) {
  for (const p of players) await p.leave()
}

describe('flag races', () => {
  it("an off-turn resign that would end the game loses to the mover's flag that already fell", async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)
    // West and East resign off turn: South (to move) and North remain.
    at(players, 1).send('resign')
    await south.waitState((s) => s.seats[1]?.status === 'removed')
    at(players, 3).send('resign')
    await south.waitState((s) => s.seats[3]?.status === 'removed')
    expect(south.state.seatToMove).toBe(0)

    // South's flag has fallen; North resigns before the flag timer runs.
    flagFallsWithTimerPending(roomOf(south.room.roomId))
    at(players, 2).send('resign')
    const over = await south.waitMessage('gameOver')

    // South lost on time before North's resign arrived, so North wins (the room settles the
    // fallen flag before applying the resign).
    expect(over.result).toEqual({ type: 'ffa_winner', seat: 'north' })
    await leaveAll(players)
  })

  it("an agreed draw is not reached after the mover's flag already fell", async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)
    at(players, 1).send('resign')
    await south.waitState((s) => s.seats[1]?.status === 'removed')
    at(players, 3).send('resign')
    await south.waitState((s) => s.seats[3]?.status === 'removed')

    // South (to move) offers a draw, then runs out of time; North accepts in the window.
    south.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 0)
    flagFallsWithTimerPending(roomOf(south.room.roomId))
    at(players, 2).send('respondDraw', { accept: true })
    const over = await south.waitMessage('gameOver')

    // South's flag fell first, so North wins on time (the timeout lapses the offer).
    expect(over.result).toEqual({ type: 'ffa_winner', seat: 'north' })
    await leaveAll(players)
  })
})

describe('integrity', () => {
  it('refuses resign / offer / respond in the countdown and after the game, and from spectating seats', async () => {
    const [a, b, c, d] = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const host = await createLobby(a as Browser, {
      name: 'Countdown check',
      mode: 'teams',
      timeControl: '10+0',
    })
    expect((await host.expectError('resign')).code).toBe('wrong_phase')
    expect((await host.expectError('offerDraw')).code).toBe('wrong_phase')
    expect((await host.expectError('respondDraw', { accept: true })).code).toBe('wrong_phase')
    await host.leave()

    const players = await startGame([a, b, c, d] as Browser[], { mode: 'teams' })
    const south = at(players, 0)
    const west = at(players, 1)
    // West runs out of time (frozen in Teams, still in the room): no longer a voter.
    await moveOnce(players) // South; West to move
    roomOf(south.room.roomId).runAction('timeout', 1, null)
    await south.waitState((s) => s.seats[1]?.status === 'frozen')
    expect((await west.expectError('offerDraw')).code).toBe('not_playing')
    expect((await west.expectError('resign')).code).toBe('not_playing')
    expect((await west.expectError('respondResign', { accept: true })).code).toBe(
      'no_resign_proposal',
    )
    south.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 0)
    expect(south.state.drawVotes).toEqual([1, -1, 0, 0])
    expect((await west.expectError('respondDraw', { accept: true })).code).toBe('not_playing')
    expect((await south.expectError('respondDraw', { accept: false })).code).toBe(
      'already_responded',
    )
    expect((await at(players, 2).expectError('offerDraw')).code).toBe('draw_offer_pending')
    at(players, 2).send('respondDraw', { accept: true })
    await south.waitState((s) => s.drawVotes[2] === 1)
    expect((await at(players, 2).expectError('respondDraw', { accept: true })).code).toBe(
      'already_responded',
    )
    at(players, 3).send('respondDraw', { accept: true })
    const over = await south.waitMessage('gameOver')
    expect(over.result.type).toBe('teams_agreed_draw')
    expect(over.endReason).toBe('agreed_draw')
    expect((await south.expectError('resign')).code).toBe('wrong_phase')
    expect((await south.expectError('offerDraw')).code).toBe('wrong_phase')
    expect((await at(players, 2).expectError('respondDraw', { accept: false })).code).toBe(
      'wrong_phase',
    )

    // Persisted and re-simulated: the timeout, then the agreed draw.
    const matchId = south.state.matchId
    const finalPosition = south.state.positionString
    let m: typeof matches.$inferSelect | undefined
    for (let i = 0; i < 100 && m?.status !== 'finished'; i++) {
      ;[m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
      if (m?.status !== 'finished') await new Promise((r) => setTimeout(r, 20))
    }
    expect(m?.endReason).toBe('agreed_draw')
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(finalPosition)
    await leaveAll(players)
  })

  it('a resign by the seat to move (3+2) ends its turn with no increment and starts the bot turn', async () => {
    bots.delayMs = 0
    const players = await startGame([await guest(h)], { timeControl: '3+2', botSeats: [1, 2, 3] })
    const south = at(players, 0)
    await moveOnce(players)
    await south.waitState((s) => s.seatToMove === 0, 10_000, 'back to south')
    const seq = south.state.actionSeq
    south.send('resign')
    const ev = await south.waitMessage('events', (e) => e.action === 'resign')
    expect(ev.seatToMove).toBe(1)
    expect(ev.clock.runningSeat).toBe(1)
    // South had 180s + 2s from its one move, minus think time; the resign adds nothing.
    expect(ev.clock.remainingMs[0]).toBeLessThanOrEqual(182_000)
    const before = south.of('events').find((e) => e.seq === seq)
    if (before) expect(ev.clock.remainingMs[0]).toBeLessThanOrEqual(before.clock.remainingMs[0])
    await south.waitMessage('events', (e) => e.seq > ev.seq && e.seat === 1, 10_000)
    await south.leave()
  })

  it("anti-spam: a declined offerer cannot offer again on other players' moves, a timeout, or a resign", async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)
    const north = at(players, 2)
    north.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 2)
    south.send('respondDraw', { accept: false })
    await south.waitState((s) => s.drawOfferSeat === -1 && s.drawCooldowns[2] === 2)
    // South and West move: North's cooldown stays.
    await moveOnce(players)
    await moveOnce(players)
    expect(south.state.drawCooldowns[2]).toBe(2)
    expect((await north.expectError('offerDraw')).code).toBe('draw_offer_cooldown')
    // East resigns off turn (voters change): still no offer for North.
    at(players, 3).send('resign')
    await south.waitState((s) => s.seats[3]?.status === 'removed')
    expect((await north.expectError('offerDraw')).code).toBe('draw_offer_cooldown')
    await moveOnce(players) // North
    expect(south.state.drawCooldowns[2]).toBe(1)
    expect((await north.expectError('offerDraw')).code).toBe('draw_offer_cooldown')
    await leaveAll(players)
  })
})
