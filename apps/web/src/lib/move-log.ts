/**
 * The move log's model: game actions (live `events`/`moveLog` messages, or a replay's steps)
 * turned into rows by round. Everything shown comes from the rules engine: the notation is the
 * engine's, captures, promotions, passes and defeats are its events, and checks are its
 * snapshots' `leaderUnderAttack`. Nothing here decides a rule.
 */
import type { GameAction } from '@game/protocol'
import {
  type DefeatReason,
  Game,
  type GameEvent,
  type GameResult,
  PASS_NOTATION,
  type Piece,
  type PieceKind,
  SEATS,
  type Seat,
} from '@game/rules'
import { SEAT_LABEL } from '../components/match/labels.ts'
import { pieceName } from './civ-info.ts'
import { formatClock } from './clock.ts'

/** One game action with what the engine said about it. */
export interface LogStep {
  seq: number
  action: GameAction
  /** The acting seat (0..3; an agreed draw: the seat that completed it, or -1). */
  seat: number
  notation: string | null
  events: readonly GameEvent[]
  /** Per seat, after the action: an active seat's leader is under attack (engine snapshot). */
  attacked: readonly boolean[]
  /** The acting seat's time left after the action (ms, from the server), or null / absent. */
  clockMs?: number | null | undefined
}

export type LogItemKind = 'move' | 'pass' | 'timeout' | 'abandon' | 'resign' | 'agreed_draw'

export interface LogItem {
  key: string
  /** Index of the step this item comes from (a replay jumps there). */
  step: number
  seq: number
  /** The seat, or -1 for an agreed draw. */
  seat: number
  kind: LogItemKind
  /** Engine notation for moves, `--` for passes, '' otherwise. */
  notation: string
  /** Pieces captured by the move. */
  captures: Piece[]
  promotion: PieceKind | null
  castle: boolean
  enPassant: boolean
  /** Seats whose leader came under attack with this action (not the mover's own). */
  checks: number[]
  /** Seats defeated by this action, in order. */
  defeats: { seat: number; reason: DefeatReason }[]
  /** The result, when this action ended the game. */
  result: GameResult | null
  /** Moves: the mover's time left after the move (ms), or null (untimed, or not known). */
  clockMs: number | null
}

/** Turn items fill a seat's cell in a round; notes (off-turn actions) follow the round's row. */
export function isTurnItem(item: LogItem): boolean {
  return item.kind === 'move' || item.kind === 'pass' || item.kind === 'timeout'
}

export interface LogRound {
  /** 1-based. */
  number: number
  /** One cell per seat (South, West, North, East); null when that seat had no turn. */
  cells: (LogItem | null)[]
  /** Off-turn actions (resignations, leaves, agreed draws) during the round. */
  notes: LogItem[]
}

const seatNum = (seat: Seat) => SEATS.indexOf(seat)

/** Per seat: an active seat's leader is under attack in this position (from the engine). */
export function attackedIn(positionString: string): boolean[] {
  const game = Game.fromPosition(positionString)
  try {
    return [...game.snapshot().leaderUnderAttack]
  } finally {
    game.free()
  }
}

/** The log items of one step (`prevAttacked`: the `attacked` of the step before, if any). */
export function itemsOfStep(
  step: LogStep,
  index: number,
  prevAttacked: readonly boolean[] = [false, false, false, false],
): LogItem[] {
  const base = (kind: LogItemKind, seat: number, notation: string, part: number): LogItem => ({
    key: `${step.seq}:${part}`,
    step: index,
    seq: step.seq,
    seat,
    kind,
    notation,
    captures: [],
    promotion: null,
    castle: false,
    enPassant: false,
    checks: [],
    defeats: [],
    result: null,
    clockMs: null,
  })
  const kind: LogItemKind = step.action
  const main = base(
    kind,
    kind === 'agreed_draw' ? -1 : step.seat,
    kind === 'move' ? (step.notation ?? '') : '',
    0,
  )
  if (kind === 'move' && typeof step.clockMs === 'number') main.clockMs = step.clockMs
  const passes: LogItem[] = []
  for (const e of step.events) {
    switch (e.type) {
      case 'move_made':
        main.seat = seatNum(e.seat)
        main.notation = e.notation
        main.castle = e.flag === 'castle'
        break
      case 'capture':
        main.captures.push(e.captured)
        break
      case 'en_passant':
        main.enPassant = true
        break
      case 'promotion':
        main.promotion = e.kind
        break
      case 'pass':
        passes.push(base('pass', seatNum(e.seat), PASS_NOTATION, passes.length + 1))
        break
      case 'defeat':
        main.defeats.push({ seat: seatNum(e.seat), reason: e.reason })
        break
      case 'game_ended':
        main.result = e.outcome.result
        break
      default:
        break
    }
  }
  const defeated = new Set(main.defeats.map((d) => d.seat))
  if (!main.result) {
    main.checks = [0, 1, 2, 3].filter(
      (s) => s !== main.seat && !defeated.has(s) && step.attacked[s] === true && !prevAttacked[s],
    )
  }
  return [main, ...passes]
}

