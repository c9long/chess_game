import type { SeatStateJson } from '@game/protocol/state'
import { X } from 'lucide-react'
import { useAnimate } from 'motion/react'
import { useEffect, useRef } from 'react'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { buttonBase, buttonVariants, cx } from '../ui.tsx'
import { plateName } from './PlayerCard.tsx'

/** The banner text on the viewer's turn when their leader is under attack. */
export const CHECK_TEXT = 'Check! Your leader is under attack'
/** The notice after the viewer's own move left their leader under attack (self-check). */
export const SELF_CHECK_TEXT = 'Your leader is in check'
/** Before the queued premove's words in its pill: "Premove: knight b7 to c9". */
export const PREMOVE_PREFIX = 'Premove:'

/**
 * Whose turn it is. "Your move" (a gold turn token and gold text, never a filled gold bar,
 * which would read as a button) gets a short pop and a gold ring when the turn arrives; when
 * the viewer's leader is under attack at that moment it reads "Check! Your leader is under
 * attack" in the danger colour instead (the check indicator; only ever for the viewer's own
 * seat). An opponent's turn names them in their seat colour; after the viewer's own move left
 * their leader attacked (`selfCheck`), a "Your leader is in check" pill sits beside it (its own
 * row in the desktop side panel), never over the board. The banner is not a live region: the
 * board's own announcer reads every move, then "Your move" (with the check) when the turn
 * arrives and the result at the end, in that order, so nothing here runs ahead of the moves
 * that caused it. The pill is visual only: the host announces it through its own live region.
 * While waiting, a queued premove (`premove`, with the board's words for it) sits beside the
 * banner in the premove lavender, with a button that cancels it; the board itself announces
 * premoves. On phones the pill shows only the board's bracket mark and "k1→j3", so the banner
 * keeps the room to say whose turn it is.
 * The texts "Your move", the check text and "Game over" are exact (tests rely on them).
 */
export function TurnBanner({
  finished,
  myTurn,
  inCheck = false,
  selfCheck = false,
  premove = null,
  onCancelPremove,
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
  /** Not the viewer's turn: their queued premove (`text` in words: "knight b7 to c9"). */
  premove?: { readonly from: string; readonly to: string; readonly text: string } | null
  /** Cancels the queued premove. */
  onCancelPremove?: (() => void) | undefined
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
    animate(scope.current, { scale: [1, 1.02, 1] }, { duration: 0.32, ease: 'easeOut' })
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
    'relative flex h-10 min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-control border px-3 text-ui font-semibold transition-colors duration-200'

  let tone = 'border-rule bg-black/15 text-muted'
  // Once it's over the banner is a plain status line, not a box beside "Show results".
  if (finished) tone = 'border-transparent px-0 font-display text-lead text-parchment'
  else if (myTurn && inCheck) tone = 'border-danger bg-danger text-ink'
  else if (!finished && myTurn) tone = 'border-transparent bg-gold/[0.1] pl-4 text-gold'
  else if (!finished && mover) tone = 'border-rule bg-black/15 pl-4 text-parchment'

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p
        ref={scope}
        className={cx(base, tone)}
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
          <>
            {/* A gold edge, as the opponents' turns have their seat colour, and the turn token. */}
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-gold" />
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-gold shadow-[0_0_0_3px_rgb(212_160_23/0.22)]"
            />
            <span className="font-display text-lead leading-none">Your move</span>
          </>
        ) : mover ? (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-[3px]"
              style={{ backgroundColor: moverColor }}
            />
            <span className="shrink-0" style={{ color: moverColor }}>
              <CivEmblem civ={mover.civ} className="h-5 w-5" />
            </span>
            <span className="min-w-0 truncate font-normal text-muted">
              {/* The plate's name; a bot's civ follows, as three bots can share a strength. */}
              <span className="font-display font-semibold text-parchment">{plateName(mover)}</span>
              {mover.isBot ? ` (${civName(mover.civ)}) is thinking` : ' to move'}
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
          className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-control bg-danger px-2.5 text-caption font-semibold text-ink sm:px-3 sm:text-ui wide:w-full"
          data-testid="self-check-notice"
        >
          <CheckIcon />
          {SELF_CHECK_TEXT}
        </p>
      ) : null}
      {!finished && !myTurn && premove ? (
        <p
          className="flex h-10 min-w-0 shrink-0 items-center gap-1 rounded-control border border-premove/45 bg-premove/[0.12] pl-2.5 text-caption font-semibold text-premove-light sm:shrink sm:text-ui wide:w-full"
          data-testid="premove-notice"
        >
          <span
            aria-hidden="true"
            className="flex items-center gap-1.5 whitespace-nowrap sm:hidden"
            data-testid="premove-short"
          >
            <PremoveMark />
            <span className="font-normal text-parchment">
              {premove.from}→{premove.to}
            </span>
          </span>
          <span className="min-w-0 truncate max-sm:sr-only" data-testid="premove-text">
            {PREMOVE_PREFIX} <span className="font-normal text-parchment">{premove.text}</span>
          </span>
          {onCancelPremove ? (
            <button
              type="button"
              onClick={onCancelPremove}
              aria-label="Cancel premove"
              // The pill's full height (a touch target like the buttons around it).
              className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-muted hover:bg-black/20 hover:text-parchment"
              data-testid="premove-cancel"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </p>
      ) : null}
      {finished && onShowResults ? (
        <button
          type="button"
          onClick={onShowResults}
          className={cx(buttonBase, 'h-10 shrink-0 px-3 text-ui', buttonVariants.secondary)}
          data-testid="show-results"
        >
          Show results
        </button>
      ) : null}
    </div>
  )
}

/** The board's premove mark (corner brackets) before the short premove text on phones. */
function PremoveMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0 text-premove"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </svg>
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
