/**
 * What clients are shown of a game: the room state's flattened rules events, and the delayed
 * view of ranked games (anti-cheat, SPECTATOR_DELAY_ROUNDS). Spectators (watch-room.ts) and
 * players who are out of a ranked game (match-room.ts) see an older frame while it runs, with
 * draw offers and resignation votes hidden and live game messages held back; once the game is
 * over they see everything.
 */
import type { ArraySchema } from '@colyseus/schema'
import {
  type ClockSync,
  type MoveLogEntry,
  type ServerMessages,
  SPECTATOR_DELAY_ROUNDS,
} from '@game/protocol'
import { EventState, type MatchState, type SeatState } from '@game/protocol/state'
import { type GameEvent, seatIndex } from '@game/rules'

/** One rules event as the flattened `lastEvents` entry of the room state. */
export function flattenEvent(e: GameEvent): EventState {
  const out = new EventState()
  out.type = e.type
  if ('seat' in e) out.seat = seatIndex(e.seat)
  switch (e.type) {
    case 'move_made':
      out.notation = e.notation
      out.from = e.from
      out.to = e.to
      out.piece = e.piece
      out.promotion = e.promotion ?? ''
      out.flag = e.flag
      break
    case 'capture':
      out.square = e.square
      out.piece = e.captured.kind
      out.pieceOwner = seatIndex(e.captured.owner)
      break
    case 'en_passant':
      out.square = e.capturedSquare
      break
    case 'promotion':
      out.square = e.square
      out.piece = e.kind
      break
    case 'castle':
      out.from = e.rookFrom
      out.to = e.rookTo
      break
    case 'pass':
      out.notation = e.notation
      break
    case 'defeat':
      out.reason = e.reason
      break
    default:
      break
  }
  return out
}

/**
 * What a delayed view shows of the game at one point: the start position (`seq` 0) or the
 * position after an action.
 */
export interface ViewFrame {
  seq: number
  positionString: string
  seatToMove: number
  statuses: string[]
  clock: ClockSync
  events: GameEvent[]
  /** The round the action was made in (full turns of the turn order before it). */
  round: number
  /** The move log entry of the action (null for the start). */
  entry: MoveLogEntry | null
}

/** A delayed view: its frame, and the number of move log entries it includes. */
export interface DelayedView {
  frame: ViewFrame
  entries: number
}

/**
 * Whether the turn order went round (a new round began) between the seat to move before an
 * action and the seat to move after it. Turn order is seat order (S, W, N, E); a mover's own
 * action that hands the turn to the same or an earlier seat wrapped around, while an
 * off-turn action (an abandon or resign by another seat) only wrapped if the pointer moved
 * back.
 */
export function wrappedRound(prevToMove: number, nextToMove: number, actingSeat: number): boolean {
  if (prevToMove < 0 || nextToMove < 0) return false
  return actingSeat === prevToMove ? nextToMove <= prevToMove : nextToMove < prevToMove
}

/**
 * The newest frame spectators may see when the game is in round `currentRound`, at least
 * `delayRounds` full rounds behind: the last frame made before round
 * `currentRound - delayRounds` (frame 0, the start, at worst). Frames are in order.
 */
export function visibleFrameIndex(
  rounds: readonly number[],
  currentRound: number,
  delayRounds: number,
): number {
  let idx = 0
  for (let i = 1; i < rounds.length; i++) {
    if ((rounds[i] as number) < currentRound - delayRounds) idx = i
    else break
  }
  return idx
}

const SEAT_FIELDS = [
  'occupied',
  'displayName',
  'isGuest',
  'isBot',
  'botLevel',
  'civ',
  'ready',
  'connected',
  'graceDeadline',
  'team',
  'status',
  'heldFor',
  'heldUntil',
] as const

const EVENT_FIELDS = [
  'type',
  'seat',
  'notation',
  'from',
  'to',
  'square',
  'piece',
  'pieceOwner',
  'promotion',
  'flag',
  'reason',
] as const

