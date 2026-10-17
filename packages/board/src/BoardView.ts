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
  hopOffset,
  indexOf,
  NUM_SQUARES,
  nameOf,
  nearestAngle,
  nearestTarget,
  perspectiveAngle,
  pointToSquare,
  relativeSeat,
  rotateVector,
  seatOrder,
  squareCenter,
  stepCursor,
} from './geometry.ts'
import {
  blendPolicy,
  chebyshev,
  contactTime,
  flightLift,
  HANDOVER_AT,
  HINT_IN_MS,
  HINT_OUT_MS,
  handoverTiming,
  hintDelay,
  lastMoveTiming,
  REDUCED_GHOST_MS,
  SETTLE_MS,
  SNAP_BACK,
  scheduleMoves,
  snapBackEase,
  squareDistance,
  TAG_MOTION,
  TAG_USER,
} from './motion.ts'
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
import { Animator, ease, outBackWith, type Tween } from './tween.ts'

/** Display options (all can change at runtime through `setOptions`). */
export interface BoardOptions {
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

export interface SetCheckOptions {
  /** Play the check sound when the indicator turns on. Default true. */
  readonly sound?: boolean
}

export interface BoardViewInit extends Partial<BoardOptions> {
  onMoveIntent?: (move: string) => void
  onSquareHover?: (square: Square | null) => void
}

const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']

/**
 * Frame width, medallion size and outer margin, in squares. The margin only has to clear the
 * medallions, which overhang the frame by about 0.42 squares (kept tight: on the 16×16 board
 * every pixel of a phone's width goes to the squares).
 */
const FRAME = 0.8
const MEDALLION = 1.08
const MARGIN = 0.5
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
const ROTATE_MS = 760
/** Glide of a dropped piece onto its square centre, ms. */
const DROP_MS = 120
const SETTLE_EASE = outBackWith(1.6)
const MEDAL_IN_EASE = outBackWith(1.4)
const PROMO_EASE = outBackWith(1.5)
const HINT_EASE = outBackWith(1.7)
/** Highlight colour of the last move (both square shades). */
const LAST_MOVE_FILL = 0xffd66e
/**
 * Check indicator: the ring and square wash, and the tint of the glow under the leader. A hot
 * vermilion that no seat colour uses (South is crimson), with a light inner line as a cue that
 * doesn't depend on hue (colour-blind players, a red piece on the square).
 */
const CHECK_RED = 0xff5a1f
const CHECK_GLOW = 0xff7a3a
const CHECK_INNER = 0xfff1e0
/** Hover and selection lift. */
const HOVER_LIFT = 0.22
const SELECT_LIFT = 0.3
/** Victim reaction on capture. */
const KNOCK_MS = 230
const KNOCK_SQ = 0.22
const KNOCK_TILT = (14 * Math.PI) / 180
/** Leader capture: hit-stop and board shake. */
const HIT_STOP_MS = 120
const HIT_STOP_SCALE = 0.3
const SHAKE_MS = 160
const SHAKE_PX = 2.5
/** Delay of the army dissolve per square of distance from the leader, ms. */
const DISSOLVE_SPREAD_MS = 45
const DISSOLVE_MS = 1300
/** Status cross-fade of medallions and bands, ms. */
const STATUS_FADE_MS = 400
/** Shadow offset in screen space, in squares (light from the upper left). */
const SHADOW_DX = 0.045
const SHADOW_DY = 0.06
const DRAG_THRESHOLD = 5
/**
 * Fingertip slop for touch and pen (CSS px): a tap or drop this close to a legal target's
 * centre counts as that target, but never past the near half of the next square (plus
 * TOUCH_EDGE_PX), so tapping the middle of another square still means that square. It
 * mostly matters when squares are smaller than a fingertip (a 16×16 board on a phone).
 */
const TOUCH_SLOP_PX = 22
const TOUCH_EDGE_PX = 6
/** Smallest on-screen diameter of a quiet-move hint dot (CSS px). */
const HINT_DOT_MIN_PX = 9
/** The hint dot's diameter as a fraction of its texture (see `hintDot` in textures.ts). */
const HINT_DOT_FRACTION = 0.28

interface PieceNode {
  readonly node: Container
  readonly body: Sprite
  readonly marker: Sprite
  readonly shadow: Sprite
  kind: PieceKind
  readonly owner: Seat
  variant: PieceVariant
  /** The kind whose texture is shown (lags `kind` during a promotion flourish). */
  shown: PieceKind
  /** 0 resting, 1 fully lifted (drag). Drives scale and shadow. */
  lift: number
  /** Scale multiplier for squash and settle (1 = none). */
  squash: number
  /** Screen-up offset of the body above its ground position (knight hops), local px. */
  ox: number
  oy: number
  /** Whether a tween currently drives this node's position. */
  moving: boolean
  /** The flight tween driving the node, if any. */
  tween: Tween | null
  /** A hover/selection/drag lift tween, if any. */
  liftTween: Tween | null
}

interface Medallion {
  readonly sprite: Sprite
  readonly glow: Sprite
  /** Light ring around the medallion of the seat to move. */
  readonly ring: Graphics
  key: string
  /** Turn scale (1 idle, MEDALLION_ACTIVE for the seat to move), tweened. */
  scale: number
  /** Status scale and alpha (a removed seat's medallion shrinks and dims). */
  statusScale: number
  /** Turn glow and ring strength 0..1, tweened. */
  glowFade: number
}

/** One last-move highlight: a fill and a border per square, drawn once and faded with alpha. */
interface LastMoveSlot {
  readonly from: Graphics
  readonly to: Graphics
  key: string
}

interface Hint {
  readonly sprite: Sprite
  readonly promo: Sprite
  delay: number
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
  /** A legal move chosen by the user (engine notation, e.g. 'e2e4', 'e8e9q'). */
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
  /** The previous board surface, fading out after a status change. */
  readonly #boardFade = new Sprite()
  readonly #bandGlow = new Sprite()
  /** The previous seat's band glow, fading out at a turn handover. */
  readonly #bandGlowOut = new Sprite()
  readonly #bandDims = new Container()
  readonly #labels = new Container()
  readonly #lastMoveLayer = new Container()
  readonly #medalLayer = new Container()
  readonly #fx = new Graphics()
  readonly #selectLayer = new Container()
  readonly #selGfx = new Graphics()
  readonly #targetGfx = new Graphics()
  readonly #flashGfx = new Graphics()
  readonly #halo = new Sprite()
  readonly #hoverGlow = new Sprite()
  readonly #hintLayer = new Container()
  readonly #hints = new Graphics()
  readonly #leaderGlows: Sprite[] = []
  /** Red ring around each checked leader's square (pulses in `#tick`, steady under reduced motion). */
  readonly #checkRing = new Graphics()
  readonly #shadowLayer = new Container()
  readonly #pieceLayer = new Container()
  /** Captured pieces reacting and their debris: above resting pieces, below the attacker. */
  readonly #captureLayer = new Container()
  readonly #movingLayer = new Container()
  readonly #dissolveLayer = new Container()
  readonly #dragLayer = new Container()
  readonly #overlay = new Container()
  readonly #light = new Sprite()
  #particles: Particles | null = null
  /** Normal-blend debris (capture chips, coloured rings). */
  #chips: Particles | null = null
  #effects: EffectTextures | null = null
  #boardMesh: Mesh<MeshGeometry, Shader> | null = null
  #boardRT: RenderTexture | null = null
  #atlas: PieceAtlas | null = null
  #atlasSize = 0
  readonly #medallions: Medallion[] = []
  #labelTexts: Text[] = []
  // Turn indicator state (tweened at handovers).
  /** Seat index the turn visuals point at (-1 none), and the one they will point at. */
  #turnShown = -1
  #turnTarget = -1
  #bandFade = 0
  #bandOutFade = 0
  #bandOutGain = 1
  readonly #dim = [0, 0, 0, 0]
  #turnTweens: Tween[] = []
  // Last move highlight.
  readonly #lmSlots: LastMoveSlot[] = []
  #lmCur = 0
  #lmKey = ''
  // Status shown by bands and medallions (lags the snapshot until its effect plays).
  #shownStatuses: readonly string[] | null = null
  /** The pending status flip of the last plan that changed statuses. */
  #statusTrigger: Tween | null = null
  // Interaction visuals.
  readonly #hintPool: Hint[] = []
  #hintCount = 0
  #hintsFor = -1
  #hintFade = 0
  #hintTween: Tween | null = null
  #selShownFor = -1
  #selFade = 0
  #selTween: Tween | null = null
  #hoverNode: PieceNode | null = null
  #hoverTween: Tween | null = null
  // Leader-capture moment.
  #hitStop = 0
  #shakeLeft = 0
  /** The seat whose leader the host marks as in check (`setCheck`). */
  #checkSeat: Seat | null = null
  /** What the board shows: `#checkSeat` once the move that caused it has landed. */
  #checkShown: Seat | null = null
  #checkTween: Tween | null = null
  /** Squares of the checked leader(s), from the snapshot's `leaderSquares`. */
  #checkSquares: number[] = []
  /** Animation clock when the last snapshot was applied (to time the check after its move). */
  #snapshotClock = 0

