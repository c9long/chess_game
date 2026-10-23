/**
 * Rematch on the result screen: propose one, answer one, and follow the votes. The proposal
 * lives in the room state (`rematchSeat`, `rematchVotes`, `rematchDeadline`,
 * `rematchRoomId`); the server creates the new lobby once everyone answered (or time ran
 * out), and GameRoom takes the players who accepted there.
 */
import { REMATCH_TIMEOUT_MS, REMATCH_VOTE, type ServerMessages } from '@game/protocol'
import type { SeatStateJson } from '@game/protocol/state'
import { Check, Clock, RotateCcw, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type MatchRoom, matchApi } from '../../lib/match.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { Button } from '../ui.tsx'
import { seatHex } from './seats.ts'

function nameOf(seats: readonly SeatStateJson[], seat: number | undefined, mySeat: number) {
  if (seat === undefined) return 'Someone'
  if (seat === mySeat) return 'You'
  return seats[seat]?.displayName || 'A player'
}

/** The toast for a `rematchEvent` (null when nothing needs saying). */
export function rematchNotice(
  e: ServerMessages['rematchEvent'],
  seats: readonly SeatStateJson[],
  mySeat: number,
): string | null {
  const who = nameOf(seats, e.seat, mySeat)
  switch (e.type) {
    case 'proposed':
      return e.seat === mySeat ? null : `${who} wants a rematch.`
    case 'declined':
      return e.seat === mySeat ? null : `${who} declined the rematch.`
    case 'cancelled':
      return e.reason === 'proposer_left'
        ? 'The rematch was called off: the player who proposed it left.'
        : e.reason === 'nobody_accepted'
          ? 'Nobody else wanted a rematch.'
          : 'The rematch lobby could not be opened. Try again.'
    default:
      return null
  }
}

/** Seconds left until `deadline` (server ms since epoch), ticking once a second. */
function useSecondsLeft(deadline: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [deadline])
  const left = Math.ceil((deadline - now) / 1000)
  // Clamped: the server's clock and ours differ a little.
  return deadline ? Math.min(REMATCH_TIMEOUT_MS / 1000, Math.max(0, left)) : 0
}

const VOTE_LABEL: Record<number, string> = {
  [REMATCH_VOTE.pending]: 'Deciding',
  [REMATCH_VOTE.accepted]: 'In',
  [REMATCH_VOTE.declined]: 'Out',
}

function VoteIcon({ vote }: { vote: number }) {
  if (vote === REMATCH_VOTE.accepted) return <Check aria-hidden="true" className="h-3.5 w-3.5" />
  if (vote === REMATCH_VOTE.declined) return <X aria-hidden="true" className="h-3.5 w-3.5" />
  return <Clock aria-hidden="true" className="h-3.5 w-3.5" />
}

