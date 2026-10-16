import type { ClockSync, ServerMessages } from '@game/protocol'
import type { MatchStateJson } from '@game/protocol/state'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { GameRoom } from '../components/match/GameRoom.tsx'
import { LobbyRoom } from '../components/match/LobbyRoom.tsx'
import { Alert, Button, Card, CenteredPage, Field, Spinner } from '../components/ui.tsx'
import {
  type CloseReason,
  errorCodeMessage,
  forgetRoom,
  joinMatch,
  type MatchRoom,
  matchErrorCode,
  matchErrorMessage,
  reconnectMatch,
  stateJson,
  useMatchStore,
} from '../lib/match.ts'

type Connection =
  | { kind: 'connecting' }
  | { kind: 'password'; error?: string }
  | { kind: 'error'; message: string }
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
    // A live seat elsewhere blocks joining; a room that already closed doesn't.
    if (room && closed?.roomId !== room.roomId) {
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
        else setConn({ kind: 'error', message: matchErrorMessage(err) })
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

export interface MatchFeed {
  state: MatchStateJson
  mySeat: number
  /** Latest `events` message (drives board animations). */
  lastEvents: ServerMessages['events'] | null
  clock: ClockSync | null
  gameOver: ServerMessages['gameOver'] | null
  /** Refusals and problems from the server, newest last. */
  notices: { id: number; text: string }[]
  dismiss: (id: number) => void
  reconnecting: boolean
}

let noticeSeq = 0

/** Subscribes to a room's state and messages. */
function useMatchFeed(room: MatchRoom, onClosed: (reason: string) => void): MatchFeed | null {
  const [state, setState] = useState<MatchStateJson | null>(() => stateJson(room))
  const [lastEvents, setLastEvents] = useState<ServerMessages['events'] | null>(null)
  const [clock, setClock] = useState<ClockSync | null>(null)
  const [gameOver, setGameOver] = useState<ServerMessages['gameOver'] | null>(null)
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([])
  const [reconnecting, setReconnecting] = useState(false)

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
        const id = ++noticeSeq
        setNotices((n) => [...n.slice(-2), { id, text: errorCodeMessage(e.code, e.message) }])
        window.setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000)
      }),
      room.onMessage('kicked', () => onClosed('kicked')),
      room.onMessage('welcome', () => {}),
    ]
    const onDrop = () => setReconnecting(true)
    const onReconnect = () => setReconnecting(false)
    const onLeave = (code: number) => {
      forgetRoom(room.roomId)
      onClosed(code === 4100 ? 'kicked' : code === 4102 ? 'closed' : 'left')
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
  }, [room, onClosed])

  if (!state) return null
  const mySeat = state.seats.findIndex((s) => s.sessionId && s.sessionId === room.sessionId)
  return {
    state,
    mySeat,
    lastEvents,
    clock: clock ?? (state.clock.serverTimestamp > 0 ? toSync(state.clock) : null),
    gameOver,
    notices,
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

function MatchView({ room }: { room: MatchRoom }) {
  const navigate = useNavigate()
  const markClosed = useMatchStore((s) => s.markClosed)
  const [closed, setClosed] = useState<string>()
  const [onClosed] = useState(() => (reason: string) => {
    setClosed(reason)
    markClosed(room.roomId, reason as CloseReason)
  })
  const feed = useMatchFeed(room, onClosed)

  // A finished game stays on screen (with its result) after the room closes.
  const keepFinished = feed?.state.phase === 'finished' && closed !== 'kicked'
  if (closed && !keepFinished) {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">
            {closed === 'kicked' ? 'Removed from the lobby' : 'Disconnected'}
          </h1>
          <p className="mb-6 text-parchment/70">
            {closed === 'kicked'
              ? 'The host removed you from this lobby.'
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
      {feed.reconnecting && !closed ? (
        <div className="sticky top-0 z-40 bg-seat-north/90 px-4 py-2 text-center text-sm font-semibold text-ink">
          Connection lost. Reconnecting…
        </div>
      ) : null}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
        {feed.notices.map((n) => (
          <div key={n.id} className="pointer-events-auto">
            <Alert>{n.text}</Alert>
          </div>
        ))}
      </div>
      {inGame ? <GameRoom room={room} feed={feed} /> : <LobbyRoom room={room} feed={feed} />}
    </>
  )
}

function PasswordPrompt({
  error,
  onSubmit,
}: {
  error?: string | undefined
  onSubmit: (password: string) => Promise<void>
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
        <h1 className="mb-1 font-display text-2xl font-semibold">Private lobby</h1>
        <p className="mb-5 text-sm text-parchment/65">Enter the password the host shared.</p>
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
            Join
          </Button>
        </form>
      </Card>
    </CenteredPage>
  )
}

export function Match() {
  const { roomId = '' } = useParams()
  const room = useMatchStore((s) => s.room)
  const [conn, withPassword] = useRoomFor(roomId)

  if (conn.kind === 'ready' && room) return <MatchView key={room.roomId} room={room} />
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
