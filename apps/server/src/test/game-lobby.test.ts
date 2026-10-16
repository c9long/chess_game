import { LEGAL_VERSIONS } from '@game/config'
import { legalAcceptances, users } from '@game/db'
import { PROTOCOL_VERSION, ROOM_NAMES } from '@game/protocol'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Browser,
  createLobby,
  createOptions,
  FakeBotClient,
  type GameHarness,
  guest,
  joinLobby,
  matchmakeError,
  type Player,
  registered,
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

describe('authentication and eligibility', () => {
  it('refuses matchmaking without a session', async () => {
    const anon = new Browser(h)
    expect(await matchmakeError(anon.sdk().create(ROOM_NAMES.match, createOptions()))).toBe(
      'unauthorized',
    )
    expect(await matchmakeError(anon.sdk().joinOrCreate(ROOM_NAMES.lobby, {}))).toBe('unauthorized')
  })

  it('refuses players who have not accepted the current Terms', async () => {
    const b = await guest(h)
    await h.server.ctx.db.delete(legalAcceptances).where(eq(legalAcceptances.userId, b.userId))
    expect(await matchmakeError(b.sdk().create(ROOM_NAMES.match, createOptions()))).toBe(
      'legal_acceptance_required',
    )
    expect(LEGAL_VERSIONS.terms).toBeTruthy()
  })

  it('refuses registered accounts without a username', async () => {
    const b = await registered(h)
    await h.server.ctx.db.update(users).set({ username: null }).where(eq(users.id, b.userId))
    expect(await matchmakeError(b.sdk().create(ROOM_NAMES.match, createOptions()))).toBe(
      'username_required',
    )
  })

  it('accepts a typographic apostrophe in the lobby name and stores a plain one', async () => {
    const b = await guest(h)
    const host = await createLobby(b, { name: 'linkedlist’s game' })
    expect(host.state.name).toBe("linkedlist's game")
  })

  it('validates create options and the protocol version', async () => {
    const b = await guest(h)
    const sdk = b.sdk()
    expect(await matchmakeError(sdk.create(ROOM_NAMES.match, createOptions({ name: 'x' })))).toBe(
      'invalid_options',
    )
    expect(
      await matchmakeError(sdk.create(ROOM_NAMES.match, createOptions({ name: 'bad\u0000name' }))),
    ).toBe('invalid_options')
    expect(
      await matchmakeError(
        sdk.create(ROOM_NAMES.match, { ...createOptions(), protocolVersion: 99 as 1 }),
      ),
    ).toBe('protocol_mismatch')
    expect(
      await matchmakeError(sdk.create(ROOM_NAMES.match, createOptions({ pickMode: 'draft' }))),
    ).toBe('not_implemented')
    // Only lobby/match rooms and the allowed methods are reachable.
    expect(await matchmakeError(sdk.joinOrCreate(ROOM_NAMES.match, createOptions()))).toBe(
      'room_not_joinable',
    )
  })

  it('accepts a bearer token (native clients)', async () => {
    const b = await guest(h)
    const token = b.cookies.get('better-auth.session_token')
    expect(token).toBeTruthy()
    const native = new Browser(h)
    const sdk = native.sdk()
    sdk.auth.token = decodeURIComponent(token as string).split('.')[0] as string
    const room = await sdk.create(ROOM_NAMES.match, createOptions({ name: 'Native lobby' }))
    expect(room.roomId).toBeTruthy()
    await room.leave()
  })
})

