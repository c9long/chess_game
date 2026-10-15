import type { Game, GameEvent } from '@game/rules'
import type { Logger } from '../logger.ts'

/** POST /v1/move request of crates/bot-service. */
export interface BotMoveRequest {
  /** rules-core position string. */
  position: string
  /** '600' ... '2400' or 'max'. */
  level: string
  /** The bot's remaining clock. */
  clockMs: number
  incrementMs: number
  seed?: number
}

export interface BotMoveResponse {
  move: string
  score?: number
  depth?: number
  nodes?: number
  timeMs?: number
}

/** Why a bot request failed (the room falls back to a quick local move). */
export type BotFailure =
  | 'unavailable'
  | 'saturated'
  | 'timeout'
  | 'rejected'
  | 'game_over'
  | 'bad_reply'

export class BotServiceError extends Error {
  readonly kind: BotFailure
  readonly retryAfterS: number | undefined

  constructor(kind: BotFailure, message: string, retryAfterS?: number) {
    super(message)
    this.kind = kind
    this.retryAfterS = retryAfterS
  }
}

/** Source of bot moves. Tests inject fakes; production uses `HttpBotClient`. */
export interface BotClient {
  requestMove(req: BotMoveRequest, signal: AbortSignal): Promise<BotMoveResponse>
}

/** Talks to bot-service over HTTP. */
export class HttpBotClient implements BotClient {
  readonly #baseUrl: string
  readonly #timeoutMs: number

  constructor(baseUrl: string, timeoutMs: number) {
    this.#baseUrl = baseUrl
    this.#timeoutMs = timeoutMs
  }

  async requestMove(req: BotMoveRequest, signal: AbortSignal): Promise<BotMoveResponse> {
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    let res: Response
    try {
      res = await fetch(`${this.#baseUrl}/v1/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.any([signal, timeout]),
      })
    } catch (err) {
      if (timeout.aborted) throw new BotServiceError('timeout', 'bot-service timed out')
      throw new BotServiceError('unavailable', `bot-service unreachable: ${(err as Error).message}`)
    }
    if (res.status === 503) {
      const retry = Number(res.headers.get('retry-after'))
      throw new BotServiceError(
        'saturated',
        'bot-service saturated',
        Number.isFinite(retry) ? retry : undefined,
      )
    }
    if (res.status === 409) throw new BotServiceError('game_over', 'bot-service: game over')
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new BotServiceError('rejected', `bot-service ${res.status}: ${body.slice(0, 200)}`)
    }
    const body = (await res.json().catch(() => null)) as BotMoveResponse | null
    if (!body || typeof body.move !== 'string') {
      throw new BotServiceError('bad_reply', 'bot-service reply without a move')
    }
    return body
  }
}

/** Used when no BOT_SERVICE_URL is configured: every bot move is a local fallback move. */
export class LocalOnlyBotClient implements BotClient {
  async requestMove(): Promise<BotMoveResponse> {
    throw new BotServiceError('unavailable', 'no bot-service configured')
  }
}

function capturesLeader(events: GameEvent[]): boolean {
  return events.some((e) => e.type === 'defeat' && e.reason === 'leader_captured')
}

/**
 * A quick move for when bot-service can't answer in time: a capture that defeats a seat
 * (leader capture) if there is one, else any capture, else a random legal move. All rule
 * knowledge comes from the engine (`@game/rules`); a leader capture is recognized by the
 * defeat event the engine reports on a trial copy of the game.
 */
export function fallbackMove(game: Game, random: () => number = Math.random): string | null {
  const moves = game.legalMoves()
  if (moves.length === 0) return null
  const captures = moves.filter((m) => m.capture)
  for (const m of captures) {
    const trial = game.clone()
    try {
      if (capturesLeader(trial.applyMove(m.notation))) return m.notation
    } finally {
      trial.free()
    }
  }
  const pool = captures.length > 0 ? captures : moves
  return pool[Math.floor(random() * pool.length)]?.notation ?? null
}

export function createBotClient(
  url: string | undefined,
  timeoutMs: number,
  logger: Logger,
): BotClient {
  if (!url) {
    logger.warn({}, 'BOT_SERVICE_URL not set: bots will play quick local moves')
    return new LocalOnlyBotClient()
  }
  return new HttpBotClient(url, timeoutMs)
}
