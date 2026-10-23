import { useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { leaveMatch, type MatchRoom, matchApi } from '../../lib/match.ts'
import { usePrefs } from '../../lib/prefs.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { Button, Spinner } from '../ui.tsx'
import { CountdownRing, LineupTable, useCountdownSecs } from './LobbyRoom.tsx'
import { MODE_LABEL } from './seats.ts'

/**
 * A solo game between create and the first move: the server seats the bots and starts by
 * itself, so this only shows who sits where around the table and the countdown (no lobby
 * controls).
 */
export function SoloStarting({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const navigate = useNavigate()
  const send = useMemo(() => matchApi(room).send, [room])
  const { state, mySeat } = feed
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
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-10 sm:py-16">
      <h1 className="text-center font-display text-title font-semibold">{state.name}</h1>
      <p className="mt-2 text-center text-ui text-muted">
        {MODE_LABEL[state.mode]}, untimed. You play against three bots.
      </p>
      <div className="mt-8 w-full">
        <LineupTable
          state={state}
          viewer={mySeat}
          youLabel
          testId="solo-lineup"
          plateClass="w-full sm:w-52"
        >
          <div className="flex justify-center sm:px-3">
            {state.phase === 'countdown' ? (
              <SoloCountdown endsAt={state.countdownEndsAt} />
            ) : (
              <div
                className="flex h-32 w-32 flex-col items-center justify-center gap-2 rounded-full bg-baize-deep/90 px-4 text-center text-caption text-muted shadow-well"
                aria-live="polite"
              >
                <Spinner className="text-brass" />
                Setting up the board
              </div>
            )}
          </div>
        </LineupTable>
      </div>
      <div className="mt-8 flex gap-2">
        {stalled ? (
          <Button onClick={() => send('startGame', {})} data-testid="solo-start">
            Start now
          </Button>
        ) : null}
        <Button variant="quiet" onClick={leave}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** The start countdown at the table's centre (no overlay: the seats stay readable). */
function SoloCountdown({ endsAt }: { endsAt: number }) {
  const systemReduced = useReducedMotion()
  const prefReduced = usePrefs((s) => s.reducedMotion)
  const secs = useCountdownSecs(endsAt)
  return (
    <div className="flex flex-col items-center" data-testid="solo-countdown">
      <span className="sr-only">Game starting in</span>
      <CountdownRing secs={secs} reduce={Boolean(systemReduced) || prefReduced} />
    </div>
  )
}
