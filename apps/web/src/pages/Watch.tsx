/**
 * Watching a game or lobby as a spectator (`/watch/:roomId`, the match room's id). Read-only:
 * the board, clocks, players and move log, no game actions. Ranked games are shown a couple
 * of rounds late while they run (the server sends a delayed copy).
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CivEmblem, civName } from '../components/CivEmblem.tsx'
import { botLevelText } from '../components/game/PlayerCard.tsx'
import { GameRoom } from '../components/match/GameRoom.tsx'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import { SpectatorCount } from '../components/match/Spectators.tsx'
import { MODE_LABEL, SEAT_LABEL, seatHex, seatName } from '../components/match/seats.ts'
import { Card, CenteredPage, Spinner } from '../components/ui.tsx'
import { type MatchRoom, matchErrorCode, matchErrorMessage, watchMatch } from '../lib/match.ts'
import {
  type MatchFeed,
  MatchToasts,
  PasswordPrompt,
  ReconnectingBanner,
  useMatchFeed,
} from './Match.tsx'

type Connection =
  | { kind: 'connecting' }
  | { kind: 'password'; error?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; room: MatchRoom }

/** Where "Stop watching" goes: back where the viewer came from (e.g. Friends), else lobbies. */
function useStopWatching(): () => void {
  const navigate = useNavigate()
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/play')
  }
}

export function Watch() {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const [conn, setConn] = useState<Connection>({ kind: 'connecting' })
  // A new attempt each time (the same password typed again still retries).
  const [attempt, setAttempt] = useState<{ password?: string; n: number }>({ n: 0 })

  useEffect(() => {
    let cancelled = false
    let joined: MatchRoom | undefined
    const password = attempt.password
    setConn({ kind: 'connecting' })
    watchMatch(roomId, password)
      .then((room) => {
        if (cancelled) {
          void room.leave(true).catch(() => {})
          return
        }
        joined = room
        setConn({ kind: 'ready', room })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // A player of this game (e.g. out of it and gone from the room): their seat is
        // still theirs to rejoin, which shows them the game.
        if (matchErrorCode(err) === 'already_seated') {
          navigate(`/match/${roomId}`, { replace: true })
          return
        }
        if (matchErrorCode(err) === 'invalid_password') {
          setConn({
            kind: 'password',
            ...(password ? { error: matchErrorMessage(err) } : {}),
          })
        } else setConn({ kind: 'error', message: watchErrorMessage(err) })
      })
    return () => {
      cancelled = true
      // Leaving the page stops watching.
      if (joined) void joined.leave(true).catch(() => {})
    }
  }, [roomId, attempt, navigate])

  if (conn.kind === 'ready') return <WatchView key={conn.room.roomId} room={conn.room} />
  if (conn.kind === 'password') {
    return (
      <PasswordPrompt
        watching
        error={conn.error}
        onSubmit={async (p) => {
          setAttempt((a) => ({ password: p, n: a.n + 1 }))
        }}
      />
    )
  }
  if (conn.kind === 'error') {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">Can’t watch this game</h1>
          <p className="mb-6 text-parchment/70" data-testid="watch-error">
            {conn.message}
          </p>
          <Link className="font-semibold text-gold hover:underline" to="/play">
            Back to lobbies
          </Link>
        </Card>
      </CenteredPage>
    )
  }
  return (
    <CenteredPage>
      <div className="flex items-center justify-center gap-3 py-20 text-parchment/70">
        <Spinner /> Connecting…
      </div>
    </CenteredPage>
  )
}

function watchErrorMessage(err: unknown): string {
  switch (matchErrorCode(err)) {
    case 'room_not_found':
      return 'That game is over or no longer exists.'
    case 'not_invited':
      return 'This is a friends challenge: only invited players and the host’s friends can watch.'
    case 'kicked':
      return 'The host removed you from this lobby.'
    default:
      return matchErrorMessage(err)
  }
}

function WatchView({ room }: { room: MatchRoom }) {
  const stopWatching = useStopWatching()
  const [closed, setClosed] = useState<string>()
  const [onClosed] = useState(() => (reason: string) => setClosed(reason))
  const feed = useMatchFeed(room, onClosed)

  // A finished game stays on screen (with its result) after the room closes.
  if (closed && feed?.state.phase !== 'finished') {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">No longer watching</h1>
          <p className="mb-6 text-parchment/70" data-testid="watch-closed">
            {closed === 'closed' || closed === 'left'
              ? 'This lobby or game has closed.'
              : closed === 'replaced'
                ? 'You are watching this game in another tab or window.'
                : closed === 'kicked'
                  ? 'You can no longer watch this game.'
                  : 'The connection to this game was lost.'}
          </p>
          <Link className="font-semibold text-gold hover:underline" to="/play">
            Back to lobbies
          </Link>
        </Card>
      </CenteredPage>
    )
  }
  if (!feed) {
    return (
      <CenteredPage>
        <div className="flex items-center justify-center gap-3 py-20 text-parchment/70">
          <Spinner /> Joining…
        </div>
      </CenteredPage>
    )
  }
  const inGame = feed.state.phase === 'in_game' || feed.state.phase === 'finished'
  return (
    <>
      {feed.reconnecting && !closed ? <ReconnectingBanner /> : null}
      <MatchToasts notices={feed.notices} inGame={inGame} />
      {inGame ? (
        <GameRoom room={room} feed={feed} spectator onLeave={stopWatching} />
      ) : (
        <WatchLobby feed={feed} onStop={stopWatching} />
      )}
    </>
  )
}

/** A lobby being watched: who is seated, until the game starts. */
function WatchLobby({ feed, onStop }: { feed: MatchFeed; onStop: () => void }) {
  const { state } = feed
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12" data-testid="watch-lobby">
      <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">Watching</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{state.name}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/65">
        {state.ranked ? <RankedBadge /> : null}
        <span>
          {MODE_LABEL[state.mode]} · {state.timeControl}
        </span>
        <SpectatorCount count={state.spectators} />
      </p>
      <p className="mt-6 text-sm text-parchment/75" role="status">
        {state.phase === 'countdown'
          ? 'The game is about to start…'
          : 'Waiting for the players. The game shows here as soon as it starts.'}
      </p>
      <ol className="mt-4 flex flex-col gap-2" aria-label="Seats">
        {state.seats.map((seat, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed seats
            key={i}
            className="flex items-center gap-3 rounded-xl border border-parchment/10 bg-panel/80 px-3 py-2.5"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: `${seatHex(i)}26`, color: seatHex(i) }}
            >
              {seat.civ ? <CivEmblem civ={seat.civ} className="h-6 w-6" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {!seat.occupied
                  ? 'Open seat'
                  : seat.isBot
                    ? `Bot · ${botLevelText(seat.botLevel)}`
                    : seat.displayName}
              </span>
              <span className="block truncate text-xs text-parchment/60">
                {SEAT_LABEL[seatName(i)]}
                {seat.civ ? ` · ${civName(seat.civ)}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="mt-8 inline-block font-semibold text-gold hover:underline"
        onClick={onStop}
        data-testid="stop-watching"
      >
        Stop watching
      </button>
    </div>
  )
}
