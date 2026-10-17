import { BoardView } from '@game/board'
import { isUntimed } from '@game/protocol'
import {
  Game,
  type GameConfig,
  type GameEvent,
  type Piece,
  type Snapshot,
  squareIndex,
} from '@game/rules'
import { useReducedMotion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
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
import { PlayerCard } from '../game/PlayerCard.tsx'
import { SELF_CHECK_TEXT, TurnBanner } from '../game/TurnBanner.tsx'
import { ConfirmDialog } from '../overlay.tsx'
import { useSeatFriendActions } from '../social/SeatFriendButton.tsx'
import { Alert, Spinner } from '../ui.tsx'
import { DrawOfferCard, GameActions, TeamResignCard } from './GameActions.tsx'
import { GameOver } from './GameOver.tsx'
import { defeatReasonLabel } from './labels.ts'
import { RankedBadge } from './RankedBadge.tsx'
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
}: {
  room: MatchRoom
  feed: MatchFeed
  /** The viewer's check indicator (from `useCheckNotice`). */
  check: CheckNotice
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
      // The turn banner and the check announcer say the viewer's own check.
      announceOwnCheck: false,
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
      // Sized to fit the viewport height with the panel beside it (desktop) or the player strip
      // and actions under it (tablets and phones). See GameRoom for the reserved heights.
      className="relative aspect-square w-[var(--board)]"
      data-testid="board"
      ref={frame}
    >
      <div ref={host} className="absolute inset-0" />
      {viewGen > 0 ? null : (
        <div className="absolute inset-0 flex items-center justify-center gap-3 text-parchment/60">
          <Spinner /> Setting up the board…
        </div>
      )}
      {hint === 'shown' ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3"
          role="status"
        >
          <span className="rounded-full border border-parchment/15 bg-ink/90 px-3 py-1.5 text-xs text-parchment/80 shadow-lg shadow-black/40 backdrop-blur">
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
function LeaveHint({ show, graceMs }: { show: boolean; graceMs: number }) {
  const touch = useMediaQuery('(pointer: coarse)')
  const [dismissed, setDismissed] = useState(leaveHintDismissed)
  if (!show || !touch || dismissed) return null
  return (
    <div
      className="order-7 flex items-center gap-2 rounded-lg border border-parchment/10 bg-ink/40 py-1.5 pr-1.5 pl-3 text-xs text-parchment/70 wide:order-none"
      data-testid="leave-hint"
    >
      <span className="min-w-0 flex-1">
        Leaving the app for more than {graceLabel(graceMs)} forfeits
      </span>
      <button
        type="button"
        className="flex h-8 shrink-0 items-center rounded-md px-2.5 font-semibold text-parchment/80 hover:bg-parchment/5 hover:text-parchment"
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

export function GameRoom({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const navigate = useNavigate()
  const { ready, error } = useRulesReady()
  const prefs = usePrefs()
  const systemReduced = useReducedMotion()
  const reduceMotion = Boolean(systemReduced) || prefs.reducedMotion
  const [showResult, setShowResult] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const leaveButton = useRef<HTMLButtonElement>(null)
  const settingsId = useId()
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
  const friendAction = useSeatFriendActions(state, untimed)
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

  async function leaveNow() {
    navigate('/play')
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

  const leaveLabel = finished ? (untimed ? 'Back to Play' : 'Back to lobbies') : 'Leave game'
  const moreButtons = (
    // Phones and tablets: two more cells of the action row. Desktop: a row of its own.
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
          {finished ? (
            leaveLabel
          ) : (
            <>
              <span className="lg:hidden">Leave</span>
              <span className="hidden lg:inline">Leave game</span>
            </>
          )}
        </span>
      </GameButton>
      <GameButton
        variant="ghost"
        className={`w-10 !px-0 ${settingsOpen ? 'bg-parchment/[0.08] text-parchment' : ''}`}
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

  return (
    <div
      className={[
        // Bottom padding clears a phone's home indicator (there is no footer on this page).
        'safe-bottom-6 mx-auto flex w-full max-w-[1500px] flex-col gap-2 px-4 pt-2',
        'wide:grid wide:grid-cols-[auto_minmax(320px,360px)] wide:items-start wide:justify-center wide:gap-6 wide:py-4',
        // Board size. Phones (2x2 strip): header 64 + title 24 + banner 40 + strip 118 +
        // actions 40 + gaps and padding 48. Tablets (strip in one row): strip 56. Desktop and
        // phones held sideways (`wide:`, index.css): the panel sits beside the board, so only
        // the header and padding count.
        // Safe-area insets (notch, home indicator) come off the height too.
        '[--board:max(min(100%,300px),min(100%,calc(100dvh_-_334px_-_var(--safe-top)_-_var(--safe-bottom))))]',
        'min-[560px]:[--board:max(min(100%,300px),min(100%,calc(100dvh_-_276px_-_var(--safe-top)_-_var(--safe-bottom))))]',
        'wide:[--board:min(calc(100vw_-_440px_-_var(--safe-left)_-_var(--safe-right)),calc(100dvh_-_96px_-_var(--safe-top)_-_var(--safe-bottom)))]',
      ].join(' ')}
    >
      <div className="order-2 flex min-w-0 justify-center wide:order-none">
        {ready ? (
          <Board room={room} feed={feed} check={check} />
        ) : (
          <div className="flex aspect-square w-[var(--board)] items-center justify-center gap-3 text-parchment/60">
            <Spinner /> Loading the game engine…
          </div>
        )}
      </div>

      <aside
        aria-label="Game"
        className="contents wide:sticky wide:top-4 wide:flex wide:max-h-[calc(100dvh-96px)] wide:flex-col wide:gap-3 wide:overflow-y-auto wide:rounded-2xl wide:border wide:border-parchment/10 wide:bg-panel/85 wide:p-4"
      >
        <header className="order-1 flex min-w-0 items-center gap-x-3 gap-y-1 wide:order-none wide:flex-wrap wide:items-baseline wide:justify-between">
          <h1 className="min-w-0 truncate font-display text-base font-semibold wide:text-lg">
            {state.name}
          </h1>
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-parchment/65 wide:ml-0">
            {state.ranked ? <RankedBadge /> : null}
            <span>
              {MODE_LABEL[state.mode]} · {untimed ? 'Untimed' : state.timeControl}
            </span>
          </span>
        </header>

        <div className="order-3 wide:order-none">
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
              leaders, which of them are attacked. */}
          <p className="sr-only" role="status" aria-live="polite" data-testid="check-announcer">
            {!myTurn && check === 'self_check'
              ? [SELF_CHECK_TEXT, checkLeaders].filter(Boolean).join('. ')
              : myTurn && check === 'check'
                ? (checkLeaders ?? '')
                : ''}
          </p>
        </div>

        {finished ? null : (
          <div className="order-4 empty:hidden wide:order-none">
            <TeamResignCard room={room} feed={feed} />
            <DrawOfferCard room={room} feed={feed} />
          </div>
        )}

        <section aria-label="Players" className="order-5 wide:order-none">
          {state.mode === 'teams' ? (
            <p className="mb-1.5 hidden text-xs text-parchment/50 wide:block">
              {teamLabel(0)} vs {teamLabel(1)}
            </p>
          ) : null}
          <ol className="grid grid-cols-2 gap-1.5 min-[560px]:grid-cols-4 wide:grid-cols-1 wide:gap-1">
            {[0, 1, 2, 3].map((i) => {
              const seat = state.seats[i]
              if (!seat) return null
              return (
                <PlayerCard
                  key={i}
                  index={i}
                  seat={seat}
                  me={i === mySeat}
                  color={seatHex(i)}
                  toMove={inGame && seatToMove === i}
                  inGame={inGame}
                  timed={!untimed}
                  clock={feed.clock}
                  defeatReason={seatInfo?.defeatReasons[i] ?? null}
                  material={seatInfo?.material?.[i] ?? null}
                  reduceMotion={reduceMotion}
                  friendAction={friendAction(i, true)}
                />
              )
            })}
          </ol>
        </section>

        {/* On wide screens the actions stay pinned at the bottom of the side panel, so a
            vote or draw card above can't push Resign / Leave out of view. */}
        <section
          aria-label="Actions"
          className="order-6 wide:sticky wide:-bottom-4 wide:z-10 wide:order-none wide:-mx-4 wide:mt-auto wide:rounded-b-2xl wide:last:-mb-4 wide:border-t wide:border-parchment/10 wide:bg-panel wide:px-4 wide:pt-3 wide:pb-4"
        >
          {finished ? (
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

        <LeaveHint show={inGame && stillPlaying} graceMs={reconnectGraceMs(state)} />

        {settingsOpen ? (
          <div className="order-8 wide:order-none">
            <BoardSettings id={settingsId} />
          </div>
        ) : null}
      </aside>

      {finished && showResult ? (
        <GameOver
          feed={feed}
          defeatReasons={seatInfo?.defeatReasons ?? null}
          defeatLabels={seatInfo?.defeatLabels ?? null}
          reduceMotion={reduceMotion}
          onClose={() => setShowResult(false)}
          onLeave={leave}
          friendAction={(i) => friendAction(i, false)}
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
