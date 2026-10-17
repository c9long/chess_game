import { readFileSync } from 'node:fs'
import { Encoder, Reflection } from '@colyseus/schema'
import { describe, expect, it } from 'vitest'
import { clockOffset, matchClient, remainingNow } from './client.ts'
import {
  CIV_SLUGS,
  checkLobbyNameFormat,
  clientMessageSchemas,
  createOptionsSchema,
  createSoloOptionsSchema,
  DRAW_OFFER_COOLDOWN_MOVES,
  DRAW_VOTE,
  ERROR_CODES,
  GAME_ACTIONS,
  isReservedMessageType,
  isUntimed,
  joinOptionsSchema,
  PROTOCOL_VERSION,
  RESERVED_MESSAGE_TYPES,
  RESIGN_EVENT_TYPES,
  serverMessageSchemas,
  TEAM_RESIGN_COOLDOWN_MOVES,
  teamOfSeat,
  UNTIMED,
} from './index.ts'
import { buildProtocolJsonSchema } from './json-schema.ts'
import { createMatchState } from './state.ts'

describe('join options', () => {
  it('accepts a valid create request and defaults pickMode to blind', () => {
    const parsed = createOptionsSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      name: '  Friday game ',
      mode: 'teams',
      timeControl: '3+2',
    })
    expect(parsed).toEqual({
      protocolVersion: 1,
      kind: 'lobby',
      name: 'Friday game',
      mode: 'teams',
      timeControl: '3+2',
      pickMode: 'blind',
      ranked: false,
    })
  })

  it('takes a ranked flag for lobbies only (never for solo games)', () => {
    const base = { protocolVersion: 1, name: 'Ladder', mode: 'ffa', timeControl: '10+0' }
    expect(createOptionsSchema.parse({ ...base, ranked: true })).toMatchObject({ ranked: true })
    expect(createOptionsSchema.safeParse({ ...base, ranked: 'yes' }).success).toBe(false)
    const solo = {
      protocolVersion: 1,
      kind: 'solo',
      mode: 'ffa',
      timeControl: UNTIMED,
      civ: CIV_SLUGS[0],
      botLevel: '1200',
    }
    expect(createOptionsSchema.safeParse(solo).success).toBe(true)
    expect(createOptionsSchema.safeParse({ ...solo, ranked: true }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, ranked: false }).success).toBe(false)
    expect(ERROR_CODES).toContain('account_required')
    expect(ERROR_CODES).toContain('ranked_no_bots')
  })

  it('rejects unknown modes, time controls, extra keys and wrong versions', () => {
    const base = { protocolVersion: 1, name: 'Lobby', mode: 'ffa', timeControl: '10+0' }
    expect(createOptionsSchema.safeParse({ ...base, mode: 'duel' }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...base, timeControl: '1+0' }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...base, protocolVersion: 2 }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...base, name: 'ab' }).success).toBe(false)
    expect(joinOptionsSchema.safeParse({ protocolVersion: 1, password: 'x' }).success).toBe(true)
  })

  it('refuses the untimed time control for multiplayer lobbies', () => {
    const base = { protocolVersion: 1, name: 'Lobby', mode: 'ffa' }
    expect(createOptionsSchema.safeParse({ ...base, timeControl: UNTIMED }).success).toBe(false)
    expect(
      createOptionsSchema.safeParse({ ...base, kind: 'lobby', timeControl: UNTIMED }).success,
    ).toBe(false)
    expect(
      createOptionsSchema.safeParse({ ...base, kind: 'lobby', timeControl: '3+2' }).success,
    ).toBe(true)
  })
})

