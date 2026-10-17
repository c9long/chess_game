/**
 * Live-game durability (PLAN §5): the matches row is inserted when a game starts, events are
 * appended as they happen (batched, in seq order), and before a match is marked finished it
 * is re-simulated from the database rows alone. Orphaned in_progress matches are aborted on
 * startup.
 */
import {
  civilizations,
  type Database,
  type Executor,
  matchEvents,
  matches,
  matchPlayers,
} from '@game/db'
import { isUntimed } from '@game/protocol'
import { type CivId, Game, type GameConfigInput, type Outcome, RULES_VERSION } from '@game/rules'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import { applyElo, applyRatings, type EloChange, type RatedSeat } from './ratings.ts'

export type MatchEventType =
  | 'move'
  | 'promotion'
  | 'pass'
  | 'defeat'
  | 'timeout'
  | 'abandon'
  | 'disconnect'
  | 'reconnect'
  | 'game_end'
  | 'resign'
  | 'draw_offer'
  | 'draw_response'
  | 'resign_proposal'
  | 'resign_response'

/**
 * Event types that are game actions; replaying them in seq order rebuilds the game. An
 * agreed draw is replayed from its `game_end` row (payload `agreedDraw: true`, also used when
 * a solo FFA game ends at its player's elimination, end reason `player_eliminated`); every
 * other `game_end` row is derived from the action before it.
 */
export const ACTION_EVENT_TYPES = ['move', 'promotion', 'timeout', 'abandon', 'resign'] as const
// A Teams resignation is one `resign` action (seat: the proposer) replayed as
// `Game.applyResign`, which resigns the whole team; the vote rows before it
// (`resign_proposal`, `resign_response`) are not actions.

export interface EventRow {
  seat: number | null
  type: MatchEventType
  payload: Record<string, unknown>
  clockRemainingMs: number | null
  serverTs: Date
}

export interface MatchPlayerInput {
  seat: number
  team: number | null
  userId: string | null
  botLevel: string | null
  civId: number
  civVersion: number
}

export interface StartMatchInput {
  mode: 'ffa' | 'teams'
  timeControl: string
  /** Ranked lobby: the game gets Elo when it finishes (casual games never do). */
  rated: boolean
  rulesVersion: number
  startedAt: Date
  players: MatchPlayerInput[]
}

export interface FinishInput {
  /** Live position string at the end, compared with the re-simulation. */
  finalPosition: string
  outcome: Outcome
  endReason: string
  endedAt: Date
  /** Per seat (S, W, N, E). */
  finalStatuses: string[]
  /** Defeat reason per seat, or null. */
  defeatReasons: (string | null)[]
  /** Who is rated how (Elo for ranked games, the hidden shadow pool for casual bot games). */
  ratingSeats: RatedSeat[]
}

export interface FinishResult {
  status: 'finished' | 'aborted'
  endReason: string
  /** Whether the stored match is rated (false when its Elo could not be applied). */
  rated: boolean
  /** Elo changes per seat (ranked games only; shadow changes are never reported). */
  ratingChanges: EloChange[]
}

