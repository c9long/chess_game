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
}

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
  const flush = () => {
    if (move) out.push(`${move}.`)
    move = null
  }
  const tail: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'move_made':
        flush()
        move =
          e.flag === 'castle'
            ? `${who(e.seat, ctx)} castled: ${pieceWord(e.piece)} ${e.from} to ${e.to}`
            : `${who(e.seat, ctx)}: ${pieceWord(e.piece)} ${e.from} to ${e.to}`
        break
      case 'capture': {
        const victim = `${whose(e.captured.owner, ctx)} ${pieceWord(e.captured.kind)}`
        if (move) move += `, takes ${victim}`
        else move = `${who(e.seat, ctx)} took ${victim} on ${e.square}`
        break
      }
      case 'en_passant':
        if (move) move += ' en passant'
        break
      case 'promotion':
        if (move) move += `, promotes to ${pieceWord(e.kind)}`
        else move = `${who(e.seat, ctx)} promoted to ${pieceWord(e.kind)} on ${e.square}`
        break
      case 'castle':
        if (move) move += `, rook ${e.rookFrom} to ${e.rookTo}`
        break
      case 'pass':
        flush()
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
  // Checks that appeared with this step (information only: a leader under attack).
  if (!next.isOver) {
    SEATS.forEach((seat, s) => {
      if (!next.leaderUnderAttack[s] || prev?.leaderUnderAttack[s]) return
      if (seat === ctx.localSeat && !ctx.ownCheck) return
      out.push(`Check: ${whose(seat, ctx)} ${attackedText(next, s)} under attack.`)
    })
  }
  out.push(...tail)
  const ended = events.find((e) => e.type === 'game_ended')
  if (ended && ended.type === 'game_ended') out.push(resultText(ended.outcome.result, ctx))
  else if (next.isOver && next.outcome && !prev?.isOver)
    out.push(resultText(next.outcome.result, ctx))
  return out.map((s) => capitalise(s))
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

  constructor(parent: HTMLElement, options: { quietMs?: number; maxWaitMs?: number } = {}) {
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
