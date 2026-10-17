import type { SeatStateJson } from '@game/protocol/state'
import { useAnimate } from 'motion/react'
import { type CSSProperties, useEffect, useRef } from 'react'
import { CivEmblem } from '../CivEmblem.tsx'
import { seatTitle } from './PlayerCard.tsx'

/** The banner text on the viewer's turn when their leader is under attack. */
export const CHECK_TEXT = 'Check! Your leader is under attack'
/** The notice after the viewer's own move left their leader under attack (self-check). */
export const SELF_CHECK_TEXT = 'Your leader is in check'

/**
 * Whose turn it is. "Your move" gets a short pop and a gold glow when the turn arrives; when
 * the viewer's leader is under attack at that moment it reads "Check! Your leader is under
 * attack" in the danger colour instead (the check indicator; only ever for the viewer's own
 * seat). An opponent's turn names them in their seat colour; after the viewer's own move left
 * their leader attacked (`selfCheck`), a "Your leader is in check" pill sits beside it (its own
 * row in the desktop side panel), never over the board. The banner is not a live region: the
 * board's own announcer reads every move, then "Your move" (with the check) when the turn
 * arrives and the result at the end, in that order, so nothing here runs ahead of the moves
 * that caused it. The pill is visual only: the host announces it through its own live region.
 * The texts "Your move", the check text and "Game over" are exact (tests rely on them).
 */
export function TurnBanner({
  finished,
  myTurn,
  inCheck = false,
  selfCheck = false,
  mover,
  moverColor,
  reduceMotion,
  onShowResults,
}: {
  finished: boolean
  myTurn: boolean
  /** It is the viewer's turn and the check indicator applies (see `lib/check-indicator.ts`). */
  inCheck?: boolean
  /** Not the viewer's turn, and their own move left their leader under attack. */
  selfCheck?: boolean
  /** The seat to move (when it isn't the viewer's turn). */
  mover: SeatStateJson | undefined
  moverColor: string
  reduceMotion: boolean
  /** Set when the result dialog is closed: a way back to it. */
  onShowResults?: (() => void) | undefined
}) {
  const [scope, animate] = useAnimate<HTMLParagraphElement>()
  const wasMyTurn = useRef(myTurn)
  const wasInCheck = useRef(inCheck)

  useEffect(() => {
    const arrived = (myTurn && !wasMyTurn.current) || (inCheck && !wasInCheck.current)
    wasMyTurn.current = myTurn
    wasInCheck.current = inCheck
    if (!arrived || reduceMotion || !scope.current) return
    const rgb = inCheck ? '255,90,31' : '212,160,23'
    animate(scope.current, { scale: [1, 1.04, 1] }, { duration: 0.32, ease: 'easeOut' })
    animate(
      scope.current,
      {
        boxShadow: [
          `0 0 0 0px rgba(${rgb},0.5)`,
          `0 0 0 6px rgba(${rgb},0.28)`,
          `0 0 0 10px rgba(${rgb},0)`,
        ],
      },
      { duration: 0.9, ease: 'easeOut' },
    )
  }, [myTurn, inCheck, reduceMotion, animate, scope])

  const base =
    'relative flex h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg px-3 text-sm font-semibold transition-colors duration-200'

  let tone = 'bg-ink/50 text-parchment/70'
  let style: CSSProperties | undefined
  if (finished) tone = 'bg-ink/50 text-parchment/70 justify-center'
  else if (myTurn && inCheck)
    tone = 'bg-danger text-ink justify-center ring-2 ring-inset ring-danger-light/80'
  else if (myTurn) tone = 'bg-gold text-ink justify-center'
  else if (mover) {
    tone = 'text-parchment pl-4'
    style = { backgroundColor: `${moverColor}1f` }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p
        ref={scope}
        className={`${base} ${tone}`}
        style={style}
        data-testid="turn-banner"
        data-check={!finished && myTurn && inCheck ? 'true' : undefined}
      >
        {finished ? (
          'Game over'
        ) : myTurn && inCheck ? (
          <>
            <CheckIcon />
            <span className="min-w-0 truncate">{CHECK_TEXT}</span>
          </>
        ) : myTurn ? (
          'Your move'
        ) : mover ? (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: moverColor }}
            />
            <span className="shrink-0" style={{ color: moverColor }}>
              <CivEmblem civ={mover.civ} className="h-5 w-5" />
            </span>
            <span className="min-w-0 truncate">
              {seatTitle(mover)} {mover.isBot ? 'is thinking' : 'to move'}
              <span aria-hidden="true" className="inline-flex w-4">
                <ThinkingDots reduceMotion={reduceMotion} />
              </span>
            </span>
          </>
        ) : null}
      </p>
      {!finished && !myTurn && selfCheck ? (
        <p
          aria-hidden="true"
          // Phones and tablets: beside the banner (no layout shift under the board). Desktop:
          // its own row in the side panel, so the mover's name keeps its room.
          className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-danger px-2.5 text-xs font-semibold text-ink ring-2 ring-inset ring-danger-light/80 sm:px-3 sm:text-sm lg:w-full"
          data-testid="self-check-notice"
        >
          <CheckIcon />
          {SELF_CHECK_TEXT}
        </p>
      ) : null}
      {finished && onShowResults ? (
        <button
          type="button"
          onClick={onShowResults}
          className="h-10 shrink-0 rounded-lg border border-gold/50 bg-gold/10 px-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          data-testid="show-results"
        >
          Show results
        </button>
      ) : null}
    </div>
  )
}

/** A warning mark before the check text (decorative; the text says it all). */
function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor">
      <path d="M10 1.5 19 18H1L10 1.5Zm-1 6v5h2v-5H9Zm0 6.5v2h2v-2H9Z" />
    </svg>
  )
}

function ThinkingDots({ reduceMotion }: { reduceMotion: boolean }) {
  if (reduceMotion) return <>…</>
  return (
    <span className="inline-flex gap-[2px] pl-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${i * 180}ms` }}
        />
      ))}
    </span>
  )
}
