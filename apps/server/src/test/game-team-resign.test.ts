/**
 * Teams resignation votes on the server: a resignation in Teams resigns the whole team, so
 * the proposer's teammate must agree first. Covers agreement (the game ends, the other team
 * wins, persisted and re-simulated), declines and the cooldown, lapses (a full round, the
 * voters changing), the immediate resignation with a frozen teammate, a proposal next to a
 * draw offer, races with a flag that already fell, bot teammates, and FFA staying a plain
 * resignation.
 */
import { matchEvents, matches, matchPlayers } from '@game/db'
import { Game, type MoveView } from '@game/rules'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resimulate } from '../game/persistence.ts'
import { botAcceptsTeamResign } from '../game/resign-logic.ts'
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

/** Starts a lobby game (host at South; bots first, so joiners take the remaining seats). */
async function startGame(
  humans: Browser[],
  opts: { mode?: 'ffa' | 'teams'; botSeats?: (1 | 2 | 3)[] } = {},
): Promise<Player[]> {
  const [first, ...rest] = humans
  const host = await createLobby(first as Browser, {
    name: 'Team resign',
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

/** Plays one greedy move for the seat to move (a human) and waits for it to land. */
async function moveOnce(players: Player[], move?: string): Promise<void> {
  const s = (players[0] as Player).state
  const mover = at(players, s.seatToMove)
  const m = move ?? greedyMove(s.positionString)
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

async function finishedMatch(matchId: string) {
  let m: typeof matches.$inferSelect | undefined
  for (let i = 0; i < 200 && m?.status !== 'finished'; i++) {
    ;[m] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    if (m?.status !== 'finished') await new Promise((r) => setTimeout(r, 20))
  }
  return m
}

async function leaveAll(players: Player[]) {
  for (const p of players) await p.leave()
}

// biome-ignore lint/suspicious/noExplicitAny: reaching into the room's private clock state
type AnyRoom = any

function roomOf(roomId: string): AnyRoom {
  for (const r of h.server.ctx.game.rooms) {
    if ((r as AnyRoom).roomId === roomId) return r
  }
  throw new Error('room not found')
}

/** The seat to move's flag has fallen but the flag timer hasn't run yet. */
function flagFallsWithTimerPending(room: AnyRoom) {
  clearTimeout(room.flagTimer)
  room.armFlagTimer = () => {}
  const clock = room.gameClock
  expect(clock.running).not.toBe(-1)
  clock.remaining[clock.running] = 0
  expect(clock.hasFlagged(performance.now())).toBe(true)
}

describe('a human teammate', () => {
  it('agrees: the whole team resigns, the game ends and the other team wins', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const west = at(players, 1)
    const north = at(players, 2)
    const matchId = south.state.matchId
    await moveOnce(players) // South; West to move

    // North proposes off turn: nothing happens to the board yet.
    north.send('resign')
    const proposed = await south.waitMessage('resignEvent', (e) => e.type === 'proposed')
    expect(proposed).toEqual({ type: 'proposed', seat: 2, team: 0 })
    await south.waitState((s) => s.teamResignSeat[0] === 2)
    expect(south.state.teamResignSeat).toEqual([2, -1])
    expect(south.of('events').some((e) => e.action === 'resign')).toBe(false)
    expect((await north.expectError('resign')).code).toBe('resign_proposal_pending')
    expect((await north.expectError('respondResign', { accept: true })).code).toBe(
      'already_responded',
    )
    expect((await west.expectError('respondResign', { accept: true })).code).toBe(
      'no_resign_proposal',
    )
    expect((await south.expectError('respondResign', {})).code).toBe('invalid_message')

    // Play goes on while the proposal stands.
    await moveOnce(players) // West
    expect(south.state.teamResignSeat[0]).toBe(2)

    // South agrees: both resign, West–East win.
    south.send('respondResign', { accept: true })
    const accepted = await south.waitMessage('resignEvent', (e) => e.type === 'accepted')
    expect(accepted).toEqual({ type: 'accepted', seat: 0, team: 0 })
    const ev = await south.waitMessage('events', (e) => e.action === 'resign')
    expect(ev.seat).toBe(2)
    expect(ev.seatToMove).toBe(-1)
    expect(ev.events).toEqual([
      { type: 'defeat', seat: 'north', reason: 'resign' },
      { type: 'frozen', seat: 'north' },
      { type: 'defeat', seat: 'south', reason: 'resign' },
      { type: 'frozen', seat: 'south' },
      { type: 'army_removed', seat: 'south' },
      { type: 'army_removed', seat: 'north' },
      {
        type: 'game_ended',
        outcome: { result: { type: 'teams_winner', team: 'west_east' }, placements: [2, 1, 2, 1] },
      },
    ])
    const over = await south.waitMessage('gameOver')
    expect(over.result).toEqual({ type: 'teams_winner', team: 'west_east' })
    expect(over.placements).toEqual([2, 1, 2, 1])
    expect(over.endReason).toBe('team_resigned')
    await south.waitState((s) => s.phase === 'finished')
    expect(south.state.result).toMatchObject({ type: 'teams_winner', endReason: 'team_resigned' })
    expect(south.state.teamResignSeat).toEqual([-1, -1])

    // Persisted: the proposal, the answer, then one resign action for the team.
    const m = await finishedMatch(matchId)
    expect(m).toMatchObject({ status: 'finished', endReason: 'team_resigned' })
    const rows = await rowsOf(matchId)
    expect(rows.find((r) => r.type === 'resign_proposal')).toMatchObject({
      seat: 2,
      payload: { teammate: 0 },
    })
    expect(rows.find((r) => r.type === 'resign_response')).toMatchObject({
      seat: 0,
      payload: { proposer: 2, accept: true },
    })
    const resigns = rows.filter((r) => r.type === 'resign')
    expect(resigns).toHaveLength(1)
    expect(resigns[0]).toMatchObject({ seat: 2, payload: { team: true, acceptedBy: 0 } })
    expect(rows.filter((r) => r.type === 'defeat').map((r) => r.seat)).toEqual([2, 0])
    expect(rows.at(-1)).toMatchObject({ type: 'game_end', payload: { endReason: 'team_resigned' } })
    const mp = await seatsOf(matchId)
    expect(mp.map((p) => p.defeatReason)).toEqual(['resign', null, 'resign', null])
    expect(mp.map((p) => p.placement)).toEqual([2, 1, 2, 1])
    expect(mp.map((p) => p.finalStatus)).toEqual(['frozen', 'active', 'frozen', 'active'])
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players)
  })

  it('declines: both play on, and the proposer makes two more moves before proposing again', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    const matchId = south.state.matchId

    south.send('resign') // on its own turn
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    north.send('respondResign', { accept: false })
    const declined = await south.waitMessage('resignEvent', (e) => e.type === 'declined')
    expect(declined).toEqual({ type: 'declined', seat: 2, team: 0 })
    await south.waitState((s) => s.teamResignSeat[0] === -1)
    expect(south.state.teamResignCooldowns).toEqual([2, 0, 0, 0])
    expect(south.state.phase).toBe('in_game')
    expect(south.state.seats.map((x) => x.status)).toEqual(['active', 'active', 'active', 'active'])
    expect(south.state.seatToMove).toBe(0)
    expect((await north.expectError('respondResign', { accept: true })).code).toBe(
      'no_resign_proposal',
    )

    const refused = await south.expectError('resign')
    expect(refused.code).toBe('resign_proposal_cooldown')
    expect(refused.message).toMatch(/2 more moves/)
    // North isn't affected by South's cooldown.
    north.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 2)
    south.send('respondResign', { accept: false })
    await south.waitState((s) => s.teamResignSeat[0] === -1)
    expect(south.state.teamResignCooldowns).toEqual([2, 0, 2, 0])

    await moveOnce(players) // South: 1 to go
    expect(south.state.teamResignCooldowns[0]).toBe(1)
    expect((await south.expectError('resign')).message).toMatch(/1 more move\b/)
    for (let i = 0; i < 3; i++) await moveOnce(players) // West, North, East
    expect(south.state.teamResignCooldowns).toEqual([1, 0, 1, 0])
    await moveOnce(players) // South: done
    expect(south.state.teamResignCooldowns[0]).toBe(0)
    south.send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    expect(south.state.phase).toBe('in_game')

    const rows = await rowsOf(matchId)
    expect(
      rows.filter((r) => r.type === 'resign_response').map((r) => [r.seat, r.payload]),
    ).toEqual([
      [2, expect.objectContaining({ proposer: 0, accept: false })],
      [0, expect.objectContaining({ proposer: 2, accept: false })],
    ])
    expect(rows.some((r) => r.type === 'resign')).toBe(false)
    await leaveAll(players)
  })

  it('sending resign while the teammate’s proposal is pending agrees to it; a draw offer can stand beside it', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    south.send('offerDraw')
    await south.waitState((s) => s.drawOfferSeat === 0)
    at(players, 1).send('resign') // West proposes
    await south.waitState((s) => s.teamResignSeat[1] === 1)
    expect(south.state.drawOfferSeat).toBe(0)
    expect(south.state.teamResignSeat).toEqual([-1, 1])
    // South–North may propose too: one proposal per team.
    at(players, 2).send('resign')
    await south.waitState((s) => s.teamResignSeat[0] === 2)
    expect(south.state.teamResignSeat).toEqual([2, 1])

    at(players, 3).send('resign') // East: agrees to West's proposal
    const accepted = await south.waitMessage('resignEvent', (e) => e.type === 'accepted')
    expect(accepted).toEqual({ type: 'accepted', seat: 3, team: 1 })
    const over = await south.waitMessage('gameOver')
    expect(over.result).toEqual({ type: 'teams_winner', team: 'south_north' })
    expect(over.placements).toEqual([1, 2, 1, 2])
    expect(over.endReason).toBe('team_resigned')
    await south.waitState((s) => s.phase === 'finished')
    expect(south.state.drawOfferSeat).toBe(-1)
    expect(south.state.teamResignSeat).toEqual([-1, -1])
    await leaveAll(players)
  })
})