/** Civ slug <-> id lookup (the catalog is tiny; refreshed every minute). */
export class CivCatalog {
  #rows: { id: number; slug: string; enabled: boolean }[] = []
  #loadedAt = 0

  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  async load(force = false) {
    if (!force && Date.now() - this.#loadedAt < 60_000 && this.#rows.length) return this.#rows
    this.#rows = await this.#db
      .select({ id: civilizations.id, slug: civilizations.slug, enabled: civilizations.enabled })
      .from(civilizations)
    this.#loadedAt = Date.now()
    return this.#rows
  }

  async enabledSlugs(): Promise<string[]> {
    return (await this.load()).filter((c) => c.enabled).map((c) => c.slug)
  }

  /**
   * Enabled slugs from the cache without waiting (a stale cache is refreshed in the
   * background), or null before the first load.
   */
  enabledSlugsCached(): string[] | null {
    if (this.#rows.length === 0) return null
    if (Date.now() - this.#loadedAt >= 60_000) void this.load().catch(() => {})
    return this.#rows.filter((c) => c.enabled).map((c) => c.slug)
  }

  async idOf(slug: string): Promise<number> {
    const row = (await this.load()).find((c) => c.slug === slug)
    if (!row) throw new Error(`unknown civ ${slug}`)
    return row.id
  }
}

/** Records one live match. Not thread-safe across processes (one room owns one match). */
export class MatchRecorder {
  #seq = 0
  #queue: (EventRow & { seq: number })[] = []
  #flushing: Promise<void> | undefined
  #timer: NodeJS.Timeout | undefined
  #closed = false
  /** seq of each seat's defeat event. */
  readonly defeatSeq: (number | null)[] = [null, null, null, null]

  private readonly db: Database
  private readonly logger: Logger
  readonly matchId: string
  readonly input: StartMatchInput
  private readonly flushIntervalMs: number

  private constructor(
    db: Database,
    logger: Logger,
    matchId: string,
    input: StartMatchInput,
    flushIntervalMs: number,
  ) {
    this.db = db
    this.logger = logger
    this.matchId = matchId
    this.input = input
    this.flushIntervalMs = flushIntervalMs
  }

  static async start(
    db: Database,
    logger: Logger,
    input: StartMatchInput,
    flushIntervalMs: number,
  ): Promise<MatchRecorder> {
    const matchId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(matches)
        .values({
          status: 'in_progress',
          mode: input.mode,
          timeControl: input.timeControl,
          rated: input.rated,
          ranked: input.rated,
          rulesVersion: input.rulesVersion,
          startedAt: input.startedAt,
        })
        .returning({ id: matches.id })
      if (!row) throw new Error('match insert returned nothing')
      await tx.insert(matchPlayers).values(input.players.map((p) => ({ matchId: row.id, ...p })))
      return row.id
    })
    return new MatchRecorder(db, logger, matchId, input, flushIntervalMs)
  }

  /** Queues an event; returns its seq. Rows are written in seq order. */
  append(row: EventRow): number {
    if (this.#closed) throw new Error('recorder closed')
    const seq = ++this.#seq
    this.#queue.push({ ...row, seq })
    if (row.type === 'defeat' && row.seat !== null) this.defeatSeq[row.seat] = seq
    this.#timer ??= setTimeout(() => {
      this.#timer = undefined
      void this.flush().catch(() => {})
    }, this.flushIntervalMs)
    return seq
  }

  /** Writes all queued rows (single flight; retried by the next flush on failure). */
  async flush(): Promise<void> {
    while (this.#flushing) await this.#flushing.catch(() => {})
    if (this.#queue.length === 0) return
    const batch = this.#queue.splice(0, this.#queue.length)
    this.#flushing = (async () => {
      try {
        await this.db.insert(matchEvents).values(
          batch.map((r) => ({
            matchId: this.matchId,
            seq: r.seq,
            seat: r.seat,
            type: r.type,
            payload: r.payload,
            clockRemainingMs: r.clockRemainingMs === null ? null : Math.round(r.clockRemainingMs),
            serverTs: r.serverTs,
          })),
        )
      } catch (err) {
        // Put the batch back in front so order is preserved, then let the caller know.
        this.#queue.unshift(...batch)
        this.logger.error(
          { matchId: this.matchId, err: (err as Error).message },
          'event flush failed',
        )
        throw err
      } finally {
        this.#flushing = undefined
      }
    })()
    await this.#flushing
  }

