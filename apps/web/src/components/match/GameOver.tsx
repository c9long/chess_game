import { isUntimed, REMATCH_VOTE } from '@game/protocol'
import { animate, motion } from 'motion/react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { isGuest, useAppState } from '../../lib/app-state.tsx'
import type { MatchRoom } from '../../lib/match.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { Confetti } from '../game/Confetti.tsx'
import { CrownIcon } from '../game/icons.tsx'
import { plateName } from '../game/PlayerCard.tsx'
import { Button, textLinkClass } from '../ui.tsx'
import { EloDelta } from './RankedBadge.tsx'
import { RematchPanel } from './Rematch.tsx'
import {
  DEFEAT_REASON_LABEL,
  END_REASON_LABEL,
  ordinal,
  PODIUM,
  SEAT_LABEL,
  seatHex,
  seatName,
  seatTextHex,
  teamLabel,
} from './seats.ts'

/** A number that counts from `from` to `to` (once, on mount). */
function CountUp({ from, to, reduceMotion }: { from: number; to: number; reduceMotion: boolean }) {
  const [value, setValue] = useState(reduceMotion ? to : from)
  useEffect(() => {
    if (reduceMotion) {
      setValue(to)
      return
    }
    const controls = animate(from, to, {
      duration: 0.6,
      delay: 0.35,
      ease: 'easeOut',
      onUpdate: (v) => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [from, to, reduceMotion])
  return <>{value}</>
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Modal focus handling: focus the heading on open, keep Tab inside the dialog, close on
 * Escape, and give focus back to where it was (the board) on close.
 */
function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      const root = panel.current
      if (!root) return
      // A menu or dialog opened from the panel (player menu, report, block) handles its own
      // keys: its Escape closes only that layer, and Tab stays inside it.
      if (e.defaultPrevented) return
      const t = e.target
      if (
        t instanceof Element &&
        !root.contains(t) &&
        t.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')
      ) {
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (!root.contains(active) || active === root.querySelector('h2')) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [panel])
}

export function GameOver({
  feed,
  defeatReasons,
  defeatLabels = null,
  reduceMotion = false,
  finalMoves = '',
  onClose,
  onLeave,
  friendAction,
  room,
  spectator = false,
  onReplay,
}: {
  feed: MatchFeed
  /**
   * The board's last announcement (the moves that ended the game), repeated as the dialog's
   * description: a screen reader that silences live regions outside a modal dialog still
   * hears which move ended the game.
   */
  finalMoves?: string
  /** Per seat: how it was knocked out (rules defeat reason), or null. */
  defeatReasons: (string | null)[] | null
  /** Per seat: display text for its defeat (see `defeatReasonLabel`), or null for the default. */
  defeatLabels?: (string | null)[] | null
  reduceMotion?: boolean
  onClose: () => void
  onLeave: () => void
  /** Per seat: the "Add friend" button for another registered player, or null. */
  friendAction?: (seat: number) => ReactNode
  /** The match room, for the rematch controls (players only). */
  room?: MatchRoom | undefined
  /** Watching: no rematch, and "Stop watching" to leave. */
  spectator?: boolean
  /** Players: open the saved game's replay (leaves the room). Shown once the game is saved. */
  onReplay?: (matchId: string) => void
}) {
  const { state, gameOver, mySeat } = feed
  const { session } = useAppState()
  // Guests who played with other people: say how to add them.
  const guestHint =
    !spectator &&
    isGuest(session?.user) &&
    !isUntimed(state.timeControl) &&
    state.seats.some((s, i) => i !== mySeat && s.occupied && !s.isBot)
  const result = state.result
  const placements = gameOver?.placements ?? result.placements
  const aborted = result.type === 'aborted'
  const order = [0, 1, 2, 3].sort((a, b) => (placements[a] ?? 9) - (placements[b] ?? 9))
  const myPlace = mySeat >= 0 ? placements[mySeat] : undefined

  // Ratings arrive with gameOver (after the result is saved); until then, the room state.
  const rated = gameOver ? gameOver.rated : state.rated
  const myRating = mySeat >= 0 ? (gameOver?.ratings[mySeat] ?? null) : null
  // A solo FFA game ends (as a draw between the bots) as soon as its player is out.
  const eliminated = result.endReason === 'player_eliminated'
  const agreedDraw =
    !eliminated && (result.type === 'ffa_agreed_draw' || result.type === 'teams_agreed_draw')
  // A player knocked out before an agreed draw didn't share it: they see their own place.
  const inDraw = agreedDraw && (myPlace === undefined || myPlace === 1)
  const isDraw = inDraw || result.type === 'teams_draw'
  const won = !aborted && !isDraw && myPlace === 1
  let headline = 'Game over'
  if (aborted) headline = 'Game cancelled'
  else if (eliminated) headline = mySeat >= 0 ? 'You were eliminated' : 'Player eliminated'
  else if (inDraw) headline = 'Draw agreed'
  else if (result.type === 'teams_draw') headline = 'Draw'
  else if (myPlace === 1) headline = 'Victory'
  else if (myPlace) headline = `You finished ${ordinal(myPlace)}`

  const parts = [END_REASON_LABEL[result.endReason] ?? '']
  if (agreedDraw && !inDraw) parts[0] = 'The remaining players agreed to a draw'
  if (eliminated) {
    parts[0] = myPlace
      ? `You finished ${ordinal(myPlace)}. The game ends here; the bots share 1st place`
      : 'The player was eliminated. The bots share 1st place'
  }
  if (inDraw && myPlace === 1 && placements.filter((p) => p === 1).length > 1) {
    parts.push('You share 1st place')
  }
  if (result.type === 'teams_winner') {
    const winnerTeam = result.winnerTeam === 'south_north' ? 0 : 1
    const loserTeam = 1 - winnerTeam
    const myTeam = mySeat >= 0 ? mySeat % 2 : -1
    if (result.endReason === 'team_resigned') {
      parts[0] = won
        ? 'The other team resigned. Your team wins'
        : myTeam === loserTeam
          ? 'Your team resigned'
          : `${teamLabel(loserTeam)} resigned. ${teamLabel(winnerTeam)} wins`
    } else {
      parts[0] = won ? 'Your team wins' : `${teamLabel(winnerTeam)} wins`
    }
  }
  if (result.type === 'ffa_winner' && result.winnerSeat >= 0) {
    const w = state.seats[result.winnerSeat]
    parts[0] =
      result.winnerSeat === mySeat
        ? 'You are the last civilization standing'
        : `${w?.isBot ? `The ${civName(w.civ)} bot` : `${w?.displayName} (${civName(w?.civ ?? '')})`} is the last civilization standing`
  }
  // Each part reads as a sentence, so the line is punctuated the same however it's built.
  const subline = parts
    .filter(Boolean)
    .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`))
    .join(' ')
  const mine = mySeat >= 0 ? state.seats[mySeat] : undefined
  const myColor = mySeat >= 0 ? seatHex(mySeat) : '#d4a017'
  const delta = myRating ? myRating.after - myRating.before : 0
  const panel = useRef<HTMLElement>(null)
  useDialogFocus(panel, onClose)
  // The heading already says the result: only the moves (and defeats) are repeated.
  const lastMoves = finalMoves.replace(/\s*Game over\..*$/s, '').trim()

  // The one gold action: the rematch while there is one to propose or answer, else leaving.
  const rematchShown = Boolean(room) && !spectator && mySeat >= 0 && !state.seats[mySeat]?.isBot
  const rematchVotes = state.rematchVotes ?? []
  const rematchPrimary =
    rematchShown &&
    !state.rematchRoomId &&
    ((state.rematchSeat ?? -1) < 0 || rematchVotes[mySeat] === REMATCH_VOTE.pending)
  const gameKind = isUntimed(state.timeControl)
    ? 'Untimed game against bots'
    : state.ranked
      ? rated
        ? 'Ranked game'
        : 'Ranked game, not rated'
      : 'Casual game'

  return (
    <motion.div
      className="safe-y-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/65 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      aria-describedby={lastMoves ? 'game-over-moves' : undefined}
      data-testid="game-over"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.section
        ref={panel}
        className={`relative my-auto w-full max-w-lg overflow-hidden rounded-sheet border bg-panel px-5 pt-7 pb-5 shadow-lift sm:px-8 sm:pt-9 sm:pb-7 ${
          won ? 'border-gold/60' : 'border-rule-brass'
        }`}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {/* The plaque's engraved inner line. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-1.5 rounded-[0.75rem] border border-brass/15"
        />
        {won && !reduceMotion ? (
          <Confetti
            colors={[seatHex(0), seatHex(1), seatHex(2), seatHex(3), '#f4efe6', '#d4a017']}
          />
        ) : null}

        <header className="relative flex flex-col items-center text-center">
          {won && mine ? (
            <span
              className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold/70 bg-black/20 shadow-plate"
              style={{ color: myColor }}
            >
              <CivEmblem civ={mine.civ} className="h-8 w-8" />
            </span>
          ) : null}
          <h2
            id="game-over-title"
            tabIndex={-1}
            className={`font-display text-title font-semibold outline-none ${won ? 'text-gold' : 'text-parchment'}`}
          >
            {headline}
          </h2>
          {subline ? (
            <p
              className="mt-2 max-w-[48ch] text-ui text-pretty text-muted"
              data-testid="game-over-subline"
            >
              {subline}
            </p>
          ) : null}
          <p className="mt-1 text-caption text-faint">{gameKind}</p>
          {lastMoves ? (
            <p id="game-over-moves" className="sr-only" data-testid="game-over-moves">
              Last moves: {lastMoves}
            </p>
          ) : null}
          <Ornament />
        </header>

        {myRating ? (
          <div
            className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule pb-4"
            data-testid="my-elo-change"
          >
            <div className="min-w-0">
              <p className="text-ui text-muted">
                {state.timeControl} {state.mode === 'ffa' ? 'Free-for-all' : 'Teams'} Elo
              </p>
              <p className="text-caption text-faint tabular-nums">
                {myRating.before} → {myRating.after}
              </p>
            </div>
            <p className="ml-auto flex items-baseline gap-3">
              <span
                className="font-display text-[1.75rem] leading-none font-semibold tabular-nums"
                aria-hidden="true"
              >
                <CountUp from={myRating.before} to={myRating.after} reduceMotion={reduceMotion} />
              </span>
              <EloDelta delta={delta} className="text-body font-semibold" />
            </p>
          </div>
        ) : null}

        {aborted ? null : (
          <ol className="relative mt-2 flex flex-col divide-y divide-rule" aria-label="Placings">
            {order.map((i, idx) => {
              const seat = state.seats[i]
              if (!seat) return null
              const rating = gameOver?.ratings[i]
              const reason = defeatReasons?.[i] ?? null
              const d = rating ? rating.after - rating.before : null
              const place = placements[i] ?? null
              const first = place === 1 && !isDraw
              const podium = place ? PODIUM[place - 1] : undefined
              return (
                <motion.li
                  key={i}
                  data-testid={`placement-${seatName(i)}`}
                  className="flex min-h-14 items-center gap-3 py-2.5"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.24,
                    ease: 'easeOut',
                    delay: 0.15 + (order.length - 1 - idx) * 0.12,
                  }}
                >
                  <span
                    className="flex w-11 shrink-0 items-center gap-1 font-display text-lead font-semibold tabular-nums"
                    style={{ color: podium ?? 'var(--color-faint)' }}
                  >
                    {place ? ordinal(place) : '—'}
                    {first ? <CrownIcon className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brass/40 bg-black/20"
                    style={{ color: seatTextHex(i) }}
                  >
                    <CivEmblem civ={seat.civ} className="h-[22px] w-[22px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate font-display text-body font-semibold">
                        {plateName(seat)}
                      </span>
                      {i === mySeat ? (
                        <span className="shrink-0 text-caption text-faint">(you)</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-caption text-faint">
                      {`${civName(seat.civ)}, ${SEAT_LABEL[seatName(i)]}`}
                      {reason ? (
                        <span
                          className={`ml-2.5 ${reason === 'resign' ? 'text-destructive-light' : 'text-muted'}`}
                          data-testid={`defeat-${seatName(i)}`}
                        >
                          <span className="sr-only">, </span>
                          {defeatLabels?.[i] ?? DEFEAT_REASON_LABEL[reason] ?? reason}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {friendAction?.(i) ?? null}
                  {rating && d !== null ? (
                    <span
                      className="shrink-0 text-right text-ui tabular-nums"
                      data-testid={`elo-${seatName(i)}`}
                      title={`Elo ${rating.before} → ${rating.after}`}
                    >
                      <span className="block font-semibold">
                        {rating.after}
                        <span className="ml-1 text-caption font-medium text-faint">Elo</span>
                      </span>
                      <EloDelta delta={d} className="block text-caption font-semibold" />
                    </span>
                  ) : null}
                </motion.li>
              )
            })}
          </ol>
        )}

        {guestHint ? (
          <p
            className="relative mt-3 text-center text-caption text-faint"
            data-testid="friends-guest-hint"
          >
            <Link to="/sign-up" className={textLinkClass}>
              Create an account
            </Link>{' '}
            to add the people you played with as friends.
          </p>
        ) : null}
        {rematchShown && room ? <RematchPanel room={room} feed={feed} /> : null}
        <div className="relative mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-rule pt-4">
          <Button variant="quiet" onClick={onClose}>
            View board
          </Button>
          {/* The replay exists once the result is saved (`gameOver`); players only. */}
          {onReplay && gameOver?.matchId && !aborted && mySeat >= 0 ? (
            <Button
              variant="quiet"
              onClick={() => onReplay(gameOver.matchId)}
              data-testid="watch-replay"
            >
              Watch replay
            </Button>
          ) : null}
          <Button
            variant={rematchPrimary ? 'secondary' : 'primary'}
            onClick={onLeave}
            className="max-sm:basis-full"
            data-testid="back-to-lobbies"
          >
            {spectator
              ? 'Stop watching'
              : isUntimed(state.timeControl)
                ? 'Back to Play'
                : 'Back to lobbies'}
          </Button>
        </div>
      </motion.section>
    </motion.div>
  )
}

/** A brass hairline with a small lozenge in the middle, under the plaque's heading. */
function Ornament() {
  return (
    <span aria-hidden="true" className="mt-4 flex w-40 items-center gap-2 text-brass/70">
      <span className="h-px flex-1 bg-current" />
      <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2 w-2" fill="currentColor">
        <path d="M5 0 10 5 5 10 0 5Z" />
      </svg>
      <span className="h-px flex-1 bg-current" />
    </span>
  )
}
