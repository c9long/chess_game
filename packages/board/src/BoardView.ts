import type { GameEvent, MoveView, Piece, PieceKind, Seat, Snapshot, Square } from '@game/rules'
import {
  Application,
  Container,
  defaultFilterVert,
  type FederatedPointerEvent,
  FillGradient,
  Filter,
  GlProgram,
  Graphics,
  Mesh,
  MeshGeometry,
  Point,
  RenderTexture,
  Shader,
  Sprite,
  Text,
  Texture,
  UniformGroup,
} from 'pixi.js'
import { hexToNumber, hexToRgb, mixHex, shadeHex } from './color.ts'
import {
  BOARD_SIZE,
  type BoardLayout,
  boardExtent,
  fileLetter,
  indexOf,
  nameOf,
  nearestAngle,
  perspectiveAngle,
  pointToSquare,
  relativeSeat,
  rotateVector,
  seatOrder,
  squareCenter,
  stepCursor,
} from './geometry.ts'
import { MoveIndex } from './moves.ts'
import { bandColor, bandGain, FROZEN_BASE, lightFor, seatColor } from './palette.ts'
import { Particles } from './particles.ts'
import { type AnimationPlan, planTransition, soundCues } from './plan.ts'
import { BOARD_FRAGMENT, BOARD_VERTEX, DISSOLVE_FRAGMENT } from './shaders.ts'
import { SoundEngine, type SoundKind } from './sound.ts'
import {
  canvasTexture,
  createEffectTextures,
  destroyEffectTextures,
  drawBoardShadow,
  drawLighting,
  drawMedallion,
  type EffectTextures,
  type MedallionState,
  PieceAtlas,
  type PieceVariant,
} from './textures.ts'
import { Animator, ease, type Tween } from './tween.ts'

/** Display options (all can change at runtime through `setOptions`). */
export interface BoardOptions {
  /** Pulse a glow under an ACTIVE seat's attacked leader (information only). Default false. */
  readonly showAttackedLeaderGlow: boolean
  /** Replace motion with short fades; no rotation spin, particles or pulsing. Default: the OS setting. */
  readonly reducedMotion: boolean
  /** Per-seat shape markers on pieces (circle, square, triangle, diamond). Default false. */
  readonly colorblindPatterns: boolean
  /** Synthesised sound effects. Default true. */
  readonly sound: boolean
  /** Sound volume 0..1. Default 0.6. */
  readonly volume: number
}

export interface SetSnapshotOptions {
  /** Animate the change from the previous snapshot. Default true. */
  readonly animate?: boolean
  /** Events returned by `applyMove` / `applyTimeout` / `applyAbandon` for this step. */
  readonly events?: readonly GameEvent[]
}

export interface BoardViewInit extends Partial<BoardOptions> {
  onMoveIntent?: (move: string) => void
  onSquareHover?: (square: Square | null) => void
}

const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']

/** Frame width, medallion size and outer margin, in squares. */
const FRAME = 0.8
const MEDALLION = 1.08
const MARGIN = 0.72
/** Medallion centre, as a fraction of the frame width out from the field edge. */
const MEDALLION_AT = 0.85
/** Scale of the medallion of the seat to move. */
const MEDALLION_ACTIVE = 1.08
/** Piece sprite size relative to a square (the art's king is 84% of the sprite). */
const PIECE_SCALE = 1.03
/** Transparent border around the board render texture, in CSS px (clean edges when rotated). */
const RT_PAD = 2
/** How long the size must stay put before textures are re-rasterised, ms. */
const RESIZE_SETTLE_MS = 150
/** Frame rate cap while nothing but the idle glow pulse moves. */
const IDLE_FPS = 30
const MOVE_MS = 180
const ROTATE_MS = 760
/** Shadow offset in screen space, in squares (light from the upper left). */
const SHADOW_DX = 0.045
const SHADOW_DY = 0.06
const DRAG_THRESHOLD = 5

interface PieceNode {
  readonly node: Container
  readonly body: Sprite
  readonly marker: Sprite
  readonly shadow: Sprite
  kind: PieceKind
  readonly owner: Seat
  variant: PieceVariant
  /** 0 resting, 1 fully lifted (drag). Drives scale and shadow. */
  lift: number
  /** Whether a tween currently drives this node's position. */
  moving: boolean
}

interface Medallion {
  readonly sprite: Sprite
  readonly glow: Sprite
  key: string
}

interface Promo {
  readonly from: number
  readonly to: number
  readonly choices: readonly PieceKind[]
  readonly container: Container
  readonly tiles: Container[]
  focus: number
}

function defaultReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

/**
 * The 4-player board renderer (PixiJS 8, WebGL).
 *
 * Framework-agnostic: mount it into any element, feed it engine snapshots and
 * legal moves, and listen for move intents. It never decides legality: the
 * host applies the move with the rules engine (or the server does) and calls
 * `setSnapshot` with the result. If a move intent is rejected, call
 * `setSnapshot` again with the current snapshot and the piece slides back.
 */
export class BoardView {
  /** A legal move chosen by the user (engine notation, e.g. 'c2c4', 'e6e7q'). */
  onMoveIntent: ((move: string) => void) | null
  /** The square under the pointer changed (`null` when off the field). */
  onSquareHover: ((square: Square | null) => void) | null

  #options: BoardOptions
  #app: Application | null = null
  #parent: HTMLElement | null = null
  #resize: ResizeObserver | null = null
  #destroyed = false
  #ready = false
  #generation = 0

  #snapshot: Snapshot | null = null
  #perspective: Seat = 'south'
  #interactive: Seat | null = null
  #moves = new MoveIndex([])

  #layout: BoardLayout = { square: 48, frame: 48 * FRAME }
  /** The square size the next rebuild will use (differs from the layout while a resize settles). */
  #targetSq = 48
  #res = 1
  /** Device resolution the current textures were rasterised at. */
  #builtRes = 0
  #fitScale = 1
  #relayoutTimer: ReturnType<typeof setTimeout> | 0 = 0
  #rebuilding = false
  #hidden = false
  #idleCapped = false
  #bandGlowGain = 1
  #dprQuery: MediaQueryList | null = null
  #contextLost = false
  #angle = 0
  #rotTween: ReturnType<Animator['add']> | null = null

  // Scene graph
  readonly #root = new Container()
  readonly #boardShadow = new Sprite()
  readonly #boardSprite = new Sprite()
  readonly #bandGlow = new Sprite()
  readonly #labels = new Container()
  readonly #medalLayer = new Container()
  readonly #fx = new Graphics()
  readonly #hints = new Graphics()
  readonly #leaderGlows: Sprite[] = []
  readonly #shadowLayer = new Container()
  readonly #pieceLayer = new Container()
  readonly #movingLayer = new Container()
  readonly #dissolveLayer = new Container()
  readonly #dragLayer = new Container()
  readonly #overlay = new Container()
  readonly #light = new Sprite()
  #particles: Particles | null = null
  #effects: EffectTextures | null = null
  #boardMesh: Mesh<MeshGeometry, Shader> | null = null
  #boardRT: RenderTexture | null = null
  #atlas: PieceAtlas | null = null
  #atlasSize = 0
  readonly #medallions: Medallion[] = []
  readonly #medalRing = new Graphics()
  #labelTexts: Text[] = []
  /** Kings of active seats under attack (for the glow and its border). */
  #attackedLeaders: number[] = []

  readonly #pieces: (PieceNode | null)[] = new Array(144).fill(null)
  readonly #anim = new Animator()
  readonly #sound = new SoundEngine()

  // Interaction
  #selected = -1
  #hover = -1
  #cursor = -1
  #cursorVisible = false
  #press: { square: number; x: number; y: number; wasSelected: boolean } | null = null
  #drag: { square: number; node: PieceNode } | null = null
  #promo: Promo | null = null
  #lastMove: { from: number; to: number; seat: Seat } | null = null
  /** The slide started by the user's own move, kept running when the host confirms it. */
  #commitSlide: { node: PieceNode; from: number; to: number; tween: Tween } | null = null
  /** A piece faded while a dragged piece hovers over it. */
  #fadedNode: PieceNode | null = null
  #time = 0

  readonly #tmpPoint = new Point()
  readonly #tmpVec = { x: 0, y: 0 }
  readonly #tmpVec2 = { x: 0, y: 0 }
  #shadowLocal = { x: 0, y: 0 }