describe('lapses', () => {
  it('after one full round, counted from the proposal', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    south.send('resign') // on its own turn
    await south.waitState((s) => s.teamResignSeat[0] === 0)
    for (let i = 0; i < 3; i++) await moveOnce(players) // South, West, North
    expect(south.state.teamResignSeat[0]).toBe(0)
    await moveOnce(players) // East: back to South
    const lapsed = await south.waitMessage('resignEvent', (e) => e.type === 'lapsed')
    expect(lapsed).toEqual({ type: 'lapsed', seat: 0, team: 0, reason: 'round' })
    await south.waitState((s) => s.teamResignSeat[0] === -1)
    expect(south.state.teamResignCooldowns[0]).toBe(2)
    expect(south.state.phase).toBe('in_game')

    // East proposes off turn (South to move): reaching East doesn't end it until South,
    // West and North have all had a turn.
    const east = at(players, 3)
    east.send('resign')
    await south.waitState((s) => s.teamResignSeat[1] === 3)
    for (let i = 0; i < 3; i++) await moveOnce(players) // South, West, North
    expect(south.state.seatToMove).toBe(3)
    await south.waitState((s) => s.teamResignSeat[1] === -1)
    expect(south.of('resignEvent').at(-1)).toEqual({
      type: 'lapsed',
      seat: 3,
      team: 1,
      reason: 'round',
    })
    await leaveAll(players)
  })

  it('when the teammate leaves; with a frozen teammate the team resigns at once', async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const west = at(players, 1)
    const east = at(players, 3)
    const matchId = south.state.matchId
    east.send('resign')
    await south.waitState((s) => s.teamResignSeat[1] === 3)

    // West leaves the game (abandon: only West freezes) and the proposal lapses.
    await west.leave()
    const lapsed = await south.waitMessage('resignEvent', (e) => e.type === 'lapsed')
    expect(lapsed).toEqual({
      type: 'lapsed',
      seat: 3,
      team: 1,
      reason: 'voters_changed',
      outSeat: 1,
    })
    await south.waitState((s) => s.seats[1]?.status === 'frozen' && s.teamResignSeat[1] === -1)
    expect(south.state.phase).toBe('in_game')
    expect(south.state.seats[3]?.status).toBe('active')

    // Nobody left to ask: East's resignation applies at once (no cooldown either).
    expect(south.state.teamResignCooldowns[3]).toBe(2)
    east.send('resign')
    const immediate = await south.waitMessage('resignEvent', (e) => e.type === 'immediate')
    expect(immediate).toEqual({ type: 'immediate', seat: 3, team: 1 })
    const ev = await south.waitMessage('events', (e) => e.action === 'resign')
    expect(ev.seat).toBe(3)
    expect(ev.events.slice(0, 2)).toEqual([
      { type: 'defeat', seat: 'east', reason: 'resign' },
      { type: 'frozen', seat: 'east' },
    ])
    const over = await south.waitMessage('gameOver')
    expect(over.result).toEqual({ type: 'teams_winner', team: 'south_north' })
    expect(over.placements).toEqual([1, 2, 1, 2])
    expect(over.endReason).toBe('team_resigned')
    await south.waitState((s) => s.phase === 'finished')
    await finishedMatch(matchId)
    const mp = await seatsOf(matchId)
    expect(mp.map((p) => p.defeatReason)).toEqual([null, 'abandon', null, 'resign'])
    const rows = await rowsOf(matchId)
    expect(rows.filter((r) => r.type === 'resign')).toEqual([
      expect.objectContaining({ seat: 3, payload: expect.objectContaining({ immediate: true }) }),
    ])
    expect(await resimulate(h.server.ctx.db, matchId)).toBe(south.state.positionString)
    await leaveAll(players.filter((p) => p !== west))
  })
})

