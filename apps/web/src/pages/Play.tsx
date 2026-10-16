import type { Room } from '@colyseus/sdk'
import { TIME_CONTROLS } from '@game/config'
import {
  BOT_LEVEL_LABELS,
  checkLobbyNameFormat,
  LOBBY_NAME_MAX,
  LOBBY_PASSWORD_MAX,
  type LobbyMetadata,
  ROOM_NAMES,
  UNTIMED,
} from '@game/protocol'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { CivPicker } from '../components/CivPicker.tsx'
import { Alert, Button, Card, Field, Spinner } from '../components/ui.tsx'
import { displayName, useAppState } from '../lib/app-state.tsx'
import {
  createMatch,
  gameClient,
  joinMatch,
  matchErrorCode,
  matchErrorMessage,
  useMatchStore,
} from '../lib/match.ts'

interface Listing {
  roomId: string
  clients: number
  maxClients: number
  metadata: LobbyMetadata
}

const MODE_LABEL = { ffa: 'Free-for-all', teams: 'Teams 2v2' } as const

/** A two-way choice button (mode, time control). */
const choice = (active: boolean) =>
  `h-11 flex-1 rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-gold ${
    active
      ? 'border-gold bg-gold/15 text-parchment'
      : 'border-parchment/20 text-parchment/70 hover:border-parchment/40'
  }`

