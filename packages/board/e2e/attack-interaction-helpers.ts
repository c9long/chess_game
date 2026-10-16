import { expect, type Page } from '@playwright/test'

/**
 * Helpers for the interaction / correctness attack specs. They read the
 * rendered Pixi scene through Pixi's own devtools hook
 * (`globalThis.__PIXI_APP_INIT__`), so no source change is needed.
 */

export type Seat = 'south' | 'west' | 'north' | 'east'
export const SEATS: readonly Seat[] = ['south', 'west', 'north', 'east']

export interface RenderedPiece {
  square: string
  kind: string
  variant: string
  alpha: number
  /** Distance from the square centre in squares. */
  off: number
  layer: string
}

export async function openSandbox(page: Page, opts: { reducedMotion?: boolean } = {}) {
  await page.addInitScript(() => {
    ;(globalThis as unknown as Record<string, unknown>).__PIXI_APP_INIT__ = (app: unknown) => {
      ;(globalThis as unknown as Record<string, unknown>).__pixiApp = app
    }
  })
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.waitForFunction(() => {
    const g = globalThis as unknown as { __sandbox?: unknown; __pixiApp?: unknown }
    return !!g.__sandbox && !!g.__pixiApp
  })
  // Turn sound off (headless audio is irrelevant here).
  await page.evaluate(() => {
    const sb = (globalThis as unknown as { __sandbox: { setOptions(o: unknown): void } }).__sandbox
    sb.setOptions({ sound: false })
  })
  await settle(page)
}

export async function settle(page: Page) {
  await page.waitForFunction(
    () =>
      !(globalThis as unknown as { __sandbox: { view: { animating: boolean } } }).__sandbox.view
        .animating,
    undefined,
    { timeout: 10_000 },
  )
  // One extra frame so the atlas/medallion promises resolve.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
}