/** The rematch block of the result dialog (seated humans only). */
export function RematchPanel({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const { state, mySeat } = feed
  const send = matchApi(room).send
  const proposer = state.rematchSeat ?? -1
  const votes = state.rematchVotes ?? [-1, -1, -1, -1]
  const myVote = mySeat >= 0 ? (votes[mySeat] ?? -1) : -1
  const seconds = useSecondsLeft(state.rematchDeadline ?? 0)
  const others = state.seats.filter((s, i) => i !== mySeat && s.occupied && !s.isBot)
  const hasBots = state.seats.some((s) => s.isBot)
  // Busy from a click until the state answers (the proposal or my vote changes), or 4 s.
  const stateKey = `${proposer}|${myVote}|${state.rematchRoomId}`
  const [sentAt, setSentAt] = useState<string | null>(null)
  const busy = sentAt === stateKey

  // The button pressed goes away when the state answers: focus then moves to the panel's
  // heading (instead of dropping to the page), and the polite status says what happened.
  const root = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current || !stateKey) return
    const el = root.current
    const active = document.activeElement
    if (!el || (active && active !== document.body && el.contains(active))) return
    refocus.current = false
    el.querySelector<HTMLElement>('[data-rematch-focus]')?.focus({ preventScroll: true })
  }, [stateKey])
  const note =
    mySeat < 0
      ? ''
      : state.rematchRoomId
        ? myVote === REMATCH_VOTE.accepted
          ? 'Opening the rematch lobby.'
          : ''
        : proposer === mySeat
          ? 'You proposed a rematch. Waiting for the others.'
          : proposer >= 0 && myVote === REMATCH_VOTE.declined
            ? 'You declined the rematch.'
            : proposer >= 0 && myVote === REMATCH_VOTE.accepted
              ? 'You accepted the rematch. Waiting for the others.'
              : ''

  function act(type: 'proposeRematch' | 'respondRematch', accept?: boolean) {
    refocus.current = true
    setSentAt(stateKey)
    if (type === 'proposeRematch') send('proposeRematch', {})
    else send('respondRematch', { accept: Boolean(accept) })
    window.setTimeout(() => setSentAt(null), 4000)
  }

  if (mySeat < 0) return null
  const wrap = (content: ReactNode) => (
    <div ref={root}>
      {content}
      <p className="sr-only" role="status" aria-live="polite" data-testid="rematch-status">
        {note}
      </p>
    </div>
  )

  if (state.rematchRoomId) {
    return wrap(
      <div
        className="relative mt-4 rounded-panel border border-rule-brass bg-black/15 px-4 py-3 text-ui text-muted shadow-well outline-none"
        tabIndex={-1}
        data-rematch-focus
        data-testid="rematch-panel"
      >
        {myVote === REMATCH_VOTE.accepted
          ? 'Opening the rematch lobby…'
          : 'The others started a rematch without you.'}
      </div>,
    )
  }

  if (proposer < 0) {
    const rankedNote = state.ranked ? ' Ranked again only if all four accept.' : ''
    return wrap(
      <div
        className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-rule bg-black/15 px-4 py-3 shadow-well"
        data-testid="rematch-panel"
      >
        <p className="min-w-0 flex-1 basis-56 text-ui text-muted">
          {others.length > 0
            ? `Same players, seats and civs${hasBots ? ', bots included' : ''}. The others get ${REMATCH_TIMEOUT_MS / 1000} s to answer.${rankedNote}`
            : 'Play again with the same civs and bots.'}
        </p>
        <Button
          size="sm"
          busy={busy}
          onClick={() => act('proposeRematch')}
          data-testid="rematch-propose"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Rematch
        </Button>
      </div>,
    )
  }

  const waiting = myVote === REMATCH_VOTE.pending
  const proposerName = nameOf(state.seats, proposer, mySeat)
  return wrap(
    <div
      className="relative mt-4 rounded-panel border border-rule-brass bg-black/15 px-4 py-3 shadow-well"
      data-testid="rematch-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3
          className="font-display text-ui font-semibold outline-none"
          tabIndex={-1}
          data-rematch-focus
        >
          {proposer === mySeat ? 'You proposed a rematch' : `${proposerName} wants a rematch`}
        </h3>
        <p className="text-caption text-faint tabular-nums" data-testid="rematch-countdown">
          {seconds > 0 ? `${seconds} s left` : 'Time is up'}
        </p>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Rematch answers">
        {state.seats.map((seat, i) => {
          const vote = votes[i] ?? -1
          if (vote === REMATCH_VOTE.notVoter) return null
          const label = VOTE_LABEL[vote] ?? ''
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: four fixed seats
              key={i}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption ${
                vote === REMATCH_VOTE.declined
                  ? 'border-rule text-faint line-through'
                  : vote === REMATCH_VOTE.accepted
                    ? 'border-ok/40 text-parchment'
                    : 'border-rule-strong text-muted'
              }`}
              data-testid={`rematch-vote-${i}`}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full ring-1 ring-black/40"
                style={{ backgroundColor: seatHex(i) }}
              />
              <span>{i === mySeat ? 'You' : seat.displayName}</span>
              <VoteIcon vote={vote} />
              <span className="sr-only">: {label}</span>
            </li>
          )
        })}
      </ul>
      {waiting ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="quiet"
            busy={busy}
            onClick={() => act('respondRematch', false)}
            data-testid="rematch-decline"
          >
            Decline
          </Button>
          <Button
            size="sm"
            busy={busy}
            onClick={() => act('respondRematch', true)}
            data-testid="rematch-accept"
          >
            Accept rematch
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-caption text-faint">
          {myVote === REMATCH_VOTE.declined
            ? 'You declined.'
            : 'Waiting for the others. The new lobby opens once everyone has answered.'}
          {state.ranked && myVote !== REMATCH_VOTE.declined
            ? ' Ranked again only if all four accept; otherwise casual.'
            : ''}
        </p>
      )}
    </div>,
  )
}
