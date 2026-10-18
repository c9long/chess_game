/**
 * Replays of finished matches (PLAN §3 "Replays"): which stored match events are game
 * actions, and how to apply one to a rules-engine game. The server's re-simulation check and
 * every client's replay viewer use these, so a replay always takes the same path through the
 * engine as the check that let the match be recorded as finished.
 *
 * No rules here: each action is handed to `@game/rules` as is (`applyMove`, `applyTimeout`,
 * ...), and the engine decides what it does.
 */
import type { GameEvent, Seat } from '@game/rules'
import { SEAT_NAMES } from './constants.ts'
import type { GameAction } from './messages.ts'

/**
 * Stored match event types that are game actions; replaying them in seq order rebuilds the
 * game. A move with a promotion is stored as `promotion`. An agreed draw is replayed from its
 * `game_end` row (payload `agreedDraw: true`, also used when a solo FFA game ends at its
 * player's elimination); every other `game_end` row follows from the action before it. A
 * Teams resignation is one `resign` row (seat: the proposer) replayed as `applyResign`, which
 * resigns the whole team; the vote rows before it (`resign_proposal`, `resign_response`) and
 * the draw-offer rows are not actions.
 */
export const REPLAY_ACTION_EVENT_TYPES = [
  'move',
  'promotion',
  'timeout',
  'abandon',
  'resign',
] as const

/** One game action of a stored match, in order. */
export interface ReplayAction {
  /** The match event's seq (gaps are the non-action rows in between). */
  seq: number
  /** Same kinds as the live `events` message's `action`. */
  action: GameAction
  /** The acting seat (0..3); for `agreed_draw`, null (everyone still playing agreed). */
  seat: number | null
  /** Engine notation for `move` actions ('e2e4', 'e8e9q'), else null. */
  notation: string | null
  /**
   * The acting seat's time left after the action (ms; the row's `clockRemainingMs`), or null
   * (untimed games, agreed draws). Not used to replay: the move log shows it.
   */
  clockMs?: number | null
}

/** The fields of a stored match event that a replay reads. */
export interface StoredMatchEvent {
  seq: number
  seat: number | null
  type: string
  payload: unknown
  /** The acting seat's time left after the action, when the row has it. */
  clockRemainingMs?: number | null
}

function payloadField(payload: unknown, key: string): unknown {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : null
}

/** The game actions among a match's stored events (any order in, seq order out). */
export function replayActionsOf(events: readonly StoredMatchEvent[]): ReplayAction[] {
  const out: ReplayAction[] = []
  const clockOf = (e: StoredMatchEvent): number | null =>
    typeof e.clockRemainingMs === 'number' ? Math.max(0, Math.round(e.clockRemainingMs)) : null
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'move' || e.type === 'promotion') {
      out.push({
        seq: e.seq,
        action: 'move',
        seat: e.seat,
        notation: String(payloadField(e.payload, 'notation')),
        clockMs: clockOf(e),
      })
    } else if (e.type === 'timeout' || e.type === 'abandon' || e.type === 'resign') {
      if (e.seat === null || !SEAT_NAMES[e.seat]) continue
      out.push({ seq: e.seq, action: e.type, seat: e.seat, notation: null, clockMs: clockOf(e) })
    } else if (e.type === 'game_end' && payloadField(e.payload, 'agreedDraw') === true) {
      out.push({ seq: e.seq, action: 'agreed_draw', seat: null, notation: null, clockMs: null })
    }
  }
  return out
}

/** The engine calls a replay makes (a `@game/rules` `Game` has them all). */
export interface ReplayGame {
  applyMove(notation: string): GameEvent[]
  applyTimeout(seat: Seat): GameEvent[]
  applyAbandon(seat: Seat): GameEvent[]
  applyResign(seat: Seat): GameEvent[]
  applyAgreedDraw(): GameEvent[]
}

/** Applies one action to a game; returns the engine's events. Throws what the engine throws. */
export function applyReplayAction(game: ReplayGame, a: ReplayAction): GameEvent[] {
  if (a.action === 'move') return game.applyMove(a.notation ?? '')
  if (a.action === 'agreed_draw') return game.applyAgreedDraw()
  const seat = SEAT_NAMES[a.seat ?? -1]
  if (!seat) throw new Error(`replay action ${a.seq} has no seat`)
  if (a.action === 'timeout') return game.applyTimeout(seat)
  if (a.action === 'abandon') return game.applyAbandon(seat)
  return game.applyResign(seat)
}