/** Pieces as drawn by the renderer (piece, moving and drag layers). */
export async function renderedBoard(page: Page): Promise<RenderedPiece[]> {
  return page.evaluate(() => {
    type Node = {
      children: Node[]
      alpha: number
      visible: boolean
      destroyed: boolean
      getGlobalPosition(): { x: number; y: number }
      texture?: { frame: { x: number; y: number; width: number } }
    }
    const g = globalThis as unknown as {
      __pixiApp: { stage: Node }
      __sandbox: { view: { squareToClient(s: string): { x: number; y: number } | null } }
    }
    const view = g.__sandbox.view
    const root = g.__pixiApp.stage.children[0] as Node
    // Layers are found by label (BoardView names every root child).
    const layer = (name: string) =>
      (root.children as (Node & { label?: string })[]).find((c) => c.label === name)
    const layers: Record<string, Node | undefined> = {
      pieces: layer('pieces'),
      moving: layer('moving'),
      dissolve: layer('dissolve'),
      drag: layer('drag'),
    }
    const names: string[] = []
    const centres: { x: number; y: number }[] = []
    for (let r = 0; r < 12; r++) {
      for (let f = 0; f < 12; f++) {
        const n = `${'abcdefghijkl'[f]}${r + 1}`
        names.push(n)
        centres.push(view.squareToClient(n) as { x: number; y: number })
      }
    }
    const a = centres[0] as { x: number; y: number }
    const b = centres[1] as { x: number; y: number }
    const sq = Math.hypot(a.x - b.x, a.y - b.y)
    const KINDS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
    const VARIANTS = ['south', 'west', 'north', 'east', 'frozen']
    const out: {
      square: string
      kind: string
      variant: string
      alpha: number
      off: number
      layer: string
    }[] = []
    const visit = (n: Node, layer: string) => {
      if (n.destroyed || !n.visible) return
      const body = n.children[0]
      if (!body?.texture) return
      const p = n.getGlobalPosition()
      let best = -1
      let bd = Number.POSITIVE_INFINITY
      centres.forEach((c, i) => {
        const d = Math.hypot(c.x - p.x, c.y - p.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      const fr = body.texture.frame
      const size = fr.width
      const pad = Math.ceil(size * 0.1)
      const cell = size + pad * 2
      const col = Math.round((fr.x - pad) / cell)
      const row = Math.round((fr.y - pad) / cell)
      out.push({
        square: names[best] as string,
        kind: KINDS[col] ?? `?${col}`,
        variant: VARIANTS[row] ?? `?${row}`,
        alpha: n.alpha,
        off: bd / sq,
        layer,
      })
    }
    for (const [name, layer] of Object.entries(layers)) {
      if (!layer) continue
      if (name === 'dissolve') {
        for (const grp of layer.children) for (const c of grp.children) visit(c, name)
      } else {
        for (const c of layer.children) visit(c, name)
      }
    }
    return out
  })
}

/** Engine snapshot as square -> "owner kind" plus statuses. */
export async function engineBoard(page: Page) {
  return page.evaluate(() => {
    const s = (
      globalThis as unknown as {
        __sandbox: {
          snapshot: {
            board: ({ kind: string; owner: string } | null)[]
            statuses: string[]
            seatToMove: string
            isOver: boolean
          }
        }
      }
    ).__sandbox.snapshot
    const pieces: Record<string, string> = {}
    s.board.forEach((p, i) => {
      if (!p) return
      pieces[`${'abcdefghijkl'[i % 12]}${Math.floor(i / 12) + 1}`] = `${p.owner} ${p.kind}`
    })
    return { pieces, statuses: s.statuses, seatToMove: s.seatToMove, isOver: s.isOver }
  })
}

/** Asserts the rendered board equals the engine snapshot (after animations settle). */
export async function expectBoardMatchesEngine(page: Page, label = '') {
  await settle(page)
  const eng = await engineBoard(page)
  const ren = await renderedBoard(page)
  const problems: string[] = []
  const seen = new Map<string, RenderedPiece>()
  const SEATS = ['south', 'west', 'north', 'east']
  for (const r of ren) {
    if (r.layer !== 'pieces') problems.push(`${r.square}: piece left in ${r.layer} layer`)
    if (r.off > 0.05) problems.push(`${r.square}: ${r.kind} off-centre by ${r.off.toFixed(2)} sq`)
    if (r.alpha < 0.99) problems.push(`${r.square}: alpha ${r.alpha}`)
    if (seen.has(r.square)) problems.push(`${r.square}: two pieces drawn`)
    seen.set(r.square, r)
  }
  for (const [sq, desc] of Object.entries(eng.pieces)) {
    const [owner, kind] = desc.split(' ') as [string, string]
    const r = seen.get(sq)
    if (!r) {
      problems.push(`${sq}: engine has ${desc}, nothing drawn`)
      continue
    }
    const status = eng.statuses[SEATS.indexOf(owner)]
    const wantVariant = status === 'frozen' ? 'frozen' : owner
    if (r.kind !== kind) problems.push(`${sq}: engine ${kind}, drawn ${r.kind}`)
    if (r.variant !== wantVariant)
      problems.push(`${sq}: want variant ${wantVariant}, drawn ${r.variant}`)
  }
  for (const sq of seen.keys()) {
    if (!eng.pieces[sq]) problems.push(`${sq}: drawn ${seen.get(sq)?.kind}, engine empty`)
  }
  expect(problems, `render != engine ${label}`).toEqual([])
}

/** Viewport (page) coordinates of a square's centre. */
export async function squarePoint(page: Page, square: string) {
  return page.evaluate((sq) => {
    const v = (
      globalThis as unknown as {
        __sandbox: {
          view: {
            canvas: HTMLCanvasElement
            squareToClient(s: string): { x: number; y: number } | null
          }
        }
      }
    ).__sandbox.view
    const p = v.squareToClient(sq)
    const r = v.canvas.getBoundingClientRect()
    if (!p) throw new Error(`no square ${sq}`)
    return { x: r.left + p.x, y: r.top + p.y }
  }, square)
}

export async function clickSquare(page: Page, square: string) {
  const p = await squarePoint(page, square)
  await page.mouse.click(p.x, p.y)
}

export async function dragSquare(page: Page, from: string, to: string) {
  const a = await squarePoint(page, from)
  const b = await squarePoint(page, to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 8, a.y + 8, { steps: 2 })
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
}

export async function sb<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ fn, args }) => {
      const s = (globalThis as unknown as { __sandbox: Record<string, unknown> }).__sandbox
      const f = s[fn] as (...a: unknown[]) => unknown
      return f(...args) as T
    },
    { fn, args },
  )
}