describe('flag races', () => {
  it("an agreement loses to the proposer's flag that already fell", async () => {
    const players = await startGame(await fourGuests())
    const south = at(players, 0)
    const north = at(players, 2)
    south.send('resign') // South is to move
    await south.waitState((s) => s.teamResignSeat[0] === 0)

    // South's flag falls; North's agreement arrives before the flag timer runs. The timeout
    // comes first (South freezes alone), the proposal lapses and the game goes on.
    flagFallsWithTimerPending(roomOf(south.room.roomId))
    const err = await north.expectError('respondResign', { accept: true })
    expect(err.code).toBe('no_resign_proposal')
    const lapsed = await south.waitMessage('resignEvent', (e) => e.type === 'lapsed')
    expect(lapsed).toEqual({
      type: 'lapsed',
      seat: 0,
      team: 0,
      reason: 'voters_changed',
      outSeat: 0,
    })
    await south.waitState((s) => s.seats[0]?.status === 'frozen')
    expect(south.state.phase).toBe('in_game')
    expect(south.state.seats[2]?.status).toBe('active')
    expect(south.of('events').some((e) => e.action === 'resign')).toBe(false)
    expect(south.of('events').some((e) => e.action === 'timeout' && e.seat === 0)).toBe(true)
    await leaveAll(players)
  })
})