/** Every item of a log, oldest first. */
export function logItems(steps: readonly LogStep[]): LogItem[] {
  return steps.flatMap((s, i) => itemsOfStep(s, i, steps[i - 1]?.attacked))
}

/**
 * Items grouped by round: a new round starts when a turn comes round to a seat at or before
 * the last seat that had a turn (South, West, North, East order; seats out of the game are
 * skipped, so their cells stay empty).
 */
export function groupRounds(items: readonly LogItem[]): LogRound[] {
  const rounds: LogRound[] = []
  let current: LogRound | null = null
  let lastSeat = 4
  for (const item of items) {
    if (isTurnItem(item)) {
      if (!current || item.seat <= lastSeat) {
        current = { number: rounds.length + 1, cells: [null, null, null, null], notes: [] }
        rounds.push(current)
      }
      current.cells[item.seat] = item
      lastSeat = item.seat
    } else {
      if (!current) {
        current = { number: 1, cells: [null, null, null, null], notes: [] }
        rounds.push(current)
        lastSeat = -1
      }
      current.notes.push(item)
    }
  }
  return rounds
}

const DEFEAT_TEXT: Record<DefeatReason, string> = {
  leader_captured: 'leader captured',
  stalemate: 'stalemated',
  timeout: 'out of time',
  abandon: 'left the game',
  resign: 'resigned',
}

function seatText(seat: number): string {
  return SEAT_LABEL[SEATS[seat] ?? 'south']
}

/** Marks after the notation: × capture, + check, # a defeat by leader capture. */
export function itemMarks(item: LogItem): string {
  let marks = ''
  if (item.captures.length > 0) marks += '×'
  if (item.defeats.some((d) => d.reason === 'leader_captured')) marks += '#'
  else if (item.checks.length > 0) marks += '+'
  return marks
}

/** The visible short text of an item (notation, or a word for passes and notes). */
export function itemText(item: LogItem, endReason?: string): string {
  switch (item.kind) {
    case 'move':
      return item.notation
    case 'pass':
      return 'pass'
    case 'timeout':
      return 'time'
    case 'abandon':
      return `${seatText(item.seat)} left the game`
    case 'resign':
      return `${seatText(item.seat)} resigned`
    case 'agreed_draw':
      // A solo FFA game ends as a draw between the bots the moment its player is out.
      return endReason === 'player_eliminated' ? 'The game ends' : 'Draw agreed'
  }
}

/** A full description of an item for screen readers ("South: e2e4, takes West's knight, check on North"). */
export function itemLabel(item: LogItem, endReason?: string): string {
  const who = seatText(item.seat)
  const parts: string[] = []
  switch (item.kind) {
    case 'move':
      parts.push(`${who}: ${item.notation}`)
      if (item.castle) parts.push('castles')
      for (const c of item.captures) {
        parts.push(`takes ${seatText(seatNum(c.owner))}’s ${pieceName(c.kind)}`)
      }
      if (item.enPassant) parts.push('en passant')
      if (item.promotion) parts.push(`promotes to ${pieceName(item.promotion)}`)
      break
    case 'pass':
      parts.push(`${who}: passes (no legal move)`)
      break
    case 'timeout':
      parts.push(`${who}: ran out of time`)
      break
    default:
      parts.push(itemText(item, endReason))
  }
  if (item.checks.length > 0) parts.push(`check on ${item.checks.map(seatText).join(' and ')}`)
  if (item.kind === 'move' && item.clockMs !== null) parts.push(`${clockText(item.clockMs)} left`)
  for (const d of item.defeats) {
    if (d.seat === item.seat && (d.reason === item.kind || item.kind === 'timeout')) continue
    parts.push(`${seatText(d.seat)} defeated, ${DEFEAT_TEXT[d.reason]}`)
  }
  return parts.join(', ')
}

/** A move's clock time in the log: "4:32", "0:08.4" under 20 s. */
export function clockText(ms: number): string {
  return formatClock(ms)
}

/** Short result text for the end of the log. */
export function resultText(result: GameResult, endReason?: string): string {
  if (endReason === 'player_eliminated') return 'The player is out; the bots share 1st place'
  switch (result.type) {
    case 'ffa_winner':
      return `${seatText(seatNum(result.seat))} wins`
    case 'teams_winner':
      return result.team === 'south_north' ? 'Team South–North wins' : 'Team West–East wins'
    case 'ffa_agreed_draw':
    case 'teams_agreed_draw':
      return 'Draw agreed'
    case 'ffa_move_limit_tie':
    case 'teams_draw':
      return 'Draw by the move limit'
  }
}