/**
 * Seat fields a delayed view takes from its frame, not from the live seat: the status of that
 * moment, and no live connection news (a drop and its abandon deadline would show the game
 * early; an abandon itself arrives with the frame's statuses).
 */
const DELAYED_SEAT: Partial<
  Record<
    (typeof SEAT_FIELDS)[number],
    (frame: ViewFrame, seat: number) => string | number | boolean
  >
> = {
  status: (frame, seat) => frame.statuses[seat] ?? '',
  connected: () => true,
  graceDeadline: () => 0,
}

type Plain = Record<string, string | number | boolean>

/** Sets `dst[key]` only when it differs (unchanged values cost nothing on the wire). */
function put(dst: object, key: string, value: unknown) {
  const d = dst as Record<string, unknown>
  if (d[key] !== value) d[key] = value
}

function copyNumbers(dst: ArraySchema<number>, src: readonly number[]) {
  while (dst.length > src.length) dst.pop()
  src.forEach((v, i) => {
    if (i < dst.length) {
      if (dst[i] !== v) dst[i] = v
    } else dst.push(v)
  })
}

function copyEvents(dst: ArraySchema<EventState>, src: readonly Plain[]) {
  while (dst.length > src.length) dst.pop()
  src.forEach((e, i) => {
    let target = dst[i]
    if (!target) {
      target = new EventState()
      for (const f of EVENT_FIELDS) if (e[f] !== undefined) put(target, f, e[f])
      dst.push(target)
      return
    }
    for (const f of EVENT_FIELDS)
      put(target, f, e[f] ?? (f === 'seat' || f === 'pieceOwner' ? -1 : ''))
  })
}

function plainEvent(e: EventState): Plain {
  const out: Plain = {}
  for (const f of EVENT_FIELDS) out[f] = (e as unknown as Plain)[f] as string | number
  return out
}

function plainGameEvent(e: GameEvent): Plain {
  return plainEvent(flattenEvent(e))
}

/**
 * Copies the match room's state into another state. With `frame` (a ranked game shown
 * delayed) the position, turn, statuses, clocks and last events come from that frame, and
 * draw offers and resignation votes are hidden. Every field is assigned once, with its final
 * value, so nothing changes on the wire that didn't change in the copy. Players' session ids
 * are kept only for a player (`forPlayer`), whose client finds its own seat by them.
 */
export function mirrorState(
  dst: MatchState,
  src: MatchState,
  frame: ViewFrame | null,
  forPlayer = false,
): void {
  for (const key of [
    'protocolVersion',
    'name',
    'mode',
    'timeControl',
    'pickMode',
    'hasPassword',
    'hostSeat',
    'phase',
    'countdownEndsAt',
    'matchId',
    'rated',
    'reconnectGraceMs',
    'ranked',
    'inviteOnly',
    'spectators',
  ] as const) {
    put(dst, key, src[key])
  }
  put(dst, 'positionString', frame ? frame.positionString : src.positionString)
  put(dst, 'seatToMove', frame ? frame.seatToMove : src.seatToMove)
  put(dst, 'actionSeq', frame ? frame.seq : src.actionSeq)
  put(dst, 'delayRounds', frame ? SPECTATOR_DELAY_ROUNDS : 0)
  src.seats.forEach((seat, i) => {
    const target = dst.seats[i] as SeatState
    for (const f of SEAT_FIELDS) {
      const delayed = frame ? DELAYED_SEAT[f] : undefined
      put(target, f, delayed && frame ? delayed(frame, i) : seat[f])
    }
    put(target, 'sessionId', forPlayer ? seat.sessionId : '')
  })
  const clock = frame ? frame.clock : null
  copyNumbers(dst.clock.remainingMs, clock ? clock.remainingMs : [...src.clock.remainingMs])
  // A delayed clock doesn't run: it shows the time left at that point.
  put(dst.clock, 'runningSeat', clock ? -1 : src.clock.runningSeat)
  put(dst.clock, 'serverTimestamp', clock ? clock.serverTimestamp : src.clock.serverTimestamp)
  put(dst.clock, 'turnStartedAt', clock ? 0 : src.clock.turnStartedAt)
  put(dst.clock, 'incrementMs', src.clock.incrementMs)
  copyEvents(
    dst.lastEvents,
    frame ? frame.events.map(plainGameEvent) : [...src.lastEvents].map(plainEvent),
  )
  for (const key of ['type', 'winnerSeat', 'winnerTeam', 'endReason'] as const) {
    put(dst.result, key, src.result[key])
  }
  copyNumbers(dst.result.placements, [...src.result.placements])
  put(dst, 'drawOfferSeat', frame ? -1 : src.drawOfferSeat)
  put(dst, 'drawOfferActionSeq', frame ? 0 : src.drawOfferActionSeq)
  copyNumbers(dst.drawVotes, frame ? [-1, -1, -1, -1] : [...src.drawVotes])
  // Cooldowns start when an offer or proposal fails and count down with that seat's moves:
  // live values would tell a delayed view what is happening now.
  copyNumbers(dst.drawCooldowns, frame ? [0, 0, 0, 0] : [...src.drawCooldowns])
  copyNumbers(dst.teamResignSeat, frame ? [-1, -1] : [...src.teamResignSeat])
  copyNumbers(dst.teamResignCooldowns, frame ? [0, 0, 0, 0] : [...src.teamResignCooldowns])
  // Rematch votes are the players' business, and a player's copy is gone before the first
  // one: the fields keep their defaults.
}

