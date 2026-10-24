/**
 * AFK bot takeover (PLAN §2 "Abandon"): in casual multiplayer games a player whose reconnect
 * grace runs out while another human is still connected is replaced by a bot, which plays on
 * the seat's own clock until the player rejoins. Ranked, solo and humanless games, and a
 * deliberate "Leave game", still abandon.
 */
import { matchEvents, matches, matchPlayers, ratings } from '@game/db'
import { applyReplayAction, type MatchReplayResponse, PROTOCOL_VERSION } from '@game/protocol'
import { Game, type GameConfigInput } from '@game/rules'
import { asc, eq, inArray } from 'drizzle-orm'
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
  matchmakeError,
  type Player,
  registered,
  sleep,
  startGameHarness,
  waitFor,
} from './game-harness.ts'

const BASE_MS = 30_000
const GRACE_MS = 300
let h: GameHarness
const bots = new FakeBotClient()
const db = () => h.server.ctx.db

beforeAll(async () => {
  h = await startGameHarness(
    { DEV_CLOCK_BASE_MS: String(BASE_MS), RECONNECT_GRACE_SECONDS: String(GRACE_MS / 1000) },
    { botClient: bots },
  )
})

afterAll(async () => {
  await h.close()
})

/** Humans seated in order from South, bots in `bots` seats, everyone ready, game started. */
async function startGame(
  browsers: Browser[],
  opts: { bots?: { seat: 1 | 2 | 3; level: string }[]; ranked?: boolean } = {},
): Promise<Player[]> {
  const [first, ...rest] = browsers
  const host = await createLobby(first as Browser, {
    name: 'Takeover game',
    ...(opts.ranked ? { ranked: true } : {}),
  })
  const players = [host]
  for (const b of rest) players.push(await joinLobby(b, host.room.roomId))
  for (const bot of opts.bots ?? []) host.send('addBot', bot)
  await host.waitState((s) => s.seats.every((x) => x.occupied), 5_000, 'all seats filled')
  for (const p of players) p.send('setCiv', { civ: 'france' })
  for (const p of players) await p.waitState((s) => s.seats[p.seat]?.civ === 'france')
  for (const p of players) p.send('setReady', { ready: true })
  await host.waitState((s) => s.seats.every((x) => x.isBot || x.ready))
  host.send('startGame')
  await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
  return players
}

const at = (players: Player[], seat: number) => players.find((p) => p.seat === seat) as Player
const bySeat = (players: Player[]) =>
  [0, 1, 2, 3].map((i) => at(players, i)) as [Player, Player, Player, Player]

/** Plays `p`'s turn (it must be to move) and waits for its `events` message. */
async function move(p: Player) {
  const seq = p.state.actionSeq + 1
  await p.waitState((s) => s.seatToMove === p.seat, 5_000, `seat ${p.seat} to move`)
  p.send('move', { move: greedyMove(p.state.positionString) })
  return p.waitMessage('events', (e) => e.seq === seq)
}

async function rowsOf(matchId: string) {
  return db()
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.matchId, matchId))
    .orderBy(asc(matchEvents.seq))
}

async function finishedMatch(matchId: string) {
  let m: typeof matches.$inferSelect | undefined
  const deadline = Date.now() + 20_000
  while (m?.status !== 'finished' && m?.status !== 'aborted' && Date.now() < deadline) {
    await sleep(50)
    ;[m] = await db().select().from(matches).where(eq(matches.id, matchId))
  }
  return m
}

/** Waits until the match has a stored event row matching `pred` (events are flushed in batches). */
async function waitForRow(
  matchId: string,
  pred: (r: typeof matchEvents.$inferSelect) => boolean,
  what: string,
) {
  const deadline = Date.now() + 5_000
  for (;;) {
    const rows = await rowsOf(matchId)
    if (rows.some(pred)) return rows
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(25)
  }
}

