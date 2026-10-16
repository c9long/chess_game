import { BoardView } from '@game/board'
import { isUntimed } from '@game/protocol'
import { Game, type GameConfig, type GameEvent, type Piece, type Snapshot } from '@game/rules'
import { useReducedMotion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { leaveMatch, type MatchRoom, matchApi } from '../../lib/match.ts'
import { lostMaterial, type SeatMaterial } from '../../lib/material.ts'
import { usePrefs } from '../../lib/prefs.ts'
import { useRulesReady } from '../../lib/rules.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { BoardSettings, KeyboardHints } from '../game/BoardSettings.tsx'
import { GameButton } from '../game/GameButton.tsx'
import { ExitIcon, GearIcon } from '../game/icons.tsx'
import { PlayerCard } from '../game/PlayerCard.tsx'
import { TurnBanner } from '../game/TurnBanner.tsx'
import { Alert, Spinner } from '../ui.tsx'
import { DrawOfferCard, GameActions } from './GameActions.tsx'
import { GameOver } from './GameOver.tsx'
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

/** Starting boards by game config, from the engine (so they follow future civ rosters). */
const startBoards = new Map<string, readonly (Piece | null)[]>()

function startBoard(config: GameConfig): readonly (Piece | null)[] {
  const key = JSON.stringify(config)
  let board = startBoards.get(key)
  if (!board) {
    const game = Game.create(config)
    try {
      board = game.snapshot().board
    } finally {
      game.free()
    }
    startBoards.set(key, board)
  }
  return board
}

/**
 * What the side panel needs from the engine: draw voters, how each seat was knocked out, and
 * the pieces each seat has lost (start board vs current board, both from engine snapshots).
 */
interface SeatInfo {
  voters: readonly boolean[]
  defeatReasons: (string | null)[]
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
    return {
      voters: game.drawVoters(),
      defeatReasons: (['south', 'west', 'north', 'east'] as const).map(
        (seat) => snapshot.defeats.find((d) => d.seat === seat)?.reason ?? null,
      ),
      material,
    }
  } finally {
    game.free()
  }
}

