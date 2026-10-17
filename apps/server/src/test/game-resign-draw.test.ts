/**
 * Resignation and draw offers on the server: resign in FFA on and off turn (Teams
 * resignation votes are in game-team-resign.test.ts), offers
 * accepted by every voter (an agreed draw, persisted and re-simulated), declines, lapses
 * after a round or when the voters change, the anti-spam cooldown, bot voters and solo games.
 */
import { matchEvents, matches, matchPlayers } from '@game/db'
import type { ServerMessages } from '@game/protocol'
import { Game } from '@game/rules'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { botAcceptsDraw } from '../game/draw-logic.ts'
import { resimulate } from '../game/persistence.ts'
import {
  type Browser,
  createLobby,
  createSolo,
  FakeBotClient,
  type GameHarness,
  greedyMove,
  guest,
  joinLobby,
  type Player,
  startGameHarness,
  waitFor,
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

/**
 * Starts a lobby game. `humans` take the seats in `humanSeats` order (the host gets seat 0;
 * bots are added first so joiners land on the remaining seats).
 */
async function startGame(
  humans: Browser[],
  opts: {
    mode?: 'ffa' | 'teams'
    timeControl?: '10+0' | '3+2'
    botSeats?: (1 | 2 | 3)[]
  } = {},
): Promise<Player[]> {
  const [first, ...rest] = humans
  const host = await createLobby(first as Browser, {
    name: 'Resign and draw',
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

/** The player at `seat`. */
function at(players: Player[], seat: number): Player {
  const p = players.find((x) => x.seat === seat)
  if (!p) throw new Error(`no player at seat ${seat}`)
  return p
}

/** Plays one greedy move for the seat to move (a human) and waits for it to land. */
async function moveOnce(players: Player[]): Promise<void> {
  const s = (players[0] as Player).state
  const mover = at(players, s.seatToMove)
  const move = greedyMove(s.positionString)
  if (!move) throw new Error('no legal move')
  const seq = s.actionSeq
  mover.send('move', { move })
  await (players[0] as Player).waitState((x) => x.actionSeq > seq, 5_000, 'move applied')
}

async function rowsOf(matchId: string) {
  return h.server.ctx.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .orderBy(asc(matchEvents.seq))
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

describe('resign', () => {
  it('FFA: off turn removes the army and keeps the clock; on turn ends the turn without increment; the last resign ends the game', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]), {
      timeControl: '3+2',
    })
    const south = at(players, 0)
    const north = at(players, 2)
    const matchId = south.state.matchId
    expect(south.state.seatToMove).toBe(0)
    const startedAt = south.state.clock.turnStartedAt

    // North resigns off turn: its army goes, South keeps the move and its running clock.
    north.send('resign')
    const off = await south.waitMessage('events', (e) => e.action === 'resign')
    expect(off).toMatchObject({ action: 'resign', seat: 2, notation: null, seatToMove: 0 })
    expect(off.events).toEqual([
      { type: 'defeat', seat: 'north', reason: 'resign' },
      { type: 'army_removed', seat: 'north' },
    ])
    expect(off.clock.runningSeat).toBe(0)
    expect(Math.abs(off.clock.turnStartedAt - startedAt)).toBeLessThan(5)
    await south.waitState((s) => s.seats[2]?.status === 'removed')

    // The resigned player stays in the room, watching, and can't resign or offer again.
    expect(north.state.seats[2]).toMatchObject({ connected: true, status: 'removed' })
    expect((await north.expectError('resign')).code).toBe('not_playing')
    expect((await north.expectError('offerDraw')).code).toBe('not_playing')
    expect((await north.expectError('move', { move: 'e2e4' })).code).toBe('not_your_turn')

    // South resigns on its own turn: the turn passes to West, with no increment for South.
    south.send('resign')
    const on = await south.waitMessage('events', (e) => e.action === 'resign' && e.seat === 0)
    expect(on.seatToMove).toBe(1)
    expect(on.clock.runningSeat).toBe(1)
    expect(on.clock.remainingMs[0]).toBeLessThanOrEqual(180_000)

    // West resigns: East is the last one standing.
    at(players, 1).send('resign')
    const over = await south.waitMessage('gameOver')
    expect(over.result).toEqual({ type: 'ffa_winner', seat: 'east' })
    expect(over.endReason).toBe('last_standing')
    // Knocked out first is last: North 4th, South 3rd, West 2nd.
    expect(over.placements).toEqual([3, 2, 4, 1])

    const rows = await rowsOf(matchId)
    expect(rows.filter((r) => r.type === 'resign').map((r) => r.seat)).toEqual([2, 0, 1])
    expect(rows.filter((r) => r.type === 'defeat').map((r) => r.payload)).toEqual([
      expect.objectContaining({ reason: 'resign' }),
      expect.objectContaining({ reason: 'resign' }),
      expect.objectContaining({ reason: 'resign' }),
    ])
    const mp = await h.server.ctx.db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(asc(matchPlayers.seat))
    expect(mp.map((p) => p.defeatReason)).toEqual(['resign', 'resign', 'resign', null])
    await south.waitState((s) => s.phase === 'finished')
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })

  it('is refused outside a game', async () => {
    const host = await createLobby(await guest(h))
    expect((await host.expectError('resign')).code).toBe('wrong_phase')
    expect((await host.expectError('offerDraw')).code).toBe('wrong_phase')
    expect((await host.expectError('respondDraw', { accept: true })).code).toBe('wrong_phase')
    expect((await host.expectError('respondDraw', {})).code).toBe('invalid_message')
    await host.leave()
  })
})

describe('draw offers between people', () => {
  it('ends in an agreed draw when every voter accepts, persisted and re-simulated', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)
    const matchId = south.state.matchId
    await moveOnce(players)
    expect((await south.expectError('respondDraw', { accept: true })).code).toBe('no_draw_offer')

    // West offers (off turn is fine): its vote counts; the others are pending.
    const west = at(players, 1)
    west.send('offerDraw')
    const offered = await south.waitMessage('drawEvent', (e) => e.type === 'offered')
    expect(offered).toEqual({ type: 'offered', seat: 1, offerSeat: 1 })
    await south.waitState((s) => s.drawOfferSeat === 1)
    expect(south.state.drawVotes).toEqual([0, 1, 0, 0])
    expect(south.state.drawOfferActionSeq).toBe(1)
    expect((await south.expectError('offerDraw')).code).toBe('draw_offer_pending')
    expect((await west.expectError('respondDraw', { accept: true })).code).toBe('already_responded')

    // Moves go on while the offer stands.
    await moveOnce(players) // West
    south.send('respondDraw', { accept: true })
    at(players, 2).send('respondDraw', { accept: true })
    await south.waitState((s) => s.drawVotes[0] === 1 && s.drawVotes[2] === 1)
    expect(south.state.phase).toBe('in_game')
    at(players, 3).send('respondDraw', { accept: true })

    const draw = await south.waitMessage('events', (e) => e.action === 'agreed_draw')
    expect(draw.seat).toBe(3)
    expect(draw.seatToMove).toBe(-1)
    expect(draw.events).toEqual([
      {
        type: 'game_ended',
        outcome: {
          result: { type: 'ffa_agreed_draw', survivors: [true, true, true, true] },
          placements: [1, 1, 1, 1],
        },
      },
    ])
    const over = await south.waitMessage('gameOver')
    expect(over.result.type).toBe('ffa_agreed_draw')
    expect(over.endReason).toBe('agreed_draw')
    expect(over.placements).toEqual([1, 1, 1, 1])
    await south.waitState((s) => s.phase === 'finished')
    expect(south.state.result).toMatchObject({ type: 'ffa_agreed_draw', endReason: 'agreed_draw' })
    expect(south.state.drawOfferSeat).toBe(-1)

    const accepted = south.of('drawEvent').filter((e) => e.type === 'accepted')
    expect(accepted.map((e) => e.seat)).toEqual([0, 2, 3])
    const rows = await rowsOf(matchId)
    const offerRow = rows.find((r) => r.type === 'draw_offer')
    expect(offerRow).toMatchObject({ seat: 1, payload: { actionSeq: 1, votes: [0, 1, 0, 0] } })
    const responses = rows.filter((r) => r.type === 'draw_response')
    expect(responses.map((r) => [r.seat, (r.payload as { accept: boolean }).accept])).toEqual([
      [0, true],
      [2, true],
      [3, true],
    ])
    const end = rows.at(-1)
    expect(end).toMatchObject({
      type: 'game_end',
      payload: { endReason: 'agreed_draw', agreedDraw: true },
    })
    const [m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m).toMatchObject({ status: 'finished', endReason: 'agreed_draw' })
    await south.waitState((s) => s.phase === 'finished')
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })

  it('a decline ends the offer, and the offerer must make two more moves to offer again', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)
    south.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 0)
    at(players, 2).send('respondDraw', { accept: false })
    const declined = await south.waitMessage('drawEvent', (e) => e.type === 'declined')
    expect(declined).toEqual({ type: 'declined', seat: 2, offerSeat: 0 })
    await south.waitState((s) => s.drawOfferSeat === -1)
    expect(south.state.drawVotes).toEqual([-1, -1, -1, -1])
    expect(south.state.drawCooldowns).toEqual([2, 0, 0, 0])
    expect((await at(players, 3).expectError('respondDraw', { accept: true })).code).toBe(
      'no_draw_offer',
    )

    const refused = await south.expectError('offerDraw')
    expect(refused.code).toBe('draw_offer_cooldown')
    expect(refused.message).toMatch(/2 more moves/)
    // Others aren't affected by South's cooldown.
    at(players, 1).send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 1)
    at(players, 3).send('respondDraw', { accept: false })
    await south.waitState((s) => s.drawOfferSeat === -1)
    expect(south.state.drawCooldowns).toEqual([2, 2, 0, 0])

    await moveOnce(players) // South: 1 to go
    expect(south.state.drawCooldowns[0]).toBe(1)
    expect((await south.expectError('offerDraw')).message).toMatch(/1 more move\b/)
    for (let i = 0; i < 3; i++) await moveOnce(players) // West, North, East
    expect(south.state.drawCooldowns).toEqual([1, 1, 0, 0])
    await moveOnce(players) // South: done
    expect(south.state.drawCooldowns[0]).toBe(0)
    south.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 0)
    await leaveAll(players)
  })

  it('lapses after one full round, counted from the offer', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)

    // South offers on its own turn: it lapses when the turn is back with South.
    south.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 0)
    for (let i = 0; i < 3; i++) await moveOnce(players) // South, West, North
    expect(south.state.drawOfferSeat).toBe(0)
    await moveOnce(players) // East: back to South
    const lapsed = await south.waitMessage('drawEvent', (e) => e.type === 'lapsed')
    expect(lapsed).toEqual({ type: 'lapsed', seat: 0, offerSeat: 0, reason: 'round' })
    await south.waitState((s) => s.drawOfferSeat === -1)
    expect(south.state.drawCooldowns[0]).toBe(2)

    // North offers off turn (South to move): reaching North doesn't end it until East has
    // had a turn too.
    const north = at(players, 2)
    north.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 2)
    await moveOnce(players) // South
    await moveOnce(players) // West: North's turn, East hasn't moved since the offer
    expect(south.state.seatToMove).toBe(2)
    expect(south.state.drawOfferSeat).toBe(2)
    await moveOnce(players) // North
    await moveOnce(players) // East
    await moveOnce(players) // South
    expect(south.state.drawOfferSeat).toBe(2)
    await moveOnce(players) // West: back to North after a full round
    await south.waitState((s) => s.drawOfferSeat === -1)
    expect(south.of('drawEvent').at(-1)).toEqual({
      type: 'lapsed',
      seat: 2,
      offerSeat: 2,
      reason: 'round',
    })
    await leaveAll(players)
  })

  it('lapses when the voters change (a resign), and agreed draws need only remaining voters', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)
    const matchId = south.state.matchId
    south.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 0)
    at(players, 1).send('respondDraw', { accept: true })
    await south.waitState((s) => s.drawVotes[1] === 1)
    at(players, 3).send('resign')
    const lapsed = await south.waitMessage('drawEvent', (e) => e.type === 'lapsed')
    expect(lapsed.reason).toBe('voters_changed')
    await south.waitState((s) => s.drawOfferSeat === -1)

    // A new offer by West (no cooldown for West) among the three left: East doesn't vote.
    at(players, 1).send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 1)
    expect(south.state.drawVotes).toEqual([0, 1, 0, -1])
    expect((await at(players, 3).expectError('respondDraw', { accept: true })).code).toBe(
      'not_playing',
    )
    south.send('respondDraw', { accept: true })
    at(players, 2).send('respondDraw', { accept: true })
    const over = await south.waitMessage('gameOver')
    // East was knocked out first (4th); the three survivors share 1st.
    expect(over.result).toEqual({ type: 'ffa_agreed_draw', survivors: [true, true, true, false] })
    expect(over.placements).toEqual([1, 1, 1, 4])
    await south.waitState((s) => s.phase === 'finished')
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })
})