describe('AFK bot takeover in casual games', () => {
  it('hands a seat whose grace ran out to a bot at the strongest level in the game, on the seat’s own clock', async () => {
    bots.delayMs = 0
    const browsers = await Promise.all([guest(h), guest(h), guest(h)])
    const players = await startGame(browsers, { bots: [{ seat: 3, level: '1500' }] })
    const south = at(players, 0)
    const west = at(players, 1)
    const north = at(players, 2)
    const westName = (browsers[1] as Browser).name
    const roomId = south.room.roomId
    await move(south)

    // West's turn and clock run while it is away; then the bot plays on from that clock.
    west.drop()
    const started = await south.waitMessage('takeoverEvent', undefined, 3_000)
    expect(started).toEqual({ type: 'started', seat: 1, name: westName, botLevel: '1500' })
    const botMove = await south.waitMessage('events', (e) => e.seq === 2, 3_000)
    expect(botMove).toMatchObject({ action: 'move', seat: 1 })
    expect(botMove.clockMs).toBeLessThanOrEqual(BASE_MS - GRACE_MS)
    expect(botMove.clockMs).toBeGreaterThan(0)
    expect(bots.requests.at(-1)).toMatchObject({ level: '1500' })
    expect(bots.requests.at(-1)?.clockMs).toBeLessThanOrEqual(BASE_MS - GRACE_MS)
    await south.waitState((s) => s.seats[1]?.isBot === true)
    expect(south.state.seats[1]).toMatchObject({
      isBot: true,
      botLevel: '1500',
      displayName: `Bot 1500 (for ${westName})`,
      connected: true,
      status: 'active',
      sessionId: '',
    })

    // It keeps playing West's turns.
    await move(north)
    await south.waitMessage('events', (e) => e.seq === 4 && e.seat === 3)
    await move(south)
    expect(await south.waitMessage('events', (e) => e.seq === 6)).toMatchObject({ seat: 1 })
    expect(south.of('events').some((e) => e.action === 'abandon')).toBe(false)

    const rows = await waitForRow(south.state.matchId, (r) => r.type === 'takeover', 'takeover')
    expect(rows.find((r) => r.type === 'takeover')).toMatchObject({
      seat: 1,
      payload: { type: 'started', botLevel: '1500', actionSeq: 1 },
    })
    expect(rows.some((r) => r.type === 'abandon')).toBe(false)

    // West was free to go: once seated in another game, it can't take this seat back too.
    const elsewhere = await createLobby(browsers[1] as Browser, { name: 'Elsewhere' })
    expect(
      await matchmakeError(
        (browsers[1] as Browser).sdk().joinById(roomId, { protocolVersion: PROTOCOL_VERSION }),
      ),
    ).toBe('already_in_room')
    for (const p of [elsewhere, south, north]) await p.leave()
  })

  it('gives the seat back when its player rejoins, dropping the bot’s pending move', async () => {
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const players = await startGame(browsers)
    const [south, west, north, east] = bySeat(players)
    const westName = (browsers[1] as Browser).name
    await move(south)

    // A slow bot is still thinking about West's move when West comes back.
    bots.delayMs = 1_500
    west.drop()
    // No bots in the game: the stand-in plays at 1200.
    expect(await south.waitMessage('takeoverEvent', undefined, 3_000)).toMatchObject({
      type: 'started',
      seat: 1,
      botLevel: '1200',
    })
    await waitFor(() => bots.requests.length > 0 && bots.calls > 0, 3_000, 'bot thinking')
    const back = await joinLobby(browsers[1] as Browser, south.room.roomId)
    expect(back.of('welcome')[0]?.seat).toBe(1)
    expect(await south.waitMessage('takeoverEvent', (e) => e.type === 'ended')).toEqual({
      type: 'ended',
      seat: 1,
      name: westName,
      botLevel: '1200',
    })
    await south.waitState((s) => s.seats[1]?.isBot === false)
    expect(south.state.seats[1]).toMatchObject({ displayName: westName, botLevel: '' })
    expect(back.seat).toBe(1)

    // The bot's answer arrives after the handback and is dropped: West moves itself.
    await sleep(1_800)
    expect(south.state.actionSeq).toBe(1)
    bots.delayMs = 0
    expect(await move(back)).toMatchObject({ seq: 2, seat: 1, action: 'move' })

    const matchId = south.state.matchId
    const rows = await waitForRow(matchId, (r) => r.type === 'move' && r.seat === 1, 'West moved')
    const mine = rows.filter((r) => r.seat === 1)
    expect(mine.map((r) => r.type)).toEqual([
      'disconnect',
      'takeover',
      'takeover',
      'reconnect',
      'move',
    ])
    expect(mine[2]?.payload).toMatchObject({ type: 'ended', botLevel: '1200' })

    // West plays on as before; the bot no longer moves for it.
    await move(north)
    await move(east)
    await move(south)
    await sleep(200)
    expect(south.state.seatToMove).toBe(1)
    expect(await move(back)).toMatchObject({ seat: 1 })
    for (const p of [south, back, north, east]) await p.leave()
  })

  it('keeps the result on the player’s seat when the bot finishes the game, and the replay re-simulates', async () => {
    bots.delayMs = 0
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const players = await startGame(browsers)
    const [south, west, north, east] = bySeat(players)
    await move(south)
    west.drop()
    await south.waitMessage('takeoverEvent', undefined, 3_000)
    await south.waitMessage('events', (e) => e.seq === 2 && e.seat === 1, 3_000)
    await move(north)
    // Everyone else resigns: the bot-played West is the last one standing.
    for (const p of [south, north, east]) {
      p.send('resign')
      await south.waitMessage('events', (e) => e.action === 'resign' && e.seat === p.seat)
    }
    const over = await south.waitMessage('gameOver', undefined, 10_000)
    expect(over.result).toEqual({ type: 'ffa_winner', seat: 'west' })
    const matchId = south.state.matchId
    const m = await finishedMatch(matchId)
    // `finished` means the server's re-simulation of the stored actions matched.
    expect(m?.status).toBe('finished')
    const seats = await db()
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(asc(matchPlayers.seat))
    expect(seats[1]).toMatchObject({ userId: (browsers[1] as Browser).userId, placement: 1 })
    expect(seats[1]?.botLevel).toBeNull()

    // The returning player can replay it; the takeover row is not an action.
    const res = await (browsers[1] as Browser).get(`/api/matches/${matchId}/replay`)
    expect(res.status).toBe(200)
    const replay = res.body as unknown as MatchReplayResponse
    expect(replay.actions.map((a) => [a.action, a.seat])).toEqual([
      ['move', 0],
      ['move', 1],
      ['move', 2],
      ['resign', 0],
      ['resign', 2],
      ['resign', 3],
    ])
    const game = Game.create(replay.config as unknown as GameConfigInput)
    try {
      for (const a of replay.actions) applyReplayAction(game, a)
      expect(game.positionString()).toBe(replay.finalPosition)
    } finally {
      game.free()
    }

    // A rematch doesn't carry the stand-in over: West's seat opens up to anyone.
    await south.waitState((s) => s.phase === 'finished')
    expect(south.state.rematchVotes[1]).toBe(-1)
    south.send('proposeRematch')
    await south.waitMessage('rematchEvent', (e) => e.type === 'proposed')
    north.send('respondRematch', { accept: true })
    east.send('respondRematch', { accept: true })
    const ready = await south.waitMessage('rematchEvent', (e) => e.type === 'ready', 5_000)
    const fresh = await joinLobby(browsers[0] as Browser, ready.roomId as string)
    expect(fresh.state.seats[1]).toMatchObject({ occupied: false, isBot: false, heldFor: '' })
    for (const p of [fresh, south, north, east]) await p.leave()
  })

  it('lets a player whose seat a bot finished open the result after sitting down elsewhere', async () => {
    bots.delayMs = 0
    const browsers = await Promise.all([guest(h), guest(h), guest(h), guest(h)])
    const players = await startGame(browsers)
    const [south, west, north, east] = bySeat(players)
    const roomId = south.room.roomId
    await move(south)
    west.drop()
    await south.waitMessage('takeoverEvent', undefined, 3_000)
    for (const p of [south, north, east]) {
      p.send('resign')
      await south.waitMessage('events', (e) => e.action === 'resign' && e.seat === p.seat)
    }
    await south.waitMessage('gameOver', undefined, 10_000)

    const elsewhere = await createLobby(browsers[1] as Browser, { name: 'Elsewhere' })
    const back = await joinLobby(browsers[1] as Browser, roomId)
    expect(back.of('welcome')[0]?.seat).toBe(1)
    expect(back.state.phase).toBe('finished')
    for (const p of [back, elsewhere, south, north, east]) await p.leave()
  })

  it('a game a bot stood in for feeds no shadow ratings, even after its player came back', async () => {
    bots.delayMs = 0
    const browsers = await Promise.all([registered(h), registered(h), registered(h)])
    const players = await startGame(browsers, { bots: [{ seat: 3, level: '1500' }] })
    const [south, west, north] = bySeat(players)
    await move(south)
    west.drop()
    await south.waitMessage('takeoverEvent', undefined, 3_000)
    const back = await joinLobby(browsers[1] as Browser, south.room.roomId)
    await south.waitMessage('takeoverEvent', (e) => e.type === 'ended')
    for (const p of [south, back, north]) {
      p.send('resign')
      await south.waitMessage('events', (e) => e.action === 'resign' && e.seat === p.seat)
    }
    const over = await south.waitMessage('gameOver', undefined, 10_000)
    expect(over.result).toEqual({ type: 'ffa_winner', seat: 'east' })
    expect((await finishedMatch(south.state.matchId))?.status).toBe('finished')
    const ids = browsers.map((b) => b.userId)
    expect(await db().select().from(ratings).where(inArray(ratings.userId, ids))).toEqual([])
    for (const p of [south, back, north]) await p.leave()
  })

  it('a bot standing in answers the draw offer its player left unanswered', async () => {
    bots.delayMs = 0
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const [south, west, north, east] = bySeat(players)
    south.send('offerDraw')
    await south.waitMessage('drawEvent', (e) => e.type === 'offered')
    west.drop()
    north.send('respondDraw', { accept: true })
    east.send('respondDraw', { accept: true })
    await south.waitMessage('takeoverEvent', undefined, 3_000)
    // Even material: a bot declines (it accepts only when well behind).
    const declined = await south.waitMessage('drawEvent', (e) => e.type === 'declined', 3_000)
    expect(declined.seat).toBe(1)
    expect(south.state.phase).toBe('in_game')
    for (const p of [south, north, east]) await p.leave()
  })
})

