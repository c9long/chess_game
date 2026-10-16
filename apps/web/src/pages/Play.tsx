import type { Room } from '@colyseus/sdk'
import { CIVILIZATIONS, TIME_CONTROLS } from '@game/config'
import {
  BOT_LEVEL_LABELS,
  checkLobbyNameFormat,
  LOBBY_NAME_MAX,
  LOBBY_PASSWORD_MAX,
  type LobbyMetadata,
  ROOM_NAMES,
  UNTIMED,
} from '@game/protocol'
import { AnimatePresence, motion } from 'motion/react'
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { CivEmblem, civName } from '../components/CivEmblem.tsx'
import { CivPicker } from '../components/CivPicker.tsx'
import { ClockIcon, LockIcon } from '../components/game/icons.tsx'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import { SEAT_LABEL, seatHex, seatName } from '../components/match/seats.ts'
import { Dialog, DialogClose } from '../components/overlay.tsx'
import { Alert, Button, Card, Field, Spinner } from '../components/ui.tsx'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
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

type LobbyFilter = 'all' | 'ranked' | 'casual'
const FILTER_LABEL: Record<LobbyFilter, string> = {
  all: 'All',
  ranked: 'Ranked',
  casual: 'Casual',
}

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
  return level === 'max' ? 'Max strength' : `Elo ${level}`
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
  const guest = isGuest(session?.user)
  const [ranked, setRanked] = useState(false)
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
        ranked: ranked && !guest,
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
    <Card className="lg:sticky lg:top-6 lg:self-start">
      <h2 className="font-display text-xl font-semibold">Create a lobby</h2>
      <p className="mt-1 mb-5 text-xs text-parchment/55">
        Blind pick: everyone chooses a civilization at once. Draft with bans is coming soon.
      </p>
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
        <RankedToggle ranked={ranked && !guest} guest={guest} onChange={setRanked} />
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
              : 'Empty: a public lobby anyone can join.'
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

/** Ranked or casual (registered accounts only for ranked; guests see why it's disabled). */
function RankedToggle({
  ranked,
  guest,
  onChange,
}: {
  ranked: boolean
  guest: boolean
  onChange: (ranked: boolean) => void
}) {
  const hintId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label
        className={`flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5 transition ${
          ranked ? 'border-gold/60 bg-gold/10' : 'border-parchment/20'
        } ${guest ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-parchment/40'}`}
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-parchment">Ranked</span>
          <span className="text-xs text-parchment/55">Elo-rated · players with accounts only</span>
        </span>
        <span className="relative inline-flex shrink-0">
          <input
            type="checkbox"
            role="switch"
            aria-checked={ranked}
            className="peer sr-only"
            checked={ranked}
            disabled={guest}
            aria-describedby={hintId}
            onChange={(e) => onChange(e.target.checked)}
            data-testid="ranked-toggle"
          />
          <span className="h-6 w-11 rounded-full bg-parchment/20 transition peer-checked:bg-gold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold" />
          <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-parchment shadow transition peer-checked:translate-x-5" />
        </span>
      </label>
      <p id={hintId} className="text-xs text-parchment/55" data-testid="ranked-hint">
        {guest ? (
          <>
            <Link to="/sign-up" className="font-semibold text-gold hover:underline">
              Create an account
            </Link>{' '}
            to play ranked.
          </>
        ) : ranked ? (
          'Counts toward your Elo. Bots can’t join; empty seats wait for players with accounts.'
        ) : (
          'Casual: no rating changes. You can fill empty seats with bots.'
        )}
      </p>
    </div>
  )
}

function JoinPasswordDialog({
  listing,
  onClose,
  returnFocusTo,
}: {
  listing: Listing
  onClose: () => void
  returnFocusTo: RefObject<HTMLElement | null>
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
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

  // Opens on mount; closing plays the exit animation, returns focus to the Join button and
  // then unmounts through `onClose`.
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      returnFocusTo={returnFocusTo}
      title="Private lobby"
      description={<>“{listing.metadata.name}” needs a password.</>}
      testId="join-password-dialog"
    >
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
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button type="submit" busy={busy} disabled={!password} data-testid="join-submit">
            Join
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * One pip per seat (South, West, North, East), in that seat's colour when taken, so the pips
 * line up with the seat-tinted civ emblems beside them. Falls back to filling in seat order
 * when the listing has no `occupied` array.
 */
function SeatPips({
  filled,
  occupied,
}: {
  filled: number
  occupied: readonly boolean[] | undefined
}) {
  const taken = (i: number) => (occupied ? Boolean(occupied[i]) : i < filled)
  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-1" role="img" aria-label={`${filled} of 4 seats filled`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full transition-colors ${taken(i) ? '' : 'border border-parchment/30'}`}
            style={taken(i) ? { backgroundColor: seatHex(i) } : undefined}
            data-seat-taken={taken(i) ? 'true' : 'false'}
          />
        ))}
      </span>
      <span aria-hidden="true" className="text-xs font-semibold tabular-nums text-parchment/60">
        {filled}/4
      </span>
    </span>
  )
}

