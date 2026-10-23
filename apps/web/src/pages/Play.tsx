import type { Room } from '@colyseus/sdk'
import { CIVILIZATIONS, civInfo, TIME_CONTROLS } from '@game/config'
import {
  BOT_LEVEL_LABELS,
  checkLobbyNameFormat,
  LOBBY_NAME_MAX,
  LOBBY_PASSWORD_MAX,
  type LobbyMetadata,
  ROOM_NAMES,
  UNTIMED,
} from '@game/protocol'
import { Clock, Eye, Lock, Users } from 'lucide-react'
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
import { CivSelect } from '../components/CivSelect.tsx'
import { CivCard } from '../components/civ/CivCard.tsx'
import { SeatEmblem, TableBoard } from '../components/match/LobbyRoom.tsx'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import { SpectatorCount } from '../components/match/Spectators.tsx'
import { botName, SEAT_LABEL, seatHex, seatName } from '../components/match/seats.ts'
import { Dialog, DialogClose } from '../components/overlay.tsx'
import {
  Alert,
  Button,
  cx,
  EmptyState,
  Field,
  inputClass,
  linkButtonClass,
  Nameplate,
  Pill,
  RuleList,
  SeatTable,
  SectionHeading,
  Spinner,
  textLinkClass,
} from '../components/ui.tsx'
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

/** A running game (listed so people can watch it). */
function isLive(r: Listing): boolean {
  return r.metadata.phase === 'in_game'
}

/** Sort order of the lobby browser: open lobbies, running games, full lobbies. */
function listingRank(r: Listing): number {
  if (isLive(r)) return 1
  return r.metadata.seatsFilled >= 4 ? 2 : 0
}

type LobbyFilter = 'all' | 'ranked' | 'casual'
const FILTER_LABEL: Record<LobbyFilter, string> = {
  all: 'All',
  ranked: 'Ranked',
  casual: 'Casual',
}

/**
 * A row of mutually exclusive choices (mode, time control, list filter) as toggle buttons in a
 * recessed track; the chosen one is raised with a brass edge.
 */
function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  hint,
  size = 'md',
  label = (o) => o,
  trailing,
  testId,
}: {
  legend: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  hint?: ReactNode
  size?: 'sm' | 'md'
  label?: (o: T) => ReactNode
  trailing?: (o: T) => ReactNode
  testId?: (o: T) => string
}) {
  const hintId = useId()
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={hint ? hintId : undefined}
    >
      <legend
        className={cx('mb-1.5 text-ui font-medium text-parchment', size === 'sm' && 'sr-only')}
      >
        {legend}
      </legend>
      <div
        className={cx(
          'flex rounded-control border border-rule-strong bg-black/20 p-1 shadow-well',
          size === 'sm' ? 'w-fit' : 'w-full',
        )}
      >
        {options.map((o) => {
          const on = value === o
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o)}
              data-testid={testId?.(o)}
              className={cx(
                'flex items-center justify-center gap-1.5 rounded-[4px] border font-semibold whitespace-nowrap transition-[color,background-color,border-color] duration-150',
                size === 'sm' ? 'h-8 px-3 text-caption' : 'h-9 flex-1 px-3 text-ui',
                on
                  ? 'border-rule-brass bg-parchment/[0.09] text-parchment shadow-rim'
                  : 'border-transparent text-muted hover:text-parchment',
              )}
            >
              {label(o)}
              {trailing?.(o)}
            </button>
          )
        })}
      </div>
      {hint ? (
        <p id={hintId} className="text-caption text-faint">
          {hint}
        </p>
      ) : null}
    </fieldset>
  )
}

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
    <Segmented
      legend="Mode"
      options={['ffa', 'teams'] as const}
      value={mode}
      onChange={onChange}
      label={(m) => MODE_LABEL[m]}
      hint={
        mode === 'ffa' ? 'Every player for themselves. Last civilization standing wins.' : teamsHint
      }
    />
  )
}

function botLevelText(level: string): string {
  return level === 'max' ? 'Max strength' : `Elo ${level}`
}

