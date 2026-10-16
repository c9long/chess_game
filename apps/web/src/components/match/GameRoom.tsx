import { BoardView } from '@game/board'
import { Game, type GameEvent, type Snapshot } from '@game/rules'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { formatClock, useClocks } from '../../lib/clock.ts'
import { leaveMatch, type MatchRoom, matchApi } from '../../lib/match.ts'
import { usePrefs } from '../../lib/prefs.ts'
import { useRulesReady } from '../../lib/rules.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { Alert, Button, Spinner } from '../ui.tsx'
import { GameOver } from './GameOver.tsx'
import { MODE_LABEL, SEAT_LABEL, STATUS_LABEL, seatHex, seatName, teamLabel } from './seats.ts'

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

/** Mounts the PixiJS board and keeps it in sync with the server's position. */
function Board({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<BoardView | null>(null)
  const [mounted, setMounted] = useState(false)
  const appliedRef = useRef<string>('')
  const prefs = usePrefs()
  const send = useMemo(() => matchApi(room).send, [room])
  const { state, mySeat, lastEvents } = feed

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
      .then(() => live && setMounted(true))
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
    if (!mounted) return
    viewRef.current?.setPerspective(seatName(mySeat >= 0 ? mySeat : 0), { animate: false })
  }, [mounted, mySeat])

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
    if (!mounted || !view || !ps) return
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
  }, [mounted, ps, events, mySeat, state.phase])

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
      className="relative aspect-square"
      style={{ width: 'min(100%, calc(100vh - 6rem))' }}
      data-testid="board"
    >
      <div ref={host} className="absolute inset-0" />
      {mounted ? null : (
        <div className="absolute inset-0 flex items-center justify-center gap-3 text-parchment/60">
          <Spinner /> Setting up the board…
        </div>
      )}
    </div>
  )
}

function PlayerRow({
  index,
  feed,
  remainingMs,
}: {
  index: number
  feed: MatchFeed
  remainingMs: number
}) {
  const { state, mySeat } = feed
  const seat = state.seats[index]
  if (!seat) return null
  const color = seatHex(index)
  const toMove = state.phase === 'in_game' && state.seatToMove === index
  const out = seat.status === 'removed' || seat.status === 'frozen'
  const low = remainingMs < 20_000 && !out
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
        toMove ? 'bg-parchment/[0.06]' : 'border-transparent'
      } ${out ? 'opacity-55' : ''}`}
      style={toMove ? { borderColor: `${color}aa` } : undefined}
      data-testid={`player-${seatName(index)}`}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-ink/60"
        style={{ borderColor: `${color}99`, color }}
      >
        <CivEmblem civ={seat.civ} className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
          <span className="truncate">
            {seat.isBot
              ? `Bot · ${seat.botLevel === 'max' ? 'Max' : seat.botLevel}`
              : seat.displayName}
          </span>
          {index === mySeat ? <span className="text-xs font-normal text-gold">(you)</span> : null}
        </p>
        <p className="truncate text-xs text-parchment/50">
          {civName(seat.civ)} · {SEAT_LABEL[seatName(index)]}
          {seat.status && seat.status !== 'active' ? ` · ${STATUS_LABEL[seat.status]}` : ''}
          {!seat.isBot && !seat.connected && !out ? ' · reconnecting' : ''}
        </p>
      </div>
      <span
        className={`rounded-lg px-2.5 py-1 font-mono text-base tabular-nums ${
          toMove ? 'bg-parchment text-ink' : 'bg-ink/60 text-parchment/80'
        } ${low && toMove ? '!bg-seat-south !text-parchment' : ''}`}
        data-testid="clock"
      >
        {out ? '—' : formatClock(remainingMs)}
      </span>
    </li>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-parchment/75">
      {label}
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--color-gold)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function GameRoom({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const navigate = useNavigate()
  const { ready, error } = useRulesReady()
  const clocks = useClocks(feed.clock)
  const prefs = usePrefs()
  const [showResult, setShowResult] = useState(true)
  const { state, mySeat } = feed
  const finished = state.phase === 'finished'
  const myTurn = state.phase === 'in_game' && mySeat >= 0 && state.seatToMove === mySeat

  // The lobby's Start button sits below the fold: open the game at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  async function leave() {
    if (!finished && mySeat >= 0) {
      const sure = window.confirm(
        'Leave this game? Your seat will be eliminated (as if your time ran out).',
      )
      if (!sure) return
    }
    await leaveMatch()
    navigate('/play')
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert>The game engine could not be loaded. Reload the page to try again.</Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-6 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 items-start justify-center">
        {ready ? (
          <Board room={room} feed={feed} />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center gap-3 text-parchment/60">
            <Spinner /> Loading the game engine…
          </div>
        )}
      </div>
      <aside className="flex flex-col gap-4">
        <section className="rounded-2xl border border-parchment/10 bg-panel/85 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h1 className="truncate font-display text-lg font-semibold">{state.name}</h1>
            <span className="shrink-0 text-xs text-parchment/50">
              {MODE_LABEL[state.mode]} · {state.timeControl}
            </span>
          </div>
          <p
            className={`mb-3 rounded-lg px-3 py-2 text-center text-sm font-semibold ${
              myTurn ? 'bg-gold text-ink' : 'bg-ink/50 text-parchment/70'
            }`}
            aria-live="polite"
            data-testid="turn-banner"
          >
            {finished
              ? 'Game over'
              : myTurn
                ? 'Your move'
                : `${SEAT_LABEL[seatName(state.seatToMove)] ?? ''} to move`}
          </p>
          {state.mode === 'teams' ? (
            <p className="mb-2 text-xs text-parchment/50">
              {teamLabel(0)} vs {teamLabel(1)}
            </p>
          ) : null}
          <ol className="flex flex-col gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <PlayerRow key={i} index={i} feed={feed} remainingMs={clocks[i] ?? 0} />
            ))}
          </ol>
        </section>

        <section className="rounded-2xl border border-parchment/10 bg-panel/85 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              className="h-10"
              disabled
              title="Resigning is coming in a later update"
            >
              Resign · soon
            </Button>
            <Button
              variant="secondary"
              className="h-10"
              disabled
              title="Draw offers are coming in a later update"
            >
              Offer draw · soon
            </Button>
          </div>
          <p className="mt-3 text-xs text-parchment/45">
            Move log, chat and replays are planned for a later update.
          </p>
          <Button variant="ghost" className="mt-2 h-10 w-full" onClick={leave}>
            {finished ? 'Back to lobbies' : 'Leave game'}
          </Button>
        </section>

        <section className="rounded-2xl border border-parchment/10 bg-panel/85 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-parchment/50">
            Board options
          </h2>
          <div className="flex flex-col gap-2.5">
            <Toggle label="Sound" checked={prefs.sound} onChange={(v) => prefs.set({ sound: v })} />
            <Toggle
              label="Glow on attacked leaders"
              checked={prefs.showAttackedLeaderGlow}
              onChange={(v) => prefs.set({ showAttackedLeaderGlow: v })}
            />
            <Toggle
              label="Colour-blind markers"
              checked={prefs.colorblindPatterns}
              onChange={(v) => prefs.set({ colorblindPatterns: v })}
            />
            <Toggle
              label="Reduced motion"
              checked={prefs.reducedMotion}
              onChange={(v) => prefs.set({ reducedMotion: v })}
            />
          </div>
        </section>
      </aside>

      {finished && showResult ? (
        <GameOver feed={feed} onClose={() => setShowResult(false)} onLeave={leave} />
      ) : null}
    </div>
  )
}