describe('solo create options', () => {
  const solo = {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'solo',
    mode: 'ffa',
    timeControl: UNTIMED,
    civ: 'mali',
    botLevel: '1200',
  } as const

  it('accepts a solo game with a civ and a bot level, the name being optional', () => {
    expect(createOptionsSchema.parse(solo)).toEqual(solo)
    expect(createSoloOptionsSchema.safeParse(solo).success).toBe(true)
    const named = createOptionsSchema.parse({ ...solo, mode: 'teams', name: ' Practice ' })
    expect(named).toMatchObject({ kind: 'solo', mode: 'teams', name: 'Practice' })
    expect(createOptionsSchema.safeParse({ ...solo, botLevel: 'max' }).success).toBe(true)
  })

  it('rejects solo games without a civ or bot level, with a clock, or with lobby-only options', () => {
    const { civ: _civ, ...noCiv } = solo
    const { botLevel: _level, ...noLevel } = solo
    expect(createOptionsSchema.safeParse(noCiv).success).toBe(false)
    expect(createOptionsSchema.safeParse(noLevel).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, civ: 'atlantis' }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, botLevel: '1000' }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, timeControl: '10+0' }).success).toBe(false)
    const { timeControl: _tc, ...noTc } = solo
    expect(createOptionsSchema.safeParse(noTc).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, password: 'x' }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, pickMode: 'blind' }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, name: 'ab' }).success).toBe(false)
    expect(createOptionsSchema.safeParse({ ...solo, kind: 'duel' }).success).toBe(false)
    // A lobby request carrying solo-only fields is refused too.
    expect(
      createOptionsSchema.safeParse({
        protocolVersion: 1,
        name: 'Lobby',
        mode: 'ffa',
        timeControl: '10+0',
        civ: 'mali',
      }).success,
    ).toBe(false)
  })

  it('knows the untimed id', () => {
    expect(isUntimed(UNTIMED)).toBe(true)
    expect(isUntimed('10+0')).toBe(false)
  })
})

describe('lobby names', () => {
  it('accepts typographic apostrophes and quotes (phones and macOS insert them) as plain ones', () => {
    expect(checkLobbyNameFormat('linkedlist’s game')).toEqual({
      ok: true,
      name: "linkedlist's game",
    })
    expect(checkLobbyNameFormat('“Friday” night')).toEqual({ ok: true, name: '"Friday" night' })
    expect(checkLobbyNameFormat("Bob's  table ")).toEqual({ ok: true, name: "Bob's table" })
    expect(checkLobbyNameFormat('Partie de Zoë')).toMatchObject({ ok: true })
    expect(checkLobbyNameFormat('四人象棋')).toMatchObject({ ok: true })
  })

  it('rejects names that are too short, too long or use unsupported symbols', () => {
    expect(checkLobbyNameFormat('ab')).toMatchObject({ ok: false })
    expect(checkLobbyNameFormat('x'.repeat(41))).toMatchObject({ ok: false })
    expect(checkLobbyNameFormat('<script>')).toMatchObject({ ok: false })
    expect(checkLobbyNameFormat('bad\u0000name')).toMatchObject({ ok: false })
    expect(checkLobbyNameFormat('party 🎉')).toMatchObject({ ok: false })
  })
})

