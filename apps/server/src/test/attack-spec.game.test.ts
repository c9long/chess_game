/**
 * Review probes for the M4/M5 server (lobbies + live games): security and spec compliance.
 * Each test asserts the behaviour the spec requires; a failing test is a confirmed defect.
 */
import { matches } from '@game/db'
import { PROTOCOL_VERSION, ROOM_NAMES } from '@game/protocol'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createLobby,
  createOptions,
  FakeBotClient,
  type GameHarness,
  guest,
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

async function settle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; code: string }> {
  try {
    return { ok: true, v: await p }
  } catch (err) {
    return { ok: false, code: (err as Error).message }
  }
}

describe('attack-spec: lobby password attempt limit (PLAN §1: 5/min per IP and per room)', () => {
  it('concurrent wrong-password joins cannot get more than 5 guesses in', async () => {
    const host = await createLobby(await guest(h), { name: 'Burst target', password: 'pw-1234' })
    const id = host.room.roomId
    const attacker = await guest(h)
    const sdk = attacker.sdk()
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        settle(sdk.joinById(id, { protocolVersion: PROTOCOL_VERSION, password: `guess-${i}` })),
      ),
    )
    const guessed = results.filter((r) => !r.ok && r.code === 'invalid_password').length
    // Every 'invalid_password' answer is a password actually checked against the hash.
    expect(guessed).toBeLessThanOrEqual(5)
    await host.leave()
  })
})

describe('attack-spec: one seat per user', () => {
  it('concurrent creates by one user do not seat them in two rooms', async () => {
    const b = await guest(h)
    const sdk = b.sdk()
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        settle(sdk.create(ROOM_NAMES.match, createOptions({ name: `Race ${i}` }))),
      ),
    )
    const joined = results.filter((r) => r.ok)
    expect(joined.length).toBe(1)
    for (const r of results) if (r.ok) await r.v.leave().catch(() => {})
  })
})

describe('attack-spec: abandoned bot games', () => {
  it('leaving a bot game frees the user to start another while the old one keeps running', async () => {
    const b = await guest(h)
    const host = await createLobby(b, { name: 'Bot farm 1' })
    host.send('addBot', { seat: 1, level: 'max' })
    host.send('addBot', { seat: 2, level: 'max' })
    host.send('addBot', { seat: 3, level: 'max' })
    await host.waitState((s) => s.seats[3]?.isBot === true)
    host.send('setCiv', { civ: 'japan' })
    await host.waitState((s) => s.seats[0]?.civ === 'japan')
    host.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true)
    // Slow bots so the abandoned game is still running when we look.
    bots.delayMs = 400
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
    const matchId = host.state.matchId
    await host.leave()
    // The user can immediately open a second room ...
    const second = await settle(
      b.sdk().create(ROOM_NAMES.match, createOptions({ name: 'Bot farm 2' })),
    )
    // ... while the first game, with no human left, is still being played by bot-service.
    await sleep(300)
    const [row] = await h.server.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    const callsBefore = bots.calls
    await sleep(500)
    const stillCallingBots = bots.calls > callsBefore
    bots.delayMs = 0
    if (second.ok) await second.v.leave().catch(() => {})
    // Spec intent: a game with no humans left should not keep consuming bot-service capacity.
    const diag = JSON.stringify({
      status: row?.status,
      stillCallingBots,
      second: second.ok || second.code,
    })
    expect(row?.status === 'in_progress' && stillCallingBots && second.ok, diag).toBe(false)
  })
})
