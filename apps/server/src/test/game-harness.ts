/**
 * Integration harness for lobbies and live games: boots the real server (Express + Better
 * Auth + Colyseus on one http.Server, listening on a random port) against game_test, and
 * drives it like browsers do (cookies, Origin, client IP) with the Colyseus SDK for Node.
 */
import { randomBytes } from 'node:crypto'
import { Client, type Room } from '@colyseus/sdk'
import { LEGAL_VERSIONS } from '@game/config'
import {
  COLYSEUS_PATH,
  type CreateOptions,
  PROTOCOL_VERSION,
  ROOM_NAMES,
  type ServerMessages,
} from '@game/protocol'
import type { MatchStateJson } from '@game/protocol/state'
import { Game, initRulesSync } from '@game/rules'
import type { AppOverrides } from '../app.ts'
import { loadConfig } from '../config.ts'
import { MemoryEmailSender } from '../email/sender.ts'
import { type BotClient, BotServiceError, fallbackMove } from '../game/bot-client.ts'
import { type RunningServer, startServer } from '../server.ts'
import { TEST_DATABASE_URL } from './env.ts'
import { randomIp } from './harness.ts'
import { startTurnstileStub, TURNSTILE_DUMMY_TOKEN } from './turnstile-stub.ts'

export const WEB_ORIGIN = 'http://localhost:5173'

export interface GameHarness {
  server: RunningServer
  url: string
  mailbox: MemoryEmailSender
  close(): Promise<void>
}

export async function startGameHarness(
  env: Record<string, string> = {},
  overrides: AppOverrides = {},
): Promise<GameHarness> {
  initRulesSync()
  const stub = await startTurnstileStub('localhost')
  const loaded = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    TRUST_CLOUDFLARE: 'true',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    HOST: '127.0.0.1',
    PORT: '0',
    API_PUBLIC_URL: WEB_ORIGIN,
    WEB_ORIGIN,
    GUEST_PURGE_INTERVAL_MINUTES: '0',
    TURNSTILE_SITEVERIFY_URL: stub.url,
    COUNTDOWN_MS: '50',
    EVENT_FLUSH_INTERVAL_MS: '20',
    ...env,
  })
  const mailbox = new MemoryEmailSender()
  const server = await startServer(loaded, { email: mailbox, ...overrides })
  return {
    server,
    url: server.url,
    mailbox,
    close: async () => {
      await server.stop(0)
      await stub.close()
    },
  }
}

/** A browser-like HTTP client with a cookie jar, the web Origin and its own client IP. */
export class Browser {
  readonly cookies = new Map<string, string>()
  readonly ip = randomIp()
  userId = ''
  name = ''

  readonly h: GameHarness