function ModeChoice({
  mode,
  onChange,
  teamsHint,
}: {
  mode: 'ffa' | 'teams'
  onChange: (m: 'ffa' | 'teams') => void
  teamsHint: string
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-parchment/85">Mode</legend>
      <div className="flex gap-2">
        {(['ffa', 'teams'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={choice(mode === m)}
            onClick={() => onChange(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="text-xs text-parchment/55">
        {mode === 'ffa'
          ? 'Every player for themselves. Last civilization standing wins.'
          : teamsHint}
      </p>
    </fieldset>
  )
}

function botLevelText(level: string): string {
  return level === 'max' ? 'Max strength' : `ELO ${level}`
}

/** Singleplayer: the player at South against three bots, untimed. */
function PlayVsBots({ blocked }: { blocked: boolean }) {
  const navigate = useNavigate()
  const levelId = useId()
  const [civ, setCiv] = useState('')
  const [level, setLevel] = useState('1200')
  const [mode, setMode] = useState<'ffa' | 'teams'>('ffa')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function start(e: FormEvent) {
    e.preventDefault()
    if (!civ) return
    setBusy(true)
    setError(undefined)
    try {
      const room = await createMatch({
        kind: 'solo',
        mode,
        timeControl: UNTIMED,
        civ,
        botLevel: level,
      })
      navigate(`/match/${room.roomId}`)
    } catch (err) {
      setError(matchErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <section
      id="vs-bots"
      aria-labelledby="vs-bots-title"
      className="mb-10 overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.07] via-panel/90 to-panel/90 p-5 shadow-[0_24px_60px_-40px_rgba(212,160,23,0.6)] sm:p-7"
      data-testid="vs-bots"
    >
      <form className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]" onSubmit={start} noValidate>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold/80">
            Singleplayer
          </p>
          <h2
            id="vs-bots-title"
            className="mt-1 font-display text-3xl font-semibold tracking-tight"
          >
            Play vs bots
          </h2>
          <p className="mt-1 mb-5 max-w-xl text-sm text-parchment/65">
            You play South. Three bots take West, North and East, each with a random civilization.
            No clocks: take as long as you like.
          </p>
          <h3 className="mb-2 text-sm font-medium text-parchment/85">Your civilization</h3>
          <CivPicker value={civ} onPick={setCiv} label="Your civilization" />
        </div>
        <div className="flex flex-col gap-5 lg:pt-14">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={levelId} className="text-sm font-medium text-parchment/85">
              Bot strength
            </label>
            <select
              id={levelId}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="h-11 rounded-lg border border-parchment/20 bg-ink/60 px-3 text-parchment outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30"
              data-testid="bot-level"
            >
              {BOT_LEVEL_LABELS.map((l) => (
                <option key={l} value={l}>
                  {botLevelText(l)}
                </option>
              ))}
            </select>
            <p className="text-xs text-parchment/55">All three bots play at this level.</p>
          </div>
          <ModeChoice
            mode={mode}
            onChange={setMode}
            teamsHint="You and the North bot against West and East."
          />
          {error ? <Alert>{error}</Alert> : null}
          <div className="mt-auto flex flex-col gap-2">
            <Button
              type="submit"
              busy={busy}
              disabled={!civ || blocked}
              className="h-12"
              data-testid="start-solo"
            >
              Start game
            </Button>
            <p className="text-center text-xs text-parchment/50" aria-live="polite">
              {busy
                ? 'Setting up the game…'
                : blocked
                  ? 'You already have a game or lobby in progress. Return to it or leave it first.'
                  : civ
                    ? 'Untimed and unrated.'
                    : 'Choose a civilization to start.'}
            </p>
          </div>
        </div>
      </form>
    </section>
  )
}

/** Subscribes to the server's realtime lobby list. */
function useLobbyList() {
  const [rooms, setRooms] = useState<Listing[]>([])
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  useEffect(() => {
    let lobby: Room | undefined
    let cancelled = false
    gameClient()
      .joinOrCreate(ROOM_NAMES.lobby)
      .then((room) => {
        if (cancelled) {
          void room.leave()
          return
        }
        lobby = room
        setStatus('live')
        room.onMessage('rooms', (list: Listing[]) => setRooms(list))
        room.onMessage('+', ([roomId, listing]: [string, Listing]) =>
          setRooms((prev) => {
            const i = prev.findIndex((r) => r.roomId === roomId)
            if (i < 0) return [...prev, listing]
            const next = [...prev]
            next[i] = listing
            return next
          }),
        )
        room.onMessage('-', (roomId: string) =>
          setRooms((prev) => prev.filter((r) => r.roomId !== roomId)),
        )
        room.onLeave(() => !cancelled && setStatus('error'))
        // The full list is sent on join, before these handlers exist: ask for it again
        // (LobbyRoom answers a `filter` message with the matching rooms).
        room.send('filter', { name: ROOM_NAMES.match })
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
      void lobby?.leave()
    }
  }, [])
  return { rooms, status }
}

function CreateLobby() {
  const { session } = useAppState()
  const navigate = useNavigate()
  const [name, setName] = useState(() =>
    session ? `${displayName(session.user)}'s game`.slice(0, LOBBY_NAME_MAX) : '',
  )
  const [mode, setMode] = useState<'ffa' | 'teams'>('ffa')
  const [timeControl, setTimeControl] = useState<keyof typeof TIME_CONTROLS>('10+0')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // Same rule as the server (@game/protocol), so a bad name is flagged before submitting.
  const nameCheck = checkLobbyNameFormat(name)
  const nameError = nameCheck.ok ? undefined : nameCheck.reason

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (nameError) return
    setBusy(true)
    setError(undefined)
    try {
      const room = await createMatch({
        kind: 'lobby',
        name: nameCheck.ok ? nameCheck.name : name.trim(),
        mode,
        timeControl,
        pickMode: 'blind',
        ...(password ? { password } : {}),
      })
      navigate(`/match/${room.roomId}`)
    } catch (err) {
      setError(matchErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="lg:sticky lg:top-6">
      <h2 className="mb-5 font-display text-xl font-semibold">Create a lobby</h2>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <Field
          label="Lobby name"
          value={name}
          maxLength={LOBBY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          error={name ? nameError : undefined}
          data-testid="lobby-name"
        />
        <ModeChoice
          mode={mode}
          onChange={setMode}
          teamsHint="South and North against West and East. Partners sit opposite each other."
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-parchment/85">Time control</legend>
          <div className="flex gap-2">
            {(Object.keys(TIME_CONTROLS) as (keyof typeof TIME_CONTROLS)[]).map((tc) => (
              <button
                key={tc}
                type="button"
                aria-pressed={timeControl === tc}
                className={choice(timeControl === tc)}
                onClick={() => setTimeControl(tc)}
              >
                {tc}
              </button>
            ))}
          </div>
          <p className="text-xs text-parchment/55">
            {timeControl === '10+0'
              ? '10 minutes per player, no increment.'
              : '3 minutes per player, plus 2 seconds per move.'}
          </p>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-parchment/85">Civ picks</legend>
          <div className="flex gap-2">
            <button type="button" aria-pressed className={choice(true)}>
              Blind pick
            </button>
            <button
              type="button"
              disabled
              className={`${choice(false)} cursor-not-allowed opacity-45`}
              title="Draft mode with bans and pick order is coming soon"
            >
              Draft · soon
            </button>
          </div>
        </fieldset>
        <Field
          label="Password (optional)"
          type="password"
          autoComplete="off"
          value={password}
          maxLength={LOBBY_PASSWORD_MAX}
          onChange={(e) => setPassword(e.target.value)}
          hint={
            password
              ? 'Private lobby: players need this password to join.'
              : 'Leave empty for a public lobby anyone can join.'
          }
          data-testid="lobby-password"
        />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" busy={busy} disabled={Boolean(nameError)} data-testid="create-lobby">
          Create lobby
        </Button>
      </form>
    </Card>
  )
}

function JoinPasswordDialog({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const room = await joinMatch(listing.roomId, password)
      navigate(`/match/${room.roomId}`)
    } catch (err) {
      setError(matchErrorMessage(err))
      if (matchErrorCode(err) !== 'invalid_password') setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-title"
    >
      <Card className="max-w-sm">
        <h2 id="join-title" className="mb-1 font-display text-xl font-semibold">
          Private lobby
        </h2>
        <p className="mb-5 text-sm text-parchment/65">
          “{listing.metadata.name}” needs a password.
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
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" busy={busy} disabled={!password} data-testid="join-submit">
              Join
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
      <path
        d="M6 8V6a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 16 9.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5v-7A1.5 1.5 0 0 1 5.5 8H6Zm2 0h4V6a2 2 0 1 0-4 0v2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function SeatPips({ filled }: { filled: number }) {
  return (
    <span className="flex gap-1" role="img" aria-label={`${filled} of 4 seats filled`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full ${i < filled ? 'bg-gold' : 'border border-parchment/30'}`}
        />
      ))}
    </span>
  )
}

export function Play() {
  const navigate = useNavigate()
  const current = useMatchStore((s) => (s.closed?.roomId === s.room?.roomId ? null : s.room))
  const { rooms, status } = useLobbyList()
  const [joining, setJoining] = useState<string>()
  const [passwordFor, setPasswordFor] = useState<Listing>()
  const [error, setError] = useState<string>()

  async function join(listing: Listing) {
    if (listing.metadata.locked) {
      setPasswordFor(listing)
      return
    }
    setJoining(listing.roomId)
    setError(undefined)
    try {
      const room = await joinMatch(listing.roomId)
      navigate(`/match/${room.roomId}`)
    } catch (err) {
      setError(matchErrorMessage(err))
    } finally {
      setJoining(undefined)
    }
  }

  const sorted = [...rooms].sort(
    (a, b) => b.metadata.seatsFilled - a.metadata.seatsFilled || a.roomId.localeCompare(b.roomId),
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      {current ? (
        <div className="mb-6">
          <Alert tone="info">
            You have a seat in “{(current.state as { name?: string })?.name ?? 'a lobby'}”.{' '}
            <button
              type="button"
              className="font-semibold text-gold underline-offset-2 hover:underline"
              onClick={() => navigate(`/match/${current.roomId}`)}
            >
              Return to it
            </button>
          </Alert>
        </div>
      ) : null}
      <PlayVsBots blocked={Boolean(current)} />
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="lobbies-title">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h1 id="lobbies-title" className="font-display text-3xl font-semibold tracking-tight">
                Lobbies
              </h1>
              <p className="mt-1 text-sm text-parchment/60">
                Join an open table, or create your own and fill empty seats with bots.
              </p>
            </div>
            <span className="flex items-center gap-2 text-xs text-parchment/50" aria-live="polite">
              {status === 'connecting' ? (
                <>
                  <Spinner /> Connecting
                </>
              ) : status === 'live' ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-seat-east" /> Live
                </>
              ) : (
                <span className="text-seat-south-light">Disconnected</span>
              )}
            </span>
          </div>
          {error ? (
            <div className="mb-4">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          {status === 'error' ? (
            <Alert>
              Could not load the lobby list. Check that you are signed in (or playing as a guest)
              and reload the page.
            </Alert>
          ) : sorted.length === 0 && status === 'live' ? (
            <div className="rounded-2xl border border-dashed border-parchment/15 px-6 py-14 text-center text-parchment/60">
              No open lobbies right now. Create one, and add bots if nobody else joins.
            </div>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="lobby-list">
              {sorted.map((r) => (
                <li
                  key={r.roomId}
                  className="flex flex-wrap items-center gap-4 rounded-2xl border border-parchment/10 bg-panel/80 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-semibold">
                      {r.metadata.locked ? (
                        <span className="text-gold" title="Private: password required">
                          <LockIcon />
                        </span>
                      ) : null}
                      <span className="truncate">{r.metadata.name}</span>
                    </p>
                    <p className="mt-1 text-xs text-parchment/55">
                      {MODE_LABEL[r.metadata.mode as 'ffa' | 'teams'] ?? r.metadata.mode} ·{' '}
                      {r.metadata.timeControl} · Blind pick
                    </p>
                  </div>
                  <SeatPips filled={r.metadata.seatsFilled} />
                  <Button
                    variant="secondary"
                    className="h-10"
                    busy={joining === r.roomId}
                    disabled={r.metadata.seatsFilled >= 4 || Boolean(current)}
                    onClick={() => join(r)}
                    data-testid="join-lobby"
                  >
                    {r.metadata.seatsFilled >= 4 ? 'Full' : 'Join'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {current ? null : <CreateLobby />}
      </div>
      {passwordFor ? (
        <JoinPasswordDialog listing={passwordFor} onClose={() => setPasswordFor(undefined)} />
      ) : null}
    </div>
  )
}
