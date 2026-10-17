import { type CDPSession, expect, type Page, test } from '@playwright/test'
import { engineBoard, openSandbox, settle, squarePoint } from './attack-interaction-helpers.ts'

/**
 * Phone zoom: the zoom button, pinch (real touch events through CDP), double tap, one-finger
 * pan, hit testing at every zoom, drag-to-move never fighting the gestures, auto-pan to a
 * selection. A 390 x 844 phone at 2x, where the 16 x 16 board gets ~21 px squares.
 */

const SHOTS = process.env.BOARD_SHOTS_DIR

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})

type Pt = { x: number; y: number }

async function touch(cdp: CDPSession, type: string, points: Pt[]) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 })),
  })
}

/** Two fingers from `a0`,`b0` to `a1`,`b1` in `steps` moves, then lifted. */
async function pinch(page: Page, a0: Pt, b0: Pt, a1: Pt, b1: Pt, steps = 10) {
  const cdp = await page.context().newCDPSession(page)
  await touch(cdp, 'touchStart', [a0])
  await touch(cdp, 'touchStart', [a0, b0])
  for (let i = 1; i <= steps; i++) {
    const k = i / steps
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k })
    await touch(cdp, 'touchMove', [lerp(a0, a1), lerp(b0, b1)])
  }
  await touch(cdp, 'touchEnd', [])
  await cdp.detach()
}

/** One finger from `a` to `b` (a drag), or a tap when they are equal. */
async function swipe(page: Page, a: Pt, b: Pt, steps = 8) {
  const cdp = await page.context().newCDPSession(page)
  await touch(cdp, 'touchStart', [a])
  for (let i = 1; i <= steps; i++) {
    const k = i / steps
    await touch(cdp, 'touchMove', [{ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }])
  }
  await touch(cdp, 'touchEnd', [])
  await cdp.detach()
}

async function zoom(page: Page): Promise<number> {
  return page.evaluate(
    () => (globalThis as unknown as { __sandbox: { view: { zoom: number } } }).__sandbox.view.zoom,
  )
}

/** On-screen size of one square (CSS px). */
async function squarePx(page: Page): Promise<number> {
  const a = await squarePoint(page, 'e4')
  const b = await squarePoint(page, 'f4')
  return Math.hypot(a.x - b.x, a.y - b.y)
}

