import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Game, initRulesSync } from '@game/rules'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BotServiceError, fallbackMove, HttpBotClient } from './bot-client.ts'

beforeAll(() => initRulesSync())

describe('fallbackMove', () => {
  it('returns a legal move', () => {
    const g = Game.create({ mode: 'ffa' })
    const m = fallbackMove(g)
    expect(m && g.legalMoveNotations().includes(m)).toBe(true)
    g.free()
  })

  it('prefers a capture that takes a leader, then any capture', () => {
    // Play greedy moves until a leader capture is on the board, then check the pick.
    const g = Game.create({ mode: 'ffa' })
    let checked = 0
    for (let i = 0; i < 400 && !g.snapshot().isOver; i++) {
      const moves = g.legalMoves()
      const leaderCaptures = moves.filter((m) => {
        if (!m.capture) return false
        const t = g.clone()
        const ev = t.applyMove(m.notation)
        t.free()
        return ev.some((e) => e.type === 'defeat' && e.reason === 'leader_captured')
      })
      const pick = fallbackMove(g, () => 0.5) as string
      if (leaderCaptures.length > 0) {
        expect(leaderCaptures.map((m) => m.notation)).toContain(pick)
        checked++
      } else if (moves.some((m) => m.capture)) {
        expect(moves.find((m) => m.notation === pick)?.capture).toBe(true)
      }
      g.applyMove(pick)
    }
    expect(checked).toBeGreaterThan(0)
    g.free()
  })
})

describe('HttpBotClient', () => {
  let server: Server
  let url: string
  let reply: (res: import('node:http').ServerResponse) => void = () => {}
  let lastBody: unknown

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c: Buffer) => {
        raw += c
      })
      req.on('end', () => {
        lastBody = raw ? JSON.parse(raw) : null
        reply(res)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })

  const req = { position: 'p', level: '1500', clockMs: 1000, incrementMs: 0 }
  const kindOf = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e) {
      return (e as BotServiceError).kind
    }
    return 'ok'
  }

  it('posts the request and returns the move', async () => {
    reply = (res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ move: 'c2c4', score: 10, depth: 3, nodes: 100, timeMs: 5 }))
    }
    const r = await new HttpBotClient(url, 1000).requestMove(req, new AbortController().signal)
    expect(r.move).toBe('c2c4')
    expect(lastBody).toEqual(req)
  })

  it('maps 503 (with Retry-After), 409, 400 and timeouts', async () => {
    const client = new HttpBotClient(url, 200)
    const signal = new AbortController().signal
    reply = (res) => {
      res.writeHead(503, { 'retry-after': '1' })
      res.end()
    }
    await expect(client.requestMove(req, signal)).rejects.toMatchObject({
      kind: 'saturated',
      retryAfterS: 1,
    })
    reply = (res) => {
      res.writeHead(409)
      res.end()
    }
    expect(await kindOf(client.requestMove(req, signal))).toBe('game_over')
    reply = (res) => {
      res.writeHead(400)
      res.end('{"error":"invalid_request"}')
    }
    expect(await kindOf(client.requestMove(req, signal))).toBe('rejected')
    reply = () => {} // never answers
    expect(await kindOf(client.requestMove(req, signal))).toBe('timeout')
  })

  it('reports an unreachable service', async () => {
    const client = new HttpBotClient('http://127.0.0.1:1', 500)
    expect(await kindOf(client.requestMove(req, new AbortController().signal))).toBe('unavailable')
    expect(new BotServiceError('timeout', 'x')).toBeInstanceOf(Error)
  })
})