/** Mounts the PixiJS board and keeps it in sync with the server's position. */
function Board({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<BoardView | null>(null)
  // Bumped each time a BoardView finishes mounting, so a re-created view (the mount effect
  // ran again) always gets the current perspective and snapshot.
  const [viewGen, setViewGen] = useState(0)
  const appliedRef = useRef<string>('')
  const prefs = usePrefs()
  const send = useMemo(() => matchApi(room).send, [room])
  const { state, mySeat, lastEvents } = feed
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
      showAttackedLeaderGlow: usePrefs.getState().showAttackedLeaderGlow,
      colorblindPatterns: usePrefs.getState().colorblindPatterns,
      reducedMotion: usePrefs.getState().reducedMotion,
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
      showAttackedLeaderGlow: prefs.showAttackedLeaderGlow,
      colorblindPatterns: prefs.colorblindPatterns,
      reducedMotion: prefs.reducedMotion,
    })
  }, [prefs.sound, prefs.showAttackedLeaderGlow, prefs.colorblindPatterns, prefs.reducedMotion])

  useEffect(() => {
    if (viewGen === 0) return
    viewRef.current?.setPerspective(seatName(mySeat >= 0 ? mySeat : 0), { animate: false })
  }, [viewGen, mySeat])

  // Follow the authoritative position. The `events` message carries the rules events that
  // make animations exact; a state patch alone (e.g. after a reconnect) still animates by diff.
  const ps =
    lastEvents && lastEvents.seq >= state.actionSeq
      ? lastEvents.positionString
      : state.positionString
  const events: readonly GameEvent[] | undefined =
    lastEvents && lastEvents.positionString === ps ? lastEvents.events : undefined
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
  const settingsId = useId()
  const { state, mySeat } = feed
  const finished = state.phase === 'finished'
  const inGame = state.phase === 'in_game'
  const untimed = isUntimed(state.timeControl)
  const myTurn = inGame && mySeat >= 0 && state.seatToMove === mySeat
  const seatInfo = useMemo(
    () => (ready ? readSeatInfo(state.positionString) : null),
    [ready, state.positionString],
  )
  const stillPlaying = mySeat >= 0 && seatInfo?.voters[mySeat] === true
  useTurnTitle(myTurn)

  // The lobby's Start button sits below the fold: open the game at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  async function leave() {
    if (!finished && stillPlaying) {
      const sure = window.confirm(
        untimed
          ? 'Leave this game? Your army will be eliminated and the bots will finish without you.'
          : 'Leave this game? Your seat will be eliminated (as if your time ran out).',
      )
      if (!sure) return
    }
    navigate('/play')
    await leaveMatch()
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
    <div className="contents lg:col-span-2 lg:flex lg:gap-2">
      <GameButton
        variant="ghost"
        className="w-full lg:flex-1"
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
        'mx-auto flex w-full max-w-[1500px] flex-col gap-2 px-4 pt-2 pb-6',
        'lg:grid lg:grid-cols-[auto_minmax(320px,360px)] lg:items-start lg:justify-center lg:gap-6 lg:py-4',
        // Board size. Phones (2x2 strip): header 64 + title 24 + banner 40 + strip 118 +
        // actions 40 + gaps and padding 48. Tablets (strip in one row): strip 56. Desktop: the
        // panel sits beside the board, so only the header and padding count.
        '[--board:max(min(100%,300px),min(100%,calc(100dvh-334px)))]',
        'min-[560px]:[--board:max(min(100%,300px),min(100%,calc(100dvh-276px)))]',
        'lg:[--board:min(calc(100vw-440px),calc(100dvh-96px))]',
      ].join(' ')}
    >
      <div className="order-2 flex min-w-0 justify-center lg:order-none">
        {ready ? (
          <Board room={room} feed={feed} />
        ) : (
          <div className="flex aspect-square w-[var(--board)] items-center justify-center gap-3 text-parchment/60">
            <Spinner /> Loading the game engine…
          </div>
        )}
      </div>

      <aside
        aria-label="Game"
        className="contents lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-96px)] lg:flex-col lg:gap-3 lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-parchment/10 lg:bg-panel/85 lg:p-4"
      >
        <header className="order-1 flex min-w-0 items-center gap-x-3 gap-y-1 lg:order-none lg:flex-wrap lg:items-baseline lg:justify-between">
          <h1 className="min-w-0 truncate font-display text-base font-semibold lg:text-lg">
            {state.name}
          </h1>
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-parchment/50 lg:ml-0">
            {state.ranked ? <RankedBadge /> : null}
            <span>
              {MODE_LABEL[state.mode]} · {untimed ? 'Untimed' : state.timeControl}
            </span>
          </span>
        </header>

        <div className="order-3 lg:order-none">
          <TurnBanner
            finished={finished}
            myTurn={myTurn}
            mover={state.seats[state.seatToMove]}
            moverColor={seatHex(state.seatToMove)}
            reduceMotion={reduceMotion}
            onShowResults={finished && !showResult ? () => setShowResult(true) : undefined}
          />
        </div>

        {finished ? null : (
          <div className="order-4 empty:hidden lg:order-none">
            <DrawOfferCard room={room} feed={feed} />
          </div>
        )}

        <section aria-label="Players" className="order-5 lg:order-none">
          {state.mode === 'teams' ? (
            <p className="mb-1.5 hidden text-xs text-parchment/50 lg:block">
              {teamLabel(0)} vs {teamLabel(1)}
            </p>
          ) : null}
          <ol className="grid grid-cols-2 gap-1.5 min-[560px]:grid-cols-4 lg:grid-cols-1 lg:gap-1">
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
                  toMove={inGame && state.seatToMove === i}
                  inGame={inGame}
                  timed={!untimed}
                  clock={feed.clock}
                  defeatReason={seatInfo?.defeatReasons[i] ?? null}
                  material={seatInfo?.material?.[i] ?? null}
                  reduceMotion={reduceMotion}
                />
              )
            })}
          </ol>
        </section>

        <section
          aria-label="Actions"
          className="order-6 lg:order-none lg:mt-auto lg:border-t lg:border-parchment/10 lg:pt-3"
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

        {settingsOpen ? (
          <div className="order-7 lg:order-none">
            <BoardSettings id={settingsId} />
          </div>
        ) : null}
      </aside>

      {finished && showResult ? (
        <GameOver
          feed={feed}
          defeatReasons={seatInfo?.defeatReasons ?? null}
          reduceMotion={reduceMotion}
          onClose={() => setShowResult(false)}
          onLeave={leave}
        />
      ) : null}
    </div>
  )
}
