import type { GameEvent, GameResult, PieceKind, Seat, Snapshot } from '@game/rules'
import { indexOf, nameOf } from './geometry.ts'

/**
 * Screen-reader text for the board (pure, unit-tested): what happened in a step (moves,
 * captures, promotions, checks, defeats, the end of the game) and what the keyboard cursor is
 * on. Plain words, e.g. "West: knight b7 to c9, takes North's pawn". The text only reports
 * the engine's events and snapshots; it never works anything out from the rules itself.
 */

export interface AnnounceContext {
  /** How a seat is named. Default: South, West, North, East. */
  readonly seatLabel: (seat: Seat) => string
  /** The viewer's own seat ("You", "your"), or null for a spectator or a hot-seat board. */
  readonly localSeat: Seat | null
  /** Announce the viewer's own check too (a host that says it elsewhere turns this off). */
  readonly ownCheck: boolean
  /** Which moves are read (checks, defeats and the result always are). Default 'all'. */
  readonly verbosity?: AnnounceVerbosity
}

/**
 * How much of the game the moves live region reads:
 * - `all`: every move (the default)
 * - `own`: only the viewer's own moves, plus other seats' moves that take one of the viewer's
 *   pieces; checks, defeats, frozen armies and the result are always read
 */
export type AnnounceVerbosity = 'all' | 'own'

const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']

export const DEFAULT_SEAT_LABEL: Readonly<Record<Seat, string>> = {
  south: 'South',
  west: 'West',
  north: 'North',
  east: 'East',
}

export function defaultSeatLabel(seat: Seat): string {
  return DEFAULT_SEAT_LABEL[seat]
}

export const DEFAULT_ANNOUNCE: AnnounceContext = {
  seatLabel: defaultSeatLabel,
  localSeat: null,
  ownCheck: true,
}

/** "knight", "prime minister". */
export function pieceWord(kind: PieceKind): string {
  return kind.replace('_', ' ')
}

function plural(kind: PieceKind): string {
  return `${pieceWord(kind)}s`
}

/** "West" or "You". */
function who(seat: Seat, ctx: AnnounceContext): string {
  return seat === ctx.localSeat ? 'You' : ctx.seatLabel(seat)
}

