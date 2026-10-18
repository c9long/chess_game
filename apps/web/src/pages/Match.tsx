import { CLOSE_CODES, type ClockSync, isUntimed, type ServerMessages } from '@game/protocol'
import type { MatchStateJson } from '@game/protocol/state'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { GameRoom } from '../components/match/GameRoom.tsx'
import { LobbyRoom } from '../components/match/LobbyRoom.tsx'
import { SoloStarting } from '../components/match/SoloStarting.tsx'
import { Alert, Button, Card, CenteredPage, Field, Spinner } from '../components/ui.tsx'
import { joinedFeed } from '../lib/live-move-log.ts'
import {
  type CloseReason,
  checkConnection,
  errorCodeMessage,
  forgetFinishedRoom,
  forgetReplacedRoom,
  forgetRoom,
  hasSavedToken,
  joinMatch,
  leaveMatch,
  type MatchRoom,
  matchErrorCode,
  matchErrorMessage,
  reconnectGraceMs,
  reconnectMatch,
  rejoinWindowMs,
  stateJson,
  useMatchStore,
} from '../lib/match.ts'
import { onResume } from '../lib/resume.ts'

type Connection =
  | { kind: 'connecting' }
  | { kind: 'password'; error?: string }
  | { kind: 'error'; message: string; code?: string | undefined }
  | { kind: 'other-room'; otherId: string }
  | { kind: 'closed'; reason: CloseReason }
  | { kind: 'ready' }

