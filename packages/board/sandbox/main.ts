/**
 * Dev-only hot-seat sandbox for @game/board: all four seats on one screen,
 * driven by the real rules engine (@game/rules). Never deployed.
 *
 * `window.__sandbox` exposes helpers for scripted checks (Playwright).
 */
import canadaSvg from '@game/assets/emblems/canada.svg?raw'
import chinaSvg from '@game/assets/emblems/china.svg?raw'
import englandSvg from '@game/assets/emblems/england.svg?raw'
import franceSvg from '@game/assets/emblems/france.svg?raw'
import germanySvg from '@game/assets/emblems/germany.svg?raw'
import japanSvg from '@game/assets/emblems/japan.svg?raw'
import maliSvg from '@game/assets/emblems/mali.svg?raw'
import russiaSvg from '@game/assets/emblems/russia.svg?raw'
import usaSvg from '@game/assets/emblems/usa.svg?raw'
import { APP_NAME, CIVILIZATIONS } from '@game/config'
import {
  type CivId,
  Game,
  type GameEvent,
  type GameMode,
  initRules,
  type Seat,
  type Snapshot,
} from '@game/rules'
import { type BoardOptions, BoardView, SEAT_STYLES } from '../src/index.ts'

const EMBLEMS: Record<CivId, string> = {
  canada: canadaSvg,
  usa: usaSvg,
  china: chinaSvg,
  japan: japanSvg,
  germany: germanySvg,
  russia: russiaSvg,
  england: englandSvg,
  france: franceSvg,
  mali: maliSvg,
}

const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']
const SEAT_LABEL: Record<Seat, string> = {
  south: 'South',
  west: 'West',
  north: 'North',
  east: 'East',
}

const stage = document.getElementById('stage') as HTMLElement
const panel = document.getElementById('panel') as HTMLElement

// The renderer doesn't need the rules engine to start: load both at once.
const rulesReady = initRules()

let mode: GameMode = 'ffa'
let civs: CivId[] = ['canada', 'japan', 'france', 'mali']
let followTurn = false
/** Hot seat: mark the seat to move when its leader is under attack (the web app's rule is per viewer). */
let showCheck = true
let perspective: Seat = 'south'
const history: string[] = []
const log: { ply: number; seat: Seat | null; text: string; major: boolean }[] = []
let options: BoardOptions = {
  reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  colorblindPatterns: false,
  sound: true,
  volume: 0.6,
}

const view = new BoardView({ ...options, onMoveIntent: (m) => play(m) })
const hover = document.createElement('div')
hover.className = 'hover-readout'
stage.appendChild(hover)
const toast = document.createElement('div')
toast.className = 'toast'
stage.appendChild(toast)
view.onSquareHover = (sq) => {
  hover.textContent = sq ?? ''
}
await Promise.all([rulesReady, view.mount(stage)])
let game = Game.create({ mode, civs: civs as unknown as [CivId, CivId, CivId, CivId] })
let snapshot: Snapshot = game.snapshot()

function showError(msg: string): void {
  toast.textContent = msg
  toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 2600)
}

