/**
 * Watching a game or lobby as a spectator (`/watch/:roomId`, the match room's id). Read-only:
 * the board, clocks, players and move log, no game actions. Ranked games are shown a couple
 * of rounds late while they run (the server sends a delayed copy).
 */
import { Clock, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { GameRoom } from '../components/match/GameRoom.tsx'
import { LineupTable, TableBoard } from '../components/match/LobbyRoom.tsx'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import { SpectatorCount } from '../components/match/Spectators.tsx'
import { MODE_LABEL } from '../components/match/seats.ts'
import {
  Button,
  CenteredPage,
  linkButtonClass,
  NoticePage,
  Pill,
  Spinner,
} from '../components/ui.tsx'
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
      <WatchNotice title="Can’t watch this game" testId="watch-error">
        {conn.message}
      </WatchNotice>
    )
  }
  return <WatchWaiting>Connecting to the game</WatchWaiting>
}

/** A short message in place of the game (it can't be watched, or watching ended). */
function WatchNotice({
  title,
  testId,
  children,
}: {
  title: string
  testId: string
  children: ReactNode
}) {
  return (
    <NoticePage
      title={title}
      action={
        <Link className={linkButtonClass('primary')} to="/play">
          Back to lobbies
        </Link>
      }
    >
      <p data-testid={testId}>{children}</p>
    </NoticePage>
  )
}

function WatchWaiting({ children }: { children: ReactNode }) {
  return (
    <CenteredPage>
      <p
        className="flex items-center justify-center gap-3 py-20 text-body text-muted"
        role="status"
      >
        <Spinner className="text-brass" /> {children}
      </p>
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
      <WatchNotice title="No longer watching" testId="watch-closed">
        {closed === 'closed' || closed === 'left'
          ? 'This lobby or game has closed.'
          : closed === 'replaced'
            ? 'You are watching this game in another tab or window.'
            : closed === 'kicked'
              ? 'You can no longer watch this game.'
              : 'The connection to this game was lost. Check your connection, then open the game again from the lobbies.'}
      </WatchNotice>
    )
  }
  if (!feed) return <WatchWaiting>Taking a seat in the gallery</WatchWaiting>
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

/** A lobby being watched: who sits where around the table, until the game starts. */
function WatchLobby({ feed, onStop }: { feed: MatchFeed; onStop: () => void }) {
  const { state } = feed
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12" data-testid="watch-lobby">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-ui text-muted">You’re watching</p>
          <h1 className="line-clamp-2 font-display text-title font-semibold text-balance [overflow-wrap:anywhere]">
            {state.name}
          </h1>
          <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ui text-muted [&_svg]:text-faint">
            <li className="flex items-center gap-1.5">
              <Users aria-hidden="true" className="h-3.5 w-3.5" />
              {MODE_LABEL[state.mode]}
            </li>
            <li className="flex items-center gap-1.5 tabular-nums">
              <Clock aria-hidden="true" className="h-3.5 w-3.5" />
              {state.timeControl}
            </li>
            <li>{state.ranked ? <RankedBadge /> : <Pill>Casual</Pill>}</li>
            <li>
              <SpectatorCount count={state.spectators} />
            </li>
          </ul>
        </div>
        <Button variant="secondary" onClick={onStop} data-testid="stop-watching">
          Stop watching
        </Button>
      </header>
      <p className="mb-6 text-center text-body text-muted" role="status">
        {state.phase === 'countdown'
          ? 'The game is about to start.'
          : 'Waiting for the players. The game shows here as soon as it starts.'}
      </p>
      <LineupTable state={state} viewer={-1} stackBelow="md" plateClass="w-full md:w-56">
        <div className="flex justify-center py-2 md:px-2 md:py-0">
          <TableBoard seats={state.seats} viewer={-1} className="w-[clamp(9rem,22vw,14rem)]" />
        </div>
      </LineupTable>
    </div>
  )
}
