/**
 * Draw offers (pure helpers, no room state): who votes, when a pending offer lapses, and how
 * a bot answers one. Every rules fact (statuses, voters, material on the board) comes from
 * the rules engine's snapshot; nothing here decides a game rule.
 */
import { DRAW_VOTE, type DrawLapseReason, type GameAction } from '@game/protocol'
import {
  type GameEvent,
  type PieceKind,
  type SeatTuple,
  type Snapshot,
  seatIndex,
} from '@game/rules'

/**
 * Conventional piece values for the bots' "am I clearly losing?" check. A single king is left
 * out; England's four Prime Ministers count (each moves like a knight or a king, and losing one
 * is a loss of material, not of the game).
 */
export const MATERIAL_VALUE: Record<PieceKind, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
  prime_minister: 4,
}

/**
 * The seats that played a turn in one game action, for the offer/proposal cooldowns: the
 * mover of a `move`, plus every seat that passed automatically (no legal move). A seat that
 * can only pass still works off its cooldown, one pass per turn.
 */
export function turnsPlayed(
  kind: GameAction,
  seat: number,
  events: readonly GameEvent[],
): number[] {
  const out = kind === 'move' ? [seat] : []
  for (const e of events) if (e.type === 'pass') out.push(seatIndex(e.seat))
  return out
}

/** A bot accepts a draw when its side's material is at most this share of the strongest rival's. */
export const BOT_DRAW_ACCEPT_RATIO = 0.8

/** Material per seat (S, W, N, E): the sum of piece values on the board. */
export function materialBySeat(snapshot: Snapshot): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0]
  const index = { south: 0, west: 1, north: 2, east: 3 } as const
  for (const piece of snapshot.board) {
    if (piece) out[index[piece.owner]] += MATERIAL_VALUE[piece.kind]
  }
  return out
}

/** Whether a seat still takes turns (active, or a Teams seat defeated but still playing). */
function inPlay(snapshot: Snapshot, seat: number): boolean {
  const status = snapshot.statuses[seat]
  return status === 'active' || status === 'defeated'
}

/**
 * How a bot at `seat` answers a draw offer: accept only when clearly losing. Material in
 * play counts (pieces of seats still taking turns; frozen Teams pieces can't move and don't
 * count). FFA: the bot's own material against the strongest other remaining player. Teams:
 * its team's total against the enemy team's. Accepts when its side has at most
 * BOT_DRAW_ACCEPT_RATIO of the other side's material.
 */
export function botAcceptsDraw(snapshot: Snapshot, seat: number): boolean {
  if (snapshot.isOver || !inPlay(snapshot, seat)) return false
  const material = materialBySeat(snapshot)
  const counted = (s: number) => (inPlay(snapshot, s) ? (material[s] ?? 0) : 0)
  let own: number
  let rival: number
  if (snapshot.config.mode === 'teams') {
    own = counted(seat) + counted((seat + 2) % 4)
    rival = counted((seat + 1) % 4) + counted((seat + 3) % 4)
  } else {
    own = counted(seat)
    rival = Math.max(...[0, 1, 2, 3].filter((s) => s !== seat).map(counted))
  }
  return own <= BOT_DRAW_ACCEPT_RATIO * rival
}

/** Initial votes of a new offer: the offerer accepted, other voters pending, the rest -1. */
export function initialVotes(voters: SeatTuple<boolean>, offerSeat: number): number[] {
  return voters.map((v, i) =>
    !v ? DRAW_VOTE.notVoter : i === offerSeat ? DRAW_VOTE.accepted : DRAW_VOTE.pending,
  )
}

/** Every voter has accepted. */
export function allAccepted(votes: readonly number[]): boolean {
  return votes.every((v) => v === DRAW_VOTE.notVoter || v === DRAW_VOTE.accepted)
}

/**
 * Whether a pending offer lapses after a game action: the voter set changed (someone was
 * defeated out of the game, removed or froze), or a full round has passed: every other
 * voter has taken a turn since the offer and the turn has come back round to the offerer
 * (it is to move, or its turn came and it passed automatically, as a defeated Teams seat
 * with no legal move does; such a seat is never the seat to move). Null while it stands.
 * `turnsTaken` holds the seats that took a turn since the offer: other seats' moves and
 * passes, and the offerer's passes only (its own moves are covered by `seatToMove`).
 */
export function lapseReason(
  votes: readonly number[],
  voters: SeatTuple<boolean>,
  offerSeat: number,
  seatToMove: number,
  turnsTaken: ReadonlySet<number>,
): DrawLapseReason | null {
  if (voters.some((v, i) => v !== (votes[i] !== DRAW_VOTE.notVoter))) return 'voters_changed'
  const othersMoved = voters.every((v, i) => !v || i === offerSeat || turnsTaken.has(i))
  if (!othersMoved) return null
  return seatToMove === offerSeat || turnsTaken.has(offerSeat) ? 'round' : null
}
