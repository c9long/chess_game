import { BOARD_CANVAS_MARGIN, BoardView } from '@game/board'
import { isUntimed, REMATCH_VOTE, SOLO_DEFAULT_NAME } from '@game/protocol'
import {
  Game,
  type GameConfig,
  type GameEvent,
  type Piece,
  type Snapshot,
  squareIndex,
} from '@game/rules'
import { Eye } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import {
  type CSSProperties,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  actionFromEvents,
  type CheckAction,
  type CheckMemo,
  type CheckNotice,
  checkDetail,
  INITIAL_CHECK,
  nextCheck,
} from '../../lib/check-indicator.ts'
import { type FeedbackEvent, feedback, feedbackFor } from '../../lib/feedback.ts'
import { useLiveMoveLog } from '../../lib/live-move-log.ts'
import { leaveMatch, type MatchRoom, matchApi, reconnectGraceMs } from '../../lib/match.ts'
import { lostMaterial, type SeatMaterial } from '../../lib/material.ts'
import { useMediaQuery } from '../../lib/media.ts'
import { usePrefs } from '../../lib/prefs.ts'
import { useRulesReady } from '../../lib/rules.ts'
import { useWakeLock } from '../../lib/wake-lock.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { BoardSettings, KeyboardHints } from '../game/BoardSettings.tsx'
import { GameButton } from '../game/GameButton.tsx'
import { ExitIcon, GearIcon } from '../game/icons.tsx'
import { type PlateEdge, PlayerPlate, seatTitle } from '../game/PlayerCard.tsx'
import { SELF_CHECK_TEXT, TurnBanner } from '../game/TurnBanner.tsx'
import { ConfirmDialog } from '../overlay.tsx'
import { useSeatFriendActions } from '../social/SeatFriendButton.tsx'
import { Alert, cx, Pill, Spinner } from '../ui.tsx'
import { DrawOfferCard, GameActions, TeamResignCard } from './GameActions.tsx'
import { GameOver } from './GameOver.tsx'
import { defeatReasonLabel } from './labels.ts'
import { MoveLogPanel, useLiveLogItems } from './MoveLog.tsx'
import { RankedBadge } from './RankedBadge.tsx'
import { rematchNotice } from './Rematch.tsx'
import { SpectatorCount, WatchLinkButton } from './Spectators.tsx'
import { MODE_LABEL, seatHex, seatName, teamLabel } from './seats.ts'

interface Position {
  snapshot: Snapshot
  legal: ReturnType<Game['legalMoves']>
}

function readPosition(positionString: string, legalFor: number): Position | null {
  if (!positionString) return null
  const game = Game.fromPosition(positionString)
  try {
    const snapshot = game.snapshot()
    const toMove = ['south', 'west', 'north', 'east'].indexOf(snapshot.seatToMove)
    const legal = !snapshot.isOver && toMove === legalFor ? game.legalMoves() : []
    return { snapshot, legal }
  } finally {
    game.free()
  }
}

/** Starting positions by game config, from the engine (so they follow future civ rosters). */
const startSnapshots = new Map<string, Snapshot>()

function startSnapshot(config: GameConfig): Snapshot {
  const key = JSON.stringify(config)
  let snapshot = startSnapshots.get(key)
  if (!snapshot) {
    const game = Game.create(config)
    try {
      snapshot = game.snapshot()
    } finally {
      game.free()
    }
    startSnapshots.set(key, snapshot)
  }
  return snapshot
}

function startBoard(config: GameConfig): readonly (Piece | null)[] {
  return startSnapshot(config).board
}

/**
 * What the side panel needs from the engine: draw voters, how each seat was knocked out, and
 * the pieces each seat has lost (start board vs current board, both from engine snapshots).
 */
interface SeatInfo {
  voters: readonly boolean[]
  defeatReasons: (string | null)[]
  /** Display text per defeat (names the leader kind for a seat that started with several). */
  defeatLabels: (string | null)[]
  material: SeatMaterial[] | null
}

function readSeatInfo(positionString: string): SeatInfo | null {
  if (!positionString) return null
  const game = Game.fromPosition(positionString)
  try {
    const snapshot = game.snapshot()
    let material: SeatMaterial[] | null = null
    try {
      material = lostMaterial(startBoard(snapshot.config), snapshot.board)
    } catch {
      material = null
    }
    const defeatReasons = (['south', 'west', 'north', 'east'] as const).map(
      (seat) => snapshot.defeats.find((d) => d.seat === seat)?.reason ?? null,
    )
    let defeatLabels: (string | null)[]
    try {
      const start = startSnapshot(snapshot.config)
      defeatLabels = defeatReasons.map((r, i) => {
        const first = start.leaderSquares[i]?.[0]
        const kind = first ? (start.board[squareIndex(first)]?.kind ?? null) : null
        return r ? defeatReasonLabel(r, kind, start.leaderSquares[i]?.length ?? 1) : null
      })
    } catch {
      defeatLabels = defeatReasons.map((r) => (r ? defeatReasonLabel(r, null, 1) : null))
    }
    return { voters: game.drawVoters(), defeatReasons, defeatLabels, material }
  } finally {
    game.free()
  }
}

const SEAT_INDEX = { south: 0, west: 1, north: 2, east: 3 } as const