/** A frozen clock for a delayed frame (nobody's clock runs). */
export function frozenClock(c: ClockSync): ClockSync {
  return { ...c, runningSeat: -1, turnStartedAt: 0 }
}

/** Live messages a delayed view holds back (they would show the game early). */
export const LIVE_ONLY: readonly string[] = ['events', 'clock', 'drawEvent', 'resignEvent']

/** The game a delayed feed follows (the match room). */
export interface FeedSource {
  /** Frames so far (frame k is the position after action k; frame 0 the start). */
  spectatorFrames(): readonly ViewFrame[]
  /** Every action so far (sent whole once the delay is over). */
  moveLogEntries(): readonly MoveLogEntry[]
  liveClock(): ClockSync | null
}

type Send = <K extends keyof ServerMessages>(type: K, payload: ServerMessages[K]) => void

/**
 * Where one audience (a watch room's spectators, or a player who is out) is in the move log
 * of a game it may be shown delayed: the actions it has been sent (`moveLog` or `events`),
 * and whether it was last shown a delayed frame.
 */
export class DelayedFeed {
  /** Move log entries this audience has been sent. */
  private shown: number
  private delayed: boolean

  constructor(shown: number, delayed = false) {
    this.shown = shown
    this.delayed = delayed
  }

  /** The audience was just sent the move log up to `entries` (a rejoin, or a new feed). */
  resetTo(entries: number) {
    this.shown = entries
  }

  /** The audience was sent action `seq` live. */
  seen(seq: number) {
    this.shown = Math.max(this.shown, seq)
  }

  /**
   * Sends what the audience may see now: with a delayed `view`, each action up to it as an
   * `events` message; once the delay is over (the game ended), the whole game at once.
   */
  advance(view: DelayedView | null, source: FeedSource, send: Send) {
    if (view) {
      const frames = source.spectatorFrames()
      while (this.shown < view.entries) {
        const frame = frames[this.shown + 1]
        if (!frame?.entry) break
        send('events', {
          ...frame.entry,
          seatToMove: frame.seatToMove as ServerMessages['events']['seatToMove'],
          clock: frozenClock(frame.clock),
        })
        this.shown++
      }
      this.delayed = true
      return
    }
    const entries = source.moveLogEntries()
    if (this.delayed) {
      this.delayed = false
      this.shown = entries.length
      send('moveLog', { entries: [...entries] })
      const clock = source.liveClock()
      if (clock) send('clock', clock)
    } else {
      this.shown = Math.max(this.shown, entries.length)
    }
  }
}
