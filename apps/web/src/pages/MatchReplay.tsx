import { BoardView } from '@game/board'
import { TIME_CONTROLS } from '@game/config'
import {
  applyReplayAction,
  isUntimed,
  type MatchDetailResponse,
  type MatchReplayResponse,
  type ReplayAction,
} from '@game/protocol'
import {
  Game,
  type GameConfigInput,
  type GameEvent,
  isSupportedRulesVersion,
  type Snapshot,
} from '@game/rules'
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Pause,
  Play,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { CivEmblem, civName } from '../components/CivEmblem.tsx'
import { BoardSettings } from '../components/game/BoardSettings.tsx'
import { GearIcon } from '../components/game/icons.tsx'
import { Medal } from '../components/game/Medal.tsx'
import { MoveLog } from '../components/match/MoveLog.tsx'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import {
  botName,
  END_REASON_LABEL,
  MODE_LABEL,
  ordinal,
  SEAT_LABEL,
  STATUS_LABEL,
  seatName,
  seatsAround,
} from '../components/match/seats.ts'
import {
  Alert,
  Button,
  cx,
  inputClass,
  linkButtonClass,
  Nameplate,
  NoticePage,
  SEAT_CLASSES,
  SEAT_ORDER,
  SeatDot,
  Spinner,
} from '../components/ui.tsx'
import { ApiError, api } from '../lib/api.ts'
import { useMediaQuery, WIDE_QUERY } from '../lib/media.ts'
import { clockText, itemLabel, type LogStep, logItems } from '../lib/move-log.ts'
import { usePrefs } from '../lib/prefs.ts'
import { useRulesReady } from '../lib/rules.ts'

/** One replayed action: the log step plus the position after it. */
interface ReplayStep extends LogStep {
  positionString: string
}

interface Simulation {
  start: string
  steps: ReplayStep[]
  /** The engine refused an action (the replay stops there). */
  error: string | null
  /** The last position equals the server's re-simulation (`finalPosition`). */
  verified: boolean
}

/** Re-simulates the stored actions with the rules engine, keeping every position. */
function simulate(replay: MatchReplayResponse): Simulation {
  const game = Game.create(replay.config as unknown as GameConfigInput)
  try {
    const start = game.positionString()
    const steps: ReplayStep[] = []
    let error: string | null = null
    for (const a of replay.actions) {
      let events: GameEvent[]
      try {
        events = applyReplayAction(game, a as ReplayAction)
      } catch (err) {
        error = (err as Error).message
        break
      }
      steps.push({
        seq: a.seq,
        action: a.action,
        seat: a.seat ?? -1,
        notation: a.notation,
        events,
        attacked: [...game.snapshot().leaderUnderAttack],
        positionString: game.positionString(),
        clockMs: a.clockMs ?? null,
      })
    }
    const final = game.positionString()
    foldSoloEnd(steps, replay.endReason)
    return { start, steps, error, verified: !error && final === replay.finalPosition }
  } finally {
    game.free()
  }
}

/**
 * A solo FFA game ends (an agreed draw between the bots) the moment its player is out. The
 * live game shows that as one step, the resignation or move with the end folded in; the
 * stored game has the draw as its own action. Fold it the same way, so the replay shows the
 * steps the game showed.
 */
function foldSoloEnd(steps: ReplayStep[], endReason: string | null | undefined): void {
  const end = steps.at(-1)
  const before = steps.at(-2)
  if (endReason !== 'player_eliminated' || end?.action !== 'agreed_draw' || !before) return
  steps.splice(-2, 2, {
    ...before,
    events: [...before.events, ...end.events],
    attacked: end.attacked,
    positionString: end.positionString,
  })
}

function snapshotOf(positionString: string): Snapshot {
  const game = Game.fromPosition(positionString)
  try {
    return game.snapshot()
  } finally {
    game.free()
  }
}

const SPEEDS = [0.5, 1, 2, 4] as const
/** Time per action at 1×. */
const STEP_MS = 1100