describe('client messages', () => {
  it('validates payloads', () => {
    expect(clientMessageSchemas.addBot.safeParse({ seat: 2, level: '1500' }).success).toBe(true)
    expect(clientMessageSchemas.addBot.safeParse({ seat: 4, level: '1500' }).success).toBe(false)
    expect(clientMessageSchemas.addBot.safeParse({ seat: 1, level: '1000' }).success).toBe(false)
    expect(clientMessageSchemas.setCiv.safeParse({ civ: CIV_SLUGS[0] }).success).toBe(true)
    expect(clientMessageSchemas.setCiv.safeParse({ civ: 'atlantis' }).success).toBe(false)
    expect(clientMessageSchemas.move.safeParse({ move: 'c2c4' }).success).toBe(true)
  })

  it('knows the reserved namespaces', () => {
    for (const t of ['takebackRequest', 'takebackRespond', 'takebackAccept', 'chat.send']) {
      expect(isReservedMessageType(t)).toBe(true)
    }
    for (const t of ['move', 'resign', 'offerDraw', 'respondDraw']) {
      expect(isReservedMessageType(t)).toBe(false)
    }
    expect(RESERVED_MESSAGE_TYPES).not.toContain('resign')
  })

  it('validates resign and draw-offer payloads', () => {
    expect(clientMessageSchemas.resign.safeParse({}).success).toBe(true)
    expect(clientMessageSchemas.resign.safeParse({ seat: 1 }).success).toBe(false)
    expect(clientMessageSchemas.offerDraw.safeParse({}).success).toBe(true)
    expect(clientMessageSchemas.offerDraw.safeParse({ to: 2 }).success).toBe(false)
    expect(clientMessageSchemas.respondDraw.safeParse({ accept: true }).success).toBe(true)
    expect(clientMessageSchemas.respondDraw.safeParse({ accept: false }).success).toBe(true)
    expect(clientMessageSchemas.respondDraw.safeParse({}).success).toBe(false)
    expect(clientMessageSchemas.respondDraw.safeParse({ accept: 'yes' }).success).toBe(false)
    expect(clientMessageSchemas.respondDraw.safeParse({ accept: true, x: 1 }).success).toBe(false)
  })

  it('describes resign and agreed-draw actions and draw events from the server', () => {
    expect(GAME_ACTIONS).toEqual(['move', 'timeout', 'abandon', 'resign', 'agreed_draw'])
    const clock = {
      remainingMs: [0, 0, 0, 0],
      runningSeat: -1,
      serverTimestamp: 1,
      turnStartedAt: 0,
    }
    const events = serverMessageSchemas.events
    const base = {
      seq: 3,
      seat: 1,
      notation: null,
      events: [],
      positionString: 'x',
      seatToMove: 2,
      clock,
    }
    expect(events.safeParse({ ...base, action: 'resign' }).success).toBe(true)
    expect(events.safeParse({ ...base, action: 'agreed_draw', seatToMove: -1 }).success).toBe(true)
    expect(events.safeParse({ ...base, action: 'surrender' }).success).toBe(false)
    const draw = serverMessageSchemas.drawEvent
    expect(draw.safeParse({ type: 'offered', seat: 0, offerSeat: 0 }).success).toBe(true)
    expect(
      draw.safeParse({ type: 'lapsed', seat: 0, offerSeat: 0, reason: 'voters_changed' }).success,
    ).toBe(true)
    expect(draw.safeParse({ type: 'lapsed', seat: 0, offerSeat: 0, reason: 'bored' }).success).toBe(
      false,
    )
    expect(draw.safeParse({ type: 'withdrawn', seat: 0, offerSeat: 0 }).success).toBe(false)
    for (const code of [
      'not_playing',
      'draw_offer_pending',
      'draw_offer_cooldown',
      'no_draw_offer',
    ]) {
      expect(ERROR_CODES).toContain(code)
    }
    expect(DRAW_OFFER_COOLDOWN_MOVES).toBe(2)
    expect(DRAW_VOTE).toEqual({ notVoter: -1, pending: 0, accepted: 1 })
  })

  it('describes Teams resignation votes', () => {
    expect(clientMessageSchemas.resign.safeParse({}).success).toBe(true)
    const respond = clientMessageSchemas.respondResign
    expect(respond.safeParse({ accept: true }).success).toBe(true)
    expect(respond.safeParse({ accept: false }).success).toBe(true)
    expect(respond.safeParse({}).success).toBe(false)
    expect(respond.safeParse({ accept: 'yes' }).success).toBe(false)
    expect(respond.safeParse({ accept: true, seat: 2 }).success).toBe(false)
    const ev = serverMessageSchemas.resignEvent
    for (const type of RESIGN_EVENT_TYPES) {
      expect(ev.safeParse({ type, seat: 2, team: 0 }).success).toBe(true)
    }
    expect(RESIGN_EVENT_TYPES).toEqual(['proposed', 'accepted', 'declined', 'lapsed', 'immediate'])
    expect(ev.safeParse({ type: 'lapsed', seat: 1, team: 1, reason: 'round' }).success).toBe(true)
    expect(
      ev.safeParse({ type: 'lapsed', seat: 1, team: 1, reason: 'voters_changed' }).success,
    ).toBe(true)
    expect(
      ev.safeParse({ type: 'lapsed', seat: 1, team: 1, reason: 'voters_changed', outSeat: 3 })
        .success,
    ).toBe(true)
    expect(
      ev.safeParse({ type: 'lapsed', seat: 1, team: 1, reason: 'voters_changed', outSeat: 4 })
        .success,
    ).toBe(false)
    expect(ev.safeParse({ type: 'lapsed', seat: 1, team: 1, reason: 'bored' }).success).toBe(false)
    expect(ev.safeParse({ type: 'proposed', seat: 1, team: 2 }).success).toBe(false)
    expect(ev.safeParse({ type: 'withdrawn', seat: 1, team: 1 }).success).toBe(false)
    for (const code of [
      'resign_proposal_pending',
      'resign_proposal_cooldown',
      'no_resign_proposal',
    ]) {
      expect(ERROR_CODES).toContain(code)
    }
    expect(TEAM_RESIGN_COOLDOWN_MOVES).toBe(2)
  })

  it('maps seats to teams (S+N vs W+E)', () => {
    expect([0, 1, 2, 3].map((s) => teamOfSeat(s as 0 | 1 | 2 | 3))).toEqual([0, 1, 0, 1])
  })
})

