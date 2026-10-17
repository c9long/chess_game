/**
 * The landing page's live demo: the real board renderer showing a four-player game the engine
 * plays against itself (moves picked from `game.legalMoves()`, see demo-moves.ts). Watch-only,
 * silent, paused while the tab is hidden or the board is off screen, and a still mid-game
 * position when the visitor prefers reduced motion. Loaded lazily after first paint.
 *
 * Pausing stops the renderer too, not just the move timer: BoardView stops its ticker while its
 * container has zero size (packages/board README, "Performance notes") and resumes without a
 * rebuild when the size comes back. So the canvas lives in an inner `stage` that collapses to
 * 0×0 while paused, with the canvas pinned to its pixel size so its last frame stays visible.
 */
import { BoardView } from '@game/board'
import { Game, initRules } from '@game/rules'
import { useEffect, useRef, useState } from 'react'
import {
  DEMO_GAMES,
  type DemoContext,
  pickDemoMove,
  playStillPosition,
  seededRandom,
} from './demo-moves.ts'

const MOVE_MS = 900
/** Pause on the final position before a new game starts. */
const RESTART_MS = 3500
/** Very long games restart anyway (the demo is decoration, not a tournament). */
const MAX_PLY = 500
/** Plies played instantly for the still (reduced motion) position (16×16: armies meet later). */
const STILL_PLY = 60
/**
 * Still mode: how long the renderer runs after mounting or a resize before it is stopped
 * (BoardView re-rasterises 150 ms after a resize settles, plus the atlas build).
 */
const STILL_SETTLE_MS = 900

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export default function DemoBoard({ onReady }: { onReady?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = host.current
    const stage = stageRef.current
    if (!el || !stage) return
    let live = true
    let mounted = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let settling = true
    let game: Game | null = null
    let ctx: DemoContext | null = null
    let round = Math.floor(Math.random() * DEMO_GAMES.length)
    let onScreen = true
    const still = prefersReducedMotion()
    const view = new BoardView({ sound: false, reducedMotion: still })

    const newGame = () => {
      game?.free()
      const demo = DEMO_GAMES[round % DEMO_GAMES.length] as (typeof DEMO_GAMES)[number]
      round++
      game = Game.create({ mode: 'ffa', civs: demo.civs })
      ctx = { start: game.snapshot(), random: seededRandom(demo.seed) }
    }

    const visible = () => live && onScreen && document.visibilityState === 'visible'
    const running = () => !still && visible()

    /** Renderer on or off (see the file comment); `data-rendering` is for the E2E test. */
    const setRendering = (on: boolean) => {
      const size = on ? '' : '0px'
      if (stage.style.width === size) return
      const canvas = view.canvas
      if (canvas) {
        // The canvas is sized 100% of the stage; pin it to its current pixels while the stage
        // is collapsed so the last frame stays on screen.
        canvas.style.width = on ? '100%' : `${canvas.clientWidth}px`
        canvas.style.height = on ? '100%' : `${canvas.clientHeight}px`
      }
      stage.style.width = size
      stage.style.height = size
      el.dataset.rendering = String(on)
    }
    const syncRendering = () => {
      if (mounted) setRendering(visible() && (!still || settling))
    }
    /** Still mode: let the renderer draw the position (again), then stop it. */
    const settle = () => {
      if (!still) return
      settling = true
      syncRendering()
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        settleTimer = undefined
        settling = false
        syncRendering()
      }, STILL_SETTLE_MS)
    }

    const step = () => {
      timer = undefined
      if (!running() || !game || !ctx) return
      const snap = game.snapshot()
      if (snap.isOver || snap.ply >= MAX_PLY) {
        newGame()
        if (game) view.setSnapshot((game as Game).snapshot(), { animate: true })
        el.dataset.ply = '0'
        schedule(MOVE_MS * 1.5)
        return
      }
      const move = pickDemoMove(game, ctx)
      if (!move) {
        schedule(RESTART_MS)
        return
      }
      const events = game.applyMove(move.notation)
      const next = game.snapshot()
      view.setSnapshot(next, { events })
      el.dataset.ply = String(next.ply)
      schedule(next.isOver ? RESTART_MS : MOVE_MS)
    }

    const schedule = (ms: number) => {
      if (timer !== undefined || !running()) return
      timer = setTimeout(step, ms)
    }
    const pause = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const onVisibility = () => {
      syncRendering()
      if (running()) schedule(MOVE_MS)
      else pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting)
            onVisibility()
          })
        : null
    // Still mode: a resize needs the renderer for a moment to redraw at the new size.
    let lastSize = ''
    const resize =
      still && typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            const size = `${el.clientWidth}x${el.clientHeight}`
            if (size === lastSize) return
            const first = lastSize === ''
            lastSize = size
            if (!first) settle()
          })
        : null

    void (async () => {
      try {
        await initRules()
        if (!live) return
        newGame()
        // A calm mid-game position, no animation.
        if (still && game && ctx) playStillPosition(game, ctx, STILL_PLY)
        await view.mount(stage)
        if (!live) return
        // Decoration only: keep the canvas out of the tab order and the accessibility tree.
        if (view.canvas) {
          view.canvas.tabIndex = -1
          view.canvas.setAttribute('aria-hidden', 'true')
          view.canvas.removeAttribute('role')
          view.canvas.removeAttribute('aria-label')
        }
        view.setPerspective('south', { animate: false })
        view.setInteractive(null)
        view.setLegalMoves([])
        if (game) {
          const first = (game as Game).snapshot()
          view.setSnapshot(first, { animate: false })
          el.dataset.ply = String(first.ply)
        }
        setShown(true)
        readyRef.current?.()
        mounted = true
        el.dataset.rendering = 'true'
        io?.observe(el)
        resize?.observe(el)
        settle()
        schedule(MOVE_MS)
      } catch {
        // No WebGL or no wasm: the framed placeholder simply stays.
      }
    })()

    return () => {
      live = false
      pause()
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      io?.disconnect()
      resize?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      view.destroy()
      game?.free()
      game = null
    }
  }, [])

  return (
    <div
      ref={host}
      inert
      className={`absolute inset-0 transition-opacity duration-700 ease-out ${shown ? 'opacity-100' : 'opacity-0'}`}
      data-testid="demo-board"
      data-ready={shown ? 'true' : undefined}
    >
      <div ref={stageRef} className="absolute top-0 left-0 h-full w-full" />
    </div>
  )
}