/**
 * Who sits where in a game against bots, as it is set up: you at South, three bots around the
 * table (your partner opposite in Teams). Updates as the choices change.
 */
function SeatPreview({
  civ,
  level,
  mode,
  className,
}: {
  civ: string
  level: string
  mode: 'ffa' | 'teams'
  className?: string
}) {
  const bot = (i: number) => (
    <Nameplate
      seat={i}
      size="sm"
      name={botName(level)}
      detail={mode === 'teams' ? (i === 2 ? 'Your partner' : 'Opponent') : 'Random civilization'}
      className="w-full max-w-[11.5rem]"
    />
  )
  return (
    <div className={className} aria-hidden="true">
      <SeatTable
        stackBelow="never"
        className="gap-2.5"
        north={bot(2)}
        west={bot(1)}
        east={bot(3)}
        south={
          <Nameplate
            seat={0}
            size="sm"
            name="You"
            detail={civ ? civName(civ) : 'Choose a civilization'}
            emblem={civ ? <SeatEmblem index={0} civ={civ} size="sm" /> : undefined}
            className="w-full max-w-[11.5rem]"
          />
        }
      >
        <TableBoard
          seats={[{ occupied: true, civ }, ...[1, 2, 3].map(() => ({ occupied: false, civ: '' }))]}
          viewer={0}
          emblems={false}
          className="w-24"
        />
      </SeatTable>
    </div>
  )
}