/** The read-only board: shows a position, animating single steps forward. */
function ReplayBoard({
  snapshot,
  events,
  animate,
  perspective,
  localSeat,
  positionString,
}: {
  snapshot: Snapshot
  events: readonly GameEvent[] | undefined
  animate: boolean
  perspective: number
  localSeat: number
  positionString: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<BoardView | null>(null)
  const [viewGen, setViewGen] = useState(0)
  const prefs = usePrefs()
  const shown = useRef(positionString)
  shown.current = positionString
  /** The board has its first perspective (later changes turn it, animated). */
  const turned = useRef(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const view = new BoardView({
      sound: usePrefs.getState().sound,
      colorblindPatterns: usePrefs.getState().colorblindPatterns,
      reducedMotion: usePrefs.getState().reducedMotion,
      announceVerbosity: usePrefs.getState().announceMoves,
      // A replay is nobody's turn: no "Your move." lines.
      announceTurn: false,
    })
    viewRef.current = view
    turned.current = false
    if (import.meta.env.DEV) {
      // Development-only hook for scripted browser checks (never in production builds).
      ;(window as unknown as { __replayBoard?: unknown }).__replayBoard = {
        position: () => shown.current,
        perspective: () => view.perspective,
      }
    }
    let live = true
    view
      .mount(el)
      .then(() => {
        if (live) setViewGen((g) => g + 1)
      })
      .catch(() => {})
    return () => {
      live = false
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    viewRef.current?.setOptions({
      sound: prefs.sound,
      colorblindPatterns: prefs.colorblindPatterns,
      reducedMotion: prefs.reducedMotion,
    })
  }, [prefs.sound, prefs.colorblindPatterns, prefs.reducedMotion])

  useEffect(() => {
    viewRef.current?.setAnnounceVerbosity(prefs.announceMoves)
  }, [prefs.announceMoves])

  // The first perspective is set at once; a change the viewer picks turns the board.
  useEffect(() => {
    if (viewGen === 0) return
    viewRef.current?.setPerspective(seatName(perspective), { animate: turned.current })
    turned.current = true
    viewRef.current?.setLocalSeat(localSeat >= 0 ? seatName(localSeat) : null)
  }, [viewGen, perspective, localSeat])

  useEffect(() => {
    const view = viewRef.current
    if (viewGen === 0 || !view) return
    view.setSnapshot(snapshot, { animate, ...(animate && events ? { events } : {}) })
    view.setInteractive(null)
  }, [viewGen, snapshot, events, animate])

  return (
    <div className="relative aspect-square w-[var(--board)]" data-testid="replay-board">
      <div ref={host} className="absolute inset-0" />
      {viewGen > 0 ? null : (
        <div className="absolute inset-0 flex items-center justify-center gap-3 text-parchment/60">
          <Spinner /> Setting up the board…
        </div>
      )}
    </div>
  )
}

/** "Free-for-all, 10+0, casual" (ranked games add the Ranked tag beside it). */
function MatchMeta({ detail }: { detail: MatchDetailResponse }) {
  const untimed = isUntimed(detail.timeControl)
  const line = [
    MODE_LABEL[detail.mode] ?? detail.mode,
    untimed ? 'untimed, against bots' : detail.timeControl,
    !detail.ranked && !untimed ? 'casual' : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <div className="flex flex-col gap-0.5 text-ui text-muted">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{line}</span>
        {detail.ranked ? <RankedBadge /> : null}
      </p>
      <p className="text-faint">
        <time dateTime={detail.startedAt}>
          {new Date(detail.startedAt).toLocaleDateString(undefined, { dateStyle: 'long' })}
        </time>
      </p>
    </div>
  )
}

type Player = MatchDetailResponse['players'][number]

/** A player's nameplate at their side of the table. */
function PlayerPlate({
  p,
  status,
  toMove,
  showPlace,
  clock,
  pos = 'bottom',
  className,
}: {
  p: Player
  /** This step's status ('active', 'defeated', ...), or null outside a replay. */
  status: string | null
  toMove: boolean
  /** Replay: places only at the end, so stepping through doesn't give the result away. */
  showPlace: boolean
  /** Time left after the seat's last action shown (timed games), ms. */
  clock: number | null | undefined
  /** Where the plate sits around the table (wide screens stand the side plates upright). */
  pos?: 'top' | 'left' | 'right' | 'bottom'
  className?: string
}) {
  const wide = useMediaQuery(WIDE_QUERY)
  const column = wide && (pos === 'left' || pos === 'right')
  // The seat colour runs along the side that faces the board, as on the game screen.
  const edge = !wide
    ? 'left'
    : pos === 'left'
      ? 'right'
      : pos === 'right'
        ? 'left'
        : pos === 'top'
          ? 'bottom'
          : 'top'
  const out = status !== null && status !== 'active'
  const state = out ? 'out' : showPlace && p.placement === 1 ? 'won' : toMove ? 'to-move' : 'idle'
  // Phones: the placing leads the detail line instead of a disc, so the name keeps its room.
  const placeInDetail = !wide && showPlace && p.placement ? p.placement : null
  const detail = [
    placeInDetail ? ordinal(placeInDetail) : null,
    civName(p.civ),
    out ? (STATUS_LABEL[status ?? ''] ?? status) : toMove ? 'to move' : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Nameplate
      seat={p.seat}
      size="sm"
      state={state}
      orient={column ? 'column' : 'row'}
      edge={edge}
      className={cx('w-full', column && 'min-h-36', className)}
      data-testid={`replay-player-${seatName(p.seat)}`}
      emblem={
        // The civ's enamel medallion, as on the game screen's plates.
        <span
          className={cx(
            'flex items-center justify-center rounded-full border border-brass/45 bg-black/20 shadow-plate',
            column ? 'h-10 w-10' : wide ? 'h-8 w-8' : 'h-7 w-7',
            SEAT_CLASSES[SEAT_ORDER[p.seat] ?? 'south'].text,
            out && 'opacity-50 grayscale',
          )}
        >
          <CivEmblem civ={p.civ} className={column ? 'h-6 w-6' : 'h-5 w-5'} />
        </span>
      }
      name={
        <>
          {p.botLevel ? botName(p.botLevel) : p.name}
          {/* Phones keep the name's room, as the game screen does. */}
          {p.isYou ? (
            <span className={wide ? 'font-sans font-normal text-faint' : 'sr-only'}> (you)</span>
          ) : null}
        </>
      }
      detail={detail}
      trailing={
        clock != null || (showPlace && p.placement && !placeInDetail) ? (
          <span className="flex items-center gap-2">
            {clock != null ? (
              <span
                className="text-ui font-semibold text-parchment"
                data-testid={`replay-clock-${seatName(p.seat)}`}
              >
                <span className="sr-only">Time left: </span>
                {clockText(clock)}
              </span>
            ) : null}
            {showPlace && p.placement && !placeInDetail ? (
              p.placement <= 3 ? (
                <Medal place={p.placement} size="sm" label={ordinal(p.placement)} />
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-rule-strong text-caption font-semibold text-muted lining-nums tabular-nums">
                  {ordinal(p.placement)}
                </span>
              )
            ) : null}
          </span>
        ) : null
      }
    />
  )
}

/**
 * The four seats around a centre (the board, or a table in the game details): the viewer's
 * seat at the bottom, then clockwise. Wide screens seat West and East beside the centre; phones
 * pair West and North above it and South and East below, as the game screen does.
 */
function SeatsAround({
  detail,
  perspective,
  plate,
  children,
}: {
  detail: MatchDetailResponse
  perspective: number
  plate: (p: Player, pos: 'top' | 'left' | 'right' | 'bottom') => ReactNode
  children: ReactNode
}) {
  const at = seatsAround(perspective)
  const of = (seat: number, pos: 'top' | 'left' | 'right' | 'bottom') => {
    const p = detail.players.find((x) => x.seat === seat)
    return p ? plate(p, pos) : null
  }
  return (
    <section
      aria-label="Players"
      className={cx(
        'grid grid-cols-2 items-center gap-2 [grid-template-areas:"w_n"_"c_c"_"s_e"]',
        'wide:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] wide:gap-3 wide:[grid-template-areas:"._n_."_"w_c_e"_"._s_."]',
      )}
    >
      <div className="flex min-w-0 justify-center [grid-area:n]">
        <div className="w-full wide:max-w-64">{of(at.top, 'top')}</div>
      </div>
      <div className="flex min-w-0 [grid-area:w] wide:justify-end">
        <div className="w-full wide:w-40">{of(at.left, 'left')}</div>
      </div>
      <div className="flex min-w-0 justify-center [grid-area:c]">{children}</div>
      <div className="flex min-w-0 [grid-area:e] wide:justify-start">
        <div className="w-full wide:w-40">{of(at.right, 'right')}</div>
      </div>
      <div className="flex min-w-0 justify-center [grid-area:s]">
        <div className="w-full wide:max-w-64">{of(at.bottom, 'bottom')}</div>
      </div>
    </section>
  )
}

/** A back link to the history list. */
function BackLink() {
  return (
    <Link
      to="/history"
      className="-ml-1 inline-flex w-fit items-center gap-1 rounded-control py-1 pr-2 pl-1 text-ui font-medium text-muted transition-colors duration-150 hover:text-parchment"
    >
      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      Match history
    </Link>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-plate border border-rule-strong bg-black/20 px-1 font-sans text-caption text-muted">
      {children}
    </kbd>
  )
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    // The board's keyboard cursor uses the arrow keys.
    target instanceof HTMLCanvasElement
  )
}