describe('clock helpers', () => {
  it('counts down only the running seat', () => {
    const sync = {
      remainingMs: [1000, 2000, 3000, 4000] as [number, number, number, number],
      runningSeat: 1 as const,
      serverTimestamp: 10_000,
      turnStartedAt: 9_000,
    }
    const offset = clockOffset(sync, 9_500) // client clock 500 ms behind
    expect(remainingNow(sync, 9_800, offset)).toEqual([1000, 1700, 3000, 4000])
    expect(remainingNow(sync, 20_000, offset)[1]).toBe(0)
  })

  it('wraps a room with typed send/on', () => {
    const sent: unknown[] = []
    const client = matchClient({
      send: (type, payload) => sent.push([type, payload]),
      onMessage: () => () => {},
    })
    client.send('move', { move: 'c2c4' })
    expect(sent).toEqual([['move', { move: 'c2c4' }]])
  })
})

describe('state schema', () => {
  it('has 4 seats and encodes, with a reflectable definition', () => {
    const state = createMatchState()
    expect(state.seats.length).toBe(4)
    // No draw offer by default; the draw fields are appended after the v1 fields.
    expect(state.drawOfferSeat).toBe(-1)
    expect([...state.drawVotes]).toEqual([-1, -1, -1, -1])
    expect(state.drawOfferActionSeq).toBe(0)
    expect([...state.drawCooldowns]).toEqual([0, 0, 0, 0])
    expect(state.ranked).toBe(false)
    // No resignation proposal by default (appended after `ranked`).
    expect([...state.teamResignSeat]).toEqual([-1, -1])
    expect([...state.teamResignCooldowns]).toEqual([0, 0, 0, 0])
    const keys = Object.keys(state.toJSON())
    expect(keys.slice(keys.indexOf('reconnectGraceMs'))).toEqual([
      'reconnectGraceMs',
      'drawOfferSeat',
      'drawVotes',
      'drawOfferActionSeq',
      'drawCooldowns',
      'ranked',
      'teamResignSeat',
      'teamResignCooldowns',
      'inviteOnly',
    ])
    expect(state.inviteOnly).toBe(false)
    const encoder = new Encoder(state)
    expect(encoder.encodeAll().length).toBeGreaterThan(0)
    const reflected = Reflection.decode(Reflection.encode(encoder))
    expect(reflected.state).toBeDefined()
  })
})

describe('JSON Schema export', () => {
  it('is up to date (run `pnpm --filter @game/protocol schema`)', () => {
    const file = readFileSync(new URL('../schema/protocol.schema.json', import.meta.url), 'utf8')
    expect(JSON.parse(file)).toEqual(JSON.parse(JSON.stringify(buildProtocolJsonSchema())))
  })
})