/**
 * The civs already chosen at a table, as small emblems tinted with their seat's colour, in seat
 * order. Open seats and seats still choosing are left out.
 */
function SeatedCivs({ civs }: { civs: readonly string[] | undefined }) {
  const seated = (civs ?? [])
    .map((civ, seat) => ({ civ, seat }))
    .filter((c) => CIVILIZATIONS.some((x) => x.slug === c.civ))
  if (seated.length === 0) return null
  const label = `Civilizations: ${seated
    .map((c) => `${civName(c.civ)} (${SEAT_LABEL[seatName(c.seat)]})`)
    .join(', ')}`
  return (
    <span
      className="flex items-center gap-1"
      role="img"
      aria-label={label}
      data-testid="seated-civs"
    >
      {seated.map((c) => (
        <span
          key={c.seat}
          className="grid h-6 w-6 place-items-center rounded-md border bg-ink/50"
          style={{ borderColor: `${seatHex(c.seat)}99`, color: seatHex(c.seat) }}
          title={`${civName(c.civ)} (${SEAT_LABEL[seatName(c.seat)]})`}
          data-civ={c.civ}
        >
          <CivEmblem civ={c.civ} className="h-4 w-4" title="" />
        </span>
      ))}
    </span>
  )
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-parchment/15 bg-ink/40 px-2 text-[11px] font-medium text-parchment/70"
      title={title}
    >
      {children}
    </span>
  )
}

const EMPTY_CELLS = Array.from({ length: 16 }, (_, i) => ({
  id: `c${i}`,
  x: i % 4,
  y: Math.floor(i / 4),
})).filter((c) => (c.x + c.y) % 2 === 0)

/** A small board with the four seat colours, for the empty lobby list. */
function EmptyTables() {
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="52"
        height="52"
        rx="6"
        className="fill-ink/60 stroke-parchment/20"
        strokeWidth="1.5"
      />
      {EMPTY_CELLS.map((c) => (
        <rect
          key={c.id}
          x={12 + c.x * 10}
          y={12 + c.y * 10}
          width="10"
          height="10"
          className="fill-parchment/10"
        />
      ))}
      <circle cx="32" cy="58" r="4" fill={seatHex(0)} />
      <circle cx="6" cy="32" r="4" fill={seatHex(1)} />
      <circle cx="32" cy="6" r="4" fill={seatHex(2)} />
      <circle cx="58" cy="32" r="4" fill={seatHex(3)} />
    </svg>
  )
}