describe('bot voters', () => {
  it('Teams: two people agree a draw with two clearly losing bots', async () => {
    // South and North are people, West and East bots. Everyone plays the deterministic
    // greedy policy until the bots' team is clearly behind on North's or South's turn.
    const players = await startGame([await guest(h), await guest(h)], {
      mode: 'teams',
      botSeats: [1, 3],
    })
    const south = at(players, 0)
    const north = at(players, 2)
    const matchId = south.state.matchId
    for (let i = 0; i < 200; i++) {
      await south.waitState((s) => s.seatToMove === 0 || s.seatToMove === 2, 5_000, 'human turn')
      const game = Game.fromPosition(south.state.positionString)
      const snap = game.snapshot()
      game.free()
      if (botAcceptsDraw(snap, 1) && botAcceptsDraw(snap, 3)) break
      await moveOnce(players)
    }
    const offerer = at(players, south.state.seatToMove)
    const partner = offerer === south ? north : south
    offerer.send('offerDraw')
    await south.waitMessage('drawEvent', (e) => e.type === 'offered')
    partner.send('respondDraw', { accept: true })
    const over = await south.waitMessage('gameOver')
    expect(over.result).toEqual({ type: 'teams_agreed_draw' })
    expect(over.placements).toEqual([1, 1, 1, 1])
    const botAnswers = south
      .of('drawEvent')
      .filter((e) => e.type === 'accepted' && (e.seat === 1 || e.seat === 3))
    expect(botAnswers).toHaveLength(2)
    const rows = await rowsOf(matchId)
    const botRows = rows.filter(
      (r) => r.type === 'draw_response' && (r.payload as { bot?: boolean }).bot,
    )
    expect(botRows.map((r) => r.seat).sort()).toEqual([1, 3])
    await south.waitState((s) => s.phase === 'finished')
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })
})