describe('bot teammates', () => {
  it('a bot teammate declines in an even position (solo); the game goes on', async () => {
    const p = await createSolo(await guest(h), { mode: 'teams' })
    await p.waitState((s) => s.phase === 'in_game', 5_000, 'in game')
    const matchId = p.state.matchId
    p.send('resign')
    const declined = await p.waitMessage('resignEvent', (e) => e.type === 'declined')
    expect(declined).toEqual({ type: 'declined', seat: 2, team: 0 })
    expect(p.of('resignEvent')[0]).toEqual({ type: 'proposed', seat: 0, team: 0 })
    await p.waitState((s) => s.teamResignCooldowns[0] === 2)
    expect(p.state.teamResignSeat).toEqual([-1, -1])
    expect(p.state.phase).toBe('in_game')
    expect(p.state.seats[0]?.status).toBe('active')
    const rows = await rowsOf(matchId)
    expect(rows.find((r) => r.type === 'resign_response')).toMatchObject({
      seat: 2,
      payload: { proposer: 0, accept: false, bot: true },
    })
    await p.leave()
  })

  it('a bot teammate agrees when the team is clearly losing', async () => {
    // South is a person with a bot partner at North; West and East are people.
    const players = await startGame([await guest(h), await guest(h), await guest(h)], {
      botSeats: [2],
    })
    const south = at(players, 0)
    expect(players.map((p) => p.seat).sort()).toEqual([0, 1, 3])
    let losing = false
    for (let i = 0; i < 400 && !losing; i++) {
      await south.waitState(
        (s) => s.phase !== 'in_game' || [0, 1, 3].includes(s.seatToMove),
        10_000,
        'a human turn',
      )
      if (south.state.phase !== 'in_game') break
      const game = Game.fromPosition(south.state.positionString)
      try {
        const snap = game.snapshot()
        if (botAcceptsTeamResign(snap, 2) && snap.statuses[0] !== 'frozen') {
          losing = true
          break
        }
        // South hangs its pieces (a move the next player can capture, else any quiet move);
        // West and East capture greedily, so South–North fall behind.
        let move: string | undefined
        if (south.state.seatToMove === 0) move = hangingMove(game)
        await moveOnce(players, move)
      } finally {
        game.free()
      }
    }
    expect(losing).toBe(true)
    south.send('resign')
    const accepted = await south.waitMessage('resignEvent', (e) => e.type === 'accepted')
    expect(accepted).toEqual({ type: 'accepted', seat: 2, team: 0 })
    const over = await south.waitMessage('gameOver')
    expect(over.result).toEqual({ type: 'teams_winner', team: 'west_east' })
    expect(over.endReason).toBe('team_resigned')
    await leaveAll(players)
  })
})