  #stopTimer() {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  /**
   * Flushes, re-simulates the game from the stored rows and compares the final position.
   * On a match: writes placements, statuses, defeat info, ratings and marks it finished.
   * On a mismatch: marks it aborted ('resimulation_mismatch', unrated) and logs loudly.
   * If the rows can't be written or read back: marks it aborted ('persist_failed'), so the
   * database agrees with what the players were told.
   * Only a match still `in_progress` is finished: one already aborted elsewhere (e.g. a new
   * process aborted it as 'server_restart') stays aborted, unrated, with no placements.
   * Throws only if even the abort can't be written.
   */
  async finish(input: FinishInput): Promise<FinishResult> {
    this.#stopTimer()
    try {
      await this.flushWithRetry()
    } catch (err) {
      this.#closed = true
      this.logger.error(
        { matchId: this.matchId, err: (err as Error).message },
        'final event flush failed: match aborted',
      )
      return this.#abortWithRetry('persist_failed', input.endedAt)
    }
    this.#closed = true
    let replayed: string
    try {
      replayed = await resimulate(this.db, this.matchId)
    } catch (err) {
      this.logger.error(
        { matchId: this.matchId, err: (err as Error).message },
        're-simulation failed: match aborted',
      )
      return this.#abortWithRetry('persist_failed', input.endedAt)
    }
    if (replayed !== input.finalPosition) {
      this.logger.error(
        { matchId: this.matchId, live: input.finalPosition, replayed },
        're-simulation mismatch: match aborted',
      )
      return this.#abortWithRetry('resimulation_mismatch', input.endedAt)
    }
    try {
      return await retryOnConflict(() => this.#recordResult(input))
    } catch (err) {
      this.logger.error(
        { matchId: this.matchId, err: (err as Error).message },
        'recording the result failed: match aborted',
      )
      return this.#abortWithRetry('persist_failed', input.endedAt)
    }
  }

  /** One attempt at recording the result (placements, ratings, finished) in a transaction. */
  #recordResult(input: FinishInput): Promise<FinishResult> {
    return this.db.transaction(async (tx): Promise<FinishResult> => {
      const [row] = await tx
        .select({ status: matches.status, endReason: matches.endReason })
        .from(matches)
        .where(eq(matches.id, this.matchId))
        .for('update')
      if (row?.status !== 'in_progress') {
        this.logger.warn(
          { matchId: this.matchId, status: row?.status, endReason: row?.endReason },
          'match no longer in progress: result not recorded',
        )
        return {
          status: 'aborted',
          endReason: row?.endReason ?? 'aborted',
          rated: false,
          ratingChanges: [],
        }
      }
      // Untimed (solo) games touch no rating at all, Elo or shadow. Ranked games get Elo;
      // casual games with bots feed the hidden shadow pool; other casual games nothing.
      const game = { mode: this.input.mode, timeControl: this.input.timeControl }
      let changes: EloChange[] = []
      if (!isUntimed(this.input.timeControl)) {
        if (this.input.rated) changes = await applyElo(tx, game, input.ratingSeats)
        else if (input.ratingSeats.some((s) => s.botLevel)) {
          await applyRatings(tx, game, input.ratingSeats)
        }
      }
      // A ranked game whose Elo couldn't be applied (e.g. an account deleted mid-game) is
      // stored and reported as unrated.
      const rated = this.input.rated && changes.length > 0
      for (let seat = 0; seat < 4; seat++) {
        const change = changes.find((c) => c.seat === seat)
        await tx
          .update(matchPlayers)
          .set({
            finalStatus: input.finalStatuses[seat] ?? null,
            placement: input.outcome.placements[seat] ?? null,
            defeatReason: input.defeatReasons[seat] ?? null,
            defeatSeq: this.defeatSeq[seat] ?? null,
            ratingBefore: change?.before ?? null,
            ratingAfter: change?.after ?? null,
          })
          .where(and(eq(matchPlayers.matchId, this.matchId), eq(matchPlayers.seat, seat)))
      }
      await tx
        .update(matches)
        .set({ status: 'finished', rated, endedAt: input.endedAt, endReason: input.endReason })
        .where(eq(matches.id, this.matchId))
      return { status: 'finished', endReason: input.endReason, rated, ratingChanges: changes }
    })
  }

  /** Marks the match aborted (unrated), e.g. when a shutdown cuts a game short. */
  async abort(reason: string): Promise<void> {
    this.#stopTimer()
    await this.flushWithRetry().catch(() => {})
    this.#closed = true
    await this.#abortWithRetry(reason, new Date())
  }

  async #abortWithRetry(reason: string, at: Date, attempts = 3): Promise<FinishResult> {
    for (let i = 1; ; i++) {
      try {
        const stored = await markAborted(this.db, this.matchId, reason, at)
        return { status: 'aborted', endReason: stored, rated: false, ratingChanges: [] }
      } catch (err) {
        if (i >= attempts) throw err
        await new Promise((r) => setTimeout(r, 100 * i))
      }
    }
  }

  async flushWithRetry(attempts = 3): Promise<void> {
    for (let i = 1; ; i++) {
      try {
        await this.flush()
        return
      } catch (err) {
        if (i >= attempts) throw err
        await new Promise((r) => setTimeout(r, 100 * i))
      }
    }
  }
}

/** Postgres SQLSTATEs worth retrying a whole transaction for: deadlock, serialization failure. */
const RETRYABLE_SQLSTATES = new Set(['40P01', '40001'])

function sqlState(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; i++) {
    if (typeof e.code === 'string') return e.code
    e = e.cause as typeof e
  }
  return undefined
}

/** Runs `fn` (a whole transaction), retrying it a few times on a deadlock or serialization failure. */
export async function retryOnConflict<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const code = sqlState(err)
      if (i >= attempts || !code || !RETRYABLE_SQLSTATES.has(code)) throw err
      await new Promise((r) => setTimeout(r, 25 * i + Math.random() * 50))
    }
  }
}