  constructor(init: BoardViewInit = {}) {
    this.onMoveIntent = init.onMoveIntent ?? null
    this.onSquareHover = init.onSquareHover ?? null
    this.#options = {
      showAttackedLeaderGlow: init.showAttackedLeaderGlow ?? false,
      reducedMotion: init.reducedMotion ?? defaultReducedMotion(),
      colorblindPatterns: init.colorblindPatterns ?? false,
      sound: init.sound ?? true,
      volume: init.volume ?? 0.6,
    }
    this.#sound.setEnabled(this.#options.sound)
    this.#sound.setVolume(this.#options.volume)
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Creates the canvas inside `parent` and starts rendering. Resolves when ready. */
  async mount(parent: HTMLElement): Promise<void> {
    if (this.#destroyed) throw new Error('BoardView was destroyed; create a new one')
    if (this.#app) throw new Error('BoardView is already mounted')
    this.#parent = parent
    const app = new Application()
    this.#app = app
    const rect = parent.getBoundingClientRect()
    this.#res = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1))
    await app.init({
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      backgroundAlpha: 0,
      // Everything big is pre-rendered texture; MSAA only helps the thin vector
      // highlights, and at 2x+ density it costs hundreds of MB for nothing visible.
      antialias: this.#res < 2,
      resolution: this.#res,
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    })
    if (this.#destroyed) {
      // destroy() ran while the renderer was starting.
      app.destroy(true)
      this.#app = null
      return
    }
    const cv = app.canvas
    cv.style.display = 'block'
    cv.style.width = '100%'
    cv.style.height = '100%'
    cv.style.touchAction = 'none'
    cv.style.outline = 'none'
    cv.tabIndex = 0
    cv.setAttribute('role', 'application')
    cv.setAttribute(
      'aria-label',
      'Game board. Arrow keys move the cursor, Enter selects and moves.',
    )
    parent.appendChild(cv)

    this.#effects = createEffectTextures()
    this.#particles = new Particles(320)
    this.#buildScene()
    this.#bindInput(cv)
    cv.addEventListener('webglcontextlost', this.#onContextLost)
    cv.addEventListener('webglcontextrestored', this.#onContextRestored)

    this.#resize = new ResizeObserver(() => void this.#relayout())
    this.#resize.observe(parent)
    globalThis.addEventListener?.('resize', this.#onWindowResize)
    // Browser zoom or moving to another screen can change devicePixelRatio
    // without any resize event; a resolution media query catches it.
    this.#watchDpr()
    app.ticker.add(() => this.#tick())
    this.#ready = true
    this.#angle = perspectiveAngle(this.#perspective)
    await this.#relayout(true)
    if (this.#snapshot) this.#applyInstant(this.#snapshot)
    this.#refreshAll()
  }

  /** Shows a position. With `animate` (default), the change from the previous one is animated. */
  setSnapshot(snapshot: Snapshot, options: SetSnapshotOptions = {}): void {
    const prev = this.#snapshot
    this.#snapshot = snapshot
    if (!this.#ready) return
    this.#closePromo(false)
    this.#endDrag(false)
    const events = options.events ?? []
    const animate = (options.animate ?? true) && prev !== null
    const resync = prev !== null && prev.hash === snapshot.hash && prev.ply === snapshot.ply
    const plan = prev && !resync ? planTransition(prev, snapshot, events) : null
    const willAnimate = !resync && animate && plan !== null && plan.appears.length <= 8
    // The user's own move is already gliding to its square: when the host
    // confirms exactly that move, let the slide finish instead of snapping it.
    const commit = this.#commitSlide
    this.#commitSlide = null
    const keep =
      willAnimate &&
      commit?.tween.alive &&
      this.#pieces[commit.from] === commit.node &&
      plan.moves.some((m) => !m.castleRook && m.from === commit.from && m.to === commit.to)
        ? commit
        : null
    this.#anim.finishAll(keep?.tween ?? null)
    if (prev && !resync) this.#lastMove = this.#nextLastMove(prev, snapshot, events, plan)
    this.#selected = -1
    this.#moves = new MoveIndex([])
    if (resync) {
      this.#settleAll()
    } else if (willAnimate && plan) {
      this.#applyPlan(snapshot, plan, keep)
    } else {
      this.#applyInstant(snapshot)
    }
    if (
      prev &&
      !resync &&
      this.#interactive !== null &&
      snapshot.seatToMove === this.#interactive &&
      prev.seatToMove !== this.#interactive &&
      !snapshot.isOver
    ) {
      this.#playLater('turn', 260)
    }
    this.#refreshAll()
  }

  /**
   * The last-move highlight after a step. A `move_made` event names it; with
   * no events, only a single-ply step that looks like one move counts. A new
   * game, an undo or a position jump clears it.
   */
  #nextLastMove(
    prev: Snapshot,
    next: Snapshot,
    events: readonly GameEvent[],
    plan: AnimationPlan | null,
  ): { from: number; to: number; seat: Seat } | null {
    if (next.ply === 0 || next.ply < prev.ply) return null
    for (const e of events) {
      if (e.type === 'move_made') return { from: indexOf(e.from), to: indexOf(e.to), seat: e.seat }
    }
    // Events without a move (timeout, abandon): the last move stays the last move.
    if (events.length > 0) return this.#lastMove
    if (next.ply !== prev.ply + 1 || !plan || !plan.incremental) return null
    const main = plan.moves.find((m) => !m.castleRook)
    return main ? { from: main.from, to: main.to, seat: main.piece.owner } : null
  }

  /** The seat shown at the bottom. The board turns (animated) in 90-degree steps. */
  setPerspective(seat: Seat, options: { animate?: boolean } = {}): void {
    if (seat === this.#perspective && this.#ready) return
    this.#perspective = seat
    if (!this.#ready) return
    this.#closePromo(true)
    const target = nearestAngle(this.#angle, seat)
    this.#anim.cancel(this.#rotTween)
    const animate = (options.animate ?? true) && !this.#options.reducedMotion
    if (!animate) {
      this.#setAngle(target)
      this.#refreshPieceFacing()
      return
    }
    const from = this.#angle
    this.#rotTween = this.#anim.add(ROTATE_MS, (k) => this.#setAngle(from + (target - from) * k), {
      ease: ease.inOutCubic,
      done: () => {
        this.#rotTween = null
      },
    })
    // Knights turn to face the centre halfway through.
    this.#anim.add(0, () => this.#refreshPieceFacing(), { delay: ROTATE_MS / 2 })
  }

  /** The seat the local user may move for (`null` = view only). */
  setInteractive(seat: Seat | null): void {
    if (seat === this.#interactive) return
    this.#interactive = seat
    this.#selected = -1
    this.#closePromo(true)
    this.#refreshFx()
  }

  /** Legal moves of the seat to move (from the engine). Used for hints and input. */
  setLegalMoves(moves: readonly MoveView[]): void {
    this.#moves = new MoveIndex(moves)
    if (this.#selected >= 0 && !this.#moves.canMoveFrom(this.#selected)) this.#selected = -1
    this.#refreshFx()
  }

  setOptions(options: Partial<BoardOptions>): void {
    this.#options = { ...this.#options, ...options }
    this.#sound.setEnabled(this.#options.sound)
    this.#sound.setVolume(this.#options.volume)
    if (!this.#ready) return
    this.#refreshAll()
  }

  get options(): BoardOptions {
    return this.#options
  }

  get perspective(): Seat {
    return this.#perspective
  }

  /** The canvas (after `mount`). */
  get canvas(): HTMLCanvasElement | null {
    return this.#app?.renderer ? this.#app.canvas : null
  }

  /** Whether animations (or a pending re-layout) are running, for tests and screenshots. */
  get animating(): boolean {
    return (
      this.#anim.busy ||
      (this.#particles?.active ?? 0) > 0 ||
      this.#dissolveLayer.children.length > 0 ||
      this.#relayoutTimer !== 0 ||
      this.#rebuilding
    )
  }

  /** Screen position (CSS px, relative to the canvas) of a square's centre, for tests and overlays. */
  squareToClient(square: Square): { x: number; y: number } | null {
    const i = indexOf(square)
    if (i < 0 || !this.#ready) return null
    squareCenter(i, this.#layout, this.#tmpVec)
    this.#tmpPoint.set(this.#tmpVec.x, this.#tmpVec.y)
    const g = this.#root.toGlobal(this.#tmpPoint)
    return { x: g.x, y: g.y }
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#ready = false
    this.#resize?.disconnect()
    globalThis.removeEventListener?.('resize', this.#onWindowResize)
    this.#dprQuery?.removeEventListener('change', this.#onDprChange)
    this.#dprQuery = null
    if (this.#relayoutTimer) clearTimeout(this.#relayoutTimer)
    this.#relayoutTimer = 0
    this.#anim.clear()
    this.#sound.destroy()
    const app = this.#app
    if (app?.renderer) {
      app.canvas.removeEventListener('webglcontextlost', this.#onContextLost)
      app.canvas.removeEventListener('webglcontextrestored', this.#onContextRestored)
      // Every texture made here owns its canvas; free them while the renderer
      // can still release their GPU memory.
      this.#atlas?.destroy()
      this.#atlas = null
      this.#boardRT?.destroy(true)
      this.#boardRT = null
      if (this.#effects) destroyEffectTextures(this.#effects)
      this.#effects = null
      for (const sprite of [
        this.#boardShadow,
        this.#light,
        ...this.#medallions.map((m) => m.sprite),
      ]) {
        const t = sprite.texture
        sprite.texture = Texture.EMPTY
        if (t && t !== Texture.EMPTY && t !== Texture.WHITE) t.destroy(true)
      }
      if (this.#boardMesh) {
        this.#boardMesh.geometry.destroy()
        this.#boardMesh.destroy()
        this.#boardMesh = null
      }
      app.destroy(true, { children: true, texture: false })
    }
    this.#app = null
    this.#parent = null
  }

  // ---------------------------------------------------------------------------
  // Scene construction and layout
  // ---------------------------------------------------------------------------

  #buildScene(): void {
    const app = this.#app as Application
    const fxTex = this.#effects as EffectTextures
    this.#boardShadow.anchor.set(0.5)
    this.#boardSprite.anchor.set(0.5)
    this.#bandGlow.texture = fxTex.bar
    this.#bandGlow.anchor.set(0.5)
    this.#bandGlow.blendMode = 'add'
    this.#bandGlow.visible = false
    for (let i = 0; i < 4; i++) {
      const g = new Sprite(fxTex.halo)
      g.anchor.set(0.5)
      g.visible = false
      this.#leaderGlows.push(g)
    }
    for (let i = 0; i < 4; i++) {
      const glow = new Sprite(fxTex.glow)
      glow.anchor.set(0.5)
      glow.blendMode = 'add'
      glow.visible = false
      const sprite = new Sprite()
      sprite.anchor.set(0.5)
      this.#medalLayer.addChild(glow, sprite)
      this.#medallions.push({ sprite, glow, key: '' })
    }
    this.#medalRing.visible = false
    this.#medalLayer.addChild(this.#medalRing)
    // Coordinates on all four edges (each seat reads its own edge).
    const texts: Text[] = []
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k < BOARD_SIZE; k++) {
        const label = side === 0 || side === 2 ? fileLetter(k) : String(k + 1)
        const t = new Text({
          text: label,
          style: {
            fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif',
            fontSize: 12,
            fontWeight: '600',
            fill: '#e9d3a0',
            dropShadow: { color: '#000000', alpha: 0.7, blur: 2, distance: 1, angle: Math.PI / 2 },
          },
        })
        t.anchor.set(0.5)
        t.alpha = 0.82
        texts.push(t)
        this.#labels.addChild(t)
      }
    }
    this.#labelTexts = texts

    this.#root.addChild(
      this.#boardShadow,
      this.#boardSprite,
      this.#bandGlow,
      this.#labels,
      this.#fx,
      ...this.#leaderGlows,
      this.#hints,
      this.#shadowLayer,
      this.#pieceLayer,
      this.#movingLayer,
      this.#dissolveLayer,
      (this.#particles as Particles).container,
      this.#medalLayer,
      this.#dragLayer,
    )
    this.#light.anchor.set(0.5)
    this.#light.eventMode = 'none'
    app.stage.addChild(this.#root, this.#light, this.#overlay)
  }

  /**
   * Follows the parent's size and the device pixel ratio. The canvas is
   * resized at once and the existing scene scaled to fit; the textures are
   * re-rasterised for the new size only once it has settled (or right away
   * with `force`), so dragging a window edge doesn't rebuild every frame.
   */
  async #relayout(force = false): Promise<void> {
    const app = this.#app
    const parent = this.#parent
    if (!app || !parent || this.#destroyed) return
    const rect = parent.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      // Hidden (display: none, collapsed panel): keep everything, stop drawing.
      if (!this.#hidden) {
        this.#hidden = true
        app.ticker.stop()
      }
      return
    }
    if (this.#hidden) {
      this.#hidden = false
      app.ticker.start()
    }
    const w = Math.floor(rect.width)
    const h = Math.floor(rect.height)
    const res = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1))
    if (res !== this.#res || w !== app.screen.width || h !== app.screen.height || force) {
      this.#res = res
      app.renderer.resize(w, h, res)
    }
    const units = BOARD_SIZE + 2 * FRAME + 2 * MARGIN
    const sq = Math.max(8, Math.floor((Math.min(w, h) / units) * res) / res)
    const changed = force || res !== this.#builtRes || Math.abs(sq - this.#layout.square) > 0.01
    this.#targetSq = changed ? sq : this.#layout.square
    this.#root.position.set(Math.round((w / 2) * res) / res, Math.round((h / 2) * res) / res)
    this.#setAngle(this.#angle)
    if (this.#relayoutTimer) clearTimeout(this.#relayoutTimer)
    this.#relayoutTimer = 0
    if (!changed) return
    if (force) {
      await this.#rebuild()
      return
    }
    this.#relayoutTimer = setTimeout(() => {
      this.#relayoutTimer = 0
      void this.#rebuild()
    }, RESIZE_SETTLE_MS)
  }

  /** Re-rasterises everything for `#targetSq` at the current resolution. */
  async #rebuild(): Promise<void> {
    const app = this.#app
    if (!app || this.#destroyed || this.#hidden) return
    const res = this.#res
    const sq = this.#targetSq
    // Running slides hold pixel targets of the old layout: land them first.
    this.#anim.finishAll()
    this.#particles?.clear()
    this.#layout = { square: sq, frame: Math.round(sq * FRAME * res) / res }
    this.#builtRes = res
    this.#setAngle(this.#angle)
    const gen = ++this.#generation
    this.#rebuilding = true
    try {
      this.#renderDecor()
      this.#renderSurface()
      this.#layoutStatic()
      this.#layoutPieces()
      const pieceSize = Math.ceil((sq * PIECE_SCALE * res) / 8) * 8
      if (pieceSize !== this.#atlasSize) {
        const atlas = await PieceAtlas.build(pieceSize)
        if (gen !== this.#generation || this.#destroyed) {
          atlas.destroy()
          return
        }
        const old = this.#atlas
        this.#atlas = atlas
        this.#atlasSize = pieceSize
        this.#refreshPieceTextures()
        old?.destroy()
      }
      await this.#refreshMedallions(true)
    } finally {
      if (gen === this.#generation) this.#rebuilding = false
    }
    if (gen !== this.#generation || this.#destroyed) return
    this.#refreshAll()
  }

  readonly #onWindowResize = (): void => {
    void this.#relayout()
  }

  #watchDpr(): void {
    this.#dprQuery?.removeEventListener('change', this.#onDprChange)
    this.#dprQuery = null
    try {
      const dpr = globalThis.devicePixelRatio || 1
      const mq = globalThis.matchMedia?.(`(resolution: ${dpr}dppx)`) ?? null
      mq?.addEventListener('change', this.#onDprChange)
      this.#dprQuery = mq
    } catch {
      // No matchMedia: the window resize listener still covers zoom.
    }
  }

  readonly #onDprChange = (): void => {
    if (this.#destroyed) return
    this.#watchDpr()
    void this.#relayout()
  }

  readonly #onContextLost = (): void => {
    this.#contextLost = true
  }

  readonly #onContextRestored = (): void => {
    this.#contextLost = false
    // Pixi re-creates its GL state in its own listener (registered first);
    // render-texture contents are gone, so draw the board surface again.
    setTimeout(() => {
      if (!this.#destroyed && this.#ready) this.#renderSurface()
    }, 0)
  }

  /** Board surface (wood, frame, seat bands) into its render texture. Cheap GPU work. */
  #renderSurface(): void {
    const app = this.#app as Application
    this.#statusKey = this.#snapshot ? this.#snapshot.statuses.join(',') : ''
    const gl = (app.renderer as { gl?: WebGLRenderingContext }).gl
    if (this.#contextLost || gl?.isContextLost()) return // redrawn on restore
    const extent = boardExtent(this.#layout)
    const { square, frame } = this.#layout
    const seatRgb = (s: Seat) => {
      const st = this.#statusOf(s)
      let c = bandColor(s)
      if (st === 'removed') c = mixHex(shadeHex(c, 0.5), '#3a3430', 0.75)
      else if (st === 'frozen') c = mixHex(c, FROZEN_BASE, 0.75)
      else if (st === 'defeated') c = mixHex(c, '#4a4440', 0.45)
      return new Float32Array(hexToRgb(shadeHex(c, 0.9)))
    }
    const gain = (s: Seat) => (this.#statusOf(s) === 'active' ? bandGain(s) : 1)
    const uniforms = {
      uSize: { value: new Float32Array([extent, extent]), type: 'vec2<f32>' },
      uSq: { value: square, type: 'f32' },
      uFrame: { value: frame, type: 'f32' },
      uPx: { value: 1 / (square * this.#res), type: 'f32' },
      uLight: { value: new Float32Array(hexToRgb('#e2c89a')), type: 'vec3<f32>' },
      uDark: { value: new Float32Array(hexToRgb('#8c5633')), type: 'vec3<f32>' },
      uWood: { value: new Float32Array(hexToRgb('#4a2617')), type: 'vec3<f32>' },
      uBrass: { value: new Float32Array(hexToRgb('#d2ab5f')), type: 'vec3<f32>' },
      uSeatS: { value: seatRgb('south'), type: 'vec3<f32>' },
      uSeatW: { value: seatRgb('west'), type: 'vec3<f32>' },
      uSeatN: { value: seatRgb('north'), type: 'vec3<f32>' },
      uSeatE: { value: seatRgb('east'), type: 'vec3<f32>' },
      uGain: {
        value: new Float32Array([gain('south'), gain('west'), gain('north'), gain('east')]),
        type: 'vec4<f32>',
      },
      uSeed: { value: 0.37, type: 'f32' },
    } as const
    if (!this.#boardMesh) {
      const geometry = new MeshGeometry({
        positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      })
      const shader = new Shader({
        glProgram: GlProgram.from({
          vertex: BOARD_VERTEX,
          fragment: BOARD_FRAGMENT,
          name: 'board-surface',
          preferredFragmentPrecision: 'highp',
        }),
        resources: { boardUniforms: new UniformGroup({ ...uniforms }) },
      })
      this.#boardMesh = new Mesh({ geometry, shader })
    } else {
      const u = (this.#boardMesh.shader as Shader).resources.boardUniforms as UniformGroup
      const target = u.uniforms as Record<string, unknown>
      for (const [k, v] of Object.entries(uniforms)) target[k] = v.value
      u.update()
    }
    const mesh = this.#boardMesh
    mesh.scale.set(extent, extent)
    mesh.position.set(RT_PAD, RT_PAD)
    const size = Math.ceil(extent) + 2 * RT_PAD
    let rt = this.#boardRT
    if (!rt || rt.width !== size || rt.height !== size || rt.source.resolution !== this.#res) {
      const old = rt
      rt = RenderTexture.create({
        width: size,
        height: size,
        resolution: this.#res,
        antialias: false,
      })
      this.#boardRT = rt
      this.#boardSprite.texture = rt
      old?.destroy(true)
    }
    // Centre the sprite on the mesh's centre, not the padded texture's.
    const c = (RT_PAD + extent / 2) / size
    this.#boardSprite.anchor.set(c, c)
    app.renderer.render({ container: mesh, target: rt, clear: true })
  }

  /**
   * Board shadow and screen-space lighting. They only depend on the board
   * size, so they are redrawn on a rebuild, never on a status change. Both
   * are soft gradients, rasterised well below device resolution.
   */
  #renderDecor(): void {
    const extent = boardExtent(this.#layout)
    const shadowRes = Math.max(0.2, this.#res * 0.25)
    const sh = drawBoardShadow(extent, shadowRes)
    BoardView.#swapTexture(this.#boardShadow, canvasTexture(sh))
    this.#boardShadow.width = sh.width / shadowRes
    this.#boardShadow.height = sh.height / shadowRes
    const lightSize = Math.min(512, Math.ceil(extent * 0.5))
    const radius = 0.16 / (BOARD_SIZE + 2 * FRAME)
    BoardView.#swapTexture(this.#light, canvasTexture(drawLighting(lightSize, radius)))
  }

  /** Replaces a sprite's own (canvas-made) texture, destroying the old one. */
  static #swapTexture(sprite: Sprite, texture: Texture): void {
    const old = sprite.texture
    sprite.texture = texture
    if (old && old !== Texture.EMPTY && old !== Texture.WHITE) old.destroy(true)
  }

  #layoutStatic(): void {
    const { square: sq, frame } = this.#layout
    const half = (sq * BOARD_SIZE) / 2
    const off = frame * 0.27
    const fontSize = Math.max(8, Math.round(sq * 0.21))
    this.#labelTexts.forEach((t, i) => {
      const side = Math.floor(i / BOARD_SIZE)
      const k = i % BOARD_SIZE
      t.style.fontSize = fontSize
      t.resolution = this.#res
      const along = (k + 0.5) * sq - half
      const alongRank = (BOARD_SIZE - 1 - k + 0.5) * sq - half
      if (side === 0) t.position.set(along, half + off)
      else if (side === 2) t.position.set(along, -half - off)
      else if (side === 1) t.position.set(-half - off, alongRank)
      else t.position.set(half + off, alongRank)
    })
    // Medallions sit on the frame, overhanging its outer edge a little.
    const r = half + frame * MEDALLION_AT
    const pos: readonly (readonly [number, number])[] = [
      [0, r],
      [-r, 0],
      [0, -r],
      [r, 0],
    ]
    this.#medallions.forEach((m, i) => {
      const p = pos[i] as readonly [number, number]
      m.sprite.position.set(p[0], p[1])
      m.glow.position.set(p[0], p[1])
      m.glow.width = sq * MEDALLION * 1.9
      m.glow.height = sq * MEDALLION * 1.9
      this.#sizeMedallion(i)
    })
    this.#leaderGlows.forEach((g) => {
      g.width = sq * 1.5
      g.height = sq * 1.5
    })
  }

  /** Medallion size: larger for the seat to move. */
  #sizeMedallion(i: number): void {
    const m = this.#medallions[i] as Medallion
    const snap = this.#snapshot
    const active = !!snap && !snap.isOver && seatOrder(snap.seatToMove) === i
    const d = this.#layout.square * MEDALLION * (active ? MEDALLION_ACTIVE : 1)
    m.sprite.width = d
    m.sprite.height = d
  }

  #setAngle(angle: number): void {
    this.#angle = angle
    const app = this.#app
    if (!app) return
    const extent = boardExtent(this.#layout) + 2 * MARGIN * this.#layout.square
    const c = Math.abs(Math.cos(angle))
    const s = Math.abs(Math.sin(angle))
    const avail = Math.min(app.screen.width, app.screen.height)
    const need = extent * (c + s)
    // While a resize settles, the scene (built for the old size) is scaled to the new one.
    const pending = this.#targetSq / this.#layout.square
    this.#fitScale = pending * Math.min(1, avail / Math.max(1, need * pending))
    this.#root.rotation = angle
    this.#root.scale.set(this.#fitScale)
    // Upright children.
    const counter = -angle
    for (const t of this.#labelTexts) t.rotation = counter
    for (const m of this.#medallions) m.sprite.rotation = counter
    for (const n of this.#pieces) {
      if (!n) continue
      n.node.rotation = counter
      n.shadow.rotation = counter
    }
    for (const c2 of this.#movingLayer.children) c2.rotation = counter
    for (const c2 of this.#dragLayer.children) c2.rotation = counter
    rotateVector(
      SHADOW_DX * this.#layout.square,
      SHADOW_DY * this.#layout.square,
      counter,
      this.#shadowLocal,
    )
    for (const n of this.#pieces) if (n) this.#placeShadow(n)
    if (this.#drag) {
      this.#drag.node.shadow.rotation = counter
      this.#placeShadow(this.#drag.node)
    }
    // Screen-space lighting follows the board footprint.
    const ext = boardExtent(this.#layout) * this.#fitScale
    this.#light.position.copyFrom(this.#root.position)
    this.#light.alpha = Math.max(0, 1 - 6 * Math.abs(Math.sin(angle) * Math.cos(angle)))
    this.#light.width = ext
    this.#light.height = ext
    this.#boardShadow.position.set(0, 0)
    rotateVector(0, this.#layout.square * 0.32, counter, this.#tmpVec2)
    this.#boardShadow.position.set(this.#tmpVec2.x, this.#tmpVec2.y)
    if (this.#promo) this.#closePromo(true)
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------

  #statusOf(seat: Seat): string {
    return this.#snapshot?.statuses[seatOrder(seat)] ?? 'active'
  }

  #variantFor(owner: Seat): PieceVariant {
    return this.#statusOf(owner) === 'frozen' ? 'frozen' : owner
  }

  #createNode(piece: Piece, square: number): PieceNode {
    const node = new Container()
    const body = new Sprite()
    body.anchor.set(0.5)
    const marker = new Sprite()
    marker.anchor.set(0.5)
    node.addChild(body, marker)
    const shadow = new Sprite()
    shadow.anchor.set(0.5)
    shadow.alpha = 0.42
    const n: PieceNode = {
      node,
      body,
      marker,
      shadow,
      kind: piece.kind,
      owner: piece.owner,
      variant: this.#variantFor(piece.owner),
      lift: 0,
      moving: false,
    }
    this.#pieceLayer.addChild(node)
    this.#shadowLayer.addChild(shadow)
    this.#applyNodeTextures(n)
    squareCenter(square, this.#layout, this.#tmpVec)
    node.position.set(this.#tmpVec.x, this.#tmpVec.y)
    node.rotation = -this.#angle
    shadow.rotation = -this.#angle
    this.#placeShadow(n)
    return n
  }

  #destroyNode(n: PieceNode): void {
    n.node.destroy({ children: true })
    n.shadow.destroy()
  }

  #applyNodeTextures(n: PieceNode): void {
    const atlas = this.#atlas
    const sq = this.#layout.square
    const size = sq * PIECE_SCALE
    if (atlas) {
      n.body.texture = atlas.piece(n.kind, n.variant)
      n.shadow.texture = atlas.shadow(n.kind)
      n.marker.texture = atlas.marker(n.owner)
    }
    const mirrored = n.kind === 'knight' && relativeSeat(n.owner, this.#perspective) >= 2
    n.body.width = size
    n.body.height = size
    n.body.scale.x = Math.abs(n.body.scale.x) * (mirrored ? -1 : 1)
    n.body.y = sq * 0.01
    const ratio = atlas ? atlas.cell / atlas.size : 1.2
    n.shadow.width = size * ratio
    n.shadow.height = size * ratio
    n.shadow.scale.x = Math.abs(n.shadow.scale.x) * (mirrored ? -1 : 1)
    // The marker texture's shape spans 80% of it: about 0.26 sq, upper right, clear of the base.
    n.marker.width = sq * 0.33
    n.marker.height = sq * 0.33
    n.marker.position.set(sq * 0.31, -sq * 0.31)
    n.marker.visible = this.#options.colorblindPatterns
    n.body.alpha = 1
  }

  #placeShadow(n: PieceNode): void {
    const k = 1 + n.lift * 2.2
    n.shadow.position.set(
      n.node.x + this.#shadowLocal.x * k,
      n.node.y + this.#shadowLocal.y * k + this.#layout.square * 0.01,
    )
    const s = 1 + n.lift * 0.15
    n.node.scale.set(s)
    const base = this.#atlas ? this.#atlas.cell / this.#atlas.size : 1.2
    const size = this.#layout.square * PIECE_SCALE * base * (1 + n.lift * 0.18)
    const mirrored = n.shadow.scale.x < 0
    n.shadow.width = size
    n.shadow.height = size
    if (mirrored) n.shadow.scale.x = -Math.abs(n.shadow.scale.x)
    n.shadow.alpha = n.node.alpha * (0.42 - n.lift * 0.14)
  }

  #refreshPieceTextures(): void {
    for (const n of this.#pieces) if (n) this.#applyNodeTextures(n)
    if (this.#drag) this.#applyNodeTextures(this.#drag.node)
  }

  #refreshPieceFacing(): void {
    this.#refreshPieceTextures()
  }

  #layoutPieces(): void {
    rotateVector(
      SHADOW_DX * this.#layout.square,
      SHADOW_DY * this.#layout.square,
      -this.#angle,
      this.#shadowLocal,
    )
    for (let i = 0; i < 144; i++) {
      const n = this.#pieces[i]
      if (!n) continue
      squareCenter(i, this.#layout, this.#tmpVec)
      n.node.position.set(this.#tmpVec.x, this.#tmpVec.y)
      this.#applyNodeTextures(n)
      this.#placeShadow(n)
    }
  }

  /** Makes the scene match `snap` immediately. */
  #applyInstant(snap: Snapshot): void {
    this.#dissolveLayer.removeChildren().forEach((c) => {
      c.destroy({ children: true })
    })
    for (let i = 0; i < 144; i++) {
      const want = snap.board[i] ?? null
      const have = this.#pieces[i] ?? null
      if (have && want && have.kind === want.kind && have.owner === want.owner) {
        const v = this.#variantFor(want.owner)
        if (v !== have.variant) {
          have.variant = v
          this.#applyNodeTextures(have)
        }
        have.node.alpha = 1
        have.lift = 0
        squareCenter(i, this.#layout, this.#tmpVec)
        have.node.position.set(this.#tmpVec.x, this.#tmpVec.y)
        this.#placeShadow(have)
        continue
      }
      if (have) this.#destroyNode(have)
      this.#pieces[i] = want ? this.#createNode(want, i) : null
    }
  }

  /** Slides every displaced piece back to its square (rejected intent / resync). */
  #settleAll(): void {
    const dur = this.#options.reducedMotion ? 0 : MOVE_MS
    for (let i = 0; i < 144; i++) {
      const n = this.#pieces[i]
      if (!n) continue
      squareCenter(i, this.#layout, this.#tmpVec)
      const tx = this.#tmpVec.x
      const ty = this.#tmpVec.y
      if (Math.hypot(n.node.x - tx, n.node.y - ty) < 0.5) continue
      this.#slide(n, tx, ty, dur, 0)
    }
  }

  #slide(
    n: PieceNode,
    tx: number,
    ty: number,
    duration: number,
    delay: number,
    done?: () => void,
  ): Tween {
    const fx = n.node.x
    const fy = n.node.y
    const dist = Math.hypot(tx - fx, ty - fy)
    const dur = dist < this.#layout.square * 0.15 ? Math.min(duration, 70) : duration
    n.moving = true
    this.#movingLayer.addChild(n.node)
    n.node.rotation = -this.#angle
    return this.#anim.add(
      dur,
      (k) => {
        n.node.x = fx + (tx - fx) * k
        n.node.y = fy + (ty - fy) * k
        n.lift = dist > this.#layout.square * 0.5 ? Math.sin(Math.PI * k) * 0.35 : 0
        this.#placeShadow(n)
      },
      {
        delay,
        ease: ease.inOutCubic,
        done: () => {
          n.moving = false
          n.lift = 0
          if (!n.node.destroyed) {
            this.#pieceLayer.addChild(n.node)
            this.#placeShadow(n)
          }
          done?.()
        },
      },
    )
  }

  #applyPlan(
    next: Snapshot,
    plan: AnimationPlan,
    keep: { node: PieceNode; tween: Tween } | null = null,
  ): void {
    const reduced = this.#options.reducedMotion
    const moveMs = reduced ? 0 : MOVE_MS
    const sq = this.#layout.square

    // Detach captured, dissolving and moving pieces before re-slotting.
    const captured: { n: PieceNode; square: number; onDest: boolean }[] = []
    for (const c of plan.captures) {
      const n = this.#pieces[c.square]
      this.#pieces[c.square] = null
      if (n) captured.push({ n, square: c.square, onDest: c.onDestination })
    }
    const dissolving: PieceNode[] = []
    for (const d of plan.dissolves) {
      const n = this.#pieces[d.square]
      this.#pieces[d.square] = null
      if (n) dissolving.push(n)
    }
    const movers: { n: PieceNode; to: number; promote: PieceKind | null; rook: boolean }[] = []
    for (const m of plan.moves) {
      const n = this.#pieces[m.from]
      this.#pieces[m.from] = null
      if (n) movers.push({ n, to: m.to, promote: m.promoteTo, rook: m.castleRook })
    }
    for (const mv of movers) {
      // A piece left on the destination (should not happen) is replaced.
      const stale = this.#pieces[mv.to]
      if (stale) this.#destroyNode(stale)
      this.#pieces[mv.to] = mv.n
      squareCenter(mv.to, this.#layout, this.#tmpVec)
      const tx = this.#tmpVec.x
      const ty = this.#tmpVec.y
      const promote = mv.promote
      const landed = () => {
        if (promote) {
          mv.n.kind = promote
          this.#applyNodeTextures(mv.n)
          this.#promotionBurst(tx, ty, mv.n.owner)
        }
      }
      if (keep && keep.node === mv.n && keep.tween.alive) {
        // The user's slide is already heading here: chain onto it.
        const prevDone = keep.tween.done
        keep.tween.done = () => {
          prevDone?.()
          landed()
        }
        continue
      }
      this.#slide(mv.n, tx, ty, moveMs, mv.rook ? (reduced ? 0 : 70) : 0, landed)
    }
    const impactDelay = reduced ? 0 : moveMs * 0.82
    for (const c of captured) {
      this.#captureEffect(c.n, c.square, impactDelay)
    }
    if (dissolving.length > 0) this.#dissolve(dissolving, reduced ? 0 : moveMs)

    for (const a of plan.appears) {
      const stale = this.#pieces[a.square]
      if (stale) this.#destroyNode(stale)
      const n = this.#createNode(a.piece, a.square)
      this.#pieces[a.square] = n
      n.node.alpha = 0
      this.#anim.add(reduced ? 120 : 260, (k) => {
        n.node.alpha = k
        this.#placeShadow(n)
      })
    }

    // Status changes: freeze cross-fades to frosted grey.
    for (const ch of plan.statusChanges) {
      if (ch.status === 'frozen') this.#freezeSeat(ch.seat, reduced ? 0 : moveMs)
    }

    // Safety net: anything still out of sync with the snapshot is fixed instantly.
    for (let i = 0; i < 144; i++) {
      const want = next.board[i] ?? null
      const have = this.#pieces[i] ?? null
      const promoting = movers.some((m) => m.to === i && m.promote !== null)
      if (have && want && have.owner === want.owner && (have.kind === want.kind || promoting))
        continue
      if (!have && !want) continue
      if (have) this.#destroyNode(have)
      this.#pieces[i] = want ? this.#createNode(want, i) : null
    }

    if (plan.gameEnded && next.outcome && !reduced) {
      const half = (sq * BOARD_SIZE) / 2 + this.#layout.frame
      const spots: readonly (readonly [number, number])[] = [
        [0, half],
        [-half, 0],
        [0, -half],
        [half, 0],
      ]
      next.outcome.placements.forEach((place, i) => {
        if (place !== 1) return
        const [x, y] = spots[i] as readonly [number, number]
        this.#anim.add(0, () => this.#burst(x, y, seatColor(SEATS[i] as Seat), 'promote'), {
          delay: moveMs + 250 + i * 120,
        })
      })
    }
    for (const cue of soundCues(plan)) {
      const delay =
        cue === 'move' || cue === 'capture' || cue === 'castle' ? moveMs * 0.75 : moveMs + 60
      this.#playLater(cue, delay)
    }
  }

  #captureEffect(n: PieceNode, square: number, delay: number): void {
    squareCenter(square, this.#layout, this.#tmpVec)
    const x = this.#tmpVec.x
    const y = this.#tmpVec.y
    const color = seatColor(n.owner)
    const reduced = this.#options.reducedMotion
    this.#anim.add(
      reduced ? 100 : 170,
      (k) => {
        n.node.alpha = 1 - k
        n.node.scale.set(1 - k * 0.35)
        n.shadow.alpha = 0.42 * (1 - k)
      },
      {
        delay,
        ease: ease.outQuad,
        done: () => this.#destroyNode(n),
      },
    )
    if (reduced) return
    this.#anim.add(0, () => this.#burst(x, y, color, 'capture'), { delay })
  }

  #burst(x: number, y: number, color: string, kind: 'capture' | 'promote' | 'freeze'): void {
    const p = this.#particles
    const fx = this.#effects
    if (!p || !fx) return
    const sq = this.#layout.square
    const tint = hexToNumber(mixHex(color, '#ffffff', 0.25))
    if (kind === 'capture') {
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2
        const v = sq * (1.6 + Math.random() * 2.6)
        p.emit(
          fx.dot,
          x,
          y,
          Math.cos(a) * v,
          Math.sin(a) * v,
          0.4 + Math.random() * 0.35,
          sq * (0.1 + Math.random() * 0.12),
          tint,
          { drag: 3.2 },
        )
      }
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2
        const v = sq * (2.5 + Math.random() * 3)
        p.emit(
          fx.spark,
          x,
          y,
          Math.cos(a) * v,
          Math.sin(a) * v,
          0.28 + Math.random() * 0.2,
          sq * 0.26,
          0xfff2d0,
          { drag: 6, spin: 6 },
        )
      }
      p.emit(fx.ring, x, y, 0, 0, 0.32, sq * 0.5, tint, { endScale: 3.4, drag: 0, alpha: 0.75 })
      p.emit(fx.glow, x, y, 0, 0, 0.22, sq * 1.2, 0xffe6b0, { endScale: 1.5, alpha: 0.32 })
    } else if (kind === 'promote') {
      p.emit(fx.glow, x, y, 0, 0, 0.6, sq * 1.2, 0xffe08a, { endScale: 2.6, alpha: 0.9 })
      p.emit(fx.ring, x, y, 0, 0, 0.45, sq * 0.6, 0xffe9b0, { endScale: 3.2, drag: 0, alpha: 0.9 })
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        const v = sq * (1.5 + Math.random() * 1.5)
        p.emit(
          fx.spark,
          x,
          y,
          Math.cos(a) * v,
          Math.sin(a) * v,
          0.5 + Math.random() * 0.3,
          sq * 0.24,
          0xfff0c0,
          { drag: 3, spin: 4 },
        )
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2
        const v = sq * (0.3 + Math.random() * 0.6)
        p.emit(
          fx.spark,
          x + Math.cos(a) * sq * 0.2,
          y + Math.sin(a) * sq * 0.25,
          Math.cos(a) * v,
          Math.sin(a) * v,
          0.6 + Math.random() * 0.4,
          sq * (0.14 + Math.random() * 0.14),
          0xdff2ff,
          { drag: 2, spin: 2 },
        )
      }
    }
  }

  #promotionBurst(x: number, y: number, owner: Seat): void {
    if (this.#options.reducedMotion) return
    this.#burst(x, y, seatColor(owner), 'promote')
  }

  #freezeSeat(seat: Seat, delay: number): void {
    const reduced = this.#options.reducedMotion
    for (let i = 0; i < 144; i++) {
      const n = this.#pieces[i]
      if (!n || n.owner !== seat || n.variant === 'frozen') continue
      const atlas = this.#atlas
      const over = new Sprite(atlas ? atlas.piece(n.kind, 'frozen') : Texture.EMPTY)
      over.anchor.set(0.5)
      over.width = n.body.width
      over.height = n.body.height
      over.scale.x = n.body.scale.x
      over.y = n.body.y
      over.alpha = 0
      n.node.addChildAt(over, 1)
      const stagger = reduced ? 0 : (i % 12) * 18 + Math.floor(i / 12) * 10
      squareCenter(i, this.#layout, this.#tmpVec)
      const x = this.#tmpVec.x
      const y = this.#tmpVec.y
      this.#anim.add(
        reduced ? 150 : 650,
        (k) => {
          over.alpha = k
        },
        {
          delay: delay + stagger,
          ease: ease.inOutSine,
          done: () => {
            n.variant = 'frozen'
            this.#applyNodeTextures(n)
            over.destroy()
          },
        },
      )
      if (!reduced) {
        this.#anim.add(0, () => this.#burst(x, y, FROZEN_BASE, 'freeze'), {
          delay: delay + stagger,
        })
      }
    }
  }

  #dissolve(nodes: PieceNode[], delay: number): void {
    const reduced = this.#options.reducedMotion
    const group = new Container()
    this.#dissolveLayer.addChild(group)
    const shadows = new Container()
    group.addChild(shadows)
    const owner = nodes[0]?.owner ?? 'south'
    for (const n of nodes) {
      shadows.addChild(n.shadow)
      group.addChild(n.node)
    }
    const edge = hexToRgb(mixHex(seatColor(owner), '#ffb347', 0.5))
    let uniforms: UniformGroup | null = null
    if (!reduced) {
      uniforms = new UniformGroup({
        uProgress: { value: 0, type: 'f32' },
        uEdge: { value: new Float32Array(edge), type: 'vec3<f32>' },
      })
      group.filters = [
        new Filter({
          glProgram: GlProgram.from({
            vertex: defaultFilterVert,
            fragment: DISSOLVE_FRAGMENT,
            name: 'board-dissolve',
            preferredFragmentPrecision: 'highp',
          }),
          resources: { dissolveUniforms: uniforms },
          resolution: this.#res,
          padding: 4,
        }),
      ]
    }
    const sq = this.#layout.square
    const p = this.#particles
    const fx = this.#effects
    const tint = hexToNumber(mixHex(seatColor(owner), '#ffcf7a', 0.4))
    const dur = reduced ? 300 : 1300
    let emitted = 0
    this.#anim.add(
      dur,
      (k) => {
        if (uniforms) {
          ;(uniforms.uniforms as { uProgress: number }).uProgress = k
        } else {
          group.alpha = 1 - k
        }
        // Embers rise (screen up) while the army burns away.
        if (!reduced && p && fx && k < 0.85) {
          const want = Math.floor(k * nodes.length * 5)
          while (emitted < want) {
            const n = nodes[emitted % nodes.length] as PieceNode
            emitted++
            rotateVector(0, -sq * (0.6 + Math.random() * 0.8), -this.#angle, this.#tmpVec2)
            p.emit(
              fx.dot,
              n.node.x + (Math.random() - 0.5) * sq * 0.5,
              n.node.y + (Math.random() - 0.3) * sq * 0.5,
              this.#tmpVec2.x + (Math.random() - 0.5) * sq * 0.3,
              this.#tmpVec2.y,
              0.7 + Math.random() * 0.5,
              sq * (0.07 + Math.random() * 0.08),
              tint,
              { drag: 0.8 },
            )
          }
        }
      },
      {
        delay,
        ease: ease.linear,
        done: () => {
          group.destroy({ children: true })
        },
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Decorations: medallions, highlights, glows
  // ---------------------------------------------------------------------------

  #refreshAll(): void {
    if (!this.#ready) return
    void this.#refreshMedallions(false)
    this.#refreshBoardIfStatusChanged()
    for (const n of this.#pieces) {
      if (!n) continue
      const v = this.#variantFor(n.owner)
      if (v !== n.variant && !(v === 'frozen' && n.node.children.length > 2)) {
        n.variant = v
      }
      this.#applyNodeTextures(n)
    }
    this.#refreshLeaderGlows()
    this.#refreshTurn()
    this.#refreshFx()
  }

  #statusKey = ''

  #refreshBoardIfStatusChanged(): void {
    const key = this.#snapshot ? this.#snapshot.statuses.join(',') : ''
    if (key === this.#statusKey) return
    this.#renderSurface()
  }

  async #refreshMedallions(force: boolean): Promise<void> {
    const snap = this.#snapshot
    const sizePx = Math.ceil(this.#layout.square * MEDALLION * this.#res)
    const gen = this.#generation
    await Promise.all(
      SEATS.map(async (seat, i) => {
        const m = this.#medallions[i] as Medallion
        const civ = snap?.config.civs[i]?.id ?? 'canada'
        const status = (snap?.statuses[i] ?? 'active') as MedallionState
        const key = `${civ}:${status}:${sizePx}`
        if (!force && key === m.key) return
        m.key = key
        const c = await drawMedallion(civ, seat, status, sizePx)
        if (gen !== this.#generation || this.#destroyed || m.key !== key) return
        const old = m.sprite.texture
        m.sprite.texture = canvasTexture(c)
        this.#sizeMedallion(i)
        m.sprite.alpha = status === 'removed' ? 0.72 : 1
        if (old !== Texture.EMPTY) old.destroy(true)
      }),
    )
  }

  /**
   * Whose turn it is: the active seat's band glows (pulsing) and its medallion
   * grows with a light ring; the other seats' bands are dimmed (in `#refreshFx`).
   */
  #refreshTurn(): void {
    const snap = this.#snapshot
    const g = this.#bandGlow
    const ring = this.#medalRing
    for (const m of this.#medallions) m.glow.visible = false
    for (let i = 0; i < 4; i++) this.#sizeMedallion(i)
    ring.clear()
    ring.visible = false
    if (!snap || snap.isOver) {
      g.visible = false
      return
    }
    const seat = snap.seatToMove
    const i = seatOrder(seat)
    const { square: sq, frame } = this.#layout
    const half = (sq * BOARD_SIZE) / 2
    const d = half + frame * 0.63
    const color = bandColor(seat)
    // Additive glow on an already bright band (Gold) would blow out to white.
    this.#bandGlowGain = seat === 'north' ? 0.45 : 1
    g.visible = true
    g.tint = hexToNumber(mixHex(color, '#ffffff', 0.08))
    g.width = sq * 12.2
    g.height = frame * 0.62
    g.rotation = i === 1 || i === 3 ? Math.PI / 2 : 0
    if (i === 0) g.position.set(0, d)
    else if (i === 1) g.position.set(-d, 0)
    else if (i === 2) g.position.set(0, -d)
    else g.position.set(d, 0)
    const m = this.#medallions[i] as Medallion
    m.glow.visible = true
    m.glow.tint = hexToNumber(mixHex(color, '#fff4d6', 0.3))
    // The medallion art's bezel radius is 0.46 of the sprite.
    const r = m.sprite.width * 0.46
    ring
      .circle(m.sprite.x, m.sprite.y, r + Math.max(1, sq * 0.02))
      .stroke({ color: hexToNumber(lightFor(color)), width: Math.max(2, sq * 0.04), alpha: 0.95 })
    ring.visible = true
  }

  #refreshLeaderGlows(): void {
    const snap = this.#snapshot
    for (const g of this.#leaderGlows) g.visible = false
    this.#attackedLeaders = []
    if (!snap || !this.#options.showAttackedLeaderGlow) return
    let k = 0
    for (let s = 0; s < 4; s++) {
      if (!snap.leaderUnderAttack[s]) continue
      const seat = SEATS[s] as Seat
      for (let i = 0; i < 144 && k < 4; i++) {
        const p = snap.board[i]
        if (!p || p.owner !== seat || p.kind !== 'king') continue
        const g = this.#leaderGlows[k++] as Sprite
        squareCenter(i, this.#layout, this.#tmpVec)
        g.position.set(this.#tmpVec.x, this.#tmpVec.y)
        g.visible = true
        g.alpha = 0.85
        this.#attackedLeaders.push(i)
      }
    }
  }

  #refreshFx(): void {
    const g = this.#fx
    const h = this.#hints
    g.clear()
    h.clear()
    if (!this.#ready) return
    const { square: sq, frame } = this.#layout
    const half = (sq * BOARD_SIZE) / 2
    const rect = (i: number) => {
      const file = i % BOARD_SIZE
      const row = BOARD_SIZE - 1 - Math.floor(i / BOARD_SIZE)
      return [file * sq - half, row * sq - half] as const
    }
    const insetBox = (i: number, width: number, color: number, alpha: number) => {
      const [x, y] = rect(i)
      const o = width / 2
      g.rect(x + o, y + o, sq - width, sq - width).stroke({ color, alpha, width })
    }
    // Turn: dim the bands of the seats not to move.
    const snap = this.#snapshot
    if (snap && !snap.isOver) {
      const a = half + frame * 0.5
      const b = frame * 0.26
      const len = sq * (BOARD_SIZE - 0.36)
      for (let i = 0; i < 4; i++) {
        if (i === seatOrder(snap.seatToMove)) continue
        if (i === 0) g.rect(-len / 2, a, len, b)
        else if (i === 1) g.rect(-a - b, -len / 2, b, len)
        else if (i === 2) g.rect(-len / 2, -a - b, len, b)
        else g.rect(a, -len / 2, b, len)
        g.fill({ color: 0x0c0806, alpha: 0.18 })
      }
    }
    // Last move: one neutral warm fill for every seat; the mover shows in the border colour.
    const lm = this.#lastMove
    if (lm) {
      for (const i of [lm.from, lm.to]) {
        const [x, y] = rect(i)
        g.rect(x, y, sq, sq).fill({ color: 0xf7d978, alpha: i === lm.to ? 0.4 : 0.22 })
        insetBox(i, Math.max(2, sq * 0.04), hexToNumber(seatColor(lm.seat)), 0.9)
      }
    }
    // Attacked leader: a steady red border (the halo under the piece pulses).
    for (const i of this.#attackedLeaders) {
      const [x, y] = rect(i)
      const w = Math.max(2, sq * 0.04)
      h.rect(x + w / 2, y + w / 2, sq - w, sq - w).stroke({ color: 0xff4d3d, width: w })
    }
    if (this.#selected >= 0) {
      const [x, y] = rect(this.#selected)
      g.rect(x, y, sq, sq).fill({ color: 0xffd25e, alpha: 0.42 })
      insetBox(this.#selected, Math.max(1.5, sq * 0.04), 0xffe9a0, 0.85)
    }
    if (this.#cursorVisible && this.#cursor >= 0) {
      const [x, y] = rect(this.#cursor)
      const inset = sq * 0.06
      g.roundRect(x + inset, y + inset, sq - inset * 2, sq - inset * 2, sq * 0.08).stroke({
        color: 0xffffff,
        alpha: 0.95,
        width: Math.max(2, sq * 0.05),
      })
    }
    // Legal-move hints for the selected piece: light marks that read on maple and walnut.
    if (this.#selected >= 0) {
      const mover = this.#snapshot?.board[this.#selected]?.owner ?? 'south'
      const ringColor = hexToNumber(lightFor(seatColor(mover)))
      const px = 1 / Math.max(1, this.#res)
      for (const t of this.#moves.targetsFrom(this.#selected)) {
        const [x, y] = rect(t.to)
        const cx = x + sq / 2
        const cy = y + sq / 2
        if (t.to === this.#hover) {
          h.rect(x, y, sq, sq).fill({ color: 0xffe9a0, alpha: 0.28 })
          const w = Math.max(3, sq * 0.05)
          h.rect(x + w / 2, y + w / 2, sq - w, sq - w).stroke({ color: 0xffe9a0, width: w })
        }
        if (t.capture) {
          const w = sq * 0.08
          h.circle(cx, cy, sq * 0.45 + w / 2 + px).stroke({
            color: 0x1a120c,
            alpha: 0.5,
            width: Math.max(1, px * 1.5),
          })
          h.circle(cx, cy, sq * 0.45).stroke({ color: ringColor, alpha: 0.85, width: w })
        } else {
          h.circle(cx, cy, sq * 0.16)
            .fill({ color: 0xf6ecd2, alpha: 0.6 })
            .stroke({ color: 0x1a120c, alpha: 0.35, width: Math.max(1, px * 1.5) })
        }
        if (t.promotions.length > 0) {
          h.circle(cx, cy, sq * 0.26).stroke({ color: 0xffd36b, alpha: 0.8, width: sq * 0.03 })
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  #lastTick = 0
  #clock = 0
  #timeScale = 1

  /**
   * Slows down (or speeds up) every animation; 1 = normal. For tests and
   * screenshots of effects mid-flight, not for production use.
   */
  set timeScale(v: number) {
    this.#timeScale = Math.max(0.01, v)
  }

  #tick(): void {
    const now = performance.now()
    // Tweens and particles share one clock. Long gaps (tab switch, a hitch)
    // are clamped for both, so effects never drift apart.
    const raw = this.#lastTick ? Math.min(250, now - this.#lastTick) : 0
    this.#lastTick = now
    const step = raw * this.#timeScale
    this.#clock += step
    const dt = step / 1000
    this.#time += dt
    this.#anim.update(this.#clock)
    this.#particles?.update(dt)
    const reduced = this.#options.reducedMotion
    const pulse = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(this.#time * 2.4)
    if (this.#bandGlow.visible) this.#bandGlow.alpha = (0.5 + 0.3 * pulse) * this.#bandGlowGain
    for (const m of this.#medallions) {
      if (m.glow.visible) m.glow.alpha = 0.35 + 0.4 * pulse
    }
    const lp = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(this.#time * 5.5)
    for (const g of this.#leaderGlows) {
      if (!g.visible) continue
      g.alpha = 0.6 + 0.4 * lp
      const s = (this.#layout.square * 1.5 * (0.95 + 0.1 * lp)) / Math.max(1, g.texture.width)
      g.scale.set(s)
    }
    // devicePixelRatio can change with no event at all (some zoom paths, emulation):
    // one property read per frame catches what the media query misses.
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1))
    if (dpr !== this.#res) void this.#relayout()
    // Idle (only the turn glow pulses): cap the frame rate to save power.
    const busy =
      this.animating ||
      this.#drag !== null ||
      this.#press !== null ||
      this.#promo !== null ||
      this.#rotTween !== null
    if (busy === this.#idleCapped) {
      this.#idleCapped = !busy
      const ticker = this.#app?.ticker
      if (ticker) ticker.maxFPS = busy ? 0 : IDLE_FPS
    }
  }

  #playLater(kind: SoundKind, delay: number): void {
    if (!this.#options.sound) return
    if (delay <= 0) {
      this.#sound.play(kind)
      return
    }
    this.#anim.add(0, () => this.#sound.play(kind), { delay })
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  #bindInput(cv: HTMLCanvasElement): void {
    const app = this.#app as Application
    const stage = app.stage
    stage.eventMode = 'static'
    stage.hitArea = app.screen
    stage.on('pointerdown', (e) => this.#onDown(e))
    stage.on('globalpointermove', (e) => this.#onMove(e))
    stage.on('pointerup', (e) => this.#onUp(e))
    stage.on('pointerupoutside', (e) => this.#onUp(e))
    cv.addEventListener('keydown', (e) => this.#onKey(e))
    cv.addEventListener('pointerleave', () => this.#setHover(-1))
    cv.addEventListener('contextmenu', (e) => {
      if (this.#drag) e.preventDefault()
    })
  }

  #hit(e: FederatedPointerEvent): number {
    this.#root.toLocal(e.global, undefined, this.#tmpPoint)
    return pointToSquare(this.#tmpPoint.x, this.#tmpPoint.y, this.#layout)
  }

  #canAct(): boolean {
    const s = this.#snapshot
    return (
      !!s &&
      !s.isOver &&
      this.#interactive !== null &&
      s.seatToMove === this.#interactive &&
      this.#rotTween === null
    )
  }

  #onDown(e: FederatedPointerEvent): void {
    this.#sound.unlock()
    if (this.#promo) return
    if (e.button !== 0 && e.pointerType === 'mouse') {
      this.#select(-1)
      return
    }
    this.#cursorVisible = false
    const sq = this.#hit(e)
    if (sq < 0 || !this.#canAct()) {
      this.#select(-1)
      return
    }
    if (this.#selected >= 0 && this.#selected !== sq && this.#moves.target(this.#selected, sq)) {
      this.#commit(this.#selected, sq, false)
      return
    }
    if (this.#moves.canMoveFrom(sq)) {
      const wasSelected = this.#selected === sq
      this.#select(sq)
      this.#press = { square: sq, x: e.global.x, y: e.global.y, wasSelected }
      return
    }
    if (this.#selected >= 0 && this.#snapshot?.board[sq]) this.#sound.play('illegal')
    this.#select(-1)
  }

  #onMove(e: FederatedPointerEvent): void {
    const sq = this.#hit(e)
    this.#setHover(sq)
    const cv = this.#app?.canvas
    if (this.#press && !this.#drag) {
      const d = Math.hypot(e.global.x - this.#press.x, e.global.y - this.#press.y)
      if (d > DRAG_THRESHOLD) this.#beginDrag(this.#press.square)
    }
    if (this.#drag) {
      this.#root.toLocal(e.global, undefined, this.#tmpPoint)
      const n = this.#drag.node
      n.node.position.set(this.#tmpPoint.x, this.#tmpPoint.y - this.#layout.square * 0.08)
      this.#placeShadow(n)
      // Fade a piece about to be captured so the lifted piece reads on top of it.
      const t = sq >= 0 ? this.#moves.target(this.#drag.square, sq) : null
      const victim = t?.capture ? (this.#pieces[sq] ?? null) : null
      this.#fadeNode(victim && victim !== n ? victim : null)
      if (cv) cv.style.cursor = 'grabbing'
      return
    }
    if (cv) {
      const act = this.#canAct()
      if (act && sq >= 0 && this.#moves.canMoveFrom(sq)) cv.style.cursor = 'grab'
      else if (act && this.#selected >= 0 && sq >= 0 && this.#moves.target(this.#selected, sq))
        cv.style.cursor = 'pointer'
      else cv.style.cursor = 'default'
    }
  }

  #onUp(e: FederatedPointerEvent): void {
    const press = this.#press
    this.#press = null
    if (this.#drag) {
      const from = this.#drag.square
      const to = this.#hit(e)
      if (to >= 0 && to !== from && this.#moves.target(from, to)) {
        this.#endDrag(true)
        this.#commit(from, to, true)
      } else {
        if (to >= 0 && to !== from) this.#sound.play('illegal')
        this.#endDrag(false)
        // Dropped back on its own square: keep it selected for click-to-move.
        if (to !== from) this.#select(-1)
      }
      return
    }
    if (press?.wasSelected && this.#hit(e) === press.square) this.#select(-1)
  }

  #setHover(sq: number): void {
    if (sq === this.#hover) return
    this.#hover = sq
    this.onSquareHover?.(sq >= 0 ? (nameOf(sq) as Square) : null)
    if (this.#selected >= 0) this.#refreshFx()
  }

  #select(sq: number): void {
    if (sq === this.#selected) return
    this.#selected = sq
    if (sq >= 0) this.#sound.play('select')
    this.#refreshFx()
  }

  #beginDrag(square: number): void {
    const n = this.#pieces[square]
    if (!n) return
    this.#drag = { square, node: n }
    this.#dragLayer.addChild(n.node)
    n.node.rotation = -this.#angle
    const from = n.lift
    this.#anim.add(110, (k) => {
      n.lift = from + (1 - from) * k
      this.#placeShadow(n)
    })
  }

  #fadeNode(n: PieceNode | null): void {
    if (n === this.#fadedNode) return
    const old = this.#fadedNode
    if (old && !old.node.destroyed) {
      old.node.alpha = 1
      this.#placeShadow(old)
    }
    this.#fadedNode = n
    if (n) {
      n.node.alpha = 0.45
      this.#placeShadow(n)
    }
  }

  /** Ends a drag; `keep` leaves the piece where it was dropped (a move intent follows). */
  #endDrag(keep: boolean): void {
    const d = this.#drag
    if (!d) return
    this.#drag = null
    this.#fadeNode(null)
    const n = d.node
    const cv = this.#app?.canvas
    if (cv) cv.style.cursor = 'default'
    if (n.node.destroyed) return
    this.#pieceLayer.addChild(n.node)
    const from = n.lift
    this.#anim.add(120, (k) => {
      n.lift = from * (1 - k)
      this.#placeShadow(n)
    })
    if (!keep) {
      squareCenter(d.square, this.#layout, this.#tmpVec)
      this.#slide(n, this.#tmpVec.x, this.#tmpVec.y, this.#options.reducedMotion ? 0 : 160, 0)
    }
  }

  /** A user move from -> to; asks for the promotion piece if needed. */
  #commit(from: number, to: number, dropped: boolean): void {
    const r = this.#moves.resolve(from, to)
    if (r === null) return
    const n = this.#pieces[from]
    if (n) {
      squareCenter(to, this.#layout, this.#tmpVec)
      const dur = dropped ? 90 : this.#options.reducedMotion ? 0 : MOVE_MS
      const tween = this.#slide(n, this.#tmpVec.x, this.#tmpVec.y, dur, 0)
      this.#commitSlide = { node: n, from, to, tween }
    }
    this.#selected = -1
    this.#refreshFx()
    if (r === 'promotion') {
      this.#openPromo(from, to)
      return
    }
    this.onMoveIntent?.(r)
  }

  #openPromo(from: number, to: number): void {
    const target = this.#moves.target(from, to)
    const owner = this.#snapshot?.board[from]?.owner
    if (!target || !owner || !this.#app) return
    const choices = target.promotions
    const container = new Container()
    const app = this.#app
    const sq = this.#layout.square * this.#fitScale
    const ext = boardExtent(this.#layout) * this.#fitScale
    const cx = this.#root.x
    const cy = this.#root.y
    const backdrop = new Graphics()
      .rect(cx - ext / 2, cy - ext / 2, ext, ext)
      .fill({ color: 0x07050a, alpha: 0.5 })
    backdrop.eventMode = 'static'
    backdrop.on('pointertap', () => this.#closePromo(true))
    container.addChild(backdrop)
    // Tiles in a column from the target square toward the board centre.
    squareCenter(to, this.#layout, this.#tmpVec)
    this.#tmpPoint.set(this.#tmpVec.x, this.#tmpVec.y)
    const g = this.#root.toGlobal(this.#tmpPoint)
    const dir = g.y < cy ? 1 : -1
    const tile = sq * 1.12
    const gap = sq * 0.1
    const total = choices.length * tile + (choices.length - 1) * gap
    let x = g.x
    const halfField = (BOARD_SIZE * sq) / 2
    x = Math.min(cx + halfField - tile / 2, Math.max(cx - halfField + tile / 2, x))
    const startY = dir > 0 ? g.y - tile / 2 : g.y + tile / 2 - total
    const startClamped = Math.min(cy + halfField - total, Math.max(cy - halfField, startY))
    const panel = new Graphics()
      .roundRect(x - tile / 2 - gap, startClamped - gap, tile + gap * 2, total + gap * 2, sq * 0.22)
      .fill({ color: 0x17110d, alpha: 0.94 })
      .stroke({ color: 0xd2ab5f, alpha: 0.9, width: Math.max(1.5, sq * 0.04) })
    container.addChild(panel)
    const tiles: Container[] = []
    const atlas = this.#atlas
    const parchment = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: '#f1e5c8' },
        { offset: 1, color: '#d8c49a' },
      ],
      textureSpace: 'local',
    })
    const radius = sq * 0.16
    choices.forEach((kind, idx) => {
      const t = new Container()
      t.position.set(x, startClamped + idx * (tile + gap) + tile / 2)
      // children: [base (focus glow + parchment tile), focus ring, piece]
      const base = new Container()
      const glow = new Sprite(this.#effects?.glow ?? Texture.EMPTY)
      glow.anchor.set(0.5)
      glow.width = tile * 1.7
      glow.height = tile * 1.7
      glow.tint = hexToNumber(seatColor(owner))
      glow.alpha = 0.5
      glow.blendMode = 'add'
      glow.visible = false
      const inner = Math.max(1, sq * 0.04)
      const bg = new Graphics()
        .roundRect(-tile / 2, -tile / 2, tile, tile, radius)
        .fill(parchment)
        // Soft inner shadow along the rim.
        .roundRect(
          -tile / 2 + inner / 2,
          -tile / 2 + inner / 2,
          tile - inner,
          tile - inner,
          radius - inner / 2,
        )
        .stroke({ color: 0x3a2814, alpha: 0.25, width: inner })
      base.addChild(glow, bg)
      const ringW = Math.max(3, sq * 0.05)
      const hl = new Graphics()
        .roundRect(-tile / 2 - ringW / 2, -tile / 2 - ringW / 2, tile + ringW, tile + ringW, radius)
        .stroke({ color: 0xe4c06a, width: ringW })
      hl.visible = false
      const sp = new Sprite(atlas ? atlas.piece(kind, owner) : Texture.EMPTY)
      sp.anchor.set(0.5)
      // The art fills about 84% of its sprite: the piece spans ~0.85 of the tile.
      sp.width = tile
      sp.height = tile
      t.addChild(base, hl, sp)
      t.eventMode = 'static'
      t.cursor = 'pointer'
      t.on('pointerover', () => this.#focusPromo(idx))
      t.on('pointertap', () => this.#choosePromo(kind))
      tiles.push(t)
      container.addChild(t)
    })
    this.#overlay.addChild(container)
    this.#promo = { from, to, choices, container, tiles, focus: 0 }
    this.#focusPromo(0)
    container.alpha = 0
    this.#anim.add(this.#options.reducedMotion ? 0 : 140, (k) => {
      container.alpha = k
    })
    void app
  }

  #focusPromo(i: number): void {
    const p = this.#promo
    if (!p) return
    p.focus = (i + p.tiles.length) % p.tiles.length
    p.tiles.forEach((t, k) => {
      const on = k === p.focus
      const hl = t.children[1]
      const glow = t.children[0]?.children[0]
      if (hl) hl.visible = on
      if (glow) glow.visible = on
      t.scale.set(on ? 1.06 : 1)
    })
  }

  #choosePromo(kind: PieceKind): void {
    const p = this.#promo
    if (!p) return
    const r = this.#moves.resolve(p.from, p.to, kind)
    this.#closePromo(false)
    if (typeof r === 'string' && r !== 'promotion') {
      this.#sound.play('select')
      this.onMoveIntent?.(r)
    }
  }

  /** Closes the picker; `revert` slides the pawn back. */
  #closePromo(revert: boolean): void {
    const p = this.#promo
    if (!p) return
    this.#promo = null
    p.container.destroy({ children: true })
    if (revert) this.#settleAll()
  }

  #onKey(e: KeyboardEvent): void {
    this.#sound.unlock()
    const p = this.#promo
    if (p) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') this.#focusPromo(p.focus - 1)
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') this.#focusPromo(p.focus + 1)
      else if (e.key === 'Enter' || e.key === ' ') {
        const k = p.choices[p.focus]
        if (k) this.#choosePromo(k)
      } else if (e.key === 'Escape') this.#closePromo(true)
      else return
      e.preventDefault()
      return
    }
    const dirs: Record<string, readonly [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }
    const d = dirs[e.key]
    if (d) {
      e.preventDefault()
      if (this.#cursor < 0) this.#cursor = this.#defaultCursor()
      else this.#cursor = stepCursor(this.#cursor, d[0], d[1], this.#perspective)
      this.#cursorVisible = true
      this.#hover = this.#cursor
      this.onSquareHover?.(nameOf(this.#cursor) as Square)
      this.#refreshFx()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (this.#cursor < 0) {
        this.#cursor = this.#defaultCursor()
        this.#cursorVisible = true
        this.#refreshFx()
        return
      }
      this.#cursorVisible = true
      if (!this.#canAct()) return
      const c = this.#cursor
      if (this.#selected >= 0 && this.#moves.target(this.#selected, c)) {
        this.#commit(this.#selected, c, false)
      } else if (this.#moves.canMoveFrom(c)) {
        this.#select(c === this.#selected ? -1 : c)
      } else {
        this.#select(-1)
      }
      return
    }
    if (e.key === 'Escape') {
      this.#select(-1)
      this.#cursorVisible = false
      this.#refreshFx()
    }
  }

  #defaultCursor(): number {
    const s = this.#snapshot
    const seat = this.#interactive ?? this.#perspective
    if (s) {
      for (let i = 0; i < 144; i++) {
        const p = s.board[i]
        if (p && p.owner === seat && p.kind === 'king') return i
      }
    }
    return 6 * BOARD_SIZE + 6
  }
}