/**
 * The position the board shows: the latest `events` message when it is at least as new as the
 * room state (its rules events make the animation exact, and it names the action that led
 * there), else the state's position (whose action comes from the state's own `lastEvents`).
 * `seatToMove` belongs to that same position, so everything keyed on it (the turn banner, the
 * check indicator, the board) changes together.
 */
function shownPosition(feed: MatchFeed): {
  ps: string
  events: readonly GameEvent[] | undefined
  action: CheckAction | null
  seatToMove: number
} {
  const { state, lastEvents } = feed
  if (lastEvents && lastEvents.seq >= state.actionSeq) {
    return {
      ps: lastEvents.positionString,
      events: lastEvents.events,
      action: { seat: lastEvents.seat, action: lastEvents.action },
      seatToMove: lastEvents.seatToMove,
    }
  }
  return {
    ps: state.positionString,
    events: undefined,
    action: actionFromEvents(state.lastEvents),
    seatToMove: state.seatToMove,
  }
}

/**
 * The check indicator for the viewer's own seat (see `lib/check-indicator.ts` for the rule).
 * Whether a leader is attacked comes from the engine's snapshot; the memo carries a self-check
 * across positions. Keyed on the position, so a re-render (or a StrictMode double render) of
 * the same position returns the same answer.
 */
function useCheckNotice(
  ready: boolean,
  ps: string,
  actionSeat: number | null,
  actionKind: string | null,
  mySeat: number,
): { notice: CheckNotice; detail: string | null } {
  const memo = useRef<{
    key: string
    memo: CheckMemo
    notice: CheckNotice
    detail: string | null
  }>({
    key: '',
    memo: INITIAL_CHECK,
    notice: 'none',
    detail: null,
  })
  return useMemo(() => {
    if (!ready || !ps || mySeat < 0) return { notice: 'none', detail: null }
    const key = `${mySeat}|${ps}`
    const m = memo.current
    if (m.key === key) return { notice: m.notice, detail: m.detail }
    const game = Game.fromPosition(ps)
    let snapshot: Snapshot
    try {
      snapshot = game.snapshot()
    } finally {
      game.free()
    }
    const action =
      actionSeat !== null && actionKind !== null ? { seat: actionSeat, action: actionKind } : null
    const out = nextCheck(
      m.key.startsWith(`${mySeat}|`) ? m.memo : INITIAL_CHECK,
      mySeat,
      {
        ply: snapshot.ply,
        seatToMove: SEAT_INDEX[snapshot.seatToMove],
        isOver: snapshot.isOver,
        leaderUnderAttack: snapshot.leaderUnderAttack,
      },
      action,
    )
    // Several leaders (England's Prime Ministers): which ones, for screen readers.
    const detail = out.notice === 'none' ? null : checkDetail(snapshot, mySeat)
    memo.current = { key, memo: out.memo, notice: out.notice, detail }
    return { notice: out.notice, detail }
  }, [ready, ps, actionSeat, actionKind, mySeat])
}