/** "West's" or "your" (mid-sentence). */
function whose(seat: Seat, ctx: AnnounceContext): string {
  return seat === ctx.localSeat ? 'your' : `${ctx.seatLabel(seat)}'s`
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function isAre(seat: Seat, ctx: AnnounceContext): string {
  return seat === ctx.localSeat ? 'are' : 'is'
}

const DEFEAT_TEXT: Record<string, string> = {
  leader_captured: 'leader captured',
  stalemate: 'no legal move (stalemate)',
  timeout: 'out of time',
  abandon: 'left the game',
  resign: 'resigned',
}

function teamSeats(team: string): readonly [Seat, Seat] {
  return team === 'south_north' ? ['south', 'north'] : ['west', 'east']
}

/** "West", "West and North", "you, West and North". */
function listSeats(seats: readonly Seat[], ctx: AnnounceContext): string {
  const names = seats.map((seat) => (seat === ctx.localSeat ? 'you' : ctx.seatLabel(seat)))
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The result sentence. `next` and `defeated` (seats knocked out in the same step) tell an
 * agreed draw apart from a game that a host ends as a draw once a player is out (a solo
 * game: the remaining seats share first place; nobody offered a draw).
 */
export function describeResult(
  result: GameResult,
  ctx: AnnounceContext = DEFAULT_ANNOUNCE,
  next: Snapshot | null = null,
  defeated: readonly Seat[] = [],
): string {
  if (result.type === 'ffa_agreed_draw' && next && defeated.length > 0) {
    const rest = SEATS.filter((_, s) => next.statuses[s] === 'active')
    const share = rest.length > 0 ? `${capitalise(listSeats(rest, ctx))} share first place.` : ''
    const local = ctx.localSeat
    const head =
      local !== null && defeated.includes(local)
        ? 'Game over. You were eliminated, so the game ends here.'
        : 'Game over. The game ends here.'
    return share ? `${head} ${share}` : head
  }
  return resultText(result, ctx)
}

function resultText(result: GameResult, ctx: AnnounceContext): string {
  switch (result.type) {
    case 'ffa_winner':
      return result.seat === ctx.localSeat
        ? 'Game over. You win.'
        : `Game over. ${ctx.seatLabel(result.seat)} wins.`
    case 'teams_winner': {
      const [a, b] = teamSeats(result.team)
      const names = `${ctx.seatLabel(a)} and ${ctx.seatLabel(b)}`
      const mine = ctx.localSeat === a || ctx.localSeat === b
      return mine ? `Game over. Your team (${names}) wins.` : `Game over. ${names} win.`
    }
    case 'ffa_move_limit_tie':
    case 'teams_draw':
      return 'Game over. A draw by the move limit.'
    case 'ffa_agreed_draw':
    case 'teams_agreed_draw':
      return 'Game over. A draw by agreement.'
  }
}

/** The leader(s) of `seat` under attack in `snap`, e.g. "king" or "prime ministers on e1 and h1". */
function attackedText(snap: Snapshot, s: number): string {
  const squares = snap.attackedLeaderSquares[s] ?? []
  const kinds = squares.map((sq) => snap.board[indexOf(sq)]?.kind ?? 'king')
  const kind = kinds[0] ?? 'king'
  // A seat with several leaders (England's Prime Ministers) says which ones.
  const several = (snap.leaderSquares[s]?.length ?? 1) > 1
  if (!several) return `${pieceWord(kind)} is`
  const list =
    squares.length <= 1
      ? (squares[0] ?? '')
      : `${squares.slice(0, -1).join(', ')} and ${squares[squares.length - 1]}`
  return squares.length > 1 && kinds.every((k) => k === kind)
    ? `${plural(kind)} on ${list} are`
    : `${pieceWord(kind)} on ${list} is`
}

/**
 * Sentences for one step from `prev` to `next` with the engine's `events` (from `applyMove`,
 * `applyTimeout`, `applyAbandon` or the server). One sentence per move, then checks that
 * appeared, defeats, frozen armies and the result.
 */
export function describeStep(
  prev: Snapshot | null,
  next: Snapshot,
  events: readonly GameEvent[],
  ctx: AnnounceContext = DEFAULT_ANNOUNCE,
): string[] {
  const out: string[] = []
  let move: string | null = null
  // `own` verbosity: another seat's move is read only when it takes one of the viewer's pieces.
  const quiet = ctx.verbosity === 'own'
  let moveSeat: Seat | null = null
  let hitsMe = false
  const flush = () => {
    if (move && (!quiet || moveSeat === ctx.localSeat || hitsMe)) out.push(`${move}.`)
    move = null
    moveSeat = null
    hitsMe = false
  }
  const tail: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'move_made':
        flush()
        moveSeat = e.seat
        move =
          e.flag === 'castle'
            ? `${who(e.seat, ctx)} castled: ${pieceWord(e.piece)} ${e.from} to ${e.to}`
            : `${who(e.seat, ctx)}: ${pieceWord(e.piece)} ${e.from} to ${e.to}`
        break
      case 'capture': {
        const victim = `${whose(e.captured.owner, ctx)} ${pieceWord(e.captured.kind)}`
        if (e.captured.owner === ctx.localSeat) hitsMe = true
        if (move) move += `, takes ${victim}`
        else {
          moveSeat = e.seat
          move = `${who(e.seat, ctx)} took ${victim} on ${e.square}`
        }
        break
      }
      case 'en_passant':
        if (move) move += ' en passant'
        break
      case 'promotion':
        if (move) move += `, promotes to ${pieceWord(e.kind)}`
        else {
          moveSeat = e.seat
          move = `${who(e.seat, ctx)} promoted to ${pieceWord(e.kind)} on ${e.square}`
        }
        break
      case 'castle':
        if (move) move += `, rook ${e.rookFrom} to ${e.rookTo}`
        break
      case 'pass':
        flush()
        if (!quiet || e.seat === ctx.localSeat)
          out.push(`${who(e.seat, ctx)} passed (no legal move).`)
        break
      case 'defeat':
        tail.push(
          `${who(e.seat, ctx)} ${isAre(e.seat, ctx)} defeated: ${DEFEAT_TEXT[e.reason] ?? e.reason}.`,
        )
        break
      case 'frozen':
        tail.push(`${capitalise(whose(e.seat, ctx))} army is frozen.`)
        break
      case 'army_removed':
        // Said by the defeat (FFA) or the result (Teams).
        break
      case 'game_ended':
        break
    }
  }
  flush()
  // Checks that appeared with this step (information only: a leader under attack). A seat
  // with several leaders (England) is told again when another of them comes under attack.
  if (!next.isOver) {
    SEATS.forEach((seat, s) => {
      if (!next.leaderUnderAttack[s]) return
      if (seat === ctx.localSeat && !ctx.ownCheck) return
      if (prev?.leaderUnderAttack[s]) {
        const several = (next.leaderSquares[s]?.length ?? 1) > 1
        const before = prev.attackedLeaderSquares[s] ?? []
        const now = next.attackedLeaderSquares[s] ?? []
        if (!several || now.every((sq) => before.includes(sq))) return
      }
      out.push(`Check: ${whose(seat, ctx)} ${attackedText(next, s)} under attack.`)
    })
  }
  out.push(...tail)
  const defeated = events.flatMap((e) => (e.type === 'defeat' ? [e.seat] : []))
  const ended = events.find((e) => e.type === 'game_ended')
  if (ended && ended.type === 'game_ended')
    out.push(describeResult(ended.outcome.result, ctx, next, defeated))
  else if (next.isOver && next.outcome && !prev?.isOver)
    out.push(describeResult(next.outcome.result, ctx, next, defeated))
  return out.map((s) => capitalise(s))
}

