import type { SeatStateJson } from '@game/protocol/state'
import { useAnimate } from 'motion/react'
import { type CSSProperties, useEffect, useRef } from 'react'
import { CivEmblem } from '../CivEmblem.tsx'
import { seatTitle } from './PlayerCard.tsx'

/**
 * Whose turn it is. "Your move" gets a short pop and a gold glow when the turn arrives; an
 * opponent's turn names them in their seat colour. The text "Your move" / "Game over" is
 * exact (tests and screen readers rely on it).
 */
export function TurnBanner({
  finished,
  myTurn,
  mover,
  moverColor,
  reduceMotion,
  onShowResults,
}: {
  finished: boolean
  myTurn: boolean
  /** The seat to move (when it isn't the viewer's turn). */
  mover: SeatStateJson | undefined
  moverColor: string
  reduceMotion: boolean
  /** Set when the result dialog is closed: a way back to it. */
  onShowResults?: (() => void) | undefined
}) {
  const [scope, animate] = useAnimate<HTMLParagraphElement>()
  const wasMyTurn = useRef(myTurn)

  useEffect(() => {
    const arrived = myTurn && !wasMyTurn.current
    wasMyTurn.current = myTurn
    if (!arrived || reduceMotion || !scope.current) return
    animate(scope.current, { scale: [1, 1.04, 1] }, { duration: 0.32, ease: 'easeOut' })
    animate(
      scope.current,
      {
        boxShadow: [
          '0 0 0 0px rgba(212,160,23,0.45)',
          '0 0 0 6px rgba(212,160,23,0.25)',
          '0 0 0 10px rgba(212,160,23,0)',
        ],
      },
      { duration: 0.9, ease: 'easeOut' },
    )
  }, [myTurn, reduceMotion, animate, scope])

  const base =
    'relative flex h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg px-3 text-sm font-semibold transition-colors duration-200'

  let tone = 'bg-ink/50 text-parchment/70'
  let style: CSSProperties | undefined
  if (finished) tone = 'bg-ink/50 text-parchment/70 justify-center'
  else if (myTurn) tone = 'bg-gold text-ink justify-center'
  else if (mover) {
    tone = 'text-parchment pl-4'
    style = { backgroundColor: `${moverColor}1f` }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <p
        ref={scope}
        className={`${base} ${tone}`}
        style={style}
        aria-live="polite"
        data-testid="turn-banner"
      >
        {finished ? (
          'Game over'
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