describe('games that still abandon', () => {
  it('a deliberate leave abandons, even in a casual game', async () => {
    const players = await startGame(await Promise.all([guest(h), guest(h), guest(h), guest(h)]))
    const south = at(players, 0)
    await at(players, 1).leave()
    const abandon = await south.waitMessage('events', (e) => e.action === 'abandon', 3_000)
    expect(abandon.seat).toBe(1)
    await sleep(GRACE_MS + 100)
    expect(south.of('takeoverEvent')).toHaveLength(0)
    for (const i of [0, 2, 3]) await at(players, i).leave()
  })

  it('ranked games abandon after the grace', async () => {
    const players = await startGame(
      await Promise.all([registered(h), registered(h), registered(h), registered(h)]),
      { ranked: true },
    )
    const south = at(players, 0)
    at(players, 1).drop()
    const abandon = await south.waitMessage('events', (e) => e.action === 'abandon', 3_000)
    expect(abandon.seat).toBe(1)
    expect(south.of('takeoverEvent')).toHaveLength(0)
    expect(south.state.seats[1]?.isBot).toBe(false)
    for (const i of [0, 2, 3]) await at(players, i).leave()
  })

  it('a casual game with no other human left abandons the last one', async () => {
    const human = await guest(h)
    const [p] = (await startGame([human], {
      bots: [
        { seat: 1, level: '600' },
        { seat: 2, level: '600' },
        { seat: 3, level: '600' },
      ],
    })) as [Player]
    const matchId = p.state.matchId
    p.drop()
    const rows = await waitForRow(matchId, (r) => r.type === 'abandon', 'abandon')
    expect(rows.find((r) => r.type === 'abandon')?.seat).toBe(0)
    expect(rows.some((r) => r.type === 'takeover')).toBe(false)
  })

  it('solo games abandon their player', async () => {
    const p = await createSolo(await guest(h))
    await p.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
    const matchId = p.state.matchId
    p.drop()
    expect((await finishedMatch(matchId))?.endReason).toBe('player_eliminated')
    const rows = await rowsOf(matchId)
    expect(rows.find((r) => r.type === 'abandon')?.seat).toBe(0)
    expect(rows.some((r) => r.type === 'takeover')).toBe(false)
  })
})