/**
 * The turn arriving at the viewer's seat (`ctx.localSeat`): "Your move.", with the check
 * when their leader is under attack ("Your move. Check: your king is under attack.").
 */
export function describeTurn(next: Snapshot, ctx: AnnounceContext): string {
  const s = ctx.localSeat === null ? -1 : SEATS.indexOf(ctx.localSeat)
  if (s < 0 || !next.leaderUnderAttack[s]) return 'Your move.'
  return `Your move. Check: your ${attackedText(next, s)} under attack.`
}

/**
 * A step without events (a reconnect or a resync): only a single move that the board
 * difference names (`from`, `to`, the mover) is described.
 */
export function describeBareMove(
  next: Snapshot,
  from: number,
  to: number,
  seat: Seat,
  ctx: AnnounceContext = DEFAULT_ANNOUNCE,
): string {
  const kind = next.board[to]?.kind ?? 'pawn'
  return `${who(seat, ctx)}: ${pieceWord(kind)} ${nameOf(from)} to ${nameOf(to)}.`
}

/** What a square holds, e.g. "e4, empty" or "b7, West knight" or "e1, your king". */
export function describeSquare(
  snap: Snapshot | null,
  index: number,
  ctx: AnnounceContext = DEFAULT_ANNOUNCE,
): string {
  const name = nameOf(index)
  const p = snap?.board[index] ?? null
  if (!p) return `${name}, empty`
  const status = snap?.statuses[SEATS.indexOf(p.owner)]
  const owner = p.owner === ctx.localSeat ? 'your' : ctx.seatLabel(p.owner)
  const frozen = status === 'frozen' ? ' (frozen)' : ''
  return `${name}, ${owner} ${pieceWord(p.kind)}${frozen}`
}

/**
 * Batches announcements: messages that arrive close together (bots replying one after another)
 * are read as one, after `quietMs` without a new one, or at most `maxWaitMs` after the first.
 * `soon` (the viewer's own move) shortens the wait to 150 ms.
 */