function describe(e: GameEvent): { text: string; seat: Seat | null; major: boolean } | null {
  switch (e.type) {
    case 'move_made':
      return {
        text: `${e.notation}${e.flag === 'castle' ? '  castle' : e.flag === 'double_step' ? '' : ''}`,
        seat: e.seat,
        major: false,
      }
    case 'capture':
      return {
        text: `  takes ${e.captured.owner} ${e.captured.kind} on ${e.square}`,
        seat: e.seat,
        major: false,
      }
    case 'en_passant':
      return { text: `  en passant (${e.capturedSquare})`, seat: e.seat, major: false }
    case 'promotion':
      return { text: `  promotes to ${e.kind} on ${e.square}`, seat: e.seat, major: false }
    case 'castle':
      return { text: `  rook ${e.rookFrom}-${e.rookTo}`, seat: e.seat, major: false }
    case 'pass':
      return { text: '-- (pass)', seat: e.seat, major: false }
    case 'defeat':
      return {
        text: `${SEAT_LABEL[e.seat]} defeated (${e.reason.replace('_', ' ')})`,
        seat: e.seat,
        major: true,
      }
    case 'army_removed':
      return { text: `${SEAT_LABEL[e.seat]} army removed`, seat: e.seat, major: true }
    case 'frozen':
      return { text: `${SEAT_LABEL[e.seat]} frozen`, seat: e.seat, major: true }
    case 'game_ended': {
      const r = e.outcome.result
      const text =
        r.type === 'ffa_winner'
          ? `Game over: ${SEAT_LABEL[r.seat]} wins`
          : r.type === 'teams_winner'
            ? `Game over: ${r.team === 'south_north' ? 'South + North' : 'West + East'} win`
            : r.type === 'teams_draw'
              ? 'Game over: draw'
              : 'Game over: move-limit tie'
      return { text, seat: null, major: true }
    }
  }
}

function pushEvents(events: readonly GameEvent[], ply: number): void {
  for (const e of events) {
    const d = describe(e)
    if (d) log.push({ ply, ...d })
  }
}

/** Shows the current game state on the board and in the panel. */
function sync(events: readonly GameEvent[] | null, animate = true): void {
  snapshot = game.snapshot()
  view.setSnapshot(snapshot, events ? { animate, events } : { animate })
  view.setInteractive(snapshot.isOver ? null : snapshot.seatToMove)
  view.setLegalMoves(snapshot.isOver ? [] : game.legalMoves())
  const toMove = SEAT_INDEX[snapshot.seatToMove]
  view.setCheck(
    showCheck && !snapshot.isOver && snapshot.leaderUnderAttack[toMove]
      ? snapshot.seatToMove
      : null,
  )
  if (followTurn && !snapshot.isOver && snapshot.seatToMove !== perspective) {
    perspective = snapshot.seatToMove
    view.setPerspective(perspective)
  }
  render()
}

function act(fn: () => GameEvent[]): boolean {
  const before = game.positionString()
  const ply = snapshot.ply + 1
  try {
    const events = fn()
    history.push(before)
    pushEvents(events, ply)
    sync(events)
    return true
  } catch (err) {
    showError((err as Error).message)
    sync(null)
    return false
  }
}

function play(move: string): boolean {
  return act(() => game.applyMove(move))
}

function newGame(): void {
  game.free()
  game = Game.create({ mode, civs: civs as unknown as [CivId, CivId, CivId, CivId] })
  history.length = 0
  log.length = 0
  log.push({
    ply: 0,
    seat: null,
    text: `New ${mode === 'ffa' ? 'free-for-all' : 'teams'} game`,
    major: true,
  })
  sync(null, false)
}

function loadPosition(pos: string, animate = true): boolean {
  try {
    const g = Game.fromPosition(pos.trim())
    history.push(game.positionString())
    game.free()
    game = g
    mode = game.snapshot().config.mode
    civs = game.snapshot().config.civs.map((c) => c.id)
    log.push({ ply: game.snapshot().ply, seat: null, text: 'Position loaded', major: true })
    sync(null, animate)
    return true
  } catch (err) {
    showError((err as Error).message)
    return false
  }
}

function undo(): void {
  const prev = history.pop()
  if (!prev) return
  const g = Game.fromPosition(prev)
  game.free()
  game = g
  log.push({ ply: game.snapshot().ply, seat: null, text: 'Undo', major: false })
  sync(null, true)
}