function Viewer({
  detail,
  replay,
  sim,
}: {
  detail: MatchDetailResponse
  replay: MatchReplayResponse
  sim: Simulation
}) {
  const total = sim.steps.length
  const last = total - 1
  // -1 = the starting position; opens on the final position (the game as it ended).
  const [pos, setPos] = useState({ index: last, prev: last })
  const { index, prev: prevIndex } = pos
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsId = useId()
  const speedId = useId()
  const items = useMemo(() => logItems(sim.steps), [sim.steps])
  const me = detail.players.find((p) => p.isYou)
  const mySeat = me?.seat ?? -1
  // Whose side the board is seen from: your own seat at first, any seat on request.
  const [perspective, setPerspective] = useState(mySeat >= 0 ? mySeat : 0)
  const baseMs = isUntimed(detail.timeControl)
    ? null
    : (TIME_CONTROLS[detail.timeControl as keyof typeof TIME_CONTROLS]?.baseMs ?? null)
  const names = useMemo(
    () =>
      [0, 1, 2, 3].map((s) => {
        const p = detail.players.find((x) => x.seat === s)
        if (!p) return SEAT_LABEL[seatName(s)]
        if (p.isYou) return 'You'
        return p.botLevel ? `${civName(p.civ)} bot` : p.name
      }),
    [detail.players],
  )

  const go = useCallback(
    (to: number) => {
      const next = Math.max(-1, Math.min(last, to))
      setPos((p) => (p.index === next ? p : { index: next, prev: p.index }))
    },
    [last],
  )

  const ps = index < 0 ? sim.start : (sim.steps[index]?.positionString ?? sim.start)
  const snapshot = useMemo(() => snapshotOf(ps), [ps])
  const forward = index === prevIndex + 1
  const events = forward && index >= 0 ? sim.steps[index]?.events : undefined

  // Autoplay: one action per tick; stops at the end.
  useEffect(() => {
    if (!playing) return
    if (index >= last) {
      setPlaying(false)
      return
    }
    const t = window.setTimeout(() => go(index + 1), STEP_MS / speed)
    return () => window.clearTimeout(t)
  }, [playing, index, last, speed, go])

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && index >= last) go(-1)
      return !p
    })
  }, [index, last, go])

  // Keyboard: ← → step, Home / End jump, Space (or K) plays and pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
      const onButton = e.target instanceof HTMLButtonElement
      if (e.key === 'ArrowLeft') {
        setPlaying(false)
        go(index - 1)
      } else if (e.key === 'ArrowRight') {
        setPlaying(false)
        go(index + 1)
      } else if (e.key === 'Home') {
        setPlaying(false)
        go(-1)
      } else if (e.key === 'End') {
        setPlaying(false)
        go(last)
      } else if ((e.key === ' ' && !onButton) || e.key === 'k' || e.key === 'K') {
        togglePlay()
      } else if (e.key === 'r' || e.key === 'R') {
        // Turn the board to the next seat (South, West, North, East).
        setPerspective((p) => (p + 1) % 4)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, last, go, togglePlay])

  // Screen readers: the board describes a single step forward; any other jump (back, first,
  // last, the scrubber, a move in the log) is said here, once.
  const [jumpNote, setJumpNote] = useState('')
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (index === prevIndex + 1) {
      setJumpNote('')
      return
    }
    const item = items.find((i) => i.step === index)
    setJumpNote(
      index < 0
        ? 'Start position'
        : `Move ${index + 1} of ${total}${item ? `: ${itemLabel(item, detail.endReason ?? undefined)}` : ''}`,
    )
  }, [index, prevIndex, items, total, detail.endReason])

  const step = (to: number) => {
    setPlaying(false)
    go(to)
  }
  const atEnd = index >= last
  // Each seat's clock as of the step shown: its time left after its last action so far (the
  // starting time before its first), from the server's stored times. Timed games only.
  const clocks = useMemo(() => {
    if (baseMs === null) return null
    const out: (number | null)[] = [baseMs, baseMs, baseMs, baseMs]
    for (let i = 0; i <= index; i++) {
      const st = sim.steps[i]
      if (st && st.seat >= 0 && typeof st.clockMs === 'number') out[st.seat] = st.clockMs
    }
    return out
  }, [baseMs, index, sim.steps])
  const result = END_REASON_LABEL[detail.endReason ?? replay.endReason ?? ''] ?? ''
  const myPlace = me?.placement ?? null
  const toMove = snapshot.isOver ? null : snapshot.seatToMove
  const ctl = 'w-10 !px-0'

  return (
    <div
      className={[
        'safe-bottom-6 mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 pt-4',
        'wide:grid wide:grid-cols-[auto_minmax(280px,320px)] wide:items-start wide:justify-center wide:gap-6 wide:py-4',
        // Phones: the board fills the width, but leaves room under the header for the title,
        // the plates above and below it and the controls (and never shrinks below 280px).
        '[--board:max(min(100%,280px),min(100%,calc(100dvh_-_400px_-_var(--safe-top)_-_var(--safe-bottom))))]',
        // Wide: beside a 320px rail with a 160px plate either side (plus gaps and padding:
        // 720px), and under the header with a plate above and below (208px).
        'wide:[--board:min(calc(100vw_-_720px_-_var(--safe-left)_-_var(--safe-right)),calc(100dvh_-_208px_-_var(--safe-top)_-_var(--safe-bottom)))]',
      ].join(' ')}
      data-testid="replay"
      data-verified={sim.verified ? 'true' : 'false'}
    >
      <div className="order-2 min-w-0 wide:order-none">
        <SeatsAround
          detail={detail}
          perspective={perspective}
          plate={(p, pos) => (
            <PlayerPlate
              p={p}
              status={snapshot.statuses[p.seat] ?? 'active'}
              toMove={toMove === seatName(p.seat)}
              showPlace={atEnd}
              clock={clocks?.[p.seat]}
              pos={pos}
            />
          )}
        >
          <ReplayBoard
            snapshot={snapshot}
            events={events}
            animate={forward}
            perspective={perspective}
            localSeat={mySeat}
            positionString={ps}
          />
        </SeatsAround>
      </div>

      <aside
        aria-label="Replay"
        className="contents wide:sticky wide:top-4 wide:flex wide:h-[max(calc(var(--board)+120px),min(34rem,calc(100dvh-96px)))] wide:flex-col wide:gap-4 wide:overflow-y-auto wide:rounded-panel wide:border wide:border-rule-brass wide:bg-surface-rail wide:p-4 wide:shadow-rim"
      >
        <header className="order-1 flex min-w-0 flex-col gap-2 wide:order-none">
          <BackLink />
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <h1 className="font-display text-title font-semibold">Replay</h1>
            <p
              className={cx('shrink-0 text-ui', myPlace === 1 ? 'text-gold' : 'text-muted')}
              data-testid="replay-outcome"
            >
              {myPlace ? `You finished ${ordinal(myPlace)}` : 'Finished'}
            </p>
          </div>
          <MatchMeta detail={detail} />
        </header>

        <section
          aria-label="Replay controls"
          className="order-3 flex flex-col gap-3 wide:order-none wide:border-t wide:border-rule wide:pt-4"
        >
          {sim.error || !sim.verified ? (
            <div data-testid="replay-mismatch">
              <Alert tone="warning">
                This replay doesn’t reach the position the server recorded, so it may not show the
                game exactly as it was played.
              </Alert>
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <Button
              variant="quiet"
              className={ctl}
              onClick={() => step(-1)}
              disabled={index < 0}
              aria-label="First position"
              title="First position (Home)"
              data-testid="replay-first"
            >
              <ChevronFirst className="!h-5 !w-5" aria-hidden="true" />
            </Button>
            <Button
              variant="quiet"
              className={ctl}
              onClick={() => step(index - 1)}
              disabled={index < 0}
              aria-label="Previous move"
              title="Previous move (←)"
              data-testid="replay-prev"
            >
              <ChevronLeft className="!h-5 !w-5" aria-hidden="true" />
            </Button>
            <Button
              variant="primary"
              className="w-14 !px-0"
              onClick={togglePlay}
              disabled={total === 0}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              data-testid="replay-play"
            >
              {playing ? (
                <Pause className="!h-5 !w-5" aria-hidden="true" />
              ) : (
                <Play className="!h-5 !w-5 fill-current" aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="quiet"
              className={ctl}
              onClick={() => step(index + 1)}
              disabled={atEnd}
              aria-label="Next move"
              title="Next move (→)"
              data-testid="replay-next"
            >
              <ChevronRight className="!h-5 !w-5" aria-hidden="true" />
            </Button>
            <Button
              variant="quiet"
              className={ctl}
              onClick={() => step(last)}
              disabled={atEnd}
              aria-label="Last position"
              title="Last position (End)"
              data-testid="replay-last"
            >
              <ChevronLast className="!h-5 !w-5" aria-hidden="true" />
            </Button>
            <Button
              variant="quiet"
              className={cx(ctl, 'ml-auto', settingsOpen && 'bg-parchment/[0.08] text-parchment')}
              aria-label="Board settings"
              aria-expanded={settingsOpen}
              aria-controls={settingsId}
              onClick={() => setSettingsOpen((o) => !o)}
              title="Board settings"
            >
              <GearIcon className="h-[18px] w-[18px]" />
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={-1}
              max={last}
              value={index}
              onChange={(e) => step(Number(e.target.value))}
              className="min-w-0 flex-1 accent-gold"
              aria-label="Move"
              aria-valuetext={index < 0 ? 'Start' : `Move ${index + 1} of ${total}`}
              data-testid="replay-scrubber"
            />
            <span
              className="w-12 shrink-0 text-right text-ui text-muted lining-nums tabular-nums"
              data-testid="replay-position"
            >
              {index < 0 ? 'Start' : `${index + 1} / ${total}`}
            </span>
            <label htmlFor={speedId} className="sr-only">
              Speed
            </label>
            <div className="w-[4.5rem] shrink-0">
              <select
                id={speedId}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}
                className={cx(inputClass, 'select text-ui lining-nums tabular-nums')}
                data-testid="replay-speed"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="min-w-0" data-testid="replay-perspective">
            <legend className="mb-1.5 text-caption text-faint">View the board from</legend>
            <div className="flex min-w-0 gap-1 rounded-control border border-rule-strong bg-black/20 p-1 shadow-well">
              {[0, 1, 2, 3].map((s) => {
                const on = perspective === s
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPerspective(s)}
                    className={cx(
                      'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-plate px-1 text-caption font-semibold transition-colors duration-150',
                      on
                        ? 'bg-panel-raised text-parchment shadow-plate ring-1 ring-brass/60'
                        : 'text-muted hover:text-parchment',
                    )}
                    title={
                      s === mySeat
                        ? `View from ${SEAT_LABEL[seatName(s)]} (you)`
                        : `View from ${SEAT_LABEL[seatName(s)]}`
                    }
                    data-testid={`replay-view-${seatName(s)}`}
                  >
                    <SeatDot seat={s} className="!h-2 !w-2" />
                    <span className="truncate">{SEAT_LABEL[seatName(s)]}</span>
                    {s === mySeat ? <span className="sr-only">(you)</span> : null}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <p className="sr-only" role="status" aria-live="polite" data-testid="replay-announcer">
            {jumpNote}
          </p>
          <p
            className="hidden flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-faint sm:flex"
            aria-hidden="true"
          >
            <span className="inline-flex items-center gap-1">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> step
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Space</Kbd> play
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Home</Kbd>
              <Kbd>End</Kbd> jump
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>R</Kbd> turn the board
            </span>
          </p>
          {settingsOpen ? <BoardSettings id={settingsId} /> : null}
        </section>

        <section
          aria-label="Moves"
          className="order-4 flex h-72 flex-col rounded-panel border border-black/30 bg-black/20 pt-2.5 pb-1 shadow-well wide:order-none wide:h-auto wide:min-h-40 wide:flex-1"
        >
          <MoveLog
            items={items}
            names={names}
            currentStep={index}
            onSelect={(s) => step(s)}
            endReason={detail.endReason ?? undefined}
            className="flex-1"
          />
        </section>

        <section
          aria-label="Result"
          className="order-5 flex flex-col gap-1 text-ui text-muted wide:order-none"
          data-testid="replay-result"
        >
          <p className="text-parchment">{result || 'Finished'}</p>
          {sim.verified ? (
            <p
              className="flex items-start gap-1.5 text-caption text-faint"
              data-testid="replay-verified"
            >
              <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
              Replayed with the rules engine. It reaches the recorded final position.
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  )
}

type Load =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'ready'; detail: MatchDetailResponse; replay: MatchReplayResponse | null }

export function MatchReplay() {
  const { matchId = '' } = useParams()
  const { ready, error: rulesError } = useRulesReady()
  const [load, setLoad] = useState<Load>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    setLoad({ kind: 'loading' })
    ;(async () => {
      try {
        const detail = await api<MatchDetailResponse>(`/api/matches/${matchId}`)
        const replayable =
          detail.status === 'finished' && isSupportedRulesVersion(detail.rulesVersion)
        const replay = replayable
          ? await api<MatchReplayResponse>(`/api/matches/${matchId}/replay`)
          : null
        if (live) setLoad({ kind: 'ready', detail, replay })
      } catch (err) {
        if (!live) return
        setLoad({ kind: err instanceof ApiError && err.status === 404 ? 'not-found' : 'error' })
      }
    })()
    return () => {
      live = false
    }
  }, [matchId])

  const replay = load.kind === 'ready' ? load.replay : null
  const sim = useMemo(() => (ready && replay ? simulate(replay) : null), [ready, replay])

  if (load.kind === 'loading' || (replay && !sim && !rulesError)) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-muted" role="status">
        <Spinner /> Loading the replay…
      </div>
    )
  }
  if (load.kind === 'not-found' || load.kind === 'error') {
    return (
      <NoticePage
        title={load.kind === 'not-found' ? 'Game not found' : 'This game didn’t load'}
        emptyTitle={
          load.kind === 'not-found' ? 'Only its players can open a game' : 'Something went wrong'
        }
        action={
          <Link to="/history" className={linkButtonClass('primary')}>
            Back to match history
          </Link>
        }
      >
        {load.kind === 'not-found'
          ? 'Check the link, or open the game from your own match history.'
          : 'Check your connection and reload the page.'}
      </NoticePage>
    )
  }
  const { detail } = load
  if (replay && sim) return <Viewer detail={detail} replay={replay} sim={sim} />

  // Nothing to replay: an old 12×12 game, a cancelled game, or the engine didn't load.
  const message = rulesError
    ? 'The game engine could not be loaded. Reload the page to try again.'
    : !isSupportedRulesVersion(detail.rulesVersion)
      ? 'This game was played on the old 12×12 board and can’t be replayed.'
      : detail.status === 'aborted'
        ? 'This game was cancelled, so there is no replay.'
        : 'This game hasn’t finished yet.'
  const mine = detail.players.find((p) => p.isYou)
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:py-14">
      <header className="flex flex-col gap-2">
        <BackLink />
        <h1 className="font-display text-title font-semibold">Game details</h1>
        <MatchMeta detail={detail} />
      </header>
      <div data-testid="replay-unavailable">
        <Alert tone="info">{message}</Alert>
      </div>
      <SeatsAround
        detail={detail}
        perspective={mine?.seat ?? 0}
        plate={(p, pos) => (
          <PlayerPlate p={p} status={null} toMove={false} showPlace clock={null} pos={pos} />
        )}
      >
        {/* The table, without a board: how the game ended. */}
        <div className="flex aspect-square w-[min(100%,15rem)] items-center justify-center rounded-panel border-[6px] border-walnut bg-baize-deep p-5 text-center shadow-well">
          <p className="text-ui text-muted">
            {detail.endReason
              ? (END_REASON_LABEL[detail.endReason] ?? detail.endReason)
              : 'No result recorded'}
          </p>
        </div>
      </SeatsAround>
    </div>
  )
}