/** Gets this page's room: the one in the store, a reconnect after reload, or a fresh join. */
function useRoomFor(roomId: string): [Connection, (password: string) => Promise<void>] {
  const room = useMatchStore((s) => s.room)
  const closed = useMatchStore((s) => s.closed)
  const [conn, setConn] = useState<Connection>({ kind: 'connecting' })

  useEffect(() => {
    // This room closed on us: say so instead of trying to rejoin a lobby that is gone.
    if (!room && closed?.roomId === roomId) {
      setConn({ kind: 'closed', reason: closed.reason })
      return
    }
    if (room?.roomId === roomId) {
      setConn({ kind: 'ready' })
      return
    }
    // A live seat elsewhere blocks joining; a room that already closed doesn't, and neither
    // does a finished game still on screen (e.g. accepting a challenge from its result).
    if (room && closed?.roomId !== room.roomId) {
      if (stateJson(room)?.phase === 'finished') {
        void leaveMatch()
        return
      }
      setConn({ kind: 'other-room', otherId: room.roomId })
      return
    }
    let cancelled = false
    setConn({ kind: 'connecting' })
    ;(async () => {
      if (await reconnectMatch(roomId)) return
      try {
        await joinMatch(roomId)
      } catch (err) {
        if (cancelled) return
        if (matchErrorCode(err) === 'invalid_password') setConn({ kind: 'password' })
        else setConn({ kind: 'error', message: matchErrorMessage(err), code: matchErrorCode(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [room, roomId, closed])

  async function withPassword(password: string) {
    try {
      await joinMatch(roomId, password)
    } catch (err) {
      setConn({ kind: 'password', error: matchErrorMessage(err) })
    }
  }

  return [conn, withPassword]
}

export type NoticeTone = 'error' | 'info' | 'success'

export interface Notice {
  id: number
  text: string
  tone: NoticeTone
}

export interface MatchFeed {
  state: MatchStateJson
  mySeat: number
  /** Latest `events` message (drives board animations). */
  lastEvents: ServerMessages['events'] | null
  clock: ClockSync | null
  gameOver: ServerMessages['gameOver'] | null
  /** Latest `drawEvent` message, with a local id so repeats are told apart. */
  lastDraw: (ServerMessages['drawEvent'] & { id: number }) | null
  /** Latest `resignEvent` message (Teams resignation votes), with a local id. */
  lastResign: (ServerMessages['resignEvent'] & { id: number }) | null
  /** Refusals, problems and game notes (toasts), newest last. */
  notices: Notice[]
  notify: (text: string, tone?: NoticeTone) => void
  dismiss: (id: number) => void
  reconnecting: boolean
}

let noticeSeq = 0

/** Subscribes to a room's state and messages (a seat's match room, or a watch room). */
export function useMatchFeed(
  room: MatchRoom,
  onClosed: (reason: string) => void,
): MatchFeed | null {
  const [state, setState] = useState<MatchStateJson | null>(() => stateJson(room))
  const [lastEvents, setLastEvents] = useState<ServerMessages['events'] | null>(null)
  // A clock sent before this page listened (right after joining) still counts.
  const [clock, setClock] = useState<ClockSync | null>(() => joinedFeed(room).clock)
  const [gameOver, setGameOver] = useState<ServerMessages['gameOver'] | null>(null)
  const [lastDraw, setLastDraw] = useState<MatchFeed['lastDraw']>(null)
  const [lastResign, setLastResign] = useState<MatchFeed['lastResign']>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [reconnecting, setReconnecting] = useState(false)
  const [notify] = useState(() => (text: string, tone: NoticeTone = 'error') => {
    const id = ++noticeSeq
    setNotices((n) => [...n.slice(-2), { id, text, tone }])
    window.setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000)
  })

  useEffect(() => {
    const onState = () => setState(stateJson(room))
    room.onStateChange(onState)
    onState()
    const offs = [
      room.onMessage('events', (e: ServerMessages['events']) => {
        setLastEvents(e)
        setClock(e.clock)
      }),
      room.onMessage('clock', (c: ClockSync) => setClock(c)),
      room.onMessage('gameOver', (g: ServerMessages['gameOver']) => setGameOver(g)),
      room.onMessage('error', (e: ServerMessages['error']) => {
        notify(errorCodeMessage(e.code, e.message))
      }),
      room.onMessage('drawEvent', (e: ServerMessages['drawEvent']) => {
        setLastDraw({ ...e, id: ++noticeSeq })
      }),
      room.onMessage('resignEvent', (e: ServerMessages['resignEvent']) => {
        setLastResign({ ...e, id: ++noticeSeq })
      }),
      room.onMessage('kicked', () => onClosed('kicked')),
      room.onMessage('welcome', () => {}),
    ]
    const onDrop = () => setReconnecting(true)
    const onReconnect = () => setReconnecting(false)
    const onLeave = (code: number) => {
      // The SDK gave up reconnecting (4003), or the drop came too soon after joining for it to
      // try (1006): keep the token, so a rejoin can still make it within the server's grace.
      if (code === 4003 || code === 1006) {
        onClosed('lost')
        return
      }
      // Another connection of this player took the seat over: a rejoin elsewhere (seatLost),
      // or a reconnect with the same token (Colyseus closes the old socket with 4002). That
      // tab or app keeps playing and has saved its own token, which this one must not delete.
      if (code === CLOSE_CODES.seatLost || code === 4002) {
        forgetReplacedRoom(room.roomId, room.reconnectionToken)
        onClosed('replaced')
        return
      }
      forgetRoom(room.roomId, room.reconnectionToken)
      onClosed(
        code === CLOSE_CODES.kicked
          ? 'kicked'
          : code === CLOSE_CODES.roomClosed
            ? 'closed'
            : 'left',
      )
    }
    room.onDrop(onDrop)
    room.onReconnect(onReconnect)
    room.onLeave(onLeave)
    return () => {
      room.onStateChange.remove(onState)
      room.onDrop.remove(onDrop)
      room.onReconnect.remove(onReconnect)
      room.onLeave.remove(onLeave)
      for (const off of offs) off()
    }
  }, [room, onClosed, notify])

  // Back in the app or tab (or back online): check the connection now instead of waiting for
  // the SDK's backoff or a dead socket's timeout (phones suspend background apps).
  useEffect(() => onResume(() => void checkConnection(room)), [room])

  // A finished game no longer needs the long-lived copy of its reconnection token.
  const phase = state?.phase
  useEffect(() => {
    if (phase === 'finished') forgetFinishedRoom(room.roomId)
  }, [phase, room])

  if (!state) return null
  const mySeat = state.seats.findIndex((s) => s.sessionId && s.sessionId === room.sessionId)
  return {
    state,
    mySeat,
    lastEvents,
    clock: clock ?? (state.clock.serverTimestamp > 0 ? toSync(state.clock) : null),
    gameOver,
    lastDraw,
    lastResign,
    notices,
    notify,
    dismiss: (id) => setNotices((n) => n.filter((x) => x.id !== id)),
    reconnecting,
  }
}

function toSync(c: MatchStateJson['clock']): ClockSync {
  const r = c.remainingMs
  return {
    remainingMs: [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 0],
    runningSeat: c.runningSeat as ClockSync['runningSeat'],
    serverTimestamp: c.serverTimestamp,
    turnStartedAt: c.turnStartedAt,
  }
}

/**
 * After the SDK's own reconnection gave up ('lost'): rejoin with the saved token right away,
 * then again whenever the app comes back or the network returns, and every few seconds, until
 * it works (a new room object is adopted and the view starts afresh), the server refuses the
 * token, or the grace is surely over (`onGiveUp`). True while trying.
 */
function useRejoin(room: MatchRoom, lost: boolean, onGiveUp: () => void): boolean {
  const [giveUp] = useState(() => onGiveUp)
  useEffect(() => {
    if (!lost) return
    let cancelled = false
    let busy = false
    const started = Date.now()
    const windowMs = rejoinWindowMs(reconnectGraceMs(stateJson(room)))
    const attempt = async () => {
      if (busy || cancelled) return
      busy = true
      const again = await reconnectMatch(room.roomId)
      busy = false
      if (again || cancelled) return
      if (!hasSavedToken(room.roomId) || Date.now() - started > windowMs) {
        forgetRoom(room.roomId, room.reconnectionToken)
        giveUp()
      }
    }
    void attempt()
    const timer = window.setInterval(() => void attempt(), 4_000)
    const off = onResume(() => void attempt())
    return () => {
      cancelled = true
      window.clearInterval(timer)
      off()
    }
  }, [lost, room, giveUp])
  return lost
}

function MatchView({ room }: { room: MatchRoom }) {
  const navigate = useNavigate()
  const markClosed = useMatchStore((s) => s.markClosed)
  const [closed, setClosed] = useState<string>()
  const [onClosed] = useState(() => (reason: string) => {
    setClosed(reason)
    markClosed(room.roomId, reason as CloseReason)
  })
  const feed = useMatchFeed(room, onClosed)
  const rejoining = useRejoin(room, closed === 'lost' && feed?.state.phase !== 'finished', () =>
    setClosed('left'),
  )

  // A finished game stays on screen (with its result) after the room closes.
  const keepFinished = feed?.state.phase === 'finished' && closed !== 'kicked'
  if (closed && closed !== 'lost' && !keepFinished) {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">
            {closed === 'kicked'
              ? 'Removed from the lobby'
              : closed === 'replaced'
                ? 'Opened somewhere else'
                : 'Disconnected'}
          </h1>
          <p className="mb-6 text-parchment/70">
            {closed === 'kicked'
              ? 'The host removed you from this lobby.'
              : closed === 'replaced'
                ? 'This game was opened in another tab or in the app, and continues there.'
                : closed === 'closed'
                  ? 'This lobby was closed.'
                  : import.meta.env.DEV
                    ? 'You are no longer connected to this game. Locally this usually means the server restarted after a code change, which closes every open lobby.'
                    : 'You are no longer connected to this game.'}
          </p>
          <Button onClick={() => navigate('/play')}>Back to lobbies</Button>
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
      {(feed.reconnecting && !closed) || rejoining ? <ReconnectingBanner /> : null}
      <MatchToasts notices={feed.notices} inGame={inGame} />
      {inGame ? (
        <GameRoom room={room} feed={feed} />
      ) : isUntimed(feed.state.timeControl) ? (
        // Only solo games are untimed; they start by themselves (no lobby to show).
        <SoloStarting room={room} feed={feed} />
      ) : (
        <LobbyRoom room={room} feed={feed} />
      )}
    </>
  )
}

/** "Connection lost. Reconnecting…" while the SDK reconnects (players and spectators). */
export function ReconnectingBanner() {
  return (
    <div
      // Covers the header (same height, text clear of the notch) instead of taking space in
      // the layout, so the game screen doesn't move while reconnecting.
      className="fixed inset-x-0 top-0 z-50 flex min-h-[calc(4rem+var(--safe-top))] items-center justify-center bg-seat-north px-4 pt-[var(--safe-top)] text-center text-sm font-semibold text-ink shadow-lg shadow-black/30"
      role="status"
      data-testid="reconnecting"
    >
      Connection lost. Reconnecting…
    </div>
  )
}

/**
 * Toasts. In a game they sit bottom-left over the board's corner on wide screens, clear of the
 * side panel's buttons; on narrower screens they sit at the top, clear of the action row and
 * its hints below the board. They let clicks through so they never block a move, and sit above
 * the result dialog (rematch notes arrive while it is open).
 */
export function MatchToasts({ notices, inGame }: { notices: Notice[]; inGame: boolean }) {
  return (
    <div
      className={`pointer-events-none fixed right-[calc(1rem+var(--safe-right))] z-[60] flex w-80 max-w-[calc(100vw-2rem-var(--safe-left)-var(--safe-right))] flex-col gap-2 ${
        inGame
          ? 'top-[calc(1rem+var(--safe-top))] lg:top-auto lg:right-auto lg:bottom-[calc(1rem+var(--safe-bottom))] lg:left-[calc(1rem+var(--safe-left))]'
          : 'bottom-[calc(1rem+var(--safe-bottom))]'
      }`}
    >
      {notices.map((n) => (
        <div
          key={n.id}
          className={`rounded-lg bg-panel shadow-lg shadow-black/40 ${inGame ? '' : 'pointer-events-auto'}`}
          data-testid="toast"
        >
          <Alert tone={n.tone}>{n.text}</Alert>
        </div>
      ))}
    </div>
  )
}

export function PasswordPrompt({
  error,
  onSubmit,
  watching = false,
}: {
  error?: string | undefined
  onSubmit: (password: string) => Promise<void>
  /** Watching instead of joining (the button and heading say so). */
  watching?: boolean
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await onSubmit(password)
    setBusy(false)
  }
  return (
    <CenteredPage>
      <Card>
        <h1 className="mb-1 font-display text-2xl font-semibold">
          {watching ? 'Private game' : 'Private lobby'}
        </h1>
        <p className="mb-5 text-sm text-parchment/65">
          {watching
            ? 'Enter the password the host shared to watch.'
            : 'Enter the password the host shared.'}
        </p>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field
            label="Password"
            type="password"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="join-password"
          />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" busy={busy} disabled={!password} data-testid="join-submit">
            {watching ? 'Watch' : 'Join'}
          </Button>
        </form>
      </Card>
    </CenteredPage>
  )
}

export function Match() {
  const { roomId = '' } = useParams()
  const room = useMatchStore((s) => s.room)
  const generation = useMatchStore((s) => s.generation)
  const [conn, withPassword] = useRoomFor(roomId)

  // Keyed by adoption too: a rejoin (a new room object for the same id) starts a fresh view.
  if (conn.kind === 'ready' && room) {
    return <MatchView key={`${room.roomId}:${generation}`} room={room} />
  }
  if (conn.kind === 'password') return <PasswordPrompt error={conn.error} onSubmit={withPassword} />
  if (conn.kind === 'other-room') {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">You’re in another lobby</h1>
          <p className="mb-6 text-parchment/70">
            Leave your current lobby before joining a different one.
          </p>
          <Link className="font-semibold text-gold hover:underline" to={`/match/${conn.otherId}`}>
            Return to your lobby
          </Link>
        </Card>
      </CenteredPage>
    )
  }
  if (conn.kind === 'closed') {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">This lobby has closed</h1>
          <p className="mb-6 text-parchment/70">
            {conn.reason === 'kicked'
              ? 'The host removed you from this lobby.'
              : conn.reason === 'left'
                ? 'You left this game. Create or join another one.'
                : conn.reason === 'replaced'
                  ? 'This game was opened in another tab or in the app, and continues there.'
                  : 'It is no longer available (the server may have restarted). Create or join another one.'}
          </p>
          <Link className="font-semibold text-gold hover:underline" to="/play">
            Back to lobbies
          </Link>
        </Card>
      </CenteredPage>
    )
  }
  if (conn.kind === 'error') {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">Can’t join this game</h1>
          <p className="mb-6 text-parchment/70">{conn.message}</p>
          {conn.code === 'account_required' ? (
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/sign-up"
                className="inline-flex h-10 items-center rounded-lg bg-gold px-4 text-sm font-semibold text-ink hover:bg-gold-bright"
                data-testid="create-account"
              >
                Create account
              </Link>
              <Link className="font-semibold text-gold hover:underline" to="/play">
                Back to lobbies
              </Link>
            </div>
          ) : (
            <Link className="font-semibold text-gold hover:underline" to="/play">
              Back to lobbies
            </Link>
          )}
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