function setCiv(seat: Seat, civ: CivId): void {
  const list = [...snapshot.config.civs.map((c) => c.id)] as CivId[]
  list[SEATS.indexOf(seat)] = civ
  civs = list
  // Latest civ versions, as the engine resolves them for a new game.
  const probe = Game.create({ mode, civs: list as unknown as [CivId, CivId, CivId, CivId] })
  const versions = probe.snapshot().config.civs.map((c) => `${c.id}.${c.version}`)
  probe.free()
  const pos = game.positionString().replace(/civ=\S+/, `civ=${versions.join(',')}`)
  try {
    const g = Game.fromPosition(pos)
    game.free()
    game = g
    sync(null, false)
  } catch {
    // A civ with a different army (England's Prime Ministers) can't take over the
    // position: start a new game with the chosen civs.
    newGame()
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  Object.assign(e, props)
  for (const c of children) e.append(c)
  return e
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { className: cls, textContent: label, type: 'button' })
  b.addEventListener('click', onClick)
  return b
}

function toggle(label: string, key: keyof BoardOptions): HTMLLabelElement {
  const input = el('input', { type: 'checkbox', checked: Boolean(options[key]) })
  input.addEventListener('change', () => {
    options = { ...options, [key]: input.checked }
    view.setOptions(options)
  })
  return el('label', { className: 'toggle' }, input, label)
}

function checkToggle(): HTMLLabelElement {
  const input = el('input', { type: 'checkbox', checked: showCheck })
  input.addEventListener('change', () => {
    showCheck = input.checked
    sync(null, false)
  })
  return el('label', { className: 'toggle' }, input, 'Check indicator')
}

const SEAT_INDEX: Record<Seat, number> = { south: 0, west: 1, north: 2, east: 3 }

const statusEl = el('div', { className: 'status' })
const seatsEl = el('div', { className: 'seats' })
const logList = el('ol')
const modeSeg = el('div', { className: 'seg' })
const perspSeg = el('div', { className: 'seg' })
const posArea = el('textarea', { spellcheck: false, placeholder: 'Position string' })

function render(): void {
  // Status line.
  const s = snapshot
  statusEl.replaceChildren()
  if (s.outcome) {
    const r = s.outcome.result
    statusEl.append(
      r.type === 'ffa_winner'
        ? `${SEAT_LABEL[r.seat]} wins`
        : r.type === 'teams_winner'
          ? `${r.team === 'south_north' ? 'South + North' : 'West + East'} win`
          : r.type === 'teams_draw'
            ? 'Draw'
            : 'Move-limit tie',
      el('span', { className: 'muted', textContent: ` · ply ${s.ply}` }),
    )
  } else {
    statusEl.append(
      `${SEAT_LABEL[s.seatToMove]} to move`,
      el('span', {
        className: 'muted',
        textContent: ` · ply ${s.ply} · quiet ${s.noProgress}/${s.moveLimit}`,
      }),
    )
  }

  modeSeg.replaceChildren(
    button(
      'Free-for-all',
      () => {
        mode = 'ffa'
        newGame()
      },
      mode === 'ffa' ? 'on' : '',
    ),
    button(
      'Teams 2v2',
      () => {
        mode = 'teams'
        newGame()
      },
      mode === 'teams' ? 'on' : '',
    ),
  )
  perspSeg.replaceChildren(
    ...SEATS.map((seat) =>
      button(
        SEAT_LABEL[seat],
        () => {
          perspective = seat
          view.setPerspective(seat)
          render()
        },
        perspective === seat ? 'on' : '',
      ),
    ),
  )

  seatsEl.replaceChildren(
    ...SEATS.map((seat, i) => {
      const style = SEAT_STYLES[seat]
      const civ = s.config.civs[i]?.id ?? 'canada'
      const status = s.statuses[i] ?? 'active'
      const emblem = el('div', { className: 'emblem' })
      emblem.innerHTML = EMBLEMS[civ]
      const select = el('select', { title: 'Civilization' })
      for (const c of CIVILIZATIONS) {
        select.append(
          el('option', { value: c.slug, textContent: c.name, selected: c.slug === civ }),
        )
      }
      select.addEventListener('change', () => setCiv(seat, select.value as CivId))
      const row = el(
        'div',
        { className: `seat${!s.isOver && s.seatToMove === seat ? ' to-move' : ''}` },
        emblem,
        el(
          'div',
          { className: 'name' },
          SEAT_LABEL[seat],
          el('small', { textContent: style.name }),
        ),
        el('span', { className: `badge ${status}`, textContent: status }),
        el(
          'div',
          { className: 'controls' },
          select,
          button('Timeout', () => act(() => game.applyTimeout(seat)), 'small'),
          button('Abandon', () => act(() => game.applyAbandon(seat)), 'small'),
        ),
      )
      row.style.setProperty('--seat', style.base)
      return row
    }),
  )

  logList.replaceChildren(
    ...log.slice(-200).map((entry) => {
      const dot = el('span', { className: 'dot' })
      dot.style.background = entry.seat ? SEAT_STYLES[entry.seat].base : 'transparent'
      return el(
        'li',
        { className: entry.major ? 'major' : '' },
        el('span', { className: 'ply', textContent: String(entry.ply) }),
        dot,
        el('span', { textContent: entry.text }),
      )
    }),
  )
  logList.scrollTop = logList.scrollHeight
  posArea.value = game.positionString()
}

