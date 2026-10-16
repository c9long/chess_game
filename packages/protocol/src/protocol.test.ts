import { readFileSync } from 'node:fs'
import { Encoder, Reflection } from '@colyseus/schema'
import { describe, expect, it } from 'vitest'
import { clockOffset, matchClient, remainingNow } from './client.ts'
import {
  CIV_SLUGS,
  checkLobbyNameFormat,
  clientMessageSchemas,
  createOptionsSchema,
  isReservedMessageType,
  joinOptionsSchema,
  PROTOCOL_VERSION,
  teamOfSeat,
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
      name: 'Friday game',
      mode: 'teams',
      timeControl: '3+2',
      pickMode: 'blind',
    })
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
    for (const t of ['resign', 'offerDraw', 'respondDraw', 'takebackAccept', 'chat.send']) {
      expect(isReservedMessageType(t)).toBe(true)
    }
    expect(isReservedMessageType('move')).toBe(false)
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
