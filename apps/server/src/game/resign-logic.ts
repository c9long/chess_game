/**
 * Teams resignation votes (pure helpers, no room state): who must agree, when a pending
 * proposal lapses, and how a bot teammate answers. In Teams a resignation resigns the whole
 * team, so the proposer's teammate must agree first (FFA resignations need no vote). The
 * rules engine applies the result (`Game.applyResign`); nothing here decides a game rule.
 */
import type { ResignLapseReason } from '@game/protocol'
import type { SeatTuple, Snapshot } from '@game/rules'
import { botAcceptsDraw } from './draw-logic.ts'

/** Teams team of a seat: 0 = South+North, 1 = West+East. */
export function teamOf(seat: number): 0 | 1 {
  return (seat % 2) as 0 | 1
}

/** The Teams partner of a seat (the seat opposite). */
export function teammateOf(seat: number): number {
  return (seat + 2) % 4
}

/**
 * Whether a pending proposal by `proposer` lapses after a game action: the proposer or its
 * teammate stopped taking turns (`voters_changed`), or a full round has passed (`round`):
 * every other seat still taking turns has taken a turn since the proposal and the turn has
 * come back round to the proposer (it is to move, or its turn came and it passed
 * automatically). Null while it stands. `takers` are the seats still taking turns (the
 * engine's `drawVoters()`); `turnsTaken` holds the seats that took a turn since the
 * proposal: other seats' moves and passes, and the proposer's passes only. The same round
 * rule as draw offers.
 */
export function resignLapseReason(
  proposer: number,
  takers: SeatTuple<boolean>,
  seatToMove: number,
  turnsTaken: ReadonlySet<number>,
): ResignLapseReason | null {
  if (!takers[proposer] || !takers[teammateOf(proposer)]) return 'voters_changed'
  const othersMoved = takers.every((t, i) => !t || i === proposer || turnsTaken.has(i))
  if (!othersMoved) return null
  return seatToMove === proposer || turnsTaken.has(proposer) ? 'round' : null
}

/**
 * How a bot teammate at `seat` answers a proposal to resign its team: agree only when the
 * team is clearly losing, by the same material check bots use for draw offers (the team's
 * material in play is at most BOT_DRAW_ACCEPT_RATIO of the enemy team's); otherwise decline.
 */
export function botAcceptsTeamResign(snapshot: Snapshot, seat: number): boolean {
  return snapshot.config.mode === 'teams' && botAcceptsDraw(snapshot, seat)
}
