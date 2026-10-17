import { BoardView } from '@game/board'
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
  RULES_VERSION,
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
import { GameButton } from '../components/game/GameButton.tsx'
import { ClockIcon, GearIcon } from '../components/game/icons.tsx'
import { Medal } from '../components/game/Medal.tsx'
import { MoveLog } from '../components/match/MoveLog.tsx'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import {
  END_REASON_LABEL,
  MODE_LABEL,
  ordinal,
  SEAT_LABEL,
  STATUS_LABEL,
  seatHex,
  seatName,
} from '../components/match/seats.ts'
import { Alert, Card, CenteredPage, Spinner } from '../components/ui.tsx'
import { ApiError, api } from '../lib/api.ts'
import { itemLabel, type LogStep, logItems } from '../lib/move-log.ts'
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

  useEffect(() => {
    const el = host.current
    if (!el) return
    const view = new BoardView({
      sound: usePrefs.getState().sound,
      colorblindPatterns: usePrefs.getState().colorblindPatterns,
      reducedMotion: usePrefs.getState().reducedMotion,
      // A replay is nobody's turn: no "Your move." lines.
      announceTurn: false,
    })
    viewRef.current = view
    if (import.meta.env.DEV) {
      // Development-only hook for scripted browser checks (never in production builds).
      ;(window as unknown as { __replayBoard?: unknown }).__replayBoard = {
        position: () => shown.current,
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
    if (viewGen === 0) return
    viewRef.current?.setPerspective(seatName(perspective), { animate: false })
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

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-parchment/15 bg-ink/40 px-2 text-[11px] font-medium text-parchment/70">
      {children}
    </span>
  )
}

function MatchChips({ detail }: { detail: MatchDetailResponse }) {
  const untimed = isUntimed(detail.timeControl)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip>{MODE_LABEL[detail.mode]}</Chip>
      <Chip>
        {untimed ? (
          'Untimed · vs bots'
        ) : (
          <>
            <ClockIcon /> {detail.timeControl}
          </>
        )}
      </Chip>
      {detail.ranked ? <RankedBadge /> : untimed ? null : <Chip>Casual</Chip>}
      <Chip>
        <time dateTime={detail.startedAt}>
          {new Date(detail.startedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
        </time>
      </Chip>
    </div>
  )
}

/** The players with their final places; dimmed (with their status) once out at this step. */
function Players({
  detail,
  statuses,
  showPlaces = true,
}: {
  detail: MatchDetailResponse
  statuses: readonly string[] | null
  /** Replay: places only at the end, so stepping through doesn't give the result away. */
  showPlaces?: boolean
}) {
  return (
    <section aria-label="Players">
      <ol className="grid grid-cols-2 gap-1.5 min-[560px]:grid-cols-4 wide:grid-cols-1 wide:gap-1">
        {[...detail.players]
          .sort((a, b) => a.seat - b.seat)
          .map((p) => {
            const status = statuses?.[p.seat] ?? 'active'
            const out = status !== 'active'
            return (
              <li
                key={p.seat}
                className={`flex min-w-0 items-center gap-2 rounded-xl border border-parchment/10 bg-ink/30 px-2.5 py-1.5 ${out ? 'opacity-60' : ''}`}
                data-testid={`replay-player-${seatName(p.seat)}`}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${seatHex(p.seat)}26`, color: seatHex(p.seat) }}
                >
                  <CivEmblem civ={p.civ} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {p.botLevel ? `${civName(p.civ)} bot` : p.name}
                    {p.isYou ? <span className="font-normal text-parchment/55"> (you)</span> : null}
                  </span>
                  <span className="block truncate text-[11px] text-parchment/55">
                    {SEAT_LABEL[seatName(p.seat)]}
                    {p.botLevel ? ` · ${p.botLevel === 'max' ? 'Max' : p.botLevel}` : ''}
                    {out ? ` · ${STATUS_LABEL[status] ?? status}` : ''}
                  </span>
                </span>
                {showPlaces ? (
                  <Medal
                    place={p.placement}
                    size="sm"
                    label={p.placement ? ordinal(p.placement) : undefined}
                  />
                ) : null}
              </li>
            )
          })}
      </ol>
    </section>
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
  const result = END_REASON_LABEL[detail.endReason ?? replay.endReason ?? ''] ?? ''
  const myPlace = me?.placement ?? null
  const ctl = 'w-10 !px-0'

  return (
    <div
      className={[
        'safe-bottom-6 mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-4 pt-3',
        'wide:grid wide:grid-cols-[auto_minmax(320px,360px)] wide:items-start wide:justify-center wide:gap-6 wide:py-4',
        // Phones: header 64 + title block 92 + controls 96 + gaps and padding 40.
        '[--board:max(min(100%,300px),min(100%,calc(100dvh_-_292px_-_var(--safe-top)_-_var(--safe-bottom))))]',
        'wide:[--board:min(calc(100vw_-_440px_-_var(--safe-left)_-_var(--safe-right)),calc(100dvh_-_96px_-_var(--safe-top)_-_var(--safe-bottom)))]',
      ].join(' ')}
      data-testid="replay"
      data-verified={sim.verified ? 'true' : 'false'}
    >
      <div className="order-2 flex min-w-0 justify-center wide:order-none">
        <ReplayBoard
          snapshot={snapshot}
          events={events}
          animate={forward}
          perspective={mySeat >= 0 ? mySeat : 0}
          localSeat={mySeat}
          positionString={ps}
        />
      </div>

      <aside
        aria-label="Replay"
        className="contents wide:sticky wide:top-4 wide:flex wide:h-[max(var(--board),min(34rem,calc(100dvh-96px)))] wide:flex-col wide:gap-3 wide:overflow-y-auto wide:rounded-2xl wide:border wide:border-parchment/10 wide:bg-panel/85 wide:p-4"
      >
        <header className="order-1 flex min-w-0 flex-col gap-2 wide:order-none">
          <Link
            to="/history"
            className="w-fit text-xs font-semibold text-gold underline-offset-2 hover:underline"
          >
            ← Match history
          </Link>
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <h1 className="font-display text-xl font-semibold">Replay</h1>
            <p className="shrink-0 text-xs text-parchment/60" data-testid="replay-outcome">
              {myPlace ? `You finished ${ordinal(myPlace)}` : 'Finished'}
            </p>
          </div>
          <MatchChips detail={detail} />
        </header>

        <section
          aria-label="Replay controls"
          className="order-3 flex flex-col gap-2 wide:order-none"
        >
          {sim.error || !sim.verified ? (
            <div data-testid="replay-mismatch">
              <Alert>
                This replay doesn’t reach the position the server recorded, so it may not show the
                game exactly as it was played.
              </Alert>
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <GameButton
              variant="ghost"
              className={ctl}
              onClick={() => step(-1)}
              disabled={index < 0}
              aria-label="First position"
              title="First position (Home)"
              data-testid="replay-first"
            >
              <ChevronFirst className="h-5 w-5" aria-hidden="true" />
            </GameButton>
            <GameButton
              variant="ghost"
              className={ctl}
              onClick={() => step(index - 1)}
              disabled={index < 0}
              aria-label="Previous move"
              title="Previous move (←)"
              data-testid="replay-prev"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </GameButton>
            <GameButton
              variant="primary"
              className="w-12 !px-0"
              onClick={togglePlay}
              disabled={total === 0}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              data-testid="replay-play"
            >
              {playing ? (
                <Pause className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Play className="h-5 w-5" aria-hidden="true" />
              )}
            </GameButton>
            <GameButton
              variant="ghost"
              className={ctl}
              onClick={() => step(index + 1)}
              disabled={atEnd}
              aria-label="Next move"
              title="Next move (→)"
              data-testid="replay-next"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </GameButton>
            <GameButton
              variant="ghost"
              className={ctl}
              onClick={() => step(last)}
              disabled={atEnd}
              aria-label="Last position"
              title="Last position (End)"
              data-testid="replay-last"
            >
              <ChevronLast className="h-5 w-5" aria-hidden="true" />
            </GameButton>
            <label htmlFor={speedId} className="sr-only">
              Speed
            </label>
            <select
              id={speedId}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}
              className="ml-auto h-10 rounded-lg border border-parchment/20 bg-ink/40 px-2 text-sm text-parchment"
              data-testid="replay-speed"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <GameButton
              variant="ghost"
              className={`${ctl} ${settingsOpen ? 'bg-parchment/[0.08] text-parchment' : ''}`}
              aria-label="Board settings"
              aria-expanded={settingsOpen}
              aria-controls={settingsId}
              onClick={() => setSettingsOpen((o) => !o)}
              title="Board settings"
            >
              <GearIcon className="h-[18px] w-[18px]" />
            </GameButton>
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
              className="shrink-0 text-xs tabular-nums text-parchment/65"
              data-testid="replay-position"
            >
              {index < 0 ? 'Start' : `${index + 1} / ${total}`}
            </span>
          </div>
          <p className="sr-only" role="status" aria-live="polite" data-testid="replay-announcer">
            {jumpNote}
          </p>
          <p className="hidden text-[11px] text-parchment/55 sm:block" aria-hidden="true">
            ← → step · Space play or pause · Home / End
          </p>
          {settingsOpen ? <BoardSettings id={settingsId} /> : null}
        </section>

        <div className="order-4 wide:order-none">
          <Players detail={detail} statuses={snapshot.statuses} showPlaces={atEnd} />
        </div>

        <section
          aria-label="Moves"
          className="order-5 flex h-72 flex-col rounded-xl border border-parchment/10 bg-ink/25 pt-2.5 pb-1 wide:order-none wide:h-auto wide:min-h-40 wide:flex-1"
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
          className="order-6 rounded-xl border border-parchment/10 bg-ink/25 px-3 py-2.5 text-xs text-parchment/70 wide:order-none"
          data-testid="replay-result"
        >
          <p>{result || 'Finished'}</p>
          {sim.verified ? (
            <p
              className="mt-1 flex items-center gap-1 text-parchment/55"
              data-testid="replay-verified"
            >
              <CircleCheck className="h-3.5 w-3.5 text-seat-east-light" aria-hidden="true" />
              Replayed with the rules engine; matches the recorded final position
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
        const replayable = detail.status === 'finished' && detail.rulesVersion === RULES_VERSION
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
      <CenteredPage>
        <div className="flex items-center justify-center gap-3 py-20 text-parchment/70">
          <Spinner /> Loading the replay…
        </div>
      </CenteredPage>
    )
  }
  if (load.kind === 'not-found' || load.kind === 'error') {
    return (
      <CenteredPage>
        <Card>
          <h1 className="mb-3 font-display text-2xl font-semibold">
            {load.kind === 'not-found' ? 'Game not found' : 'Couldn’t load this game'}
          </h1>
          <p className="mb-6 text-parchment/70">
            {load.kind === 'not-found'
              ? 'Only the players of a game can see its replay.'
              : 'Please try again later.'}
          </p>
          <Link className="font-semibold text-gold hover:underline" to="/history">
            Back to match history
          </Link>
        </Card>
      </CenteredPage>
    )
  }
  const { detail } = load
  if (replay && sim) return <Viewer detail={detail} replay={replay} sim={sim} />

  // Nothing to replay: an old 12×12 game, a cancelled game, or the engine didn't load.
  const message = rulesError
    ? 'The game engine could not be loaded. Reload the page to try again.'
    : detail.rulesVersion !== RULES_VERSION
      ? 'This game was played on the old 12×12 board and can’t be replayed.'
      : detail.status === 'aborted'
        ? 'This game was cancelled, so there is no replay.'
        : 'This game hasn’t finished yet.'
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <Link
        to="/history"
        className="text-xs font-semibold text-gold underline-offset-2 hover:underline"
      >
        ← Match history
      </Link>
      <h1 className="mt-2 mb-3 font-display text-3xl font-semibold tracking-tight">Game details</h1>
      <MatchChips detail={detail} />
      <div className="mt-5" data-testid="replay-unavailable">
        <Alert tone="info">{message}</Alert>
      </div>
      <div className="mt-5">
        <Players detail={detail} statuses={null} />
      </div>
      {detail.endReason ? (
        <p className="mt-4 text-sm text-parchment/65">
          {END_REASON_LABEL[detail.endReason] ?? detail.endReason}
        </p>
      ) : null}
    </div>
  )
}