/** Singleplayer: the player at South against three bots, untimed. */
function PlayVsBots({ blocked }: { blocked: boolean }) {
  const navigate = useNavigate()
  const levelId = useId()
  const levelHintId = useId()
  const civLabelId = useId()
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
      className="rounded-panel border border-rule-brass bg-surface-rail p-5 shadow-rim sm:p-8"
      data-testid="vs-bots"
    >
      <form
        className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]"
        onSubmit={start}
        noValidate
      >
        <div className="flex min-w-0 flex-col">
          <h2 id="vs-bots-title" className="font-display text-title font-semibold">
            Play vs bots
          </h2>
          <p className="mt-2 max-w-[56ch] text-body text-pretty text-muted">
            You play South against three bots, each with a random civilization. There are no clocks,
            so take as long as you like.
          </p>
          <SeatPreview
            civ={civ}
            level={level}
            mode={mode}
            className="mt-8 hidden justify-center rounded-panel border border-black/30 bg-baize px-4 py-8 shadow-well sm:flex"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <h3 id={civLabelId} className="mb-1.5 text-ui font-medium text-parchment">
              Your civilization
            </h3>
            <CivSelect
              value={civ}
              onChange={setCiv}
              labelId={civLabelId}
              attached={civInfo(civ) !== null}
              preview
            />
            {civ ? <CivCard civ={civ} variant="attached" fold="rest" headingLevel={4} /> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={levelId} className="text-ui font-medium text-parchment">
              Bot strength
            </label>
            <select
              id={levelId}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className={cx(inputClass, 'select')}
              aria-describedby={levelHintId}
              data-testid="bot-level"
            >
              {BOT_LEVEL_LABELS.map((l) => (
                <option key={l} value={l}>
                  {botLevelText(l)}
                </option>
              ))}
            </select>
            <p id={levelHintId} className="text-caption text-faint">
              All three bots play at this level.
            </p>
          </div>
          <ModeChoice
            mode={mode}
            onChange={setMode}
            teamsHint="You and the North bot against West and East."
          />
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              size="lg"
              busy={busy}
              disabled={!civ || blocked}
              data-testid="start-solo"
            >
              Start game
            </Button>
            <p className="text-center text-caption text-faint" aria-live="polite">
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
    <section
      aria-labelledby="create-lobby-title"
      className="rounded-panel border border-rule bg-surface-rail p-5 shadow-rim sm:p-6 lg:sticky lg:top-6 lg:self-start"
    >
      <h2 id="create-lobby-title" className="font-display text-heading font-semibold">
        Create a lobby
      </h2>
      <p className="mt-1 mb-6 text-ui text-faint">
        Everyone picks a civilization at the same time. Drafting with bans is on the way.
      </p>
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
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
        <Segmented
          legend="Time control"
          options={Object.keys(TIME_CONTROLS) as (keyof typeof TIME_CONTROLS)[]}
          value={timeControl}
          onChange={setTimeControl}
          label={(tc) => <span className="tabular-nums">{tc}</span>}
          hint={
            timeControl === '10+0'
              ? '10 minutes per player, no increment.'
              : '3 minutes per player, plus 2 seconds per move.'
          }
        />
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
              : 'Leave empty for a public lobby anyone can join.'
          }
          data-testid="lobby-password"
        />
        {error ? <Alert>{error}</Alert> : null}
        <Button
          type="submit"
          variant="secondary"
          busy={busy}
          disabled={Boolean(nameError)}
          data-testid="create-lobby"
        >
          Create lobby
        </Button>
      </form>
    </section>
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
    <div className="flex flex-col gap-1.5">
      <label
        className={cx(
          'flex items-center justify-between gap-4 rounded-control border px-3 py-2.5 transition-colors duration-150',
          ranked ? 'border-brass/60 bg-brass/[0.07]' : 'border-rule-strong',
          guest ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-parchment/35',
        )}
      >
        <span className="flex flex-col">
          <span className="text-ui font-semibold text-parchment">Ranked</span>
          <span className="text-caption text-faint">Rated games, for players with accounts</span>
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
          <span className="h-6 w-11 rounded-full bg-parchment/20 shadow-well transition-colors duration-150 peer-checked:bg-brass peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold" />
          <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-parchment shadow-plate transition-transform duration-150 peer-checked:translate-x-5" />
        </span>
      </label>
      <p id={hintId} className="text-caption text-faint" data-testid="ranked-hint">
        {guest ? (
          <>
            <Link to="/sign-up" className={cx(textLinkClass, 'font-semibold')}>
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
        <div className="mt-2 flex flex-col-reverse gap-2 border-t border-rule pt-4 sm:flex-row sm:justify-end">
          <DialogClose>
            <Button variant="quiet">Cancel</Button>
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
 * A table seen from above: one bar per side in that seat's colour when the seat is taken, a
 * faint outline when it's open (South at the bottom, West left, North top, East right). Falls
 * back to filling in seat order when the listing has no `occupied` array.
 */
function TableGlyph({
  filled,
  occupied,
}: {
  filled: number
  occupied: readonly boolean[] | undefined
}) {
  const taken = (i: number) => (occupied ? Boolean(occupied[i]) : i < filled)
  const bars = [
    'bottom-0.5 left-2.5 right-2.5 h-[3px]',
    'left-0.5 top-2.5 bottom-2.5 w-[3px]',
    'top-0.5 left-2.5 right-2.5 h-[3px]',
    'right-0.5 top-2.5 bottom-2.5 w-[3px]',
  ]
  return (
    <span
      className="relative block h-11 w-11 shrink-0 rounded-plate border border-rule bg-baize shadow-well"
      role="img"
      aria-label={`${filled} of 4 seats filled`}
    >
      <span className="absolute inset-[9px] rounded-[2px] bg-walnut/80 ring-1 ring-black/40" />
      {bars.map((pos, i) => (
        <span
          key={pos}
          className={cx('absolute rounded-full', pos, taken(i) ? null : 'bg-parchment/15')}
          style={taken(i) ? { backgroundColor: seatHex(i) } : undefined}
          data-seat-taken={taken(i) ? 'true' : 'false'}
        />
      ))}
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
      className="flex items-center -space-x-1"
      role="img"
      aria-label={label}
      data-testid="seated-civs"
    >
      {seated.map((c) => (
        <span
          key={c.seat}
          className="grid h-7 w-7 place-items-center rounded-full border bg-baize-deep ring-2 ring-surface"
          style={{ borderColor: `${seatHex(c.seat)}aa`, color: seatHex(c.seat) }}
          title={`${civName(c.civ)} (${SEAT_LABEL[seatName(c.seat)]})`}
          data-civ={c.civ}
        >
          <CivEmblem civ={c.civ} className="h-4 w-4" title="" />
        </span>
      ))}
    </span>
  )
}

/** One fact in a lobby row's detail line. */
function RowFact({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0">
      {icon}
      {children}
    </li>
  )
}

function LobbyRow({
  r,
  mine,
  guest,
  blocked,
  joining,
  onJoin,
}: {
  r: Listing
  mine: boolean
  guest: boolean
  blocked: boolean
  joining: boolean
  onJoin: (opener: HTMLElement) => void
}) {
  const live = isLive(r)
  const full = !live && r.metadata.seatsFilled >= 4
  const watchClass = linkButtonClass('secondary', 'min-w-24', 'sm')
  let action: ReactNode
  if (live) {
    action = mine ? (
      <Link to={`/match/${r.roomId}`} className={watchClass} data-testid="watch-game">
        Your game
      </Link>
    ) : (
      <Link
        to={`/watch/${r.roomId}`}
        className={watchClass}
        aria-label={`Watch ${r.metadata.name}`}
        data-testid="watch-game"
      >
        <Eye aria-hidden="true" />
        Watch
      </Link>
    )
  } else if (full && !mine) {
    // A full lobby can't be joined, but it can be watched until it starts.
    action = (
      <Link
        to={`/watch/${r.roomId}`}
        className={watchClass}
        aria-label={`Full. Watch ${r.metadata.name}`}
        data-testid="watch-lobby"
      >
        <Eye aria-hidden="true" />
        Watch
      </Link>
    )
  } else {
    action = (
      <>
        {mine ? null : (
          <Link
            to={`/watch/${r.roomId}`}
            className={linkButtonClass('quiet', 'w-9 px-0', 'sm')}
            aria-label={`Watch ${r.metadata.name}`}
            title="Watch"
            data-testid="watch-lobby"
          >
            <Eye aria-hidden="true" />
          </Link>
        )}
        {r.metadata.ranked && guest && !full ? (
          <Link
            to="/sign-up"
            className={linkButtonClass('secondary', undefined, 'sm')}
            title="Ranked games are for players with an account"
            data-testid="join-lobby"
          >
            Create account to join
          </Link>
        ) : (
          <Button
            variant={full ? 'quiet' : 'secondary'}
            size="sm"
            className="min-w-20"
            busy={joining}
            disabled={full || blocked || (r.metadata.ranked && guest)}
            onClick={(e) => onJoin(e.currentTarget)}
            data-testid="join-lobby"
          >
            {full ? 'Full' : 'Join'}
          </Button>
        )}
      </>
    )
  }

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: full ? 0.7 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 sm:flex-nowrap"
    >
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-4">
        <TableGlyph filled={r.metadata.seatsFilled} occupied={r.metadata.occupied} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            {r.metadata.locked ? (
              <span className="shrink-0 text-brass" title="Private: password required">
                <Lock aria-hidden="true" className="h-4 w-4" />
              </span>
            ) : null}
            <span className="truncate font-display text-lead font-semibold text-parchment">
              {r.metadata.name}
            </span>
          </p>
          <ul className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-ui text-faint">
            <RowFact icon={<Users aria-hidden="true" />}>
              {MODE_LABEL[r.metadata.mode as 'ffa' | 'teams'] ?? r.metadata.mode}
            </RowFact>
            <RowFact icon={<Clock aria-hidden="true" />}>
              <span className="tabular-nums" title="Time control">
                {r.metadata.timeControl}
              </span>
            </RowFact>
            <RowFact>
              <span className="tabular-nums" aria-hidden="true">
                {r.metadata.seatsFilled} of 4 seated
              </span>
            </RowFact>
            <RowFact>{r.metadata.ranked ? <RankedBadge /> : 'Casual'}</RowFact>
            {r.metadata.locked ? <RowFact>Private</RowFact> : null}
            {r.metadata.phase === 'countdown' ? (
              <RowFact>
                <Pill tone="brass">Starting</Pill>
              </RowFact>
            ) : live ? (
              <RowFact>
                <Pill>In game</Pill>
              </RowFact>
            ) : null}
            {(r.metadata.spectators ?? 0) > 0 ? (
              <RowFact>
                <SpectatorCount count={r.metadata.spectators ?? 0} />
              </RowFact>
            ) : null}
          </ul>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <SeatedCivs civs={r.metadata.civs} />
        <span className="flex items-center gap-1.5">{action}</span>
      </div>
    </motion.li>
  )
}

function ListStatus({ status }: { status: 'connecting' | 'live' | 'error' }) {
  return (
    <span className="flex items-center gap-2 text-caption text-faint" aria-live="polite">
      {status === 'connecting' ? (
        <>
          <Spinner className="h-3 w-3" /> Connecting
        </>
      ) : status === 'live' ? (
        <>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ok" /> Live
        </>
      ) : (
        <span className="text-destructive-light">Disconnected</span>
      )}
    </span>
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
    // Open lobbies first (fullest first), then running games to watch, then full lobbies.
    .sort(
      (a, b) =>
        listingRank(a) - listingRank(b) ||
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
      <h1 className="sr-only">Play</h1>
      {current ? (
        <Alert tone="info" className="mb-6">
          You have a seat in “{(current.state as { name?: string })?.name ?? 'a lobby'}”.{' '}
          <button
            type="button"
            className={cx(textLinkClass, 'font-semibold')}
            onClick={() => navigate(`/match/${current.roomId}`)}
          >
            Return to it
          </button>
        </Alert>
      ) : null}
      <PlayVsBots blocked={Boolean(current)} />
      <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <section aria-labelledby="lobbies-title" className="min-w-0">
          <SectionHeading
            id="lobbies-title"
            title={<span className="text-title">Lobbies</span>}
            description="Join an open table, watch a game in progress, or create your own lobby."
            actions={<ListStatus status={status} />}
          />
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              legend="Show lobbies"
              size="sm"
              options={['all', 'ranked', 'casual'] as const}
              value={filter}
              onChange={setFilter}
              label={(f) => FILTER_LABEL[f]}
              trailing={(f) => (
                <span className="font-normal tabular-nums text-faint">{counts[f]}</span>
              )}
              testId={(f) => `lobby-filter-${f}`}
            />
            <Link
              to="/leaderboard"
              className={cx(textLinkClass, 'text-ui')}
              data-testid="play-leaderboard-link"
            >
              See the leaderboard
            </Link>
          </div>
          {error ? <Alert className="my-4">{error}</Alert> : null}
          {status === 'error' ? (
            <Alert className="mt-4">
              Could not load the lobby list. Check that you are signed in (or playing as a guest)
              and reload the page.
            </Alert>
          ) : sorted.length === 0 && status === 'live' ? (
            <EmptyState
              className="mt-4"
              title={
                filter === 'ranked' ? 'No ranked tables right now' : 'No open tables right now'
              }
              action={
                <div className="flex flex-wrap gap-2">
                  {current ? null : (
                    <Button
                      variant="secondary"
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
                    variant="quiet"
                    onClick={() =>
                      document.getElementById('vs-bots')?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    Play vs bots
                  </Button>
                </div>
              }
            >
              {filter === 'ranked'
                ? 'Create a ranked lobby and invite players with accounts.'
                : 'Start one and invite friends, or fill the empty seats with bots.'}
            </EmptyState>
          ) : sorted.length === 0 ? (
            <p className="flex items-center gap-2 border-y border-rule py-6 text-ui text-faint">
              <Spinner className="h-3.5 w-3.5" /> Looking for open tables
            </p>
          ) : (
            <RuleList data-testid="lobby-list">
              <AnimatePresence initial={false} mode="popLayout">
                {sorted.map((r) => (
                  <LobbyRow
                    key={r.roomId}
                    r={r}
                    mine={current?.roomId === r.roomId}
                    guest={guest}
                    blocked={Boolean(current)}
                    joining={joining === r.roomId}
                    onJoin={(opener) => join(r, opener)}
                  />
                ))}
              </AnimatePresence>
            </RuleList>
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