async function canvasRect(page: Page) {
  return page.evaluate(() => {
    const r = (
      globalThis as unknown as { __sandbox: { view: { canvas: HTMLCanvasElement } } }
    ).__sandbox.view.canvas.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
}

/** The square whose centre is nearest to a page point. */
async function squareAt(page: Page, p: Pt): Promise<string> {
  return page.evaluate((pt) => {
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
    const r = v.canvas.getBoundingClientRect()
    let best = ''
    let bd = Number.POSITIVE_INFINITY
    for (let rank = 1; rank <= 16; rank++) {
      for (const f of 'abcdefghijklmnop') {
        const q = v.squareToClient(`${f}${rank}`) as { x: number; y: number }
        const d = Math.hypot(r.left + q.x - pt.x, r.top + q.y - pt.y)
        if (d < bd) {
          bd = d
          best = `${f}${rank}`
        }
      }
    }
    return best
  }, p)
}

/**
 * Two quick taps at one point. Real touch input through CDP takes a frame per event here
 * (software rendering), too slow for a double tap, so these are synthetic touch pointer
 * events dispatched in one go (PixiJS reads pointerdown on the canvas, pointerup on window).
 */
async function doubleTap(page: Page, p: Pt) {
  await page.evaluate((pt) => {
    const cv = (globalThis as unknown as { __sandbox: { view: { canvas: HTMLCanvasElement } } })
      .__sandbox.view.canvas
    const init = (id: number, buttons: number): PointerEventInit => ({
      pointerId: id,
      pointerType: 'touch',
      isPrimary: true,
      clientX: pt.x,
      clientY: pt.y,
      button: 0,
      buttons,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    for (const id of [901, 902]) {
      cv.dispatchEvent(new PointerEvent('pointerdown', init(id, 1)))
      cv.dispatchEvent(new PointerEvent('pointerup', init(id, 0)))
    }
  }, p)
}

async function tapSquare(page: Page, sq: string) {
  const p = await squarePoint(page, sq)
  await page.touchscreen.tap(p.x, p.y)
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

test.beforeEach(async ({ page }) => {
  await openSandbox(page)
})

test('the zoom button zooms to fingertip-sized squares and back', async ({ page }) => {
  const sq1 = await squarePx(page)
  expect(sq1).toBeLessThan(24)
  const button = page.locator('[data-board-zoom]')
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('aria-label', 'Zoom in on the board')
  await shot(page, 'phone-390-zoom1')
  await button.tap()
  await settle(page)
  expect(await zoom(page)).toBeGreaterThan(1.9)
  const sq2 = await squarePx(page)
  // Effective tap targets of at least ~32 px (aims for 44).
  expect(sq2).toBeGreaterThanOrEqual(40)
  await expect(button).toHaveAttribute('data-board-zoom', 'out')
  await expect(button).toHaveAttribute('aria-label', 'Zoom out to the whole board')
  // Coordinates stay readable: the edge labels show the visible ranks.
  const labels = await page.evaluate(() => {
    type N = { label?: string; visible: boolean; children: (N & { text: string })[] }
    const app = (globalThis as unknown as { __pixiApp: { stage: { children: N[] } } }).__pixiApp
    const layer = app.stage.children.find((c) => c.label === 'edgeLabels') as N
    return {
      visible: layer.visible,
      texts: layer.children.filter((c) => c.visible).map((c) => c.text),
    }
  })
  expect(labels.visible).toBe(true)
  expect(labels.texts).toContain('1')
  await shot(page, 'phone-390-zoomed')
  await button.tap()
  await settle(page)
  expect(await zoom(page)).toBe(1)
  expect(Math.abs((await squarePx(page)) - sq1)).toBeLessThan(0.5)
})

test('pinch zooms around the fingers, and springs back below 1x', async ({ page }) => {
  const r = await canvasRect(page)
  const mid = { x: r.left + r.width * 0.3, y: r.top + r.height * 0.35 }
  const before = await squareAt(page, mid)
  await pinch(
    page,
    { x: mid.x - 20, y: mid.y },
    { x: mid.x + 20, y: mid.y },
    { x: mid.x - 60, y: mid.y },
    { x: mid.x + 60, y: mid.y },
  )
  await settle(page)
  const z = await zoom(page)
  expect(z).toBeGreaterThan(2.5)
  // The board point between the fingers stayed between them.
  expect(await squareAt(page, mid)).toBe(before)
  // Pinching in past 1x springs back to the whole board, centred.
  const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  await pinch(
    page,
    { x: c.x - 150, y: c.y },
    { x: c.x + 150, y: c.y },
    { x: c.x - 10, y: c.y },
    { x: c.x + 10, y: c.y },
  )
  await settle(page)
  expect(await zoom(page)).toBe(1)
})

test('taps and drags hit the right squares at every zoom and pan', async ({ page }) => {
  const button = page.locator('[data-board-zoom]')
  await button.tap()
  await settle(page)
  // South: tap-tap at the step zoom.
  await tapSquare(page, 'h2')
  await tapSquare(page, 'h4')
  await settle(page)
  expect((await engineBoard(page)).pieces.h4).toBe('south pawn')
  // Zoom further with a pinch, then pan with one finger on empty squares.
  const r = await canvasRect(page)
  const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  await pinch(
    page,
    { x: c.x - 30, y: c.y },
    { x: c.x + 30, y: c.y },
    { x: c.x - 50, y: c.y },
    { x: c.x + 50, y: c.y },
  )
  await settle(page)
  expect(await zoom(page)).toBeGreaterThan(2.5)
  // Pan with one finger from the middle of the view (empty squares there).
  const panFrom = c
  expect((await engineBoard(page)).pieces[await squareAt(page, c)]).toBeUndefined()
  const z0 = await zoom(page)
  const e7Before = await squarePoint(page, 'e7')
  await swipe(page, panFrom, { x: panFrom.x + 40, y: panFrom.y + 60 })
  await settle(page)
  const e7After = await squarePoint(page, 'e7')
  // The board followed the finger (clamped at the edges, so at least partly).
  expect(Math.hypot(e7After.x - e7Before.x, e7After.y - e7Before.y)).toBeGreaterThan(10)
  expect(await zoom(page)).toBeCloseTo(z0, 5)
  // Every seat moves at this zoom: West, North and East, each by tap-tap.
  for (const [from, to, seat] of [
    ['b8', 'd8', 'west'],
    ['h15', 'h13', 'north'],
    ['o8', 'm8', 'east'],
  ] as const) {
    await page.evaluate((s) => {
      const sb = (
        globalThis as unknown as { __sandbox: { view: { setZoom(z: number, o: unknown): void } } }
      ).__sandbox
      sb.view.setZoom(3, { focus: s, animate: false })
    }, from)
    await settle(page)
    await tapSquare(page, from)
    await tapSquare(page, to)
    await settle(page)
    expect((await engineBoard(page)).pieces[to], `${seat} ${from}-${to}`).toBe(`${seat} pawn`)
  }
})

test('one finger on a piece drags it even when zoomed; a second finger cancels the drag', async ({
  page,
}) => {
  await page.evaluate(() =>
    (
      globalThis as unknown as { __sandbox: { view: { setZoom(z: number, o: unknown): void } } }
    ).__sandbox.view.setZoom(2.5, { focus: 'g2', animate: false }),
  )
  await settle(page)
  const z0 = await zoom(page)
  const a = await squarePoint(page, 'g2')
  const b = await squarePoint(page, 'g4')
  await swipe(page, a, b, 10)
  await settle(page)
  expect((await engineBoard(page)).pieces.g4).toBe('south pawn')
  expect(await zoom(page)).toBeCloseTo(z0, 5)

  // West to move: start dragging b6, then a second finger lands: no move, and a pinch.
  await page.evaluate(() =>
    (
      globalThis as unknown as { __sandbox: { view: { setZoom(z: number, o: unknown): void } } }
    ).__sandbox.view.setZoom(2.5, { focus: 'b6', animate: false }),
  )
  await settle(page)
  const p = await squarePoint(page, 'b6')
  const cdp = await page.context().newCDPSession(page)
  await touch(cdp, 'touchStart', [p])
  for (let i = 1; i <= 4; i++) await touch(cdp, 'touchMove', [{ x: p.x + i * 6, y: p.y }])
  const q = { x: p.x + 24, y: p.y + 120 }
  await touch(cdp, 'touchStart', [{ x: p.x + 24, y: p.y }, q])
  for (let i = 1; i <= 6; i++) {
    await touch(cdp, 'touchMove', [
      { x: p.x + 24, y: p.y - i * 8 },
      { x: q.x, y: q.y + i * 8 },
    ])
  }
  await touch(cdp, 'touchEnd', [])
  await cdp.detach()
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.seatToMove).toBe('west')
  expect(eng.pieces.b6).toBe('west pawn')
  expect(await zoom(page)).toBeGreaterThan(2.5)
})

test('double tap on an empty square zooms in there, and out again', async ({ page }) => {
  const p = await squarePoint(page, 'g7')
  await doubleTap(page, p)
  await settle(page)
  expect(await zoom(page)).toBeGreaterThan(1.9)
  // The tapped point stayed under the finger.
  expect(await squareAt(page, p)).toBe('g7')
  // Two slow taps are not a double tap.
  await page.touchscreen.tap(p.x, p.y)
  await page.waitForTimeout(500)
  await page.touchscreen.tap(p.x, p.y)
  await settle(page)
  expect(await zoom(page)).toBeGreaterThan(1.9)
  await doubleTap(page, p)
  await settle(page)
  expect(await zoom(page)).toBe(1)
})

test('selecting a piece pans to show its moves; zoomed hit areas are big', async ({ page }) => {
  await page.evaluate(() => {
    const v = (
      globalThis as unknown as {
        __sandbox: { view: { zoomRange: { max: number }; setZoom(z: number, o: unknown): void } }
      }
    ).__sandbox.view
    v.setZoom(v.zoomRange.max, { focus: 'e1', animate: false })
  })
  await settle(page)
  const sq = await squarePx(page)
  expect(sq).toBeGreaterThan(60)
  // Tap a little off the pawn's centre (still on it), then check e4 is in view.
  const e2 = await squarePoint(page, 'e2')
  await page.touchscreen.tap(e2.x + sq * 0.3, e2.y - sq * 0.3)
  await settle(page)
  const r = await canvasRect(page)
  const e4 = await squarePoint(page, 'e4')
  const e2After = await squarePoint(page, 'e2')
  expect(e4.y - r.top).toBeGreaterThan(sq * 0.5)
  expect(e2After.y).toBeLessThan(r.top + r.height)
  await shot(page, 'phone-390-zoomed-selected')
  await tapSquare(page, 'e4')
  await settle(page)
  expect((await engineBoard(page)).pieces.e4).toBe('south pawn')
})

test('reduced motion: zoom changes at once', async ({ page }) => {
  await page.evaluate(() =>
    (globalThis as unknown as { __sandbox: { setOptions(o: unknown): void } }).__sandbox.setOptions(
      { reducedMotion: true },
    ),
  )
  await page.locator('[data-board-zoom]').tap()
  // No animation frames needed: the zoom is applied synchronously.
  expect(await zoom(page)).toBeGreaterThan(1.9)
})