  constructor(h: GameHarness) {
    this.h = h
  }

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      origin: WEB_ORIGIN,
      'cf-connecting-ip': this.ip,
      ...extra,
    }
    const cookie = this.cookieHeader()
    if (cookie) h.cookie = cookie
    return h
  }

  async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(`${this.h.url}${path}`, {
      method,
      headers: this.headers(
        body === undefined ? extra : { 'content-type': 'application/json', ...extra },
      ),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair?.indexOf('=') ?? -1
      if (!pair || i < 0) continue
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (!value || /max-age=0/i.test(c)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {}
    return { status: res.status, body: json as Record<string, unknown> & unknown }
  }

  get(path: string) {
    return this.request('GET', path)
  }

  post(path: string, body: unknown = {}, extra: Record<string, string> = {}) {
    return this.request('POST', path, body, extra)
  }

  async onboard() {
    await this.post('/api/legal/age-confirmation', { dateOfBirth: '1990-05-17' })
    await this.post('/api/legal/acceptances', {
      documents: Object.entries(LEGAL_VERSIONS).map(([document, version]) => ({
        document,
        version,
      })),
    })
  }

  sdk(): Client {
    return new Client(`${this.h.url}${COLYSEUS_PATH}`, { headers: this.headers() })
  }
}

export async function guest(h: GameHarness): Promise<Browser> {
  const b = new Browser(h)
  await b.onboard()
  const res = await b.post(
    '/api/auth/sign-in/anonymous',
    {},
    { 'x-captcha-response': TURNSTILE_DUMMY_TOKEN },
  )
  if (res.status !== 200) throw new Error(`guest failed: ${res.status} ${JSON.stringify(res.body)}`)
  const user = (res.body as { user: { id: string; name: string } }).user
  b.userId = user.id
  b.name = user.name
  return b
}

export async function registered(h: GameHarness): Promise<Browser> {
  const b = new Browser(h)
  await b.onboard()
  const username = `u_${randomBytes(5).toString('hex')}`
  const email = `${username}@example.test`
  const res = await b.post(
    '/api/auth/sign-up/email',
    { email, password: 'correct horse battery staple', name: username, username },
    { 'x-captcha-response': TURNSTILE_DUMMY_TOKEN },
  )
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`)
  const mail = h.mailbox
    .list(email)
    .filter((m) => m.kind === 'verify-email')
    .at(-1)
  const link = mail?.text.match(/https?:\/\/\S+/)?.[0]
  const token = link ? new URL(link).searchParams.get('token') : null
  const verify = await b.get(`/api/auth/verify-email?token=${token}`)
  if (verify.status !== 200) throw new Error(`verify failed: ${verify.status}`)
  b.userId = (res.body as { user: { id: string } }).user.id
  b.name = username
  return b
}

/** A connected match-room client that records every server message. */
export class Player {
  readonly messages: { type: string; payload: unknown }[] = []

  readonly browser: Browser
  room: Room

  constructor(browser: Browser, room: Room) {
    this.browser = browser
    this.room = room
    this.listen()
  }

  listen() {
    this.room.onMessage('*', (type, payload) => {
      this.messages.push({ type: String(type), payload })
    })
  }

  get state(): MatchStateJson {
    return (this.room.state as { toJSON(): MatchStateJson }).toJSON()
  }

  get seat(): number {
    return this.state.seats.findIndex((s) => s.sessionId === this.room.sessionId)
  }

  send(type: string, payload: unknown = {}) {
    this.room.send(type, payload)
  }

  /** Messages of a type received so far. */
  of<K extends keyof ServerMessages>(type: K): ServerMessages[K][] {
    return this.messages.filter((m) => m.type === type).map((m) => m.payload as ServerMessages[K])
  }

  async waitMessage<K extends keyof ServerMessages>(
    type: K,
    pred: (p: ServerMessages[K]) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<ServerMessages[K]> {
    let found: ServerMessages[K] | undefined
    await waitFor(
      () => {
        found = this.of(type).find(pred)
        return found !== undefined
      },
      timeoutMs,
      `message ${type}`,
    )
    return found as ServerMessages[K]
  }

  /** Sends and waits for the `error` reply to it. */
  async expectError(type: string, payload: unknown = {}) {
    const before = this.of('error').length
    this.send(type, payload)
    await waitFor(() => this.of('error').length > before, 5_000, `error for ${type}`)
    return this.of('error')[before] as ServerMessages['error']
  }

  waitState(pred: (s: MatchStateJson) => boolean, timeoutMs = 5_000, what = 'state') {
    return waitFor(() => pred(this.state), timeoutMs, what)
  }

  async leave() {
    await this.room.leave(true).catch(() => {})
  }

  /** Simulates a dropped connection (no consented leave, no auto-reconnect). */
  drop() {
    this.room.reconnection.enabled = false
    const ws = (this.room.connection.transport as unknown as { ws: { close(): void } }).ws
    ws.close()
  }

  async reconnect() {
    const token = this.room.reconnectionToken
    this.room = await this.browser.sdk().reconnect(token)
    this.listen()
  }
}

export async function waitFor(cond: () => boolean, timeoutMs = 5_000, what = 'condition') {
  const deadline = Date.now() + timeoutMs
  const check = () => {
    try {
      return cond()
    } catch {
      return false
    }
  }
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createOptions(over: Partial<CreateOptions> = {}): CreateOptions {
  return {
    protocolVersion: PROTOCOL_VERSION,
    name: 'Test lobby',
    mode: 'ffa',
    timeControl: '10+0',
    ...over,
  }
}

export async function createLobby(b: Browser, over: Partial<CreateOptions> = {}): Promise<Player> {
  const room = await b.sdk().create(ROOM_NAMES.match, createOptions(over))
  const p = new Player(b, room)
  await p.waitMessage('welcome')
  return p
}

export async function joinLobby(b: Browser, roomId: string, password?: string): Promise<Player> {
  const room = await b.sdk().joinById(roomId, {
    protocolVersion: PROTOCOL_VERSION,
    ...(password !== undefined ? { password } : {}),
  })
  const p = new Player(b, room)
  await p.waitMessage('welcome')
  return p
}

/** Expects a matchmaking call to fail; returns the error code (the SDK error message). */
export async function matchmakeError(promise: Promise<unknown>): Promise<string> {
  try {
    const room = (await promise) as Room
    await room.leave().catch(() => {})
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected matchmaking to fail')
}

/**
 * Engine-driven test policy: a leader capture if any, else a capture, else the first legal
 * move (deterministic, so games end quickly and reproducibly).
 */
export function greedyMove(position: string): string | null {
  const game = Game.fromPosition(position)
  try {
    return fallbackMove(game, () => 0)
  } finally {
    game.free()
  }
}

/** Bot client fake: greedy engine moves, optionally failing or slow. */
export class FakeBotClient implements BotClient {
  calls = 0
  mode: 'ok' | 'saturated' | 'illegal' = 'ok'
  delayMs = 0
  readonly requests: { level: string; clockMs: number; incrementMs: number }[] = []

  async requestMove(req: {
    position: string
    level: string
    clockMs: number
    incrementMs: number
  }) {
    this.calls++
    this.requests.push({ level: req.level, clockMs: req.clockMs, incrementMs: req.incrementMs })
    if (this.delayMs) await sleep(this.delayMs)
    if (this.mode === 'saturated') throw new BotServiceError('saturated', 'busy', 1)
    if (this.mode === 'illegal') return { move: 'a1a1' }
    const move = greedyMove(req.position)
    if (!move) throw new BotServiceError('game_over', 'no move')
    return { move }
  }
}

/**
 * Plays the humans' turns with `greedyMove` until the game ends (bots move by themselves).
 * Returns the gameOver message.
 */
export async function playOut(
  players: Player[],
  timeoutMs = 20_000,
): Promise<ServerMessages['gameOver']> {
  const deadline = Date.now() + timeoutMs
  const anyone = players[0] as Player
  let lastSent = -1
  while (Date.now() < deadline) {
    const over = anyone.of('gameOver')[0]
    if (over) return over
    const s = anyone.state
    if (s.phase === 'in_game' && s.seatToMove >= 0 && s.actionSeq !== lastSent) {
      const mover = players.find((p) => p.seat === s.seatToMove)
      if (mover) {
        const move = greedyMove(s.positionString)
        if (move) {
          lastSent = s.actionSeq
          mover.send('move', { move })
        }
      }
    }
    await sleep(5)
  }
  throw new Error('game did not finish in time')
}