export function Play() {
  const navigate = useNavigate()
  const current = useMatchStore((s) => (s.closed?.roomId === s.room?.roomId ? null : s.room))
  const { rooms, status } = useLobbyList()
  const [joining, setJoining] = useState<string>()
  const [passwordFor, setPasswordFor] = useState<Listing>()
  /** The Join button that opened the password dialog, for focus to return to. */
  const passwordOpener = useRef<HTMLElement | null>(null)
  const [error, setError] = useState<string>()
  // The lobby filter lives in the URL (?lobbies=ranked), so links can open it pre-filtered.
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('lobbies')
  const filter: LobbyFilter = fromUrl === 'ranked' || fromUrl === 'casual' ? fromUrl : 'all'
  const setFilter = (f: LobbyFilter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (f === 'all') next.delete('lobbies')
        else next.set('lobbies', f)
        return next
      },
      { replace: true },
    )
  const { session } = useAppState()
  const guest = isGuest(session?.user)

  async function join(listing: Listing, opener?: HTMLElement) {
    if (listing.metadata.locked) {
      passwordOpener.current = opener ?? null
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

  const sorted = [...rooms]
    .filter((r) =>
      filter === 'all' ? true : filter === 'ranked' ? r.metadata.ranked : !r.metadata.ranked,
    )
    .sort(
      (a, b) =>
        Number(a.metadata.seatsFilled >= 4) - Number(b.metadata.seatsFilled >= 4) ||
        b.metadata.seatsFilled - a.metadata.seatsFilled ||
        a.roomId.localeCompare(b.roomId),
    )
  const counts = {
    all: rooms.length,
    ranked: rooms.filter((r) => r.metadata.ranked).length,
    casual: rooms.filter((r) => !r.metadata.ranked).length,
  }

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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <fieldset className="inline-flex rounded-lg border border-parchment/15 bg-ink/40 p-1">
              <legend className="sr-only">Show lobbies</legend>
              {(['all', 'ranked', 'casual'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`h-8 rounded-md px-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-gold ${
                    filter === f
                      ? 'bg-parchment/10 text-parchment'
                      : 'text-parchment/60 hover:text-parchment'
                  }`}
                  data-testid={`lobby-filter-${f}`}
                >
                  {FILTER_LABEL[f]}
                  <span className="ml-1.5 tabular-nums text-parchment/45">{counts[f]}</span>
                </button>
              ))}
            </fieldset>
            <Link
              to="/leaderboard"
              className="text-xs font-semibold text-gold underline-offset-2 hover:underline"
              data-testid="play-leaderboard-link"
            >
              Leaderboard →
            </Link>
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
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-parchment/15 bg-panel/30 px-6 py-12 text-center">
              <EmptyTables />
              <h2 className="mt-4 font-display text-xl font-semibold">
                {filter === 'ranked' ? 'No ranked tables' : 'No open tables'}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-parchment/60">
                {filter === 'ranked'
                  ? 'Create a ranked lobby and invite players with accounts.'
                  : 'Start one and invite friends, or fill the empty seats with bots.'}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {current ? null : (
                  <Button
                    className="h-10"
                    onClick={() => {
                      const input = document.querySelector<HTMLInputElement>(
                        '[data-testid="lobby-name"]',
                      )
                      input?.focus()
                      input?.select()
                    }}
                  >
                    Create a lobby
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="h-10"
                  onClick={() =>
                    document.getElementById('vs-bots')?.scrollIntoView({ behavior: 'smooth' })
                  }
                >
                  Play vs bots
                </Button>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="lobby-list">
              <AnimatePresence initial={false} mode="popLayout">
                {sorted.map((r) => {
                  const full = r.metadata.seatsFilled >= 4
                  return (
                    <motion.li
                      key={r.roomId}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: full ? 0.6 : 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="grid gap-3 rounded-2xl border border-parchment/10 bg-panel/80 px-4 py-3.5 transition-[border-color,translate] duration-150 hover:-translate-y-px hover:border-parchment/20 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5 sm:px-5 sm:py-4"
                    >
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-2 font-semibold">
                          {r.metadata.locked ? (
                            <span className="shrink-0 text-gold" title="Private: password required">
                              <LockIcon />
                            </span>
                          ) : null}
                          <span className="truncate">{r.metadata.name}</span>
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Chip>
                            {MODE_LABEL[r.metadata.mode as 'ffa' | 'teams'] ?? r.metadata.mode}
                          </Chip>
                          <Chip title="Time control">
                            <ClockIcon /> {r.metadata.timeControl}
                          </Chip>
                          {r.metadata.ranked ? <RankedBadge /> : <Chip>Casual</Chip>}
                          {r.metadata.locked ? <Chip>Private</Chip> : null}
                          {r.metadata.phase === 'countdown' ? (
                            <Chip>Starting</Chip>
                          ) : r.metadata.phase === 'in_game' ? (
                            <Chip>In game</Chip>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:contents">
                        <span className="flex items-center gap-3">
                          <SeatedCivs civs={r.metadata.civs} />
                          <SeatPips
                            filled={r.metadata.seatsFilled}
                            occupied={r.metadata.occupied}
                          />
                        </span>
                        {r.metadata.ranked && guest && !full ? (
                          <Link
                            to="/sign-up"
                            className="inline-flex h-10 items-center rounded-lg border border-gold/50 px-4 text-sm font-semibold whitespace-nowrap text-gold hover:border-gold hover:bg-gold/10"
                            title="Ranked games are for players with an account"
                            data-testid="join-lobby"
                          >
                            Create account to join
                          </Link>
                        ) : (
                          <Button
                            variant={full ? 'ghost' : 'secondary'}
                            className="h-10 min-w-20"
                            busy={joining === r.roomId}
                            disabled={full || Boolean(current) || (r.metadata.ranked && guest)}
                            onClick={(e) => join(r, e.currentTarget)}
                            data-testid="join-lobby"
                          >
                            {full ? 'Full' : 'Join'}
                          </Button>
                        )}
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          )}
        </section>
        {current ? null : <CreateLobby />}
      </div>
      {passwordFor ? (
        <JoinPasswordDialog
          listing={passwordFor}
          onClose={() => setPasswordFor(undefined)}
          returnFocusTo={passwordOpener}
        />
      ) : null}
    </div>
  )
}