/** Mounts the PixiJS board and keeps it in sync with the server's position. */
function Board({
  room,
  feed,
  check,
  onFinalMoves,
}: {
  room: MatchRoom
  feed: MatchFeed
  /** The viewer's check indicator (from `useCheckNotice`). */
  check: CheckNotice
  /** The board's last announcement once the game is over (repeated in the result dialog). */
  onFinalMoves: (text: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<BoardView | null>(null)
  // Bumped each time a BoardView finishes mounting, so a re-created view (the mount effect
  // ran again) always gets the current perspective and snapshot.
  const [viewGen, setViewGen] = useState(0)
  const appliedRef = useRef<string>('')
  const prefs = usePrefs()
  const send = useMemo(() => matchApi(room).send, [room])
  const { state, mySeat } = feed
  // The keyboard hint shows once, the first time the board gets keyboard focus.
  const [hint, setHint] = useState<'idle' | 'shown' | 'done'>('idle')
  const frame = useRef<HTMLDivElement>(null)
  const finalMoves = useRef(onFinalMoves)
  finalMoves.current = onFinalMoves

  useEffect(() => {
    const el = frame.current
    if (!el || hint !== 'idle') return
    const onFocus = (e: FocusEvent) => {
      // Pointer clicks focus the canvas too; only a keyboard user needs the hint.
      if (e.target instanceof HTMLCanvasElement && e.target.matches(':focus-visible')) {
        setHint('shown')
      }
    }
    el.addEventListener('focusin', onFocus)
    return () => el.removeEventListener('focusin', onFocus)
  }, [hint])

  useEffect(() => {
    if (hint !== 'shown') return
    const t = window.setTimeout(() => setHint('done'), 4000)
    return () => window.clearTimeout(t)
  }, [hint])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const view = new BoardView({
      onMoveIntent: (move) => send('move', { move }),
      sound: usePrefs.getState().sound,
      colorblindPatterns: usePrefs.getState().colorblindPatterns,
      reducedMotion: usePrefs.getState().reducedMotion,
      announceVerbosity: usePrefs.getState().announceMoves,
      // A check made while it isn't the viewer's turn waits for their turn ("Your move. Check:
      // ..."), and the check announcer says a self-check (docs/RULES.md "Check indicators").
      announceOwnCheck: false,
      onAnnounce: (text) => {
        if (view.isOver) finalMoves.current(text)
      },
    })
    viewRef.current = view
    if (import.meta.env.DEV) {
      // Development-only hook for scripted browser checks (never in production builds).
      ;(window as unknown as { __board?: unknown }).__board = {
        squareToClient: (sq: string) => {
          const p = view.squareToClient(sq as never)
          const rect = view.canvas?.getBoundingClientRect()
          return p && rect ? { x: rect.left + p.x, y: rect.top + p.y } : null
        },
        position: () => appliedRef.current,
        checkSquares: () => view.checkSquares,
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
      appliedRef.current = ''
      view.destroy()
    }
  }, [send])

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

  useEffect(() => {
    if (viewGen === 0) return
    viewRef.current?.setPerspective(seatName(mySeat >= 0 ? mySeat : 0), { animate: false })
    // Announcements say "You" for the viewer's own seat.
    viewRef.current?.setLocalSeat(mySeat >= 0 ? seatName(mySeat) : null)
  }, [viewGen, mySeat])

  // Follow the authoritative position. The `events` message carries the rules events that
  // make animations exact; a state patch alone (e.g. after a reconnect) still animates by diff.
  const { ps, events } = shownPosition(feed)
  useEffect(() => {
    const view = viewRef.current
    if (viewGen === 0 || !view || !ps) return
    const pos = readPosition(ps, mySeat)
    if (!pos) return
    const first = appliedRef.current === ''
    const changed = appliedRef.current !== ps
    appliedRef.current = ps
    if (changed) view.setSnapshot(pos.snapshot, { animate: !first, ...(events ? { events } : {}) })
    const myTurn =
      mySeat >= 0 &&
      state.phase === 'in_game' &&
      !pos.snapshot.isOver &&
      pos.snapshot.seatToMove === seatName(mySeat)
    view.setInteractive(myTurn ? seatName(mySeat) : null)
    view.setLegalMoves(myTurn ? pos.legal : [])
  }, [viewGen, ps, events, mySeat, state.phase])

  // The check indicator on the viewer's leader square(s). After the position above, so the
  // board times it (and its sound) after the move that caused it.
  useEffect(() => {
    if (viewGen === 0) return
    viewRef.current?.setCheck(check !== 'none' && mySeat >= 0 ? seatName(mySeat) : null)
  }, [viewGen, check, mySeat])

  // A refused move: put the board back on the current position (the piece slides home).
  useEffect(() => {
    const off = room.onMessage('error', (e: { code: string; requestType?: string }) => {
      if (e.requestType !== 'move' || !appliedRef.current) return
      const pos = readPosition(appliedRef.current, mySeat)
      if (pos) viewRef.current?.setSnapshot(pos.snapshot, { animate: true })
    })
    return off
  }, [room, mySeat])

  return (
    <div
      // Fills its cell of the table, which GameRoom sizes to the viewport (`--board`).
      className="relative aspect-square w-full"
      data-testid="board"
      ref={frame}
    >
      <div ref={host} className="absolute inset-0" />
      {viewGen > 0 ? null : (
        <div className="absolute inset-0 flex items-center justify-center gap-3 text-ui text-muted">
          <Spinner /> Setting up the board…
        </div>
      )}
      {hint === 'shown' ? (
        // Visual only: the board's own focus announcement already says how to play.
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3"
          aria-hidden="true"
        >
          <span className="rounded-full border border-rule-brass bg-baize-deep/95 px-3 py-1.5 text-caption text-muted shadow-lift">
            <KeyboardHints compact />
          </span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Haptic feedback (lib/feedback.ts) at the moments the board plays its sounds: a move or
 * capture, check on you, your turn, and the end of the game. Nothing on the first position
 * shown (joining or rejoining isn't news).
 */
function useGameFeedback(input: {
  ready: boolean
  ps: string
  events: readonly FeedbackEvent[] | undefined
  mySeat: number
  myTurn: boolean
  check: CheckNotice
  finished: boolean
}) {
  const { ready, ps, events, mySeat, myTurn, check, finished } = input
  const prev = useRef<{ ps: string; myTurn: boolean; check: CheckNotice; finished: boolean }>(null)
  // The end arrives twice (the final move's events, then the finished phase): feel it once.
  const endFelt = useRef(false)
  useEffect(() => {
    if (!ready || !ps) return
    const p = prev.current
    prev.current = { ps, myTurn, check, finished }
    if (!p) {
      endFelt.current = finished
      return
    }
    const kind = feedbackFor({
      events: p.ps !== ps ? events : undefined,
      mySeat,
      yourTurn: myTurn && !p.myTurn,
      check: check === 'check' && p.check !== 'check',
      ended: finished && !p.finished,
    })
    if (!kind || (kind === 'gameEnd' && endFelt.current)) return
    if (kind === 'gameEnd') endFelt.current = true
    feedback(kind)
  }, [ready, ps, events, mySeat, myTurn, check, finished])
}

const LEAVE_HINT_KEY = 'hint:leave-forfeit:dismissed'

/** "60 s", "90 s", "3 min": the server's reconnect grace for the hint. */
function graceLabel(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`
}

function leaveHintDismissed(): boolean {
  try {
    return localStorage.getItem(LEAVE_HINT_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Phones and tablets, while playing: switching apps for longer than the server's reconnect
 * grace forfeits the seat. Dismissible; remembered on this device.
 */
function LeaveHint({
  show,
  graceMs,
  className,
}: {
  show: boolean
  graceMs: number
  className?: string | undefined
}) {
  const touch = useMediaQuery('(pointer: coarse)')
  const [dismissed, setDismissed] = useState(leaveHintDismissed)
  if (!show || !touch || dismissed) return null
  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-control border border-rule bg-black/15 py-1.5 pr-1.5 pl-3 text-caption text-muted',
        className,
      )}
      data-testid="leave-hint"
      data-after-actions
    >
      <span className="min-w-0 flex-1">
        Leaving the app for more than {graceLabel(graceMs)} forfeits
      </span>
      <button
        type="button"
        className="flex h-8 shrink-0 items-center rounded-control px-2.5 font-semibold text-parchment/85 hover:bg-parchment/5 hover:text-parchment"
        onClick={() => {
          setDismissed(true)
          try {
            localStorage.setItem(LEAVE_HINT_KEY, '1')
          } catch {}
        }}
        aria-label="Dismiss the hint about leaving the app"
      >
        Got it
      </button>
    </div>
  )
}

/** While it's your move and the tab is in the background, say so in the tab title. */
function useTurnTitle(myTurn: boolean) {
  useEffect(() => {
    const PREFIX = '● Your move – '
    const strip = () => {
      if (document.title.startsWith(PREFIX)) document.title = document.title.slice(PREFIX.length)
    }
    const update = () => {
      if (myTurn && document.hidden) {
        if (!document.title.startsWith(PREFIX)) document.title = PREFIX + document.title
      } else strip()
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      strip()
    }
  }, [myTurn])
}

/**
 * How the game screen is laid out, by viewport:
 * - `phone` and `tablet` (portrait): the board full width, a plate above each top corner and
 *   below each bottom corner, the actions under it. Tablets put the title beside the banner.
 * - `desk`: the same corners around the board, with the side panel beside it.
 * - `table`: wide screens, where height is what limits the board: the same four corners, but
 *   with slim upright plates beside the board instead of rows above and below it, so the board
 *   takes the full height.
 * - `side`: phones held sideways. The board takes the full height and the plates sit in the
 *   side panel, in the same corners as on a phone.
 * Corners, from the viewer's seat: West top left, North top right, East bottom right and the
 * viewer bottom left: each plate at the clockwise end of its own edge, so turn order runs
 * clockwise around the board.
 */
type Layout = 'phone' | 'tablet' | 'desk' | 'table' | 'side'

function subscribeResize(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/** The slim upright plates beside the board (`table`) and their gap to it, px. */
const PLATE_W = 112
const PLATE_GAP = 8

/**
 * What each layout keeps off the board, px across (`x`) and down (`y`): the header, padding and
 * gaps; the plate rows above and below the board (phone, tablet, desk); the side panel and its
 * gutters (wide layouts); and on phones, tablets and sideways phones the canvas's overhang
 * (below). `table` trades desk's two plate rows for the upright plates' width.
 */
const BUDGET = {
  phone: { y: 340 },
  tablet: { y: 308 },
  desk: { x: 392, y: 196 },
  table: { x: 392 + 2 * (PLATE_W + PLATE_GAP), y: 88 },
  side: { x: 328, y: 88 },
} as const

/**
 * The board's size per layout (`--board`), from `BUDGET` and the safe-area insets. Phones and
 * tablets use 100% (the page may show a scrollbar); wide layouts use the viewport, as nothing on
 * them scrolls. On phones, tablets and sideways phones the canvas is 16px larger than this and
 * overhangs the page gutter by 8px a side, so its transparent margin sits in the gutter and the
 * walnut frame lines up with the plates.
 */
const SAFE_Y = 'var(--safe-top) - var(--safe-bottom)'
const SAFE_X = 'var(--safe-left) - var(--safe-right)'
const fitWide = ({ x, y }: { x: number; y: number }) =>
  `min(calc(100vw - ${x}px - ${SAFE_X}), calc(100dvh - ${y}px - ${SAFE_Y}))`
const fitTall = (y: number) => `max(min(100%, 300px), min(100%, calc(100dvh - ${y}px - ${SAFE_Y})))`
const BOARD_SIZE: Record<Layout, string> = {
  phone: fitTall(BUDGET.phone.y),
  tablet: fitTall(BUDGET.tablet.y),
  desk: fitWide(BUDGET.desk),
  table: fitWide(BUDGET.table),
  side: `max(240px, ${fitWide(BUDGET.side)})`,
}

/**
 * Upright plates beside the board win whenever they make it larger than desk's plate rows do, as
 * long as the board is tall enough for two of them, one above the other (shorter wide screens
 * keep the rows). The same sums as `BOARD_SIZE`, safe-area insets included, so the two agree.
 */
const TABLE_MIN_BOARD = 420
let tableCache = { w: -1, h: -1, fits: false }
function tableFits(): boolean {
  const w = window.innerWidth
  const h = window.innerHeight
  if (w !== tableCache.w || h !== tableCache.h) {
    const safe = safeInsets()
    const room = ({ x, y }: { x: number; y: number }) => Math.min(w - x - safe.x, h - y - safe.y)
    const table = room(BUDGET.table)
    tableCache = { w, h, fits: table >= TABLE_MIN_BOARD && table > room(BUDGET.desk) }
  }
  return tableCache.fits
}

/** The safe-area insets across and down, px, read through the same `--safe-*` variables. */
function safeInsets(): { x: number; y: number } {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)'
  document.body.append(probe)
  const s = getComputedStyle(probe)
  const px = (v: string) => Number.parseFloat(v) || 0
  const out = {
    x: px(s.paddingLeft) + px(s.paddingRight),
    y: px(s.paddingTop) + px(s.paddingBottom),
  }
  probe.remove()
  return out
}

function useGameLayout(): Layout {
  // `side` is the landscape half of the `wide:` variant (index.css); `desk` the other half.
  const side = useMediaQuery(
    '(orientation: landscape) and (max-height: 31.99rem) and (min-width: 40rem)',
  )
  const desk = useMediaQuery('(min-width: 64rem)')
  const tablet = useMediaQuery('(min-width: 35rem)')
  const table = useSyncExternalStore(subscribeResize, tableFits, () => false)
  if (side) return 'side'
  if (desk) return table ? 'table' : 'desk'
  return tablet ? 'tablet' : 'phone'
}

type PlatePosition = 'bottom' | 'left' | 'top' | 'right'
/** Seat positions relative to the viewer's seat (index 0 is the viewer, then clockwise). */
const POSITIONS: readonly PlatePosition[] = ['bottom', 'left', 'top', 'right']

const CORNER_AREA: Record<PlatePosition, string> = {
  left: '[grid-area:tl]',
  top: '[grid-area:tr]',
  bottom: '[grid-area:bl]',
  right: '[grid-area:br]',
}

/** Table plates: the edge their seat colour runs along, and their popover side. */
const TABLE_EDGE: Record<PlatePosition, PlateEdge> = {
  left: 'right',
  top: 'top',
  bottom: 'bottom',
  right: 'left',
}
const TABLE_SIDE: Record<PlatePosition, 'top' | 'bottom' | 'left'> = {
  left: 'bottom',
  top: 'left',
  bottom: 'top',
  right: 'left',
}

/** Row plates move toward the board to hug the walnut frame (the canvas has a margin round it). */
const ROW_HUG: Partial<Record<Layout, { upper: string; lower: string }>> = {
  phone: { upper: 'translate-y-1', lower: '-translate-y-1' },
  tablet: { upper: 'translate-y-1', lower: '-translate-y-1' },
  desk: { upper: 'translate-y-2', lower: '-translate-y-2' },
}

/** Where a seat's plate goes, which edge its seat colour runs along, and its popover side. */
function placement(
  layout: Layout,
  pos: PlatePosition,
): {
  className: string
  edge: PlateEdge
  side: 'top' | 'bottom' | 'left'
  shape: 'row' | 'column'
} {
  const upper = pos === 'left' || pos === 'top'
  if (layout === 'table') {
    // Upright plates in the board's corners, lined up with the frame's outer edge. West and
    // East face the board with their seat colour; North and South carry theirs along the edge
    // they share with the board's top or bottom, in line with that seat's banner. Each is at
    // most half the board tall, so the two in a column can never overlap.
    const leftSide = pos === 'left' || pos === 'bottom'
    return {
      className: cx(
        CORNER_AREA[pos],
        'min-h-0 max-h-[calc(var(--board)/2-var(--board-inset))]',
        upper ? 'mt-[var(--board-inset)] self-start' : 'mb-[var(--board-inset)] self-end',
        leftSide ? 'translate-x-[var(--board-inset)]' : '-translate-x-[var(--board-inset)]',
      ),
      edge: TABLE_EDGE[pos],
      side: TABLE_SIDE[pos],
      shape: 'column',
    }
  }
  const hug = ROW_HUG[layout]
  return {
    className: cx(CORNER_AREA[pos], hug && (upper ? hug.upper : hug.lower)),
    edge: upper ? 'bottom' : 'top',
    side: layout === 'side' ? 'left' : upper ? 'bottom' : 'top',
    shape: 'row',
  }
}

export function GameRoom({
  room,
  feed,
  spectator = false,
  onLeave,
}: {
  room: MatchRoom
  feed: MatchFeed
  /** Watching (a watch room): read-only, no game actions, no rematch. */
  spectator?: boolean
  /** Spectators: what "Stop watching" does (the page leaves the watch room on unmount). */
  onLeave?: () => void
}) {
  const navigate = useNavigate()
  // The match room's id (the page's `/match/:roomId` or `/watch/:roomId`; a spectator's
  // `room` is the watch room), for the shareable watch link.
  const matchRoomId = useParams().roomId ?? room.roomId
  const { ready, error } = useRulesReady()
  const prefs = usePrefs()
  const systemReduced = useReducedMotion()
  const reduceMotion = Boolean(systemReduced) || prefs.reducedMotion
  const [showResult, setShowResult] = useState(true)
  const [finalMoves, setFinalMoves] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const leaveButton = useRef<HTMLButtonElement>(null)
  const settingsId = useId()
  const layout = useGameLayout()
  const { state, mySeat } = feed
  const finished = state.phase === 'finished'
  const inGame = state.phase === 'in_game'
  const untimed = isUntimed(state.timeControl)
  const shown = shownPosition(feed)
  // The turn as of the position the board shows (an `events` message can be ahead of the
  // state patch), so the banner, the check indicator and the board agree.
  const seatToMove = shown.seatToMove
  const myTurn = inGame && mySeat >= 0 && seatToMove === mySeat
  const seatInfo = useMemo(
    () => (ready ? readSeatInfo(state.positionString) : null),
    [ready, state.positionString],
  )
  const stillPlaying = mySeat >= 0 && seatInfo?.voters[mySeat] === true
  // Spectators get no friend or report buttons (those are for people who played together).
  const friendAction = useSeatFriendActions(state, untimed || spectator)
  const logItems = useLiveLogItems(useLiveMoveLog(room), ready)
  const logNames = useMemo(
    () => state.seats.map((seat, i) => (i === mySeat ? 'You' : seatTitle(seat))),
    [state.seats, mySeat],
  )
  const { notice: check, detail: checkLeaders } = useCheckNotice(
    ready,
    shown.ps,
    shown.action?.seat ?? null,
    shown.action?.action ?? null,
    mySeat,
  )
  useTurnTitle(myTurn)
  useGameFeedback({
    ready,
    ps: shown.ps,
    events: shown.events ?? state.lastEvents,
    mySeat,
    myTurn,
    check,
    finished,
  })
  // Keep the screen on while the game is live (released when it ends or the page closes).
  useWakeLock(inGame)

  // The lobby's Start button sits below the fold: open the game at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Rematch: toasts for what happens, the result dialog back up when someone proposes, and
  // off to the new lobby once it exists (for the players who accepted).
  const notify = feed.notify
  const seatsRef = useRef(state.seats)
  seatsRef.current = state.seats
  useEffect(() => {
    if (spectator) return
    return matchApi(room).on('rematchEvent', (e) => {
      const text = rematchNotice(e, seatsRef.current, mySeat)
      if (text) notify(text, e.type === 'cancelled' ? 'error' : 'info')
      if (e.type === 'proposed' && e.seat !== mySeat) setShowResult(true)
    })
  }, [room, spectator, mySeat, notify])
  const rematchRoomId = state.rematchRoomId
  const iAccepted = mySeat >= 0 && state.rematchVotes?.[mySeat] === REMATCH_VOTE.accepted
  useEffect(() => {
    if (!spectator && rematchRoomId && iAccepted) navigate(`/match/${rematchRoomId}`)
  }, [spectator, rematchRoomId, iAccepted, navigate])

  async function leaveNow() {
    if (spectator) {
      if (onLeave) onLeave()
      else navigate('/play')
      return
    }
    navigate('/play')
    await leaveMatch()
  }

  /** The finished game's replay: leaves the room (like "Back to lobbies") and opens it. */
  async function watchReplay(matchId: string) {
    navigate(`/history/${matchId}`)
    await leaveMatch()
  }

  /** Leaving a game you are still playing knocks your seat out: confirm that first. */
  function leave() {
    if (!finished && stillPlaying) setConfirmLeave(true)
    else void leaveNow()
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert>The game engine could not be loaded. Reload the page to try again.</Alert>
      </div>
    )
  }

  const leaveLabel = spectator
    ? 'Stop watching'
    : finished
      ? untimed
        ? 'Back to Play'
        : 'Back to lobbies'
      : 'Leave game'
  const wide = layout !== 'phone' && layout !== 'tablet'
  const panel = layout === 'desk' || layout === 'table'
  const moreButtons = (
    // Phones and tablets: two more cells of the action row. Wide: a row of its own.
    <div className="contents wide:col-span-2 wide:flex wide:gap-2">
      <GameButton
        variant="ghost"
        ref={leaveButton}
        className="w-full wide:flex-1"
        onClick={leave}
        aria-label={leaveLabel}
      >
        <ExitIcon className="h-4 w-4 shrink-0 opacity-70" />
        <span className="truncate">
          {finished || spectator ? (
            leaveLabel
          ) : (
            <>
              <span className="wide:hidden">Leave</span>
              <span className="hidden wide:inline">Leave game</span>
            </>
          )}
        </span>
      </GameButton>
      <GameButton
        variant="ghost"
        className={cx('w-10 !px-0', settingsOpen && 'bg-parchment/[0.08] text-parchment')}
        aria-label="Board settings"
        aria-expanded={settingsOpen}
        aria-controls={settingsId}
        onClick={() => setSettingsOpen((o) => !o)}
        title="Board settings"
      >
        <GearIcon className="h-[18px] w-[18px]" />
      </GameButton>
    </div>
  )

  // The winner's plate lights up once the game is over (not for a shared first place).
  const finalPlaces = feed.gameOver?.placements ?? state.result.placements
  const firsts = finalPlaces.flatMap((p, i) => (p === 1 ? [i] : []))
  const soleWinner = state.result.type !== 'aborted' && firsts.length === 1 ? firsts[0] : -1
  // The viewer's seat sits at the bottom (spectators see the board from South).
  const viewer = mySeat >= 0 ? mySeat : 0
  const plates = [0, 1, 2, 3].map((i) => {
    const seat = state.seats[i]
    if (!seat) return null
    const place = placement(layout, POSITIONS[(i - viewer + 4) % 4] ?? 'bottom')
    return (
      <PlayerPlate
        key={i}
        index={i}
        seat={seat}
        me={i === mySeat}
        toMove={inGame && seatToMove === i}
        inGame={inGame}
        timed={!untimed}
        clock={feed.clock}
        defeatReason={seatInfo?.defeatReasons[i] ?? null}
        material={seatInfo?.material?.[i] ?? null}
        reduceMotion={reduceMotion}
        friendAction={friendAction(i, true)}
        inCheck={i === mySeat && inGame && check !== 'none'}
        won={finished && soleWinner === i}
        place={finished && state.result.type !== 'aborted' ? (finalPlaces[i] ?? null) : null}
        partner={state.mode === 'teams' && mySeat >= 0 && i === (mySeat + 2) % 4}
        edge={place.edge}
        shape={place.shape}
        size={panel ? 'full' : 'compact'}
        popoverSide={place.side}
        className={place.className}
      />
    )
  })
  const players = (
    <ol
      aria-label="Players"
      className={
        layout === 'side'
          ? 'grid grid-cols-2 gap-1.5 [grid-template-areas:"tl_tr"_"bl_br"]'
          : 'contents'
      }
    >
      {plates}
    </ol>
  )

  const board = ready ? (
    <Board room={room} feed={feed} check={check} onFinalMoves={setFinalMoves} />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center gap-3 text-ui text-muted">
      <Spinner /> Loading the game engine…
    </div>
  )

  const modeLine = `${MODE_LABEL[state.mode]}, ${untimed ? 'untimed' : state.timeControl}`
  // A solo game's default name speaks to its player; someone watching sees whose game it is.
  const host = state.seats.find((s) => s.occupied && !s.isBot)
  const title =
    spectator && state.name === SOLO_DEFAULT_NAME && host
      ? `${host.displayName} vs bots`
      : state.name

  return (
    <div
      className={cx(
        'mx-auto w-full max-w-[1500px] px-4',
        // Bottom padding clears a phone's home indicator (there is no footer on this page).
        !wide && 'safe-bottom-6 flex flex-col gap-2 pt-2',
        panel && 'grid grid-cols-[auto_336px] items-start justify-center gap-6 py-3',
        layout === 'side' &&
          'grid grid-cols-[auto_minmax(280px,26rem)] items-start justify-center gap-4 py-2',
      )}
      style={
        {
          '--board': BOARD_SIZE[layout],
          '--board-inset': `calc(var(--board) * ${BOARD_CANVAS_MARGIN})`,
          '--plate-w': `${PLATE_W}px`,
          '--plate-gap': `${PLATE_GAP}px`,
        } as CSSProperties
      }
      data-layout={layout}
    >
      {/* The table: the board, with each player's plate at its edge. */}
      {layout === 'side' ? (
        <div className="-m-2 w-[calc(var(--board)+16px)]">{board}</div>
      ) : (
        <div className={cx('flex min-w-0 justify-center', !wide && 'order-3')}>
          <div
            className={cx(
              'grid gap-y-1.5',
              layout === 'table'
                ? 'grid-cols-[var(--plate-w)_var(--board)_var(--plate-w)] grid-rows-2 gap-x-[var(--plate-gap)] [grid-template-areas:"tl_c_tr"_"bl_c_br"]'
                : 'w-[var(--board)] grid-cols-2 gap-x-2 [grid-template-areas:"tl_tr"_"c_c"_"bl_br"]',
            )}
          >
            <div className={cx('min-w-0 [grid-area:c]', !wide && '-mx-2')}>{board}</div>
            {players}
          </div>
        </div>
      )}

      <aside
        aria-label="Game"
        className={cx(
          !wide && 'contents',
          wide &&
            'sticky flex min-w-0 flex-col overflow-y-auto rounded-panel border border-rule-brass bg-surface-rail shadow-rim',
          panel && 'top-3 gap-3 p-4',
          layout === 'desk' && 'h-[max(calc(var(--board)+108px),min(34rem,calc(100dvh-88px)))]',
          layout === 'table' && 'h-[max(var(--board),min(34rem,calc(100dvh-88px)))]',
          layout === 'side' &&
            'top-2 h-[calc(100dvh-80px-var(--safe-top)-var(--safe-bottom))] gap-2 p-3',
        )}
      >
        <div
          className={cx(
            'flex min-w-0 flex-col gap-2',
            !wide && 'order-1',
            layout === 'tablet' && 'flex-row flex-wrap items-center gap-x-4',
            panel && 'gap-3',
          )}
        >
          <header
            className={cx(
              'flex min-w-0 gap-x-3',
              wide ? 'flex-col gap-y-1' : 'flex-wrap items-center justify-between gap-y-0.5',
              layout === 'tablet' && 'flex-1 basis-0',
            )}
          >
            <h1
              className={cx(
                // Phones: the title wraps rather than losing its end to the meta line.
                'min-w-0 font-display leading-tight font-semibold',
                wide ? 'truncate' : 'break-words',
                panel ? 'text-heading' : 'text-lead',
              )}
            >
              {title}
            </h1>
            <p className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-faint">
              {state.ranked ? <RankedBadge /> : null}
              <span>{modeLine}</span>
              <SpectatorCount
                count={state.spectators ?? 0}
                // Spectators on phones see it in their banner below instead.
                className={spectator ? 'hidden wide:inline-flex' : 'inline-flex'}
              />
              {inGame ? (
                <WatchLinkButton
                  roomId={matchRoomId}
                  state={state}
                  notify={feed.notify}
                  label={layout !== 'tablet'}
                />
              ) : null}
            </p>
            {panel && state.mode === 'teams' ? (
              <p className="text-caption text-faint">
                {teamLabel(0)} against {teamLabel(1)}
              </p>
            ) : null}
          </header>

          {spectator ? (
            <p
              className={cx(
                'flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted',
                layout === 'tablet' && 'basis-full',
              )}
              data-testid="spectator-banner"
            >
              <Pill tone="brass">
                <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                Watching
              </Pill>
              {state.delayRounds > 0 && inGame ? (
                <span data-testid="spectator-delay">
                  Ranked game: shown {state.delayRounds} rounds behind
                </span>
              ) : null}
              <SpectatorCount count={state.spectators ?? 0} className="inline-flex wide:hidden" />
            </p>
          ) : null}

          <div className={cx('min-w-0', layout === 'tablet' && 'flex-1 basis-0')}>
            <TurnBanner
              finished={finished}
              myTurn={myTurn}
              inCheck={myTurn && check === 'check'}
              selfCheck={!myTurn && check === 'self_check'}
              mover={state.seats[seatToMove]}
              moverColor={seatHex(seatToMove)}
              reduceMotion={reduceMotion}
              onShowResults={finished && !showResult ? () => setShowResult(true) : undefined}
            />
            {/* Always mounted, so screen readers announce the self-check when its text appears
                (the visual pill beside the banner is aria-hidden), and, for a seat with several
                leaders, which of them are attacked. A check on the viewer's turn is read by the
                board after the moves that made it ("Your move. Check: ..."). */}
            <p className="sr-only" role="status" aria-live="polite" data-testid="check-announcer">
              {!myTurn && check === 'self_check'
                ? [SELF_CHECK_TEXT, checkLeaders].filter(Boolean).join('. ')
                : ''}
            </p>
          </div>

          {finished ? null : (
            <div
              className={cx(
                'empty:hidden [&>*:last-child]:mb-0',
                layout === 'tablet' && 'basis-full',
              )}
            >
              <TeamResignCard room={room} feed={feed} />
              <DrawOfferCard room={room} feed={feed} />
            </div>
          )}
        </div>

        {layout === 'side' ? players : null}

        {/* In the side panel the actions stay pinned at the bottom, so a vote or draw card
            above can't push Resign and Leave out of view. */}
        <section
          aria-label="Actions"
          className={cx(
            !wide && 'order-4',
            panel &&
              'sticky -bottom-4 z-10 order-2 -mx-4 mt-auto rounded-b-panel border-t border-rule bg-surface-rail px-4 pt-3 pb-4 [&:not(:has(~[data-after-actions]))]:-mb-4',
          )}
        >
          {finished || spectator ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">{moreButtons}</div>
          ) : (
            <GameActions
              room={room}
              feed={feed}
              voters={seatInfo?.voters ?? null}
              myDefeatReason={
                feed.mySeat >= 0 ? (seatInfo?.defeatReasons[feed.mySeat] ?? null) : null
              }
            >
              {moreButtons}
            </GameActions>
          )}
        </section>

        <LeaveHint
          show={inGame && stillPlaying}
          graceMs={reconnectGraceMs(state)}
          className={cx(!wide && 'order-5', panel && 'order-3')}
        />

        {/* Desk and table: the settings take the move list's place (and scroll there) while
            open, so the actions stay pinned at the bottom of the panel. */}
        {settingsOpen ? (
          <div
            className={cx(
              !wide && 'order-6',
              panel && 'order-1 -mx-1 min-h-0 flex-1 overflow-y-auto px-1',
            )}
            {...(panel ? {} : { 'data-after-actions': true })}
          >
            <BoardSettings id={settingsId} />
          </div>
        ) : null}

        {/* Last in reading order on every screen. Desk and table: shown between the header and
            the pinned actions (order-1), filling the room left and shrinking before the panel
            would scroll. Phones and tablets: a bar after the actions (and the settings) that
            opens the log below, so nothing above it moves. Sideways phones: under the actions,
            where the panel scrolls to it. */}
        <MoveLogPanel
          items={logItems}
          names={logNames}
          endReason={state.result.endReason}
          className={cx(
            !wide && 'order-7',
            panel && 'order-1 min-h-0 flex-1',
            panel && settingsOpen && '!hidden',
            layout === 'side' && 'h-56 shrink-0',
          )}
        />
      </aside>

      {finished && showResult ? (
        <GameOver
          feed={feed}
          defeatReasons={seatInfo?.defeatReasons ?? null}
          defeatLabels={seatInfo?.defeatLabels ?? null}
          reduceMotion={reduceMotion}
          finalMoves={finalMoves}
          onClose={() => setShowResult(false)}
          onLeave={leave}
          friendAction={(i) => friendAction(i, false)}
          room={spectator ? undefined : room}
          spectator={spectator}
          {...(spectator ? {} : { onReplay: (id: string) => void watchReplay(id) })}
        />
      ) : null}

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this game?"
        description={
          !untimed
            ? 'Your seat will be eliminated (as if your time ran out).'
            : state.mode === 'teams'
              ? 'Your army will be eliminated and the bots will finish without you.'
              : 'Your army will be eliminated and the game ends.'
        }
        confirmLabel="Leave game"
        cancelLabel="Keep playing"
        tone="danger"
        returnFocusTo={leaveButton}
        testId="leave-dialog"
        confirmTestId="leave-confirm"
        onConfirm={() => {
          setConfirmLeave(false)
          void leaveNow()
        }}
      />
    </div>
  )
}