describe('lobby browser and lobbies', () => {
  it('lists public lobbies live with their metadata', async () => {
    const watcher = await guest(h)
    const lobby = await watcher.sdk().joinOrCreate(ROOM_NAMES.lobby, {})
    const listings: Record<string, { metadata: Record<string, unknown> }> = {}
    lobby.onMessage('rooms', (rooms: { roomId: string; metadata: Record<string, unknown> }[]) => {
      for (const r of rooms) listings[r.roomId] = r
    })
    lobby.onMessage('+', ([id, r]: [string, { metadata: Record<string, unknown> }]) => {
      listings[id] = r
    })
    const hostB = await guest(h)
    const host = await createLobby(hostB, { name: 'Open table', mode: 'teams', timeControl: '3+2' })
    await waitFor(() => Boolean(listings[host.room.roomId]), 5_000, 'listing')
    expect(listings[host.room.roomId]?.metadata).toEqual({
      name: 'Open table',
      mode: 'teams',
      timeControl: '3+2',
      seatsFilled: 1,
      locked: false,
      phase: 'waiting',
      pickMode: 'blind',
    })
    const other = await joinLobby(await guest(h), host.room.roomId)
    await waitFor(
      () => listings[host.room.roomId]?.metadata.seatsFilled === 2,
      5_000,
      'seatsFilled 2',
    )
    await other.leave()
    await host.leave()
    await lobby.leave()
  })

  it('protects private lobbies with a hashed password and limits attempts', async () => {
    const host = await createLobby(await guest(h), { name: 'Private', password: 'open sesame' })
    expect(host.state.hasPassword).toBe(true)
    const id = host.room.roomId
    const a = await guest(h)
    expect(await matchmakeError(a.sdk().joinById(id, { protocolVersion: PROTOCOL_VERSION }))).toBe(
      'invalid_password',
    )
    for (let i = 0; i < 4; i++) {
      expect(
        await matchmakeError(
          a.sdk().joinById(id, { protocolVersion: PROTOCOL_VERSION, password: 'nope' }),
        ),
      ).toBe('invalid_password')
    }
    // 5 failures within a minute: even the right password is refused now, from this IP...
    expect(
      await matchmakeError(
        a.sdk().joinById(id, { protocolVersion: PROTOCOL_VERSION, password: 'open sesame' }),
      ),
    ).toBe('too_many_attempts')
    // ...and for this room from any IP.
    const b = await guest(h)
    expect(
      await matchmakeError(
        b.sdk().joinById(id, { protocolVersion: PROTOCOL_VERSION, password: 'open sesame' }),
      ),
    ).toBe('too_many_attempts')
    await host.leave()

    // A fresh private room admits the right password.
    const host2 = await createLobby(await guest(h), { name: 'Private 2', password: 'pw' })
    const c = await guest(h)
    const joined = await joinLobby(c, host2.room.roomId, 'pw')
    expect(joined.seat).toBe(1)
    await joined.leave()
    await host2.leave()
  })

  it('seats players, enforces host controls and starts with bots', async () => {
    const hostB = await guest(h)
    const host = await createLobby(hostB, { name: 'Bots welcome' })
    expect(host.seat).toBe(0)
    expect(host.state.hostSeat).toBe(0)
    const p2b = await guest(h)
    const p2 = await joinLobby(p2b, host.room.roomId)
    expect(p2.seat).toBe(1)

    // One seat per user: a second connection is refused, as is another room.
    expect(
      await matchmakeError(
        p2b.sdk().joinById(host.room.roomId, { protocolVersion: PROTOCOL_VERSION }),
      ),
    ).toBe('already_seated')
    expect(await matchmakeError(p2b.sdk().create(ROOM_NAMES.match, createOptions()))).toBe(
      'already_in_room',
    )

    // Host-only actions.
    expect((await p2.expectError('addBot', { seat: 2, level: '1200' })).code).toBe('not_host')
    expect((await p2.expectError('startGame')).code).toBe('not_host')
    expect((await host.expectError('addBot', { seat: 1, level: '1200' })).code).toBe(
      'seat_occupied',
    )
    expect((await host.expectError('addBot', { seat: 2, level: '1000' })).code).toBe(
      'invalid_message',
    )

    host.send('addBot', { seat: 2, level: '1200' })
    host.send('addBot', { seat: 3, level: 'max' })
    await host.waitState((s) => s.seats[3]?.isBot === true)
    const s = host.state
    expect(s.phase).toBe('civ_select')
    expect(s.seats[2]).toMatchObject({ isBot: true, botLevel: '1200', ready: true })
    expect(s.seats[2]?.civ).not.toBe('')
    host.send('setBotCiv', { seat: 3, civ: 'mali' })
    await host.waitState((st) => st.seats[3]?.civ === 'mali')
    expect((await host.expectError('setBotCiv', { seat: 1, civ: 'mali' })).code).toBe('not_a_bot')

    // Start conditions: civs and ready.
    expect((await host.expectError('startGame')).code).toBe('civ_required')
    expect((await host.expectError('setReady', { ready: true })).code).toBe('civ_required')
    host.send('setCiv', { civ: 'japan' })
    p2.send('setCiv', { civ: 'japan' }) // duplicates allowed (blind pick)
    await host.waitState((st) => st.seats[0]?.civ === 'japan' && st.seats[1]?.civ === 'japan')
    host.send('setReady', { ready: true })
    await host.waitState((st) => st.seats[0]?.ready === true)
    expect((await host.expectError('startGame')).code).toBe('not_ready')
    p2.send('setReady', { ready: true })
    await host.waitState((st) => st.seats[1]?.ready === true)

    // Swap seats (choosing teams), then start.
    host.send('swapSeats', { a: 1, b: 2 })
    await host.waitState((st) => st.seats[1]?.isBot === true && p2.seat === 2)
    host.send('startGame')
    await host.waitState((st) => st.phase === 'in_game', 5_000, 'in_game')
    expect(host.state.matchId).toMatch(/[0-9a-f-]{36}/)
    expect(host.state.rated).toBe(false)
    expect(host.state.seats.map((x) => x.status)).toEqual(['active', 'active', 'active', 'active'])
    expect((await p2.expectError('setCiv', { civ: 'usa' })).code).toBe('wrong_phase')
    await host.leave()
    await p2.leave()
  })

  it('kicks players (no rejoin) and transfers host when the host leaves', async () => {
    const host = await createLobby(await guest(h), { name: 'Kick test' })
    const victimB = await guest(h)
    const victim = await joinLobby(victimB, host.room.roomId)
    const third = await joinLobby(await guest(h), host.room.roomId)
    host.send('kick', { seat: 1 })
    await victim.waitMessage('kicked')
    await host.waitState((s) => !s.seats[1]?.occupied)
    expect(
      await matchmakeError(
        victimB.sdk().joinById(host.room.roomId, { protocolVersion: PROTOCOL_VERSION }),
      ),
    ).toBe('kicked')
    await host.leave()
    await third.waitState((s) => s.hostSeat === 2, 5_000, 'host transfer')
    const welcome = third.of('welcome')[0]
    expect(welcome?.seat).toBe(2)
    await third.leave()
  })
})

describe('messages', () => {
  let host: Player

  beforeAll(async () => {
    host = await createLobby(await guest(h), { name: 'Messages' })
  })

  afterAll(async () => {
    await host.leave()
  })

  it('answers reserved messages with not_implemented', async () => {
    for (const type of ['resign', 'offerDraw', 'respondDraw', 'takebackRequest', 'chat.send']) {
      const err = await host.expectError(type, {})
      expect(err).toEqual({ code: 'not_implemented', requestType: type })
    }
  })

  it('rejects unknown and malformed messages', async () => {
    expect((await host.expectError('teleport', {})).code).toBe('unknown_message')
    expect((await host.expectError('setCiv', { civ: 'atlantis' })).code).toBe('invalid_message')
    expect((await host.expectError('move', { move: 'c2c4' })).code).toBe('wrong_phase')
  })
})