  readonly #pieces: (PieceNode | null)[] = new Array(NUM_SQUARES).fill(null)
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
    this.#chips = new Particles(96)
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
    this.#snapshotClock = this.#clock
    this.#closePromo(false)
    this.#endDrag(false)
    const events = options.events ?? []
    const animate = (options.animate ?? true) && prev !== null
    const resync = prev !== null && prev.hash === snapshot.hash && prev.ply === snapshot.ply
    const plan = prev && !resync ? planTransition(prev, snapshot, events) : null
    const policy = blendPolicy(this.#anim.remaining(TAG_MOTION), prev ? snapshot.ply - prev.ply : 0)
    const canAnimate = !resync && animate && plan !== null && plan.appears.length <= 8
    const willAnimate = canAnimate && policy.mode === 'chain'
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
    // A move still in flight is hurried (never jumped) and the new one starts
    // right after it; a big catch-up is shown at once with a short cross-fade.
    let start = 0
    if (willAnimate)
      start = this.#anim.hurry(policy.mode === 'chain' ? policy.hurryMs : 0, TAG_MOTION)
    else this.#anim.finishAll(keep?.tween ?? null)
    if (prev && !resync) this.#lastMove = this.#nextLastMove(prev, snapshot, events, plan)
    this.#selected = -1
    this.#moves = new MoveIndex([])
    this.#handoverAt = start
    this.#lastMoveAt = { from: start, to: start }
    if (resync) {
      this.#settleAll()
    } else if (willAnimate && plan) {
      // Until the plan's effect starts, bands and medallions keep the old
      // statuses (or, while an earlier effect is still pending, what it shows now).
      if (plan.statusChanges.length > 0 && prev && !this.#statusTrigger?.alive) {
        this.#shownStatuses = [...prev.statuses]
      }
      this.#applyPlan(snapshot, plan, keep, start)
    } else {
      this.#applyInstant(snapshot, canAnimate && policy.mode === 'instant' ? policy.fadeMs : 0)
    }
    // Bands and medallions: a plan schedules its own status change, and an
    // earlier one still waiting for its burn or frost keeps its turn; otherwise now.
    const statusPending = willAnimate && this.#statusTrigger?.alive === true
    if (!(willAnimate && plan && plan.statusChanges.length > 0) && !statusPending) {
      this.#applyShownStatuses(null, canAnimate)
    }
    this.#syncTurn(this.#handoverAt, canAnimate)
    this.#drawLastMove(canAnimate)
    if (
      prev &&
      !resync &&
      this.#interactive !== null &&
      snapshot.seatToMove === this.#interactive &&
      prev.seatToMove !== this.#interactive &&
      !snapshot.isOver
    ) {
      this.#playLater('turn', Math.max(260, this.#handoverAt + 120))
    }
    // A check already shown follows its leader: when the leader itself moves (and stays in
    // check), the marking leaves the old square now and appears on the new one once the
    // slide lands, instead of jumping ahead of the piece. No second sound.
    const checked = this.#checkSeat
    if (checked !== null && this.#checkShown === checked && prev && willAnimate) {
      const s = SEATS.indexOf(checked)
      const before = prev.leaderSquares[s] ?? []
      const after = snapshot.leaderSquares[s] ?? []
      const moved = before.length !== after.length || before.some((sq, k) => sq !== after[k])
      if (moved) this.#showCheckAtHandover(checked, false)
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
    this.#setHoverPiece(null)
    this.#closePromo(true)
    this.#refreshFx()
  }

  /** Legal moves of the seat to move (from the engine). Used for hints and input. */
  setLegalMoves(moves: readonly MoveView[]): void {
    this.#moves = new MoveIndex(moves)
    if (this.#selected >= 0 && !this.#moves.canMoveFrom(this.#selected)) this.#selected = -1
    // Re-show the hints of a still-selected piece for the new move list.
    if (this.#selected >= 0) this.#hintsFor = -2
    this.#refreshFx()
  }

  /**
   * Marks `seat`'s leader square(s) as in check: a red ring and a pulsing red glow under the
   * piece (both steady under reduced motion), following the leader as it moves. `null` clears
   * it. The board never decides when a check is shown (that is the host's rule, e.g. only for
   * the local player); the squares come from the snapshot's `leaderSquares`, so a civ whose
   * leader is not a king works the same. Turning it on right after `setSnapshot` waits until
   * that move has landed, then plays the check sound (unless `sound: false`).
   */
  setCheck(seat: Seat | null, options: SetCheckOptions = {}): void {
    if (seat === this.#checkSeat) return
    this.#checkSeat = seat
    this.#anim.cancel(this.#checkTween)
    this.#checkTween = null
    if (seat === null || !this.#ready) {
      this.#checkShown = seat
      this.#refreshCheck()
      return
    }
    this.#showCheckAtHandover(seat, options.sound ?? true)
  }

  /**
   * Hides the check marking until the move in flight hands the turn over (when it lands),
   * then shows it on `seat`'s leader square(s), with the check sound when `sound`.
   */
  #showCheckAtHandover(seat: Seat, sound: boolean): void {
    this.#anim.cancel(this.#checkTween)
    this.#checkTween = null
    const show = () => {
      this.#checkTween = null
      if (this.#checkSeat !== seat) return
      this.#checkShown = seat
      this.#refreshCheck()
      if (sound) this.#playLater('check', 0)
    }
    const wait = this.#handoverAt - (this.#clock - this.#snapshotClock)
    this.#checkShown = null
    this.#refreshCheck()
    if (wait <= 0) show()
    else this.#checkTween = this.#anim.add(0, () => {}, { delay: wait, done: show })
  }

  /** The seat whose leader is marked in check (`setCheck`), or null. */
  get checkSeat(): Seat | null {
    return this.#checkSeat
  }

  /** Squares currently drawn as in check (empty until the move that caused it has landed). */
  get checkSquares(): Square[] {
    return this.#checkSquares.map((i) => nameOf(i) as Square)
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
      (this.#chips?.active ?? 0) > 0 ||
      this.#shakeLeft > 0 ||
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
      this.#endSurfaceFade()
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
    this.#boardFade.visible = false
    for (const g of [this.#bandGlow, this.#bandGlowOut]) {
      g.texture = fxTex.bar
      g.anchor.set(0.5)
      g.blendMode = 'add'
      g.visible = false
    }
    for (let i = 0; i < 4; i++) {
      const d = new Sprite(Texture.WHITE)
      d.tint = 0x0c0806
      d.alpha = 0
      d.visible = false
      this.#bandDims.addChild(d)
    }
    for (let i = 0; i < 4; i++) {
      const g = new Sprite(fxTex.halo)
      g.anchor.set(0.5)
      g.tint = CHECK_GLOW
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
      const ring = new Graphics()
      ring.alpha = 0
      ring.visible = false
      this.#medallions.push({
        sprite,
        glow,
        ring,
        key: '',
        scale: 1,
        statusScale: 1,
        glowFade: 0,
      })
    }
    // Rings after the glow/sprite pairs (medalLayer.children[2i] is seat i's glow).
    for (const m of this.#medallions) this.#medalLayer.addChild(m.ring)
    for (let i = 0; i < 2; i++) {
      const slot: LastMoveSlot = { from: new Graphics(), to: new Graphics(), key: '' }
      slot.from.alpha = 0
      slot.to.alpha = 0
      this.#lastMoveLayer.addChild(slot.from, slot.to)
      this.#lmSlots.push(slot)
    }
    for (const sp of [this.#halo, this.#hoverGlow]) {
      sp.texture = fxTex.glow
      sp.anchor.set(0.5)
      sp.blendMode = 'add'
      sp.alpha = 0
      sp.visible = false
    }
    this.#selGfx.visible = false
    this.#targetGfx.visible = false
    this.#flashGfx.visible = false
    this.#selectLayer.addChild(
      this.#selGfx,
      this.#hoverGlow,
      this.#halo,
      this.#targetGfx,
      this.#flashGfx,
    )
    this.#hintLayer.addChild(this.#hints)
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

    const particles = (this.#particles as Particles).container
    const chips = (this.#chips as Particles).container
    // Labels name the layers for tests and devtools (the order is the draw order).
    const layers: readonly [Container, string][] = [
      [this.#boardShadow, 'boardShadow'],
      [this.#boardSprite, 'board'],
      [this.#boardFade, 'boardFade'],
      [this.#bandGlowOut, 'bandGlowOut'],
      [this.#bandGlow, 'bandGlow'],
      [this.#bandDims, 'bandDims'],
      [this.#labels, 'labels'],
      [this.#lastMoveLayer, 'lastMove'],
      [this.#fx, 'fx'],
      [this.#selectLayer, 'select'],
      ...this.#leaderGlows.map((g, i) => [g, `leaderGlow${i}`] as [Container, string]),
      [this.#checkRing, 'checkRing'],
      [this.#hintLayer, 'hints'],
      [this.#shadowLayer, 'shadows'],
      [this.#pieceLayer, 'pieces'],
      [this.#captureLayer, 'captures'],
      [chips, 'chips'],
      [this.#movingLayer, 'moving'],
      [this.#dissolveLayer, 'dissolve'],
      [particles, 'particles'],
      [this.#medalLayer, 'medals'],
      [this.#dragLayer, 'drag'],
    ]
    for (const [c, label] of layers) {
      c.label = label
      this.#root.addChild(c)
    }
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
    this.#chips?.clear()
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
    this.#statusKey = this.#shownKey()
    const gl = (app.renderer as { gl?: WebGLRenderingContext }).gl
    if (this.#contextLost || gl?.isContextLost()) return // redrawn on restore
    const extent = boardExtent(this.#layout)
    const { square, frame } = this.#layout
    const seatRgb = (s: Seat) => {
      const st = this.#shownStatusOf(seatOrder(s))
      let c = bandColor(s)
      if (st === 'removed') c = mixHex(shadeHex(c, 0.5), '#3a3430', 0.75)
      else if (st === 'frozen') c = mixHex(c, FROZEN_BASE, 0.75)
      else if (st === 'defeated') c = mixHex(c, '#4a4440', 0.45)
      return new Float32Array(hexToRgb(shadeHex(c, 0.9)))
    }
    const gain = (s: Seat) => (this.#shownStatusOf(seatOrder(s)) === 'active' ? bandGain(s) : 1)
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
    // Labels have an 8 px floor so they stay legible, but never outgrow the frame.
    const fontSize = Math.min(Math.max(8, Math.round(sq * 0.21)), Math.max(6, frame * 0.6))
    // Medallions sit on the frame, overhanging its outer edge a little.
    const r = half + frame * MEDALLION_AT
    // A medallion's footprint at its largest (the seat to move): the labels next to it
    // step aside along the edge, or hide when they can't clear it.
    const medR = sq * MEDALLION * MEDALLION_ACTIVE * 0.46 + Math.max(1, sq * 0.02)
    this.#labelTexts.forEach((t, i) => {
      const side = Math.floor(i / BOARD_SIZE)
      const k = i % BOARD_SIZE
      t.style.fontSize = fontSize
      t.resolution = this.#res
      // Upright labels turn with the perspective, so allow for either orientation.
      const labelR = Math.max(t.width, t.height) / 2
      // Out from the field far enough that two-digit ranks don't reach into it.
      const off = Math.min(frame * 0.5, Math.max(frame * 0.27, labelR + 1))
      let along =
        side === 0 || side === 2 ? (k + 0.5) * sq - half : (BOARD_SIZE - 1 - k + 0.5) * sq - half
      const dy = r - (half + off)
      const need = medR + labelR
      t.visible = true
      if (Math.hypot(along, dy) < need) {
        const clear = Math.sqrt(Math.max(0, need * need - dy * dy))
        if (clear - Math.abs(along) <= sq * 0.35) along = Math.sign(along || 1) * clear
        else t.visible = false
      }
      if (side === 0) t.position.set(along, half + off)
      else if (side === 2) t.position.set(along, -half - off)
      else if (side === 1) t.position.set(-half - off, along)
      else t.position.set(half + off, along)
    })
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
      // The medallion art's bezel radius is 0.46 of the sprite; drawn at the active size.
      const r = sq * MEDALLION * MEDALLION_ACTIVE * 0.46 + Math.max(1, sq * 0.02)
      m.ring.clear()
      m.ring.circle(0, 0, r).stroke({
        color: hexToNumber(lightFor(bandColor(SEATS[i] as Seat))),
        width: Math.max(2, sq * 0.04),
        alpha: 0.95,
      })
      m.ring.position.set(p[0], p[1])
      this.#sizeMedallion(i)
    })
    this.#leaderGlows.forEach((g) => {
      g.width = sq * 1.5
      g.height = sq * 1.5
    })
    // Dims over the bands of the seats not to move.
    const a = half + frame * 0.5
    const b = frame * 0.26
    const len = sq * (BOARD_SIZE - 0.36)
    this.#bandDims.children.forEach((d, i) => {
      const sp = d as Sprite
      if (i === 0) sp.position.set(-len / 2, a)
      else if (i === 1) sp.position.set(-a - b, -len / 2)
      else if (i === 2) sp.position.set(-len / 2, -a - b)
      else sp.position.set(a, -len / 2)
      sp.width = i === 0 || i === 2 ? len : b
      sp.height = i === 0 || i === 2 ? b : len
    })
    this.#placeBand(this.#bandGlow, this.#turnShown)
    this.#bandGlowOut.visible = false
    this.#bandOutFade = 0
    // Selection, hovered target and illegal-drop flash: drawn once per size, moved and faded.
    const w = Math.max(1.5, sq * 0.04)
    this.#selGfx.clear()
    this.#selGfx
      .rect(0, 0, sq, sq)
      .fill({ color: 0xffd25e, alpha: 0.25 })
      .roundRect(
        w / 2 + sq * 0.03,
        w / 2 + sq * 0.03,
        sq - w - sq * 0.06,
        sq - w - sq * 0.06,
        sq * 0.1,
      )
      .stroke({ color: 0xffe9a0, alpha: 0.8, width: w })
    const tw = Math.max(3, sq * 0.05)
    this.#targetGfx.clear()
    this.#targetGfx
      .rect(0, 0, sq, sq)
      .fill({ color: 0xffe9a0, alpha: 0.28 })
      .rect(tw / 2, tw / 2, sq - tw, sq - tw)
      .stroke({ color: 0xffe9a0, width: tw })
    this.#flashGfx.clear()
    this.#flashGfx.rect(0, 0, sq, sq).fill({ color: 0xff4d3d, alpha: 1 })
    for (const sp of [this.#halo, this.#hoverGlow]) {
      sp.width = sq * 1.3
      sp.height = sq * 1.3
    }
    for (const h of this.#hintPool) this.#sizeHint(h)
    this.#lmKey = ''
    this.#drawLastMove(false)
  }

  /** Places a band glow sprite along seat `i`'s band (hidden for -1). */
  #placeBand(g: Sprite, i: number): void {
    if (i < 0) {
      g.visible = false
      return
    }
    const { square: sq, frame } = this.#layout
    const half = (sq * BOARD_SIZE) / 2
    const d = half + frame * 0.63
    const color = bandColor(SEATS[i] as Seat)
    g.tint = hexToNumber(mixHex(color, '#ffffff', 0.08))
    g.width = sq * (BOARD_SIZE + 0.2)
    g.height = frame * 0.62
    g.rotation = i === 1 || i === 3 ? Math.PI / 2 : 0
    if (i === 0) g.position.set(0, d)
    else if (i === 1) g.position.set(-d, 0)
    else if (i === 2) g.position.set(0, -d)
    else g.position.set(d, 0)
  }

  /** Medallion size: larger for the seat to move (tweened at handovers), smaller once removed. */
  #sizeMedallion(i: number): void {
    const m = this.#medallions[i] as Medallion
    const d = this.#layout.square * MEDALLION * m.scale * m.statusScale
    m.sprite.width = d
    m.sprite.height = d
    m.ring.scale.set((m.scale * m.statusScale) / MEDALLION_ACTIVE)
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
      shown: piece.kind,
      owner: piece.owner,
      variant: this.#variantFor(piece.owner),
      lift: 0,
      squash: 1,
      ox: 0,
      oy: 0,
      moving: false,
      tween: null,
      liftTween: null,
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
    this.#anim.cancel(n.tween)
    this.#anim.cancel(n.liftTween)
    if (this.#hoverNode === n) this.#hoverNode = null
    if (!n.node.destroyed) n.node.destroy({ children: true })
    if (!n.shadow.destroyed) n.shadow.destroy()
  }

  /**
   * Whether a flight of `n` is already scheduled to start after `start`. When moves arrive
   * faster than frames are drawn (a background tab, a burst of updates), one piece can have
   * two flights queued; the later one owns the piece, and the earlier one must not cancel it.
   */
  #laterFlight(n: PieceNode, start: number): boolean {
    const t = n.tween
    return !!t && t.alive && t.start > start
  }

  /** Stops whatever flight drives `n` and puts its body back on the ground. */
  #stopMotion(n: PieceNode): void {
    this.#anim.cancel(n.tween)
    this.#anim.cancel(n.liftTween)
    n.tween = null
    n.liftTween = null
    n.node.x -= n.ox
    n.node.y -= n.oy
    n.ox = 0
    n.oy = 0
    n.moving = false
  }

  #applyNodeTextures(n: PieceNode): void {
    const atlas = this.#atlas
    const sq = this.#layout.square
    const size = sq * PIECE_SCALE
    if (atlas) {
      n.body.texture = atlas.piece(n.shown, n.variant)
      n.shadow.texture = atlas.shadow(n.shown)
      n.marker.texture = atlas.marker(n.owner)
    }
    const mirrored = n.shown === 'knight' && relativeSeat(n.owner, this.#perspective) >= 2
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

  /**
   * Scale and shadow from the node's lift and squash. The shadow stays on the
   * ground (under the node minus its hop offset) and spreads, softens and
   * drifts away from the light as the piece rises.
   */
  #placeShadow(n: PieceNode): void {
    const k = 1 + n.lift * 2.2
    n.shadow.position.set(
      n.node.x - n.ox + this.#shadowLocal.x * k,
      n.node.y - n.oy + this.#shadowLocal.y * k + this.#layout.square * 0.01,
    )
    const s = (1 + n.lift * 0.15) * n.squash
    n.node.scale.set(s)
    const base = this.#atlas ? this.#atlas.cell / this.#atlas.size : 1.2
    const spread = (1 + n.lift * 0.18) * (1 + (1 - n.squash) * 1.6)
    const size = this.#layout.square * PIECE_SCALE * base * spread
    const mirrored = n.shadow.scale.x < 0
    n.shadow.width = size
    n.shadow.height = size
    if (mirrored) n.shadow.scale.x = -Math.abs(n.shadow.scale.x)
    n.shadow.alpha = n.node.alpha * Math.max(0.2, 0.42 - n.lift * 0.18)
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
    for (let i = 0; i < NUM_SQUARES; i++) {
      const n = this.#pieces[i]
      if (!n) continue
      squareCenter(i, this.#layout, this.#tmpVec)
      n.node.position.set(this.#tmpVec.x, this.#tmpVec.y)
      n.ox = 0
      n.oy = 0
      this.#applyNodeTextures(n)
      this.#placeShadow(n)
    }
  }

  /**
   * Makes the scene match `snap` immediately. With `fadeMs`, pieces that
   * change cross-fade (old out, new in) instead of popping.
   */
  #applyInstant(snap: Snapshot, fadeMs = 0): void {
    this.#dissolveLayer.removeChildren().forEach((c) => {
      c.destroy({ children: true })
    })
    for (let i = 0; i < NUM_SQUARES; i++) {
      const want = snap.board[i] ?? null
      const have = this.#pieces[i] ?? null
      if (have && want && have.kind === want.kind && have.owner === want.owner) {
        const v = this.#variantFor(want.owner)
        if (v !== have.variant || have.shown !== have.kind) {
          have.variant = v
          have.shown = have.kind
          this.#applyNodeTextures(have)
        }
        this.#stopMotion(have)
        have.node.alpha = 1
        have.lift = 0
        have.squash = 1
        squareCenter(i, this.#layout, this.#tmpVec)
        have.node.position.set(this.#tmpVec.x, this.#tmpVec.y)
        if (have.node.parent !== this.#pieceLayer) this.#pieceLayer.addChild(have.node)
        this.#placeShadow(have)
        continue
      }
      if (have) {
        if (fadeMs > 0) this.#fadeAway(have, fadeMs)
        else this.#destroyNode(have)
      }
      const n = want ? this.#createNode(want, i) : null
      this.#pieces[i] = n
      if (n && fadeMs > 0) {
        n.node.alpha = 0
        this.#placeShadow(n)
        this.#anim.add(fadeMs, (k) => {
          if (n.node.destroyed) return
          n.node.alpha = k
          this.#placeShadow(n)
        })
      }
    }
  }

  /** Fades a detached node out and destroys it. */
  #fadeAway(n: PieceNode, ms: number): void {
    this.#stopMotion(n)
    this.#captureLayer.addChild(n.node)
    const a0 = n.node.alpha
    const s0 = n.shadow.alpha
    this.#anim.add(
      ms,
      (k) => {
        n.node.alpha = a0 * (1 - k)
        n.shadow.alpha = s0 * (1 - k)
      },
      { ease: ease.outQuad, done: () => this.#destroyNode(n) },
    )
  }

  /** Brings every displaced piece back to its square (rejected intent / resync). */
  #settleAll(): void {
    const reduced = this.#options.reducedMotion
    for (let i = 0; i < NUM_SQUARES; i++) {
      const n = this.#pieces[i]
      if (!n) continue
      squareCenter(i, this.#layout, this.#tmpVec)
      const tx = this.#tmpVec.x
      const ty = this.#tmpVec.y
      if (Math.hypot(n.node.x - n.ox - tx, n.node.y - n.oy - ty) < 0.5 && n.lift < 0.01) continue
      this.#returnHome(n, tx, ty, reduced)
    }
  }

  /** Eases a piece back to (tx, ty) with its lift held until the end, then settles. */
  #returnHome(n: PieceNode, tx: number, ty: number, reduced: boolean): void {
    if (reduced) {
      this.#stopMotion(n)
      n.lift = 0
      n.node.position.set(tx, ty)
      if (!n.node.destroyed) this.#pieceLayer.addChild(n.node)
      this.#placeShadow(n)
      return
    }
    const dist = Math.hypot(n.node.x - n.ox - tx, n.node.y - n.oy - ty) / this.#layout.square
    this.#fly(n, tx, ty, {
      duration: SNAP_BACK.duration,
      ease: snapBackEase(dist),
      liftFrom: n.lift,
      peak: n.lift,
      dropAt: SNAP_BACK.dropFrom,
      settle: n.lift > 0.05 ? 0.95 : 0,
      tag: TAG_MOTION,
    })
  }

  /**
   * Flies a piece to (tx, ty): position eased along the path, an optional
   * screen-up hop (knights, castling rook), lift rising from its current
   * value to `peak` and dropping at the end, then an optional landing settle
   * (squash from `settle` back to 1). The start position is read when the
   * flight actually starts, so a delayed flight follows wherever an earlier
   * (hurried) one left the piece. All closures are made here; per frame only
   * numbers change.
   */
  #fly(
    n: PieceNode,
    tx: number,
    ty: number,
    o: {
      duration: number
      delay?: number
      ease?: (t: number) => number
      peak?: number
      liftFrom?: number
      dropAt?: number
      hop?: number
      /** Hop sideways off the path instead of screen-up (the castling rook clears its leader). */
      hopAside?: boolean
      settle?: number
      tag?: number
    },
    done?: () => void,
  ): Tween {
    const sq = this.#layout.square
    const posEase = o.ease ?? ease.move
    let peak = o.peak ?? 0
    let hop = o.hop ?? 0
    let settle = o.settle ?? 0
    const dropAt = o.dropAt ?? 0.7
    let liftFrom = o.liftFrom ?? n.lift
    let fx = 0
    let fy = 0
    // Peak hop offset (board-local), fixed when the flight starts.
    let hx = 0
    let hy = 0
    let started = false
    let tween: Tween | null = null
    n.moving = true
    this.#anim.cancel(n.liftTween)
    n.liftTween = null
    if (n.node.parent !== this.#movingLayer) this.#movingLayer.addChild(n.node)
    n.node.rotation = -this.#angle
    const update = (k: number) => {
      if (n.node.destroyed) return
      if (!started) {
        started = true
        // A later flight of this piece, already queued, keeps the piece; this one runs first.
        if (!(tween && this.#laterFlight(n, tween.start))) {
          if (n.tween && n.tween !== tween) this.#anim.cancel(n.tween)
          n.tween = tween
        }
        this.#anim.cancel(n.liftTween)
        n.liftTween = null
        fx = n.node.x - n.ox
        fy = n.node.y - n.oy
        if (o.liftFrom === undefined) liftFrom = n.lift
        // Nothing (or almost nothing) to travel: no lift or hop, and a short glide.
        if (Math.hypot(tx - fx, ty - fy) < sq * 0.15) {
          peak = Math.min(peak, liftFrom)
          hop = 0
          if (liftFrom < 0.05) settle = 0
          if (tween && tween.duration > 90) tween.duration = 90
        }
        if (hop > 0) {
          hopOffset(
            tx - fx,
            ty - fy,
            hop * sq,
            this.#angle,
            o.hopAside === true,
            this.#tmpVec2,
            (fx + tx) / 2,
            (fy + ty) / 2,
          )
          hx = this.#tmpVec2.x
          hy = this.#tmpVec2.y
        }
      }
      const p = posEase(k)
      let ox = 0
      let oy = 0
      if (hop > 0) {
        const h = Math.sin(Math.PI * k)
        ox = hx * h
        oy = hy * h
      }
      n.ox = ox
      n.oy = oy
      n.node.x = fx + (tx - fx) * p + ox
      n.node.y = fy + (ty - fy) * p + oy
      n.lift = flightLift(k, liftFrom, peak, dropAt)
      this.#placeShadow(n)
    }
    tween = this.#anim.add(o.duration, update, {
      delay: o.delay ?? 0,
      ease: ease.linear,
      tag: o.tag ?? 0,
      done: () => {
        // A later flight queued for this piece takes over from here: stay in the air layer.
        const handOff = !!tween && this.#laterFlight(n, tween.start)
        if (n.tween === tween) n.tween = null
        n.moving = handOff
        n.lift = 0
        n.ox = 0
        n.oy = 0
        if (!n.node.destroyed) {
          n.node.position.set(tx, ty)
          if (!handOff) this.#pieceLayer.addChild(n.node)
          this.#placeShadow(n)
          if (settle > 0 && !handOff) this.#settle(n, settle)
        }
        done?.()
      },
    })
    if (tween.alive && !started) n.tween = tween
    return tween
  }

  /** Landing settle: a small squash that springs back (outBack) while the shadow tightens. */
  #settle(n: PieceNode, from: number): void {
    if (this.#options.reducedMotion) return
    n.squash = from
    this.#placeShadow(n)
    this.#anim.add(
      SETTLE_MS,
      (k) => {
        if (n.node.destroyed) return
        n.squash = from + (1 - from) * k
        this.#placeShadow(n)
      },
      { ease: SETTLE_EASE },
    )
  }

  /** Reduced motion: the piece fades out where it is and fades in on its new square. */
  #crossFadeMove(
    n: PieceNode,
    tx: number,
    ty: number,
    delay: number,
    fadeMs: number,
    tag: number,
    done?: () => void,
  ): void {
    let self: Tween | null = null
    self = this.#anim.add(
      0,
      () => {
        if (n.node.destroyed) return
        // A flight of this piece queued after this move keeps running (it starts from here).
        if (!(self && this.#laterFlight(n, self.start))) this.#stopMotion(n)
        const dist = Math.hypot(n.node.x - tx, n.node.y - ty)
        n.lift = 0
        if (dist >= this.#layout.square * 0.15) {
          const ghost = new Sprite(n.body.texture)
          ghost.anchor.set(0.5)
          ghost.width = n.body.width
          ghost.height = n.body.height
          ghost.scale.x = n.body.scale.x
          ghost.position.set(n.node.x, n.node.y + n.body.y)
          ghost.rotation = -this.#angle
          this.#captureLayer.addChild(ghost)
          this.#anim.add(
            REDUCED_GHOST_MS,
            (k) => {
              ghost.alpha = 1 - k
            },
            { ease: ease.linear, done: () => ghost.destroy() },
          )
          n.node.alpha = 0
        }
        n.node.position.set(tx, ty)
        this.#pieceLayer.addChild(n.node)
        this.#placeShadow(n)
        if (n.node.alpha >= 1) {
          done?.()
          return
        }
        this.#anim.add(
          fadeMs,
          (k) => {
            if (n.node.destroyed) return
            n.node.alpha = k
            this.#placeShadow(n)
          },
          done ? { ease: ease.linear, done } : { ease: ease.linear },
        )
      },
      { delay, tag },
    )
  }

  #applyPlan(
    next: Snapshot,
    plan: AnimationPlan,
    keep: { node: PieceNode; tween: Tween } | null = null,
    start = 0,
  ): void {
    const reduced = this.#options.reducedMotion
    const sq = this.#layout.square
    const now = this.#anim.now

    // Detach captured, dissolving and moving pieces before re-slotting.
    const captured: { n: PieceNode; square: number; onDest: boolean }[] = []
    for (const c of plan.captures) {
      const n = this.#pieces[c.square]
      this.#pieces[c.square] = null
      if (n) captured.push({ n, square: c.square, onDest: c.onDestination })
    }
    const dissolving: { n: PieceNode; square: number }[] = []
    for (const d of plan.dissolves) {
      const n = this.#pieces[d.square]
      this.#pieces[d.square] = null
      if (n) dissolving.push({ n, square: d.square })
    }
    const schedule = scheduleMoves(
      plan.moves.map((m) => ({
        kind: m.piece.kind,
        distSq: squareDistance(m.from, m.to),
        castleRook: m.castleRook,
      })),
      reduced,
    )
    const movers: {
      n: PieceNode
      from: number
      to: number
      promote: PieceKind | null
      rook: boolean
      /** Absolute timing relative to now, ms. */
      start: number
      duration: number
      land: number
      contact: number
    }[] = []
    plan.moves.forEach((m, idx) => {
      const n = this.#pieces[m.from]
      this.#pieces[m.from] = null
      if (!n) return
      const item = schedule.items[idx] as (typeof schedule.items)[number]
      const isKeep = !!keep && keep.node === n && keep.tween.alive
      const st = isKeep ? 0 : start + item.delay
      const dur = isKeep
        ? Math.max(
            0,
            (keep as { tween: Tween }).tween.start +
              (keep as { tween: Tween }).tween.duration -
              now,
          )
        : item.duration
      const land = isKeep ? dur : st + dur * item.timing.landAt
      const dist = squareDistance(m.from, m.to)
      const contact = isKeep ? dur * 0.8 : st + contactTime(item.timing, dist)
      movers.push({
        n,
        from: m.from,
        to: m.to,
        promote: m.promoteTo,
        rook: m.castleRook,
        start: st,
        duration: dur,
        land,
        contact,
      })
    })
    const captureAt = new Set(captured.filter((c) => c.onDest).map((c) => c.square))
    for (const [idx, mv] of movers.entries()) {
      // A piece left on the destination (should not happen) is replaced.
      const stale = this.#pieces[mv.to]
      if (stale) this.#destroyNode(stale)
      this.#pieces[mv.to] = mv.n
      squareCenter(mv.to, this.#layout, this.#tmpVec)
      const tx = this.#tmpVec.x
      const ty = this.#tmpVec.y
      const n = mv.n
      // The kind changes now (the snapshot is the truth); the texture at the flourish.
      if (mv.promote) n.kind = mv.promote
      const landed = mv.promote ? () => this.#promotionFlourish(n, tx, ty) : undefined
      if (keep && keep.node === n && keep.tween.alive) {
        // The user's slide is already heading here: chain onto it.
        const prevDone = keep.tween.done
        keep.tween.done = () => {
          prevDone?.()
          landed?.()
        }
        continue
      }
      const item = schedule.items[idx] as (typeof schedule.items)[number]
      const t = item.timing
      if (t.crossFade) {
        this.#crossFadeMove(n, tx, ty, mv.start, t.duration, TAG_MOTION, landed)
        continue
      }
      this.#fly(
        n,
        tx,
        ty,
        {
          duration: t.duration,
          delay: mv.start,
          ease: t.ease,
          peak: t.lift,
          hop: t.hop,
          hopAside: mv.rook,
          settle: t.settleMs > 0 ? (captureAt.has(mv.to) ? 0.93 : 0.95) : 0,
          tag: TAG_MOTION,
        },
        landed,
      )
    }
    const main = movers.find((m) => !m.rook) ?? movers[0] ?? null
    const landAt = main ? Math.max(...movers.map((m) => m.land)) : start
    const endAt = movers.length > 0 ? Math.max(...movers.map((m) => m.start + m.duration)) : start

    // Captures react when the attacker arrives (en passant: when it lands).
    let leaderHit: { square: number; at: number; owner: Seat } | null = null
    for (const c of captured) {
      const attacker = movers.find((m) => m.to === c.square) ?? main
      const at = c.onDest && attacker ? attacker.contact : main ? main.land : start
      let dir: { x: number; y: number } | null = null
      if (attacker) {
        const ax = (attacker.to % BOARD_SIZE) - (attacker.from % BOARD_SIZE)
        const ay = Math.floor(attacker.from / BOARD_SIZE) - Math.floor(attacker.to / BOARD_SIZE)
        const len = Math.hypot(ax, ay)
        if (len > 0) dir = { x: ax / len, y: ay / len }
      }
      this.#captureEffect(c.n, c.square, at, dir)
      if (c.n.kind === 'king') leaderHit = { square: c.square, at, owner: c.n.owner }
    }
    if (leaderHit && !reduced) this.#leaderMoment(leaderHit.square, leaderHit.owner, leaderHit.at)

    // The army burns away (outward from its leader) after the hit; statuses change as it starts.
    const effectAt = leaderHit ? leaderHit.at + (reduced ? 0 : 140) : landAt
    if (dissolving.length > 0) {
      const lead =
        leaderHit?.square ??
        dissolving.find((d) => d.n.kind === 'king')?.square ??
        dissolving[0]?.square ??
        0
      this.#dissolve(dissolving, lead, effectAt)
    }

    for (const a of plan.appears) {
      const stale = this.#pieces[a.square]
      if (stale) this.#destroyNode(stale)
      const n = this.#createNode(a.piece, a.square)
      this.#pieces[a.square] = n
      n.node.alpha = 0
      this.#anim.add(
        reduced ? 120 : 260,
        (k) => {
          n.node.alpha = k
          this.#placeShadow(n)
        },
        { delay: start },
      )
    }

    // Status changes: freeze cross-fades to frosted grey, sweeping out from the leader.
    for (const ch of plan.statusChanges) {
      if (ch.status !== 'frozen') continue
      let lead = -1
      for (let i = 0; i < NUM_SQUARES; i++) {
        const p = next.board[i]
        if (p && p.owner === ch.seat && p.kind === 'king') lead = i
      }
      this.#freezeSeat(ch.seat, effectAt, lead)
    }
    // Bands and medallions change when the effect that explains them plays.
    // (A burn shows nothing for its first ~15%, so a removal waits for the first embers.)
    const statusAt = effectAt + (dissolving.length > 0 && !reduced ? 0.15 * DISSOLVE_MS : 0)
    // Untagged like the burn and frost it explains, so a following move's
    // hurry cannot flip it ahead of them; chained after any earlier pending one.
    if (plan.statusChanges.length > 0) {
      const statuses = [...next.statuses]
      const pending = this.#statusTrigger
      const after = pending?.alive ? pending.start - this.#anim.now + 1 : 0
      this.#statusTrigger = this.#anim.add(
        0,
        () => {
          const snap = this.#snapshot
          // Caught up with the snapshot: stop lagging.
          const same = !!snap && statuses.every((st, i) => st === snap.statuses[i])
          this.#applyShownStatuses(same ? null : statuses, true)
        },
        { delay: Math.max(statusAt, after) },
      )
    }

    // Safety net: anything still out of sync with the snapshot is fixed instantly.
    for (let i = 0; i < NUM_SQUARES; i++) {
      const want = next.board[i] ?? null
      const have = this.#pieces[i] ?? null
      if (have && want && have.owner === want.owner && have.kind === want.kind) continue
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
          delay: endAt + 250 + i * 120,
        })
      })
    }
    const firstCapture =
      captured.length > 0
        ? Math.min(...captured.map((c) => this.#captureTime(c, movers, main, start)))
        : landAt
    for (const cue of soundCues(plan)) {
      let delay: number
      if (cue === 'capture') delay = firstCapture
      else if (cue === 'move' || cue === 'castle') delay = landAt
      else if (cue === 'promotion') delay = landAt + 120
      else if (cue === 'defeat' || cue === 'freeze') delay = statusAt
      else delay = endAt + 60
      this.#playLater(cue, delay)
    }
    // Turn handover and last-move highlight follow the piece, not the dispatch.
    // A reduced-motion cross-fade has no flight to follow: hand over as it starts
    // (the user's own drop is already on its square and fades nothing).
    // (Reduced motion always cross-fades; see moveTiming.)
    this.#handoverAt = !main
      ? effectAt
      : reduced
        ? main.start
        : main.start + main.duration * HANDOVER_AT
    this.#lastMoveAt = { from: main ? main.start : start, to: main ? main.land : start }
  }

  #captureTime(
    c: { square: number; onDest: boolean },
    movers: readonly { to: number; contact: number; land: number }[],
    main: { land: number } | null,
    start: number,
  ): number {
    const attacker = movers.find((m) => m.to === c.square)
    if (c.onDest && attacker) return attacker.contact
    return main ? main.land : start
  }

  /** When (ms from now) the turn visuals hand over, and when the last move lights up; set by a plan. */
  #handoverAt = 0
  #lastMoveAt = { from: 0, to: 0 }

  /**
   * The captured piece is knocked along the attacker's path (tilting away
   * from it), shrinks and fades, while chips in its colour scatter forward.
   * Drawn below the moving layer, so the attacker always lands on top.
   */
  #captureEffect(
    n: PieceNode,
    square: number,
    delay: number,
    dir: { x: number; y: number } | null,
  ): void {
    this.#stopMotion(n)
    squareCenter(square, this.#layout, this.#tmpVec)
    const x = this.#tmpVec.x
    const y = this.#tmpVec.y
    const reduced = this.#options.reducedMotion
    const sq = this.#layout.square
    if (reduced) {
      this.#anim.add(
        100,
        (k) => {
          n.node.alpha = 1 - k
          n.shadow.alpha = 0.42 * (1 - k)
        },
        { delay, ease: ease.outQuad, tag: TAG_MOTION, done: () => this.#destroyNode(n) },
      )
      return
    }
    // Board-local push direction; the tilt reads in screen space.
    const dx = dir ? dir.x : 0
    const dy = dir ? dir.y : 0
    rotateVector(dx, dy, this.#angle, this.#tmpVec2)
    const tilt = (this.#tmpVec2.x >= 0 ? 1 : -1) * KNOCK_TILT
    const color = seatColor(n.owner)
    this.#anim.add(
      0,
      () => {
        if (n.node.destroyed) return
        this.#captureLayer.addChild(n.node)
        const x0 = n.node.x
        const y0 = n.node.y
        const r0 = -this.#angle
        const s0 = n.node.scale.x
        const sh0 = n.shadow.alpha
        const shx = n.shadow.x
        const shy = n.shadow.y
        this.#chipBurst(x, y, color, dir)
        this.#anim.add(
          KNOCK_MS,
          (k) => {
            if (n.node.destroyed) return
            n.node.position.set(x0 + dx * KNOCK_SQ * sq * k, y0 + dy * KNOCK_SQ * sq * k)
            n.node.rotation = r0 + tilt * k
            n.node.scale.set(s0 * (1 - 0.2 * k))
            n.node.alpha = 1 - k
            const ks = Math.min(1, (k * KNOCK_MS) / 150)
            n.shadow.alpha = sh0 * (1 - ks)
            n.shadow.position.set(shx + dx * KNOCK_SQ * sq * k, shy + dy * KNOCK_SQ * sq * k)
          },
          { ease: ease.outCubic, done: () => this.#destroyNode(n) },
        )
      },
      { delay, tag: TAG_MOTION },
    )
  }

  /** Capture debris: shards in the victim's colour thrown forward, and one coloured ring. */
  #chipBurst(x: number, y: number, color: string, dir: { x: number; y: number } | null): void {
    const p = this.#chips
    const fx = this.#effects
    if (!p || !fx) return
    const sq = this.#layout.square
    const base = hexToNumber(color)
    const dark = hexToNumber(shadeHex(color, 0.62))
    const light = hexToNumber(shadeHex(color, 1.25))
    const heading = dir ? Math.atan2(dir.y, dir.x) : 0
    const spread = dir ? Math.PI / 3 : Math.PI
    for (let i = 0; i < 12; i++) {
      const a = heading + (Math.random() * 2 - 1) * spread
      const v = sq * (2.5 + Math.random() * 1.5)
      p.emit(
        fx.chip,
        x + Math.cos(a) * sq * 0.12,
        y + Math.sin(a) * sq * 0.12,
        Math.cos(a) * v,
        Math.sin(a) * v,
        0.35 + Math.random() * 0.15,
        sq * (0.08 + Math.random() * 0.06),
        i % 3 === 0 ? dark : i % 3 === 1 ? base : light,
        { drag: 4, spin: (Math.random() < 0.5 ? -1 : 1) * 8, endScale: 0.55, blend: 'normal' },
      )
    }
    p.emit(fx.ring, x, y, 0, 0, 0.26, sq * 0.5, hexToNumber(lightFor(color)), {
      endScale: 2.4,
      drag: 0,
      alpha: 0.45,
      blend: 'normal',
    })
  }

  /**
   * A leader falls: a brief hit-stop, a shockwave in its colour and a small
   * board shake (none of it under reduced motion).
   */
  #leaderMoment(square: number, owner: Seat, delay: number): void {
    squareCenter(square, this.#layout, this.#tmpVec)
    const x = this.#tmpVec.x
    const y = this.#tmpVec.y
    const sq = this.#layout.square
    const tint = hexToNumber(lightFor(seatColor(owner)))
    this.#anim.add(
      0,
      () => {
        this.#hitStop = HIT_STOP_MS
        this.#shakeLeft = SHAKE_MS
        const fx = this.#effects
        this.#chips?.emit(fx?.ring ?? Texture.EMPTY, x, y, 0, 0, 0.48, sq, tint, {
          endScale: 7,
          drag: 0,
          alpha: 0.5,
          blend: 'normal',
        })
        this.#particles?.emit(fx?.glow ?? Texture.EMPTY, x, y, 0, 0, 0.35, sq * 1.4, tint, {
          endScale: 1.6,
          alpha: 0.35,
        })
      },
      { delay, tag: TAG_MOTION },
    )
  }

  #burst(x: number, y: number, color: string, kind: 'promote' | 'freeze'): void {
    const p = this.#particles
    const fx = this.#effects
    if (!p || !fx) return
    const sq = this.#layout.square
    if (kind === 'promote') {
      const tint = hexToNumber(mixHex(color, '#fff4d6', 0.5))
      p.emit(fx.glow, x, y, 0, 0, 0.5, sq * 1.1, tint, { endScale: 1.6, alpha: 0.45 })
      // Sparks start around the piece's edge and drift screen-up, clear of its face.
      for (let i = 0; i < 10; i++) {
        const side = i % 2 === 0 ? -1 : 1
        rotateVector(
          side * sq * (0.1 + Math.random() * 0.25),
          -sq * (0.7 + Math.random() * 0.9),
          -this.#angle,
          this.#tmpVec2,
        )
        rotateVector(
          side * sq * (0.3 + Math.random() * 0.14),
          (Math.random() - 0.3) * sq * 0.6,
          -this.#angle,
          this.#tmpVec,
        )
        p.emit(
          fx.spark,
          x + this.#tmpVec.x,
          y + this.#tmpVec.y,
          this.#tmpVec2.x,
          this.#tmpVec2.y,
          0.5,
          sq * (0.1 + Math.random() * 0.06),
          0xfff0c0,
          { drag: 2.5, spin: 3, endScale: 0.4 },
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

  /**
   * Promotion as a short transformation: the pawn rises and brightens, turns
   * into the new piece at the peak under a ring in its seat's colour, and
   * the new piece settles from slightly large with an overshoot. It stays
   * readable throughout (the brightening is a partial additive copy).
   */
  #promotionFlourish(n: PieceNode, x: number, y: number): void {
    if (n.node.destroyed) return
    if (this.#options.reducedMotion || n.shown === n.kind) {
      n.shown = n.kind
      this.#applyNodeTextures(n)
      return
    }
    const sq = this.#layout.square
    const color = seatColor(n.owner)
    const over = new Sprite(n.body.texture)
    over.anchor.set(0.5)
    over.width = n.body.width
    over.height = n.body.height
    over.scale.x = n.body.scale.x
    over.y = n.body.y
    over.blendMode = 'add'
    over.alpha = 0
    n.node.addChild(over)
    const rise = 0.6
    this.#anim.add(
      120,
      (k) => {
        if (n.node.destroyed) return
        n.lift = rise * k
        over.alpha = 0.7 * k
        this.#placeShadow(n)
      },
      {
        ease: ease.outQuad,
        done: () => {
          if (n.node.destroyed) return
          n.shown = n.kind
          this.#applyNodeTextures(n)
          over.texture = n.body.texture
          over.width = n.body.width
          over.height = n.body.height
          over.scale.x = n.body.scale.x
          const ring = hexToNumber(mixHex(color, '#fff4d6', 0.5))
          this.#chips?.emit(this.#effects?.ring ?? Texture.EMPTY, x, y, 0, 0, 0.3, sq * 0.7, ring, {
            endScale: 2,
            drag: 0,
            alpha: 0.6,
            blend: 'normal',
          })
          this.#burst(x, y, color, 'promote')
          this.#anim.add(
            240,
            (k) => {
              if (n.node.destroyed) return
              n.squash = 1.15 + (1 - 1.15) * PROMO_EASE(k)
              n.lift = rise * (1 - ease.inOutSine(k))
              over.alpha = 0.7 * Math.max(0, 1 - (k * 240) / 180)
              this.#placeShadow(n)
            },
            {
              ease: ease.linear,
              done: () => {
                if (!over.destroyed) over.destroy()
                if (n.node.destroyed) return
                n.squash = 1
                n.lift = 0
                this.#placeShadow(n)
              },
            },
          )
        },
      },
    )
  }