describe('solo (untimed) games', () => {
  it('bots decline in an even position', async () => {
    const p = await createSolo(await guest(h), { mode: 'ffa' })
    await p.waitState((s) => s.phase === 'in_game' && s.seatToMove === 0, 5_000, 'my turn')
    p.send('offerDraw')
    const declined = await p.waitMessage('drawEvent', (e) => e.type === 'declined')
    // The first bot (West) declines; that ends the offer.
    expect(declined).toEqual({ type: 'declined', seat: 1, offerSeat: 0 })
    await p.waitState((s) => s.drawCooldowns[0] === 2)
    expect(p.state.drawOfferSeat).toBe(-1)
    expect(p.of('drawEvent').filter((e) => e.type !== 'offered')).toHaveLength(1)
    await p.leave()
  })

  it('bots answer by the material heuristic, in seat order', async () => {
    const p = await createSolo(await guest(h), { mode: 'ffa' })
    // West has lost its queen and both rooks (20 material against 39): West, the first bot
    // to answer, is clearly losing; North is not. Injected into the live room, because the
    // armies of the 16×16 board take a long time to meet in greedy play.
    await p.waitState((s) => s.phase === 'in_game' && s.seatToMove === 0, 5_000, 'my turn')
    const start = p.state.positionString as string
    const fields = start.split(' ')
    fields[1] = (fields[1] as string)
      .split('/')
      .map((rank) => rank.replace(/^wRwP12/, '1wP12').replace(/^wQwP12/, '1wP12'))
      .join('/')
    fields[4] = (fields[4] as string)
      .split(',')
      .filter((c) => !c.startsWith('W'))
      .join(',')
    const room = roomOf(p.room.roomId)
    room.game.free()
    room.game = Game.fromPosition(fields.join(' '))
    const snap = room.game.snapshot() as ReturnType<Game['snapshot']>
    expect(snap.seatToMove).toBe('south')
    expect(botAcceptsDraw(snap, 1)).toBe(true)
    expect(botAcceptsDraw(snap, 2)).toBe(false)
    const voters = [1, 2, 3].filter((s) => snap?.statuses[s] === 'active')
    const expected: ServerMessages['drawEvent'][] = []
    for (const seat of voters) {
      const accept = botAcceptsDraw(snap, seat)
      expected.push({ type: accept ? 'accepted' : 'declined', seat: seat as 1, offerSeat: 0 })
      if (!accept) break
    }
    expect(expected.some((e) => e.type === 'accepted')).toBe(true)
    p.send('offerDraw')
    const last = expected.at(-1) as ServerMessages['drawEvent']
    await waitFor(() => p.of('drawEvent').length >= expected.length + 1, 5_000, 'bot answers')
    expect(p.of('drawEvent').slice(1)).toEqual(expected)
    if (last.type === 'accepted') {
      expect((await p.waitMessage('gameOver')).endReason).toBe('agreed_draw')
    } else {
      await p.waitState((s) => s.drawOfferSeat === -1)
    }
    await p.leave()
  })

  it('a resign removes the player in FFA (4th) and ends the game there', async () => {
    const p = await createSolo(await guest(h), { mode: 'ffa' })
    await p.waitState((s) => s.phase === 'in_game', 5_000, 'in game')
    p.send('resign')
    await p.waitState((s) => s.seats[0]?.status === 'removed')
    const over = await p.waitMessage('gameOver', () => true, 5_000)
    expect(over.placements).toEqual([4, 1, 1, 1])
    expect(over.endReason).toBe('player_eliminated')
    // Only the resign was played: the bots didn't play the game out.
    expect(p.of('events').map((e) => e.action)).toEqual(['resign'])
    await p.leave()
  })
})
