import { isUntimed } from '@game/protocol'
import { animate, motion } from 'motion/react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { isGuest, useAppState } from '../../lib/app-state.tsx'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { Confetti } from '../game/Confetti.tsx'
import { Medal } from '../game/Medal.tsx'
import { botLevelText } from '../game/PlayerCard.tsx'
import { Button } from '../ui.tsx'
import { EloDelta } from './RankedBadge.tsx'
import {
  DEFEAT_REASON_LABEL,
  END_REASON_LABEL,
  ordinal,
  SEAT_LABEL,
  seatHex,
  seatName,
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
  reduceMotion = false,
  onClose,
  onLeave,
  friendAction,
}: {
  feed: MatchFeed
  /** Per seat: how it was knocked out (rules defeat reason), or null. */
  defeatReasons: (string | null)[] | null
  reduceMotion?: boolean
  onClose: () => void
  onLeave: () => void
  /** Per seat: the "Add friend" button for another registered player, or null. */
  friendAction?: (seat: number) => ReactNode
}) {
  const { state, gameOver, mySeat } = feed
  const { session } = useAppState()
  // Guests who played with other people: say how to add them.
  const guestHint =
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

  return (
    <motion.div
      className="safe-y-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/65 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      data-testid="game-over"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.section
        ref={panel}
        className={`relative my-auto w-full max-w-lg overflow-hidden rounded-2xl border bg-panel p-5 shadow-2xl shadow-black/60 sm:p-8 ${
          won ? 'border-gold/50' : 'border-parchment/15'
        }`}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {won ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_top,rgba(212,160,23,0.22),transparent_70%)]"
          />
        ) : null}
        {won && !reduceMotion ? (
          <Confetti
            colors={[seatHex(0), seatHex(1), seatHex(2), seatHex(3), '#f4efe6', '#d4a017']}
          />
        ) : null}

        <div className="relative flex items-start gap-4">
          {won && mine ? (
            <span
              className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border"
              style={{
                borderColor: `${myColor}99`,
                backgroundColor: `${myColor}26`,
                color: myColor,
              }}
            >
              <CivEmblem civ={mine.civ} className="h-8 w-8" />
            </span>
          ) : null}
          <div className="min-w-0">
            <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.3em] text-gold uppercase">
              {isUntimed(state.timeControl)
                ? 'Untimed game vs bots'
                : state.ranked
                  ? rated
                    ? 'Ranked game'
                    : 'Ranked game · not rated'
                  : 'Casual game'}
            </p>
            <h2
              id="game-over-title"
              tabIndex={-1}
              className={`mt-1 font-display text-4xl font-semibold outline-none ${won ? 'text-gold' : ''}`}
            >
              {headline}
            </h2>
            {subline ? (
              <p className="mt-2 text-sm text-parchment/65" data-testid="game-over-subline">
                {subline}
              </p>
            ) : null}
          </div>
        </div>

        {myRating ? (
          <div
            className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-parchment/10 bg-ink/40 px-4 py-3"
            data-testid="my-elo-change"
          >
            <div className="min-w-0">
              <p className="text-xs text-parchment/55">
                {state.timeControl} {state.mode === 'ffa' ? 'Free-for-all' : 'Teams'} Elo
              </p>
              <p className="text-xs text-parchment/45 tabular-nums">
                {myRating.before} → {myRating.after}
              </p>
            </div>
            <p className="ml-auto flex items-center gap-3">
              <span
                className="font-display text-[28px] leading-none font-semibold tabular-nums"
                aria-hidden="true"
              >
                <CountUp from={myRating.before} to={myRating.after} reduceMotion={reduceMotion} />
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${
                  delta > 0 ? 'bg-[#7fd8b7]/15' : delta < 0 ? 'bg-seat-south/20' : 'bg-parchment/10'
                }`}
              >
                <EloDelta delta={delta} />
              </span>
            </p>
          </div>
        ) : null}

        {aborted ? null : (
          <ol className="relative mt-5 flex flex-col gap-2">
            {order.map((i, idx) => {
              const seat = state.seats[i]
              if (!seat) return null
              const rating = gameOver?.ratings[i]
              const reason = defeatReasons?.[i] ?? null
              const d = rating ? rating.after - rating.before : null
              const place = placements[i] ?? null
              const first = place === 1 && !isDraw
              return (
                <motion.li
                  key={i}
                  data-testid={`placement-${seatName(i)}`}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    first
                      ? 'border-gold/60 bg-gradient-to-r from-gold/10 to-transparent'
                      : i === mySeat
                        ? 'border-parchment/25 bg-parchment/[0.04]'
                        : 'border-parchment/10'
                  }`}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.24,
                    ease: 'easeOut',
                    delay: 0.15 + (order.length - 1 - idx) * 0.12,
                  }}
                >
                  <Medal place={place} label={place ? ordinal(place) : undefined} />
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${seatHex(i)}26`, color: seatHex(i) }}
                  >
                    <CivEmblem civ={seat.civ} className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">
                        {seat.isBot ? `Bot · ${botLevelText(seat.botLevel)}` : seat.displayName}
                      </span>
                      {i === mySeat ? (
                        <span className="shrink-0 rounded border border-gold/50 bg-gold/15 px-1 text-[10px] leading-4 font-bold tracking-wider text-gold uppercase">
                          You
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-parchment/65">
                      {civName(seat.civ)} · {SEAT_LABEL[seatName(i)]}
                      {reason ? (
                        <span
                          className={reason === 'resign' ? 'text-seat-south-light/90' : ''}
                          data-testid={`defeat-${seatName(i)}`}
                        >
                          {' · '}
                          {DEFEAT_REASON_LABEL[reason] ?? reason}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {friendAction?.(i) ?? null}
                  {rating && d !== null ? (
                    <span
                      className="shrink-0 text-right text-sm tabular-nums"
                      data-testid={`elo-${seatName(i)}`}
                      title={`Elo ${rating.before} → ${rating.after}`}
                    >
                      <span className="block font-semibold">
                        {rating.after}
                        <span className="ml-1 text-[11px] font-medium text-parchment/45">Elo</span>
                      </span>
                      <EloDelta delta={d} className="block text-xs font-semibold" />
                    </span>
                  ) : null}
                </motion.li>
              )
            })}
          </ol>
        )}

        {guestHint ? (
          <p
            className="relative mt-4 text-center text-xs text-parchment/60"
            data-testid="friends-guest-hint"
          >
            <Link to="/sign-up" className="font-semibold text-gold hover:underline">
              Create an account
            </Link>{' '}
            to add the people you played with as friends.
          </p>
        ) : null}
        <div className="relative mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            View board
          </Button>
          <Button onClick={onLeave} data-testid="back-to-lobbies">
            {isUntimed(state.timeControl) ? 'Back to Play' : 'Back to lobbies'}
          </Button>
        </div>
      </motion.section>
    </motion.div>
  )
}