/** A quiet move whose piece the next seat can capture right away (else the first quiet move). */
function hangingMove(game: Game): string | undefined {
  const quiet = game.legalMoves().filter((m: MoveView) => !m.capture)
  for (const m of quiet) {
    const trial = game.clone()
    try {
      trial.applyMove(m.notation)
      if (!trial.snapshot().isOver && trial.legalMoves().some((r) => r.capture && r.to === m.to)) {
        return m.notation
      }
    } finally {
      trial.free()
    }
  }
  return quiet[0]?.notation
}

describe('Free-for-All', () => {
  it('a resignation needs no vote and respondResign is refused', async () => {
    const players = await startGame(await fourGuests(), { mode: 'ffa' })
    const south = at(players, 0)
    expect(south.state.teamResignSeat).toEqual([-1, -1])
    expect((await at(players, 1).expectError('respondResign', { accept: true })).code).toBe(
      'no_resign_proposal',
    )
    at(players, 2).send('resign')
    const ev = await south.waitMessage('events', (e) => e.action === 'resign')
    expect(ev.events).toEqual([
      { type: 'defeat', seat: 'north', reason: 'resign' },
      { type: 'army_removed', seat: 'north' },
    ])
    await south.waitState((s) => s.seats[2]?.status === 'removed')
    expect(south.of('resignEvent')).toEqual([])
    expect(south.state.teamResignSeat).toEqual([-1, -1])
    await leaveAll(players)
  })
})