export class AnnounceBatcher {
  #pending: string[] = []
  #timer: ReturnType<typeof setTimeout> | 0 = 0
  #first = 0
  readonly #quietMs: number
  readonly #maxWaitMs: number
  readonly #onFlush: (text: string) => void

  constructor(
    onFlush: (text: string) => void,
    options: { quietMs?: number; maxWaitMs?: number } = {},
  ) {
    this.#onFlush = onFlush
    this.#quietMs = options.quietMs ?? 700
    this.#maxWaitMs = options.maxWaitMs ?? 2500
  }

  queue(sentences: readonly string[], soon = false): void {
    if (sentences.length === 0) return
    const now = Date.now()
    if (this.#pending.length === 0) this.#first = now
    this.#pending.push(...sentences)
    if (this.#timer) clearTimeout(this.#timer)
    const wait = Math.max(
      0,
      Math.min(soon ? 150 : this.#quietMs, this.#first + this.#maxWaitMs - now),
    )
    this.#timer = setTimeout(() => this.flush(), wait)
  }

  /** Hands over everything queued now. */
  flush(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = 0
    if (this.#pending.length === 0) return
    const text = this.#pending.join(' ')
    this.#pending = []
    this.#onFlush(text)
  }

  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = 0
    this.#pending = []
  }
}

/**
 * Two visually hidden live regions next to the canvas: `moves` (polite, batched by an
 * `AnnounceBatcher`) for what happens in the game, and `cursor` (polite, at once) for answers
 * to the keyboard.
 */
export class LiveAnnouncer {
  readonly moves: HTMLElement
  readonly cursor: HTMLElement
  readonly #batch: AnnounceBatcher
  #lastCursor = ''

  constructor(
    parent: HTMLElement,
    options: { quietMs?: number; maxWaitMs?: number; onLine?: (text: string) => void } = {},
  ) {
    const doc = parent.ownerDocument
    this.moves = doc.createElement('div')
    this.moves.setAttribute('aria-live', 'polite')
    this.moves.setAttribute('aria-relevant', 'additions')
    this.moves.dataset.boardAnnouncer = 'moves'
    this.cursor = doc.createElement('div')
    this.cursor.setAttribute('role', 'status')
    this.cursor.setAttribute('aria-live', 'polite')
    this.cursor.setAttribute('aria-atomic', 'true')
    this.cursor.dataset.boardAnnouncer = 'cursor'
    for (const el of [this.moves, this.cursor]) {
      Object.assign(el.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        margin: '-1px',
        padding: '0',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        clipPath: 'inset(50%)',
        whiteSpace: 'nowrap',
        border: '0',
      })
      parent.appendChild(el)
    }
    this.#batch = new AnnounceBatcher((text) => {
      const line = doc.createElement('p')
      line.textContent = text
      this.moves.appendChild(line)
      // Only additions are read; old lines are kept briefly, then dropped.
      while (this.moves.childElementCount > 4) this.moves.firstElementChild?.remove()
      options.onLine?.(text)
    }, options)
  }

  /** Queues sentences for the moves region; `soon` shortens the wait (the viewer's own move). */
  queue(sentences: readonly string[], soon = false): void {
    this.#batch.queue(sentences, soon)
  }

  /** Speaks everything queued now. */
  flush(): void {
    this.#batch.flush()
  }

  /** Answers the keyboard at once in the cursor region (replacing what it said before). */
  say(text: string): void {
    this.cursor.textContent = repeatable(text, this.#lastCursor)
    this.#lastCursor = this.cursor.textContent
  }

  destroy(): void {
    this.#batch.cancel()
    this.moves.remove()
    this.cursor.remove()
  }
}

/** `text`, changed invisibly when it equals `last`, so a live region reads it again. */
export function repeatable(text: string, last: string): string {
  return text === last ? `${text}\u00a0` : text
}