const followInput = el('input', { type: 'checkbox', checked: followTurn })
followInput.addEventListener('change', () => {
  followTurn = followInput.checked
  if (followTurn && !snapshot.isOver) {
    perspective = snapshot.seatToMove
    view.setPerspective(perspective)
  }
  render()
})

panel.append(
  el(
    'header',
    {},
    el('h1', { textContent: APP_NAME }),
    el('span', { className: 'tag', textContent: 'Dev sandbox' }),
  ),
  el(
    'section',
    {},
    el('h2', { textContent: 'Game' }),
    el('div', { className: 'row' }, modeSeg, button('Undo', undo), button('Restart', newGame)),
    el('div', { className: 'status mt' }, statusEl),
  ),
  el(
    'section',
    {},
    el('h2', { textContent: 'Perspective' }),
    el(
      'div',
      { className: 'row' },
      perspSeg,
      el('label', { className: 'toggle' }, followInput, 'Follow turn'),
    ),
  ),
  el('section', {}, el('h2', { textContent: 'Seats' }), seatsEl),
  el(
    'section',
    {},
    el('h2', { textContent: 'Options' }),
    el(
      'div',
      { className: 'row' },
      checkToggle(),
      toggle('Reduced motion', 'reducedMotion'),
      toggle('Colour-blind marks', 'colorblindPatterns'),
      toggle('Sound', 'sound'),
    ),
  ),
  el('section', { className: 'log' }, el('h2', { textContent: 'Events' }), logList),
  el(
    'section',
    {},
    el('h2', { textContent: 'Position' }),
    posArea,
    el(
      'div',
      { className: 'row mt' },
      button('Load', () => loadPosition(posArea.value)),
      button('Copy', () => void navigator.clipboard?.writeText(game.positionString())),
    ),
  ),
)

newGame()

/** Hooks for scripted checks (Playwright). */
const api = {
  view,
  get snapshot() {
    return snapshot
  },
  play,
  /** Plays moves in order; stops at the first error. Waits `delay` ms between moves. */
  async playAll(moves: readonly string[], delay = 0) {
    for (const m of moves) {
      if (!play(m)) return false
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    }
    return true
  },
  timeout: (seat: Seat) => act(() => game.applyTimeout(seat)),
  abandon: (seat: Seat) => act(() => game.applyAbandon(seat)),
  newGame: (m: GameMode) => {
    mode = m
    newGame()
  },
  loadPosition,
  position: () => game.positionString(),
  setPerspective: (seat: Seat) => {
    perspective = seat
    view.setPerspective(seat)
    render()
  },
  setOptions: (o: Partial<BoardOptions>) => {
    options = { ...options, ...o }
    view.setOptions(options)
  },
  setCiv,
  legal: () => game.legalMoveNotations(),
}
;(globalThis as unknown as { __sandbox: typeof api }).__sandbox = api
