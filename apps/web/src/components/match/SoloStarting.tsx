import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { leaveMatch, type MatchRoom, matchApi } from '../../lib/match.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { Button, Spinner } from '../ui.tsx'
import { MODE_LABEL, SEAT_LABEL, seatHex, seatName } from './seats.ts'

/**
 * A solo game between create and the first move: the server seats the bots and starts by
 * itself, so this only shows the line-up and the countdown (no lobby controls).
 */
export function SoloStarting({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const navigate = useNavigate()
  const send = useMemo(() => matchApi(room).send, [room])
  const { state } = feed
  // The server starts the countdown at once; only offer a manual start if it stalls
  // (e.g. a start that failed and was reported as an error).
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    setStalled(false)
    if (state.phase !== 'civ_select') return
    const id = window.setTimeout(() => setStalled(true), 2500)
    return () => window.clearTimeout(id)
  }, [state.phase])

  async function leave() {
    navigate('/play')
    await leaveMatch()
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-12 text-center sm:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">
        Singleplayer · {MODE_LABEL[state.mode]} · Untimed
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{state.name}</h1>
      <ul className="mt-8 grid w-full grid-cols-2 gap-3 sm:grid-cols-4" data-testid="solo-lineup">
        {state.seats.map((seat, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: seats are fixed positions
            key={i}
            className="flex flex-col items-center gap-2 rounded-2xl border border-parchment/10 bg-panel/80 px-3 py-4"
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full border bg-ink/60"
              style={{ borderColor: `${seatHex(i)}99`, color: seatHex(i) }}
            >
              {seat.civ ? <CivEmblem civ={seat.civ} className="h-7 w-7" /> : <Spinner />}
            </span>
            <span className="text-sm font-semibold">
              {seat.isBot
                ? `Bot · ${seat.botLevel === 'max' ? 'Max' : seat.botLevel}`
                : seat.occupied
                  ? 'You'
                  : '…'}
            </span>
            <span className="text-xs text-parchment/55">
              {seat.civ ? civName(seat.civ) : ''} · {SEAT_LABEL[seatName(i)]}
            </span>
          </li>
        ))}
      </ul>
      {state.phase === 'countdown' ? (
        <InlineCountdown endsAt={state.countdownEndsAt} />
      ) : (
        <p className="mt-8 flex items-center gap-3 text-parchment/65" aria-live="polite">
          <Spinner /> Setting up the board…
        </p>
      )}
      <div className="mt-6 flex gap-2">
        {stalled ? (
          <Button onClick={() => send('startGame', {})} data-testid="solo-start">
            Start now
          </Button>
        ) : null}
        <Button variant="ghost" onClick={leave}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** The start countdown under the line-up (no overlay: the line-up stays readable). */
function InlineCountdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  const secs = Math.max(1, Math.ceil((endsAt - now) / 1000))
  return (
    <div className="mt-8 flex flex-col items-center" data-testid="solo-countdown">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-gold">Game starting</p>
      <p className="mt-1 font-display text-6xl font-semibold tabular-nums" aria-live="assertive">
        {secs}
      </p>
    </div>
  )
}