export async function setPerspective(page: Page, seat: Seat) {
  await sb(page, 'setPerspective', seat)
  await settle(page)
}

export async function position(page: Page): Promise<string> {
  return sb<string>(page, 'position')
}

export async function seatToMove(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (globalThis as unknown as { __sandbox: { snapshot: { seatToMove: string } } }).__sandbox
        .snapshot.seatToMove,
  )
}

/** Which seat the board's turn band/medallion glow is drawn for (null = hidden). */
export async function turnIndicator(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    type N = {
      children: N[]
      visible: boolean
      x: number
      y: number
      rotation: number
    }
    const g = globalThis as unknown as { __pixiApp: { stage: N } }
    const root = g.__pixiApp.stage.children[0] as N
    const band = (root.children as (N & { label?: string })[]).find(
      (c) => c.label === 'bandGlow',
    ) as N
    const medals = (root.children as (N & { label?: string })[]).find(
      (c) => c.label === 'medals',
    ) as N
    const glowSeat = ['south', 'west', 'north', 'east'].filter(
      (_, i) => (medals.children[i * 2] as N).visible,
    )
    if (!band.visible) return glowSeat.length ? `medal-only:${glowSeat.join(',')}` : null
    let bandSeat: string
    if (Math.abs(band.x) < 1) bandSeat = band.y > 0 ? 'south' : 'north'
    else bandSeat = band.x < 0 ? 'west' : 'east'
    if (glowSeat.length !== 1 || glowSeat[0] !== bandSeat)
      return `mismatch band=${bandSeat} medal=${glowSeat.join(',')}`
    return bandSeat
  })
}

const SEAT_LETTER: Record<Seat, string> = { south: 's', west: 'w', north: 'n', east: 'e' }
const KIND_LETTER: Record<string, string> = {
  pawn: 'P',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
}

/**
 * Builds a position string from `{ e2: 'south pawn', ... }`.
 * `rest` is everything after the board: "<to-move> <statuses> <castling> <ep> <np> <ply> [k=v]".
 */
export function buildPosition(mode: 'ffa' | 'teams', pieces: Record<string, string>, rest: string) {
  const ranks: string[] = []
  for (let r = 11; r >= 0; r--) {
    let line = ''
    let empty = 0
    for (let f = 0; f < 12; f++) {
      const sq = `${'abcdefghijkl'[f]}${r + 1}`
      const p = pieces[sq]
      if (!p) {
        empty++
        continue
      }
      if (empty) line += String(empty)
      empty = 0
      const [owner, kind] = p.split(' ') as [Seat, string]
      line += `${SEAT_LETTER[owner]}${KIND_LETTER[kind]}`
    }
    if (empty) line += String(empty)
    ranks.push(line)
  }
  return `${mode} ${ranks.join('/')} ${rest}`
}

export async function load(page: Page, pos: string) {
  const ok = await sb<boolean>(page, 'loadPosition', pos, false)
  expect(ok, `loadPosition failed: ${pos}`).toBe(true)
  await settle(page)
}

/** The open promotion picker: kinds of its tiles and their page coordinates. */
export async function promoPicker(page: Page) {
  return page.evaluate(() => {
    type N = {
      children: N[]
      getGlobalPosition(): { x: number; y: number }
      texture?: { frame: { x: number; y: number; width: number } }
    }
    const g = globalThis as unknown as {
      __pixiApp: { stage: N; canvas: HTMLCanvasElement }
    }
    const overlay = g.__pixiApp.stage.children[2] as N
    const c = overlay.children[0]
    if (!c) return null
    const r = g.__pixiApp.canvas.getBoundingClientRect()
    const KINDS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
    const VARIANTS = ['south', 'west', 'north', 'east', 'frozen']
    // children: backdrop, panel, tiles...
    return c.children.slice(2).map((t) => {
      const sp = t.children[2] as N
      const fr = (sp.texture as { frame: { x: number; y: number; width: number } }).frame
      const size = fr.width
      const pad = Math.ceil(size * 0.1)
      const cell = size + pad * 2
      const p = t.getGlobalPosition()
      return {
        kind: KINDS[Math.round((fr.x - pad) / cell)],
        variant: VARIANTS[Math.round((fr.y - pad) / cell)],
        x: r.left + p.x,
        y: r.top + p.y,
      }
    })
  })
}
