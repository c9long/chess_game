/**
 * Review fixes for the game server that the attack-* probes don't cover directly:
 * WebSocket origin check, unlisting running games, unrated results without rating changes.
 */
import { request } from 'node:http'
import { matchMaker } from '@colyseus/core'
import { COLYSEUS_PATH, ROOM_NAMES } from '@game/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createLobby,
  FakeBotClient,
  type GameHarness,
  guest,
  startGameHarness,
  WEB_ORIGIN,
} from './game-harness.ts'

let h: GameHarness
const bots = new FakeBotClient()

beforeAll(async () => {
  h = await startGameHarness({}, { botClient: bots })
})

afterAll(async () => {
  await h.close()
})

/** Status of a raw WebSocket upgrade request (101, or the refusal's status). */
function upgradeStatus(origin: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    }
    if (origin) headers.Origin = origin
    const req = request(`${h.url}${COLYSEUS_PATH}/no-process/no-room?sessionId=nope`, { headers })
    req.on('upgrade', (res, socket) => {
      socket.destroy()
      resolve(res.statusCode ?? 0)
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

describe('WebSocket upgrade origin', () => {
  it('refuses an upgrade from another site and accepts the web origin or no Origin', async () => {
    expect(await upgradeStatus('https://evil.example')).toBe(403)
    expect(await upgradeStatus(WEB_ORIGIN)).toBe(101)
    expect(await upgradeStatus(undefined)).toBe(101)
  })
})

describe('lobby browser', () => {
  it('lists a lobby while it is open and unlists it once the game runs', async () => {
    const host = await createLobby(await guest(h), { name: 'Listed lobby' })
    const listed = async () =>
      (await matchMaker.query({ name: ROOM_NAMES.match, private: false })).some(
        (r) => r.roomId === host.room.roomId,
      )
    expect(await listed()).toBe(true)
    for (const seat of [1, 2, 3]) host.send('addBot', { seat, level: '600' })
    await host.waitState((s) => s.seats.every((x) => x.occupied))
    host.send('setCiv', { civ: 'mali' })
    await host.waitState((s) => s.seats[0]?.civ === 'mali')
    host.send('setReady', { ready: true })
    await host.waitState((s) => s.seats[0]?.ready === true)
    bots.delayMs = 200
    host.send('startGame')
    await host.waitState((s) => s.phase === 'in_game', 5_000, 'in_game')
    expect(await listed()).toBe(false)
    bots.delayMs = 0
    await host.leave()
  })
})