  #freezeSeat(seat: Seat, delay: number, leader: number): void {
    const reduced = this.#options.reducedMotion
    for (let i = 0; i < NUM_SQUARES; i++) {
      const n = this.#pieces[i]
      if (!n || n.owner !== seat || n.variant === 'frozen') continue
      const atlas = this.#atlas
      const over = new Sprite(atlas ? atlas.piece(n.shown, 'frozen') : Texture.EMPTY)
      over.anchor.set(0.5)
      over.width = n.body.width
      over.height = n.body.height
      over.scale.x = n.body.scale.x
      over.y = n.body.y
      over.alpha = 0
      n.node.addChildAt(over, 1)
      // The frost spreads outward from the leader.
      const stagger = reduced ? 0 : leader >= 0 ? 40 * chebyshev(i, leader) : 0
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
            if (!n.node.destroyed) this.#applyNodeTextures(n)
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

  /** The army burns away, spreading outward from `leader` (one filter pass for the group). */
  #dissolve(items: { n: PieceNode; square: number }[], leader: number, delay: number): void {
    const reduced = this.#options.reducedMotion
    const nodes = items.map((d) => d.n)
    for (const n of nodes) this.#stopMotion(n)
    const group = new Container()
    this.#dissolveLayer.addChild(group)
    const shadows = new Container()
    group.addChild(shadows)
    const owner = nodes[0]?.owner ?? 'south'
    for (const n of nodes) {
      shadows.addChild(n.shadow)
      group.addChild(n.node)
    }
    const sq = this.#layout.square
    // Per-piece start, as a fraction of the burn: 45 ms per king step from the leader.
    const steps = items.map((d) => chebyshev(d.square, leader))
    const maxSteps = Math.max(0, ...steps)
    const spreadMs = reduced ? 0 : maxSteps * DISSOLVE_SPREAD_MS
    const edge = hexToRgb(mixHex(seatColor(owner), '#ffb347', 0.5))
    let uniforms: UniformGroup | null = null
    squareCenter(leader, this.#layout, this.#tmpVec)
    this.#tmpPoint.set(this.#tmpVec.x, this.#tmpVec.y)
    const centre = this.#root.toGlobal(this.#tmpPoint)
    const sqGlobal = sq * this.#fitScale
    if (!reduced) {
      uniforms = new UniformGroup({
        uProgress: { value: 0, type: 'f32' },
        uEdge: { value: new Float32Array(edge), type: 'vec3<f32>' },
        uCenter: { value: new Float32Array([centre.x, centre.y]), type: 'vec2<f32>' },
        uDelay: {
          value: DISSOLVE_SPREAD_MS / DISSOLVE_MS / Math.max(1, sqGlobal),
          type: 'f32',
        },
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
    const p = this.#particles
    const fx = this.#effects
    const tint = hexToNumber(mixHex(seatColor(owner), '#ffcf7a', 0.4))
    const burn = reduced ? 300 : DISSOLVE_MS
    const dur = burn + spreadMs
    const span = dur / burn
    let emitted = 0
    this.#anim.add(
      dur,
      (k) => {
        if (uniforms) {
          ;(uniforms.uniforms as { uProgress: number }).uProgress = k * span
        } else {
          group.alpha = 1 - k
        }
        // Embers rise (screen up) from pieces that are burning right now.
        if (!reduced && p && fx) {
          const want = Math.floor(k * nodes.length * 5)
          while (emitted < want) {
            const idx = emitted % nodes.length
            emitted++
            const local = k * span - ((steps[idx] as number) * DISSOLVE_SPREAD_MS) / burn
            if (local <= 0 || local > 0.85) continue
            const n = nodes[idx] as PieceNode
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
    this.#refreshCheck()
    this.#syncTurn(0, false)
    this.#refreshFx()
  }

  #statusKey = ''

  /** Statuses the bands and medallions show (they lag the snapshot while an effect plays). */
  #shownStatusOf(i: number): string {
    return this.#shownStatuses?.[i] ?? this.#snapshot?.statuses[i] ?? 'active'
  }

  #shownKey(): string {
    return [0, 1, 2, 3].map((i) => this.#shownStatusOf(i)).join(',')
  }

  #refreshBoardIfStatusChanged(): void {
    if (this.#shownKey() === this.#statusKey) return
    this.#renderSurface()
  }

  /** Shows new statuses on the bands and medallions, cross-faded when `fade`. */
  #applyShownStatuses(statuses: readonly string[] | null, fade: boolean): void {
    this.#shownStatuses = statuses
    if (!this.#ready) return
    const doFade = fade && !this.#options.reducedMotion
    if (this.#shownKey() !== this.#statusKey) {
      if (doFade) this.#crossFadeSurface()
      else this.#renderSurface()
    }
    void this.#refreshMedallions(
      false,
      fade ? (this.#options.reducedMotion ? 150 : STATUS_FADE_MS) : 0,
    )
  }

  /** Renders the board surface into a fresh texture and fades the old one out on top. */
  #crossFadeSurface(): void {
    const app = this.#app
    const gl = (app?.renderer as { gl?: WebGLRenderingContext } | undefined)?.gl
    const old = this.#boardRT
    if (!old || this.#contextLost || gl?.isContextLost()) {
      this.#renderSurface()
      return
    }
    this.#endSurfaceFade()
    this.#boardRT = null
    this.#renderSurface()
    if (!this.#boardRT) {
      this.#boardRT = old
      return
    }
    const f = this.#boardFade
    f.texture = old
    f.anchor.copyFrom(this.#boardSprite.anchor)
    f.position.copyFrom(this.#boardSprite.position)
    f.alpha = 1
    f.visible = true
    this.#anim.add(
      STATUS_FADE_MS,
      (k) => {
        f.alpha = 1 - k
      },
      { ease: ease.inOutSine, done: () => this.#endSurfaceFade() },
    )
  }

  #endSurfaceFade(): void {
    const f = this.#boardFade
    const t = f.texture
    f.visible = false
    f.texture = Texture.EMPTY
    if (t && t !== Texture.EMPTY && t !== this.#boardRT) t.destroy(true)
  }

  async #refreshMedallions(force: boolean, fadeMs = 0): Promise<void> {
    const snap = this.#snapshot
    const sizePx = Math.ceil(this.#layout.square * MEDALLION * this.#res)
    const gen = this.#generation
    await Promise.all(
      SEATS.map(async (seat, i) => {
        const m = this.#medallions[i] as Medallion
        const civ = snap?.config.civs[i]?.id ?? 'canada'
        const status = this.#shownStatusOf(i) as MedallionState
        const key = `${civ}:${status}:${sizePx}`
        if (!force && key === m.key) return
        const statusChanged = m.key !== '' && m.key.split(':')[1] !== status
        m.key = key
        const c = await drawMedallion(civ, seat, status, sizePx)
        if (gen !== this.#generation || this.#destroyed || m.key !== key) return
        const old = m.sprite.texture
        m.sprite.texture = canvasTexture(c)
        const removed = status === 'removed'
        const targetScale = removed ? 0.9 : 1
        const targetAlpha = removed ? 0.72 : 1
        if (fadeMs > 0 && statusChanged && old !== Texture.EMPTY) {
          // The old face fades out on top while the new one shrinks/dims into place.
          const ghost = new Sprite(old)
          ghost.anchor.set(0.5)
          ghost.position.copyFrom(m.sprite.position)
          ghost.width = m.sprite.width
          ghost.height = m.sprite.height
          ghost.rotation = m.sprite.rotation
          ghost.alpha = m.sprite.alpha
          this.#medalLayer.addChild(ghost)
          const s0 = m.statusScale
          const a0 = m.sprite.alpha
          this.#anim.add(
            fadeMs,
            (k) => {
              m.statusScale = s0 + (targetScale - s0) * k
              m.sprite.alpha = a0 + (targetAlpha - a0) * k
              this.#sizeMedallion(i)
              ghost.alpha = a0 * (1 - k)
              ghost.width = m.sprite.width
              ghost.height = m.sprite.height
            },
            {
              ease: ease.inOutSine,
              done: () => {
                ghost.destroy()
                old.destroy(true)
              },
            },
          )
          return
        }
        m.statusScale = targetScale
        this.#sizeMedallion(i)
        m.sprite.alpha = targetAlpha
        if (old !== Texture.EMPTY) old.destroy(true)
      }),
    )
  }

  /**
   * Points the turn visuals at the seat to move. With `animate`, the hand-over
   * starts after `delay` ms (when the moving piece lands): the old band glow
   * fades out while the new one fades in, the new medallion grows with a
   * small overshoot and the old one shrinks, and the band dims cross-fade.
   */
  #syncTurn(delay: number, animate: boolean): void {
    const snap = this.#snapshot
    const want = snap && !snap.isOver ? seatOrder(snap.seatToMove) : -1
    if (want === this.#turnTarget) {
      if (this.#turnShown === want) {
        this.#placeBand(this.#bandGlow, want)
        for (let i = 0; i < 4; i++) this.#sizeMedallion(i)
      }
      return
    }
    this.#turnTarget = want
    if (!animate || delay <= 0) {
      this.#handover(want, animate)
      return
    }
    this.#anim.add(0, () => this.#handover(want, true), { delay, tag: TAG_MOTION })
  }

  #handover(to: number, animate: boolean): void {
    for (const t of this.#turnTweens) this.#anim.cancel(t)
    this.#turnTweens = []
    const from = this.#turnShown
    this.#turnShown = to
    // Additive glow on an already bright band (Gold) would blow out to white.
    const gainFor = (i: number) => (i === 2 ? 0.45 : 1)
    const tm = handoverTiming(this.#options.reducedMotion)
    const track = (t: Tween) => {
      if (t.alive) this.#turnTweens.push(t)
    }
    // Band glow: the old one moves to the outgoing sprite and fades.
    if (animate && from >= 0 && from !== to && this.#bandFade > 0.01) {
      const out = this.#bandGlowOut
      this.#placeBand(out, from)
      out.visible = true
      this.#bandOutGain = this.#bandGlowGain
      const f0 = this.#bandFade
      this.#bandOutFade = f0
      track(
        this.#anim.add(
          tm.outMs,
          (k) => {
            this.#bandOutFade = f0 * (1 - k)
          },
          {
            ease: ease.inOutSine,
            done: () => {
              out.visible = false
            },
          },
        ),
      )
    }
    this.#placeBand(this.#bandGlow, to)
    if (to >= 0) {
      this.#bandGlowGain = gainFor(to)
      if (animate && from !== to) {
        this.#bandFade = 0
        track(
          this.#anim.add(
            tm.inMs,
            (k) => {
              this.#bandFade = k
            },
            { ease: ease.inOutSine },
          ),
        )
      } else {
        this.#bandFade = 1
      }
    } else {
      this.#bandFade = 0
    }
    if (!animate) {
      this.#bandGlowOut.visible = false
      this.#bandOutFade = 0
    }
    // Band dims and medallions.
    for (let i = 0; i < 4; i++) {
      const dim = this.#bandDims.children[i] as Sprite
      const m = this.#medallions[i] as Medallion
      const dimTo = to >= 0 && i !== to ? 0.18 : 0
      const scaleTo = i === to ? MEDALLION_ACTIVE : 1
      const glowTo = i === to ? 1 : 0
      if (!animate) {
        this.#dim[i] = dimTo
        dim.alpha = dimTo
        dim.visible = dimTo > 0
        m.scale = scaleTo
        m.glowFade = glowTo
        this.#applyMedalGlow(i)
        this.#sizeMedallion(i)
        continue
      }
      const d0 = this.#dim[i] as number
      if (Math.abs(d0 - dimTo) > 0.001) {
        dim.visible = true
        track(
          this.#anim.add(
            tm.inMs,
            (k) => {
              const v = d0 + (dimTo - d0) * k
              this.#dim[i] = v
              dim.alpha = v
            },
            {
              ease: ease.inOutSine,
              done: () => {
                dim.visible = dimTo > 0
              },
            },
          ),
        )
      }
      const s0 = m.scale
      if (Math.abs(s0 - scaleTo) > 0.001) {
        const grow = scaleTo > s0
        track(
          this.#anim.add(
            grow ? tm.medalInMs : tm.medalOutMs,
            (k) => {
              m.scale = s0 + (scaleTo - s0) * k
              this.#sizeMedallion(i)
            },
            { ease: grow && !this.#options.reducedMotion ? MEDAL_IN_EASE : ease.outCubic },
          ),
        )
      }
      const g0 = m.glowFade
      if (Math.abs(g0 - glowTo) > 0.001) {
        track(
          this.#anim.add(
            glowTo > g0 ? tm.medalInMs : tm.medalOutMs,
            (k) => {
              m.glowFade = g0 + (glowTo - g0) * k
              this.#applyMedalGlow(i)
            },
            { ease: ease.inOutSine },
          ),
        )
      }
    }
  }

  /** Medallion glow and ring visibility from its fade (the glow alpha also pulses in `#tick`). */
  #applyMedalGlow(i: number): void {
    const m = this.#medallions[i] as Medallion
    const on = m.glowFade > 0.001
    m.glow.visible = on
    m.ring.visible = on
    m.ring.alpha = m.glowFade
    if (on) m.glow.tint = hexToNumber(mixHex(bandColor(SEATS[i] as Seat), '#fff4d6', 0.3))
  }

  /** The `n`th leader glow sprite, created (and layered with the others) when first needed. */
  #leaderGlowAt(n: number): Sprite | null {
    const have = this.#leaderGlows[n]
    if (have) return have
    const fx = this.#effects
    if (!fx || this.#checkRing.parent !== this.#root) return null
    for (let k = this.#leaderGlows.length; k <= n; k++) {
      const g = new Sprite(fx.halo)
      g.anchor.set(0.5)
      g.tint = CHECK_GLOW
      g.visible = false
      g.label = `leaderGlow${k}`
      g.width = this.#layout.square * 1.5
      g.height = this.#layout.square * 1.5
      this.#root.addChildAt(g, this.#root.getChildIndex(this.#checkRing))
      this.#leaderGlows.push(g)
    }
    return this.#leaderGlows[n] ?? null
  }

  /** Check indicator: glow and ring on the shown seat's leader squares (from the snapshot). */
  #refreshCheck(): void {
    const snap = this.#snapshot
    const ring = this.#checkRing
    for (const g of this.#leaderGlows) g.visible = false
    ring.clear()
    this.#checkSquares = []
    const seat = this.#checkShown
    if (!snap || !this.#ready || seat === null) return
    const squares = snap.leaderSquares[SEATS.indexOf(seat)] ?? []
    const sq = this.#layout.square
    const w = Math.max(2.5, sq * 0.075)
    for (const name of squares) {
      const i = indexOf(name)
      // Every leader square gets a ring; the glow sprites grow with the roster (a civ may
      // have more than four leader pieces).
      const g = this.#leaderGlowAt(this.#checkSquares.length)
      if (g) {
        squareCenter(i, this.#layout, this.#tmpVec)
        g.position.set(this.#tmpVec.x, this.#tmpVec.y)
        g.visible = true
        g.alpha = 0.85
      }
      this.#squareOrigin(i, this.#tmpVec)
      const x = this.#tmpVec.x
      const y = this.#tmpVec.y
      ring.rect(x, y, sq, sq).fill({ color: CHECK_RED, alpha: 0.22 })
      ring
        .roundRect(x + w / 2, y + w / 2, sq - w, sq - w, sq * 0.08)
        .stroke({ color: CHECK_RED, width: w, alpha: 1 })
      const wi = Math.max(1, w * 0.3)
      ring
        .roundRect(x + w + wi / 2, y + w + wi / 2, sq - 2 * w - wi, sq - 2 * w - wi, sq * 0.05)
        .stroke({ color: CHECK_INNER, width: wi, alpha: 0.9 })
      this.#checkSquares.push(i)
    }
    ring.alpha = 1
  }

  /** Top-left corner of a square in board-local coordinates. */
  #squareOrigin(i: number, out: { x: number; y: number }): { x: number; y: number } {
    const sq = this.#layout.square
    const half = (sq * BOARD_SIZE) / 2
    out.x = (i % BOARD_SIZE) * sq - half
    out.y = (BOARD_SIZE - 1 - Math.floor(i / BOARD_SIZE)) * sq - half
    return out
  }

  /**
   * Draws one last-move square into `g` (once per move; only alpha animates).
   * The warm fill is lighter on maple and stronger on walnut so both read
   * the same; the mover shows as a rounded inset in its light colour.
   */
  #drawLastMoveSquare(g: Graphics, i: number, seat: Seat, dest: boolean): void {
    const sq = this.#layout.square
    this.#squareOrigin(i, this.#tmpVec)
    const x = this.#tmpVec.x
    const y = this.#tmpVec.y
    const dark = ((i % BOARD_SIZE) + Math.floor(i / BOARD_SIZE)) % 2 === 0
    const fill = dest ? (dark ? 0.46 : 0.3) : dark ? 0.27 : 0.17
    const w = Math.max(1.5, sq * 0.05)
    const inset = w / 2 + sq * 0.035
    g.clear()
    g.rect(x, y, sq, sq).fill({ color: LAST_MOVE_FILL, alpha: fill })
    g.roundRect(x + inset, y + inset, sq - 2 * inset, sq - 2 * inset, sq * 0.1).stroke({
      color: hexToNumber(lightFor(seatColor(seat))),
      width: w,
      alpha: dest ? 0.75 : 0.45,
    })
  }

  /**
   * Shows `#lastMove`. With `animate`, the previous highlight fades out, the
   * origin fades in as the piece leaves and the destination as it lands
   * (times from the current plan).
   */
  #drawLastMove(animate: boolean): void {
    const lm = this.#lastMove
    const key = lm ? `${lm.from}-${lm.to}-${lm.seat}` : ''
    if (key === this.#lmKey) return
    this.#lmKey = key
    const t = lastMoveTiming(this.#options.reducedMotion)
    const prev = this.#lmSlots[this.#lmCur] as LastMoveSlot
    this.#lmCur = 1 - this.#lmCur
    const cur = this.#lmSlots[this.#lmCur] as LastMoveSlot
    if (prev.key !== '') {
      if (animate) {
        const a = prev.from.alpha
        const b = prev.to.alpha
        this.#anim.add(
          t.outMs,
          (k) => {
            prev.from.alpha = a * (1 - k)
            prev.to.alpha = b * (1 - k)
          },
          { ease: ease.inOutSine },
        )
      } else {
        prev.from.alpha = 0
        prev.to.alpha = 0
      }
      prev.key = ''
    }
    cur.key = key
    if (!lm) {
      cur.from.clear()
      cur.to.clear()
      return
    }
    this.#drawLastMoveSquare(cur.from, lm.from, lm.seat, false)
    this.#drawLastMoveSquare(cur.to, lm.to, lm.seat, true)
    // The newest highlight draws above the fading one.
    this.#lastMoveLayer.addChild(cur.from, cur.to)
    if (!animate) {
      cur.from.alpha = 1
      cur.to.alpha = 1
      return
    }
    cur.from.alpha = 0
    cur.to.alpha = 0
    this.#anim.add(
      t.fromMs,
      (k) => {
        if (cur.key === key) cur.from.alpha = k
      },
      { delay: this.#lastMoveAt.from, ease: ease.inOutSine },
    )
    this.#anim.add(
      t.toMs,
      (k) => {
        if (cur.key === key) cur.to.alpha = k
      },
      { delay: this.#lastMoveAt.to, ease: ease.inOutSine, tag: TAG_MOTION },
    )
  }

  /** Static highlights (keyboard cursor, attacked leaders) and the selection/hint state. */
  #refreshFx(): void {
    const g = this.#fx
    const h = this.#hints
    g.clear()
    h.clear()
    if (!this.#ready) return
    const sq = this.#layout.square
    if (this.#cursorVisible && this.#cursor >= 0) {
      this.#squareOrigin(this.#cursor, this.#tmpVec)
      const inset = sq * 0.06
      g.roundRect(
        this.#tmpVec.x + inset,
        this.#tmpVec.y + inset,
        sq - inset * 2,
        sq - inset * 2,
        sq * 0.08,
      ).stroke({
        color: 0xffffff,
        alpha: 0.95,
        width: Math.max(2, sq * 0.05),
      })
    }
    this.#syncSelection()
    this.#syncTarget()
  }

  /**
   * Selection visuals follow `#selected`: the square fill and the halo under
   * the piece fade in, the piece lifts a little, and the legal-move hints
   * ripple out from it; deselecting fades them away.
   */
  #syncSelection(): void {
    const sel = this.#selected
    if (sel === this.#selShownFor && sel === this.#hintsFor) return
    const reduced = this.#options.reducedMotion
    const prevSel = this.#selShownFor
    if (sel !== prevSel) {
      const old = prevSel >= 0 ? this.#pieces[prevSel] : null
      if (old && !old.moving && this.#drag?.node !== old) {
        this.#tweenLift(old, old === this.#hoverNode ? HOVER_LIFT : 0, 140)
      }
      this.#selShownFor = sel
      this.#anim.cancel(this.#selTween)
      const node = sel >= 0 ? this.#pieces[sel] : null
      if (sel >= 0) {
        this.#squareOrigin(sel, this.#tmpVec)
        this.#selGfx.position.set(this.#tmpVec.x, this.#tmpVec.y)
        squareCenter(sel, this.#layout, this.#tmpVec)
        this.#halo.position.set(this.#tmpVec.x, this.#tmpVec.y)
        const owner = node?.owner ?? this.#snapshot?.board[sel]?.owner ?? 'south'
        this.#halo.tint = hexToNumber(lightFor(seatColor(owner)))
        this.#selGfx.visible = true
        this.#halo.visible = true
        if (node && !node.moving) this.#tweenLift(node, reduced ? 0 : SELECT_LIFT, 120)
        if (node === this.#hoverNode) this.#fadeHoverGlow(0)
      }
      const f0 = this.#selFade
      const target = sel >= 0 ? 1 : 0
      this.#selTween = this.#anim.add(
        reduced ? 0 : target > 0 ? 110 : HINT_OUT_MS,
        (k) => {
          this.#selFade = f0 + (target - f0) * k
          this.#selGfx.alpha = this.#selFade
        },
        {
          ease: ease.outCubic,
          done: () => {
            if (target === 0) {
              this.#selGfx.visible = false
              this.#halo.visible = false
            }
          },
        },
      )
    }
    this.#showHints(sel)
  }

  /** Legal-move hints for `from` (-1 hides them). Sprites from a pool; one tween drives all. */
  #showHints(from: number): void {
    if (from === this.#hintsFor && from < 0) return
    this.#hintsFor = from
    this.#anim.cancel(this.#hintTween)
    const reduced = this.#options.reducedMotion
    if (from < 0) {
      const count = this.#hintCount
      const f0 = this.#hintFade
      if (count === 0) return
      this.#hintTween = this.#anim.add(
        reduced ? 0 : HINT_OUT_MS,
        (k) => {
          this.#hintFade = f0 * (1 - k)
          for (let i = 0; i < count; i++) {
            const h = this.#hintPool[i] as Hint
            h.sprite.alpha = Math.min(h.sprite.alpha, this.#hintFade)
            h.promo.alpha = Math.min(h.promo.alpha, this.#hintFade)
          }
        },
        {
          ease: ease.outQuad,
          done: () => {
            for (let i = 0; i < count; i++) {
              const h = this.#hintPool[i] as Hint
              h.sprite.visible = false
              h.promo.visible = false
            }
            this.#hintCount = 0
          },
        },
      )
      return
    }
    const fx = this.#effects
    if (!fx) return
    const targets = this.#moves.targetsFrom(from)
    const mover = this.#snapshot?.board[from]?.owner ?? 'south'
    const ringTint = hexToNumber(lightFor(seatColor(mover)))
    while (this.#hintPool.length < targets.length) {
      const sprite = new Sprite(fx.hintDot)
      const promo = new Sprite(fx.hintPromo)
      for (const sp of [sprite, promo]) {
        sp.anchor.set(0.5)
        sp.visible = false
        this.#hintLayer.addChild(sp)
      }
      const h: Hint = { sprite, promo, delay: 0 }
      this.#sizeHint(h)
      this.#hintPool.push(h)
    }
    for (let i = targets.length; i < this.#hintCount; i++) {
      const h = this.#hintPool[i] as Hint
      h.sprite.visible = false
      h.promo.visible = false
    }
    let maxDelay = 0
    targets.forEach((t, i) => {
      const h = this.#hintPool[i] as Hint
      squareCenter(t.to, this.#layout, this.#tmpVec)
      h.sprite.texture = t.capture ? fx.hintRing : fx.hintDot
      h.sprite.tint = t.capture ? ringTint : 0xffffff
      h.sprite.position.set(this.#tmpVec.x, this.#tmpVec.y)
      h.promo.position.set(this.#tmpVec.x, this.#tmpVec.y)
      h.promo.tint = 0xffd36b
      h.sprite.visible = true
      h.promo.visible = t.promotions.length > 0
      h.delay = reduced ? 0 : hintDelay(from, t.to)
      maxDelay = Math.max(maxDelay, h.delay)
      this.#scaleHint(h, reduced ? 1 : 0.4)
      h.sprite.alpha = reduced ? 1 : 0
      h.promo.alpha = reduced ? 1 : 0
    })
    this.#hintCount = targets.length
    this.#hintFade = 1
    if (reduced || targets.length === 0) return
    const total = HINT_IN_MS + maxDelay
    const count = targets.length
    this.#hintTween = this.#anim.add(
      total,
      (k) => {
        const ms = k * total
        for (let i = 0; i < count; i++) {
          const h = this.#hintPool[i] as Hint
          const u = Math.max(0, Math.min(1, (ms - h.delay) / HINT_IN_MS))
          this.#scaleHint(h, 0.4 + 0.6 * HINT_EASE(u))
          const a = ease.outQuad(u)
          h.sprite.alpha = a
          h.promo.alpha = a
        }
      },
      { ease: ease.linear },
    )
  }

  #sizeHint(h: Hint): void {
    this.#scaleHint(h, 1)
  }

  #scaleHint(h: Hint, s: number): void {
    const sq = this.#layout.square
    const w = Math.max(1, h.sprite.texture.width)
    // Quiet-move dots keep a readable size on small squares (a 16×16 board on a phone),
    // up to at most 60% of the square.
    let size = sq
    if (h.sprite.texture === this.#effects?.hintDot) {
      const wt = this.#root.worldTransform
      const screen = Math.hypot(wt.a, wt.b) || 1
      const minSize = HINT_DOT_MIN_PX / screen / HINT_DOT_FRACTION
      size = Math.min(Math.max(sq, minSize), (sq * 0.6) / HINT_DOT_FRACTION)
    }
    h.sprite.scale.set((size * s) / w)
    h.promo.scale.set((sq * s) / Math.max(1, h.promo.texture.width))
  }

  /** The hovered legal target of the selected piece. */
  #syncTarget(): void {
    const t =
      this.#selected >= 0 && this.#hover >= 0 && this.#hover !== this.#selected
        ? this.#moves.target(this.#selected, this.#hover)
        : null
    if (!t) {
      this.#targetGfx.visible = false
      return
    }
    this.#squareOrigin(this.#hover, this.#tmpVec)
    this.#targetGfx.position.set(this.#tmpVec.x, this.#tmpVec.y)
    this.#targetGfx.visible = true
  }

  /** Tweens a resting piece's lift (hover, selection, drag), replacing any earlier lift tween. */
  #tweenLift(n: PieceNode, to: number, ms: number): void {
    this.#anim.cancel(n.liftTween)
    n.liftTween = null
    const from = n.lift
    if (Math.abs(from - to) < 0.001) return
    if (this.#options.reducedMotion) {
      n.lift = to
      this.#placeShadow(n)
      return
    }
    n.liftTween = this.#anim.add(
      ms,
      (k) => {
        if (n.node.destroyed || n.moving) return
        n.lift = from + (to - from) * k
        this.#placeShadow(n)
      },
      {
        ease: ease.outCubic,
        done: () => {
          n.liftTween = null
        },
      },
    )
  }

  /** Hover affordance on a movable piece of the interactive seat: a small lift and a soft glow. */
  #setHoverPiece(n: PieceNode | null): void {
    if (n === this.#hoverNode) return
    const old = this.#hoverNode
    this.#hoverNode = n
    const selNode = this.#selected >= 0 ? this.#pieces[this.#selected] : null
    if (old && !old.node.destroyed && !old.moving && old !== selNode && this.#drag?.node !== old) {
      this.#tweenLift(old, 0, 160)
    }
    if (!n || n === selNode) {
      this.#fadeHoverGlow(0)
      return
    }
    if (!this.#options.reducedMotion) this.#tweenLift(n, HOVER_LIFT, 120)
    const sq = this.#pieces.indexOf(n)
    if (sq >= 0) {
      squareCenter(sq, this.#layout, this.#tmpVec)
      this.#hoverGlow.position.set(this.#tmpVec.x, this.#tmpVec.y)
      this.#hoverGlow.tint = hexToNumber(lightFor(seatColor(n.owner)))
      this.#fadeHoverGlow(0.3)
    }
  }

  #fadeHoverGlow(to: number): void {
    this.#anim.cancel(this.#hoverTween)
    const g = this.#hoverGlow
    const from = g.visible ? g.alpha : 0
    if (Math.abs(from - to) < 0.001) {
      g.visible = to > 0
      return
    }
    g.visible = true
    this.#hoverTween = this.#anim.add(
      to > from ? 120 : 160,
      (k) => {
        g.alpha = from + (to - from) * k
      },
      {
        ease: ease.outCubic,
        done: () => {
          g.visible = to > 0
        },
      },
    )
  }

  /** Red flash on a refused drop target. */
  #flashIllegal(square: number): void {
    this.#squareOrigin(square, this.#tmpVec)
    const f = this.#flashGfx
    f.position.set(this.#tmpVec.x, this.#tmpVec.y)
    f.visible = true
    this.#anim.add(
      220,
      (k) => {
        f.alpha = 0.25 * (1 - k)
      },
      {
        ease: ease.outQuad,
        done: () => {
          f.visible = false
        },
      },
    )
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
    let step = raw * this.#timeScale
    // Hit-stop: a leader's fall briefly slows the whole scene.
    if (this.#hitStop > 0) {
      this.#hitStop -= step
      step *= HIT_STOP_SCALE
    }
    this.#clock += step
    const dt = step / 1000
    this.#time += dt
    this.#anim.update(this.#clock)
    this.#particles?.update(dt)
    this.#chips?.update(dt)
    if (this.#shakeLeft > 0) {
      this.#shakeLeft = Math.max(0, this.#shakeLeft - step)
      const t = 1 - this.#shakeLeft / SHAKE_MS
      const amp = (this.#options.reducedMotion ? 0 : SHAKE_PX / this.#fitScale) * (1 - t) ** 2
      this.#root.pivot.set(Math.sin(t * Math.PI * 7) * amp, Math.cos(t * Math.PI * 5.2) * amp * 0.7)
    } else if (this.#root.pivot.x !== 0 || this.#root.pivot.y !== 0) {
      this.#root.pivot.set(0, 0)
    }
    const reduced = this.#options.reducedMotion
    const pulse = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(this.#time * 2.4)
    const band = this.#bandGlow
    band.visible = this.#turnShown >= 0 && this.#bandFade > 0.001
    if (band.visible) band.alpha = (0.5 + 0.3 * pulse) * this.#bandGlowGain * this.#bandFade
    const out = this.#bandGlowOut
    if (out.visible) out.alpha = (0.5 + 0.3 * pulse) * this.#bandOutGain * this.#bandOutFade
    for (const m of this.#medallions) {
      if (m.glow.visible) m.glow.alpha = (0.35 + 0.4 * pulse) * m.glowFade
    }
    // Selected piece: a halo that breathes at 1.6 Hz (steady under reduced motion).
    if (this.#halo.visible) {
      const hp = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.#time * Math.PI * 2 * 1.6)
      this.#halo.alpha = (0.3 + 0.2 * hp) * this.#selFade
    }
    // Check: the glow under the leader and its ring pulse together (steady under reduced motion).
    if (this.#checkSquares.length > 0) {
      const lp = reduced ? 0.75 : 0.5 + 0.5 * Math.sin(this.#time * 5.5)
      for (const g of this.#leaderGlows) {
        if (!g.visible) continue
        g.alpha = 0.55 + 0.45 * lp
        const s = (this.#layout.square * 1.5 * (0.92 + 0.14 * lp)) / Math.max(1, g.texture.width)
        g.scale.set(s)
      }
      this.#checkRing.alpha = reduced ? 1 : 0.55 + 0.45 * lp
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
    cv.addEventListener('pointerleave', () => {
      this.#setHover(-1)
      this.#setHoverPiece(null)
    })
    cv.addEventListener('contextmenu', (e) => {
      if (this.#drag) e.preventDefault()
    })
  }

  #hit(e: FederatedPointerEvent): number {
    this.#root.toLocal(e.global, undefined, this.#tmpPoint)
    return pointToSquare(this.#tmpPoint.x, this.#tmpPoint.y, this.#layout)
  }

  /**
   * For touch or pen, the legal target of `from` that a tap or drop just off it meant
   * (see TOUCH_SLOP_PX), or -1. A mouse is precise and never gets this help.
   */
  #touchTarget(e: FederatedPointerEvent, from: number): number {
    if (e.pointerType === 'mouse' || from < 0) return -1
    this.#root.toLocal(e.global, undefined, this.#tmpPoint)
    const wt = this.#root.worldTransform
    const scale = Math.hypot(wt.a, wt.b) || 1
    const sq = this.#layout.square
    const slop = Math.min(TOUCH_SLOP_PX / scale, sq * 0.5 + TOUCH_EDGE_PX / scale)
    const targets = this.#moves.targetsFrom(from).map((m) => m.to)
    return nearestTarget(this.#tmpPoint.x, this.#tmpPoint.y, targets, this.#layout, slop)
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
    // A fingertip just off a legal target on a small board: that target was meant.
    const near = this.#selected >= 0 ? this.#touchTarget(e, this.#selected) : -1
    if (near >= 0 && near !== this.#selected) {
      this.#commit(this.#selected, near, false)
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
    const act = this.#canAct()
    const movable = act && sq >= 0 && this.#moves.canMoveFrom(sq)
    this.#setHoverPiece(movable && !this.#press ? (this.#pieces[sq] ?? null) : null)
    if (cv) {
      if (movable) cv.style.cursor = 'grab'
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
      let to = this.#hit(e)
      if (to !== from && !(to >= 0 && this.#moves.target(from, to))) {
        const near = this.#touchTarget(e, from)
        if (near >= 0) to = near
      }
      if (to >= 0 && to !== from && this.#moves.target(from, to)) {
        this.#endDrag(true)
        this.#commit(from, to, true)
      } else {
        if (to >= 0 && to !== from) {
          this.#sound.play('illegal')
          this.#flashIllegal(to)
        }
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
    if (this.#selected >= 0) this.#syncTarget()
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
    this.#stopMotion(n)
    this.#fadeHoverGlow(0)
    this.#dragLayer.addChild(n.node)
    n.node.rotation = -this.#angle
    this.#tweenLift(n, 1, 110)
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
    this.#anim.cancel(n.liftTween)
    n.liftTween = null
    this.#pieceLayer.addChild(n.node)
    if (!keep) {
      // Back home with the lift held (it passes over other pieces), dropping at the end.
      squareCenter(d.square, this.#layout, this.#tmpVec)
      this.#returnHome(n, this.#tmpVec.x, this.#tmpVec.y, this.#options.reducedMotion)
    }
  }

  /** A user move from -> to; asks for the promotion piece if needed. */
  #commit(from: number, to: number, dropped: boolean): void {
    const r = this.#moves.resolve(from, to)
    if (r === null) return
    const n = this.#pieces[from]
    if (n) {
      squareCenter(to, this.#layout, this.#tmpVec)
      const reduced = this.#options.reducedMotion
      let tween: Tween
      if (dropped) {
        // Already over its square: glide to the centre and set it down.
        tween = this.#fly(n, this.#tmpVec.x, this.#tmpVec.y, {
          duration: reduced ? 0 : DROP_MS,
          ease: ease.outQuad,
          liftFrom: reduced ? 0 : n.lift,
          peak: reduced ? 0 : n.lift,
          dropAt: 0,
          settle: reduced ? 0 : 0.95,
          tag: TAG_USER,
        })
      } else {
        const t = scheduleMoves(
          [{ kind: n.kind, distSq: squareDistance(from, to), castleRook: false }],
          reduced,
        ).items[0]?.timing
        tween = this.#fly(n, this.#tmpVec.x, this.#tmpVec.y, {
          duration: reduced || !t ? 0 : t.duration,
          ease: t?.ease ?? ease.move,
          peak: reduced ? 0 : (t?.lift ?? 0),
          liftFrom: reduced ? 0 : n.lift,
          hop: reduced ? 0 : (t?.hop ?? 0),
          settle: reduced || !t || t.settleMs === 0 ? 0 : 0.95,
          tag: TAG_USER,
        })
      }
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
      for (let i = 0; i < NUM_SQUARES; i++) {
        const p = s.board[i]
        if (p && p.owner === seat && p.kind === 'king') return i
      }
    }
    return (BOARD_SIZE / 2) * BOARD_SIZE + BOARD_SIZE / 2
  }
}