/**
 * Aborts a match that is still in progress (never overwrites a finished or already aborted
 * row). Returns the end reason the row now has.
 */
async function markAborted(db: Executor, matchId: string, reason: string, at: Date) {
  const updated = await db
    .update(matches)
    .set({ status: 'aborted', rated: false, endedAt: at, endReason: reason })
    .where(and(eq(matches.id, matchId), eq(matches.status, 'in_progress')))
    .returning({ id: matches.id })
  if (updated.length > 0) return reason
  const [row] = await db
    .select({ endReason: matches.endReason })
    .from(matches)
    .where(eq(matches.id, matchId))
  return row?.endReason ?? reason
}

/**
 * A match recorded under another rules version than this engine plays (rules version 1 was the
 * 12×12 board; version 2 is 16×16). Such rows stay in the history, but their moves can't be
 * replayed on the current board, so re-simulation refuses them instead of mis-simulating.
 */
export class UnsupportedRulesVersionError extends Error {
  readonly matchId: string
  readonly rulesVersion: number

  constructor(matchId: string, rulesVersion: number) {
    super(
      `match ${matchId} was played under rules version ${rulesVersion}; this engine replays only version ${RULES_VERSION}`,
    )
    this.name = 'UnsupportedRulesVersionError'
    this.matchId = matchId
    this.rulesVersion = rulesVersion
  }
}

/** Whether `resimulate` can replay a match stored with this rules version. */
export function canResimulate(rulesVersion: number): boolean {
  return rulesVersion === RULES_VERSION
}

/**
 * Rebuilds a match from its database rows alone (config from matches/match_players, actions
 * from match_events) and returns the final position string. Throws
 * `UnsupportedRulesVersionError` for a match from an older rules version (see above).
 */
export async function resimulate(db: Executor, matchId: string): Promise<string> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId))
  if (!match) throw new Error(`match ${matchId} not found`)
  if (!canResimulate(match.rulesVersion)) {
    throw new UnsupportedRulesVersionError(matchId, match.rulesVersion)
  }
  const players = await db
    .select({ seat: matchPlayers.seat, slug: civilizations.slug, version: matchPlayers.civVersion })
    .from(matchPlayers)
    .innerJoin(civilizations, eq(civilizations.id, matchPlayers.civId))
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(asc(matchPlayers.seat))
  const civs = players.map((p) => ({ id: p.slug as CivId, version: p.version }))
  if (civs.length !== 4) throw new Error(`match ${matchId} has ${civs.length} players`)
  const config: GameConfigInput = {
    mode: match.mode,
    civs: civs as unknown as NonNullable<GameConfigInput['civs']>,
    rulesVersion: match.rulesVersion,
  }
  const actions = await db
    .select({
      seq: matchEvents.seq,
      seat: matchEvents.seat,
      type: matchEvents.type,
      payload: matchEvents.payload,
    })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, matchId),
        inArray(matchEvents.type, [...ACTION_EVENT_TYPES, 'game_end']),
      ),
    )
    .orderBy(asc(matchEvents.seq))
  const game = Game.create(config)
  try {
    const seats = ['south', 'west', 'north', 'east'] as const
    for (const a of actions) {
      const seat = seats[a.seat ?? -1]
      if (a.type === 'move' || a.type === 'promotion') {
        game.applyMove(String((a.payload as { notation?: unknown }).notation))
      } else if (a.type === 'timeout' && seat) {
        game.applyTimeout(seat)
      } else if (a.type === 'abandon' && seat) {
        game.applyAbandon(seat)
      } else if (a.type === 'resign' && seat) {
        game.applyResign(seat)
      } else if (a.type === 'game_end' && (a.payload as { agreedDraw?: unknown }).agreedDraw) {
        game.applyAgreedDraw()
      }
    }
    return game.positionString()
  } finally {
    game.free()
  }
}

/** Startup: games left in_progress by a crash or kill are aborted (unrated). */
export async function abortOrphanedMatches(db: Database): Promise<string[]> {
  const rows = await db
    .update(matches)
    .set({ status: 'aborted', rated: false, endedAt: sql`now()`, endReason: 'server_restart' })
    .where(eq(matches.status, 'in_progress'))
    .returning({ id: matches.id })
  return rows.map((r) => r.id)
}
