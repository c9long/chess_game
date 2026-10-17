import { describe, expect, it } from 'vitest'
import {
  anchorCamera,
  boardToScreen,
  type Camera,
  type CameraViewport,
  clampCamera,
  IDENTITY_CAMERA,
  panBy,
  revealPoints,
  rubberZoom,
  sameCamera,
  screenToBoard,
  zoomAround,
  zoomLimits,
} from './camera.ts'

// A phone: 390 px wide, 20 px squares, the 16x16 board with frame and margin (9.3 squares).
const phone: CameraViewport = { width: 390, height: 390, unit: 20, half: 9.3, angle: 0 }

function close(a: number, b: number, eps = 1e-6) {
  expect(Math.abs(a - b)).toBeLessThan(eps)
}

describe('camera', () => {
  it('maps board points to the screen and back at any zoom and rotation', () => {
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.3]) {
      const vp = { ...phone, angle }
      const cam: Camera = { zoom: 2.3, x: 1.5, y: -2.25 }
      const s = boardToScreen(cam, vp, 4, 3)
      const b = screenToBoard(cam, vp, s.x, s.y)
      close(b.x, 4)
      close(b.y, 3)
    }
  })

  it('shows the camera point at the viewport centre', () => {
    const cam: Camera = { zoom: 2, x: 3, y: -1 }
    const s = boardToScreen(cam, { ...phone, angle: Math.PI / 2 }, 3, -1)
    close(s.x, 0)
    close(s.y, 0)
  })

  it('keeps the whole board centred at zoom 1', () => {
    expect(clampCamera({ zoom: 1, x: 4, y: -3 }, phone)).toEqual({ zoom: 1, x: 0, y: 0 })
  })

  it('never lets the zoomed board edge come inside the viewport', () => {
    const cam = clampCamera({ zoom: 2, x: 100, y: -100 }, phone)
    // Visible half-width at 2x: 390 / 2 / 40 = 4.64 squares, so the centre stops at 9.3 - 4.64.
    const lim = 9.3 - 390 / 2 / 40
    close(cam.x, lim)
    close(cam.y, -lim)
    const edge = boardToScreen(cam, phone, 9.3, -9.3)
    close(edge.x, 195)
    close(edge.y, -195)
  })

  it('clamps along screen axes when the board is turned', () => {
    // A wide viewport: the board can pan sideways only once it is wider than the screen.
    const wide: CameraViewport = {
      width: 800,
      height: 390,
      unit: 21,
      half: 9.3,
      angle: Math.PI / 2,
    }
    const cam = clampCamera({ zoom: 1.5, x: 5, y: 5 }, wide)
    const u = boardToScreen(cam, wide, 0, 0)
    // Board half-width on screen = 9.3 * 31.5 = 293 < 400: stays centred horizontally.
    close(u.x, 0)
    // Vertically it may move until its edge reaches the viewport edge.
    expect(Math.abs(u.y)).toBeLessThanOrEqual(9.3 * 31.5 - 195 + 1e-6)
  })

  it('zooms around a screen point, which stays put', () => {
    const p = { x: 120, y: -60 }
    const before = screenToBoard(IDENTITY_CAMERA, phone, p.x, p.y)
    const cam = zoomAround(IDENTITY_CAMERA, phone, 2.5, p)
    const after = boardToScreen(cam, phone, before.x, before.y)
    close(after.x, p.x)
    close(after.y, p.y)
    expect(cam.zoom).toBe(2.5)
  })

  it('anchors a pinch: the board point between the fingers follows them', () => {
    const vp = { ...phone, angle: Math.PI }
    const start = { zoom: 2, x: 1, y: 1 }
    const mid0 = { x: 10, y: 20 }
    const anchor = screenToBoard(start, vp, mid0.x, mid0.y)
    const mid1 = { x: -30, y: 50 }
    const cam = anchorCamera(3, anchor, mid1, vp)
    const s = boardToScreen(cam, vp, anchor.x, anchor.y)
    close(s.x, mid1.x)
    close(s.y, mid1.y)
  })

  it('pans with the finger and stops at the edge', () => {
    const cam = panBy({ zoom: 2, x: 0, y: 0 }, phone, -40, 0)
    // Dragging left by one zoomed square shows one square further right.
    close(cam.x, 1)
    const far = panBy(cam, phone, -10_000, 10_000)
    close(far.x, 9.3 - 390 / 2 / 40)
    close(far.y, -(9.3 - 390 / 2 / 40))
    // At zoom 1 there is nothing to pan.
    expect(panBy(IDENTITY_CAMERA, phone, 50, 50)).toEqual(IDENTITY_CAMERA)
  })

  it('reveals a selected piece and its targets with the smallest pan', () => {
    const cam: Camera = { zoom: 2, x: -4, y: 0 }
    // Visible: x in [-8.64, 0.64]. Targets up to x = 2.5 need a pan of 1.86 + pad.
    const out = revealPoints(
      cam,
      phone,
      [
        { x: 0, y: 0 },
        { x: 2.5, y: 1 },
      ],
      0.5,
    )
    close(out.x, 2.5 + 0.5 - 390 / 2 / 40)
    close(out.y, 0)
    // Already in view: no change.
    expect(revealPoints(out, phone, [{ x: 0, y: 0 }], 0.5)).toBe(out)
  })

  it('keeps the selected piece in view when its targets cannot all fit', () => {
    const cam: Camera = { zoom: 3, x: -5, y: 0 }
    const pts = [
      { x: -6, y: 0 },
      { x: 7, y: 0 },
    ]
    const out = revealPoints(cam, phone, pts, 0.5, 0)
    const half = 390 / 2 / 60
    expect(-6).toBeGreaterThanOrEqual(out.x - half)
    expect(-6).toBeLessThanOrEqual(out.x + half)
  })

  it('sets zoom limits from the square size', () => {
    expect(zoomLimits(21).max).toBeCloseTo(76 / 21)
    expect(zoomLimits(21).step).toBeCloseTo(44 / 21)
    expect(zoomLimits(21).step * 21).toBeGreaterThanOrEqual(32)
    // Big squares (desktop): at least 2x, the one-tap zoom 1.5x.
    expect(zoomLimits(60)).toEqual({ max: 2, step: 1.5 })
    // Tiny squares: at most 4x.
    expect(zoomLimits(8).max).toBe(4)
  })

  it('rubber-bands a pinch past the limits', () => {
    expect(rubberZoom(2, 1, 3)).toBe(2)
    expect(rubberZoom(0.5, 1, 3)).toBeLessThan(1)
    expect(rubberZoom(0.5, 1, 3)).toBeGreaterThan(0.65)
    expect(rubberZoom(10, 1, 3)).toBeGreaterThan(3)
    expect(rubberZoom(10, 1, 3)).toBeLessThan(3.75)
    // Monotonic.
    expect(rubberZoom(0.6, 1, 3)).toBeGreaterThan(rubberZoom(0.5, 1, 3))
  })

  it('compares cameras with a tolerance', () => {
    expect(sameCamera({ zoom: 2, x: 1, y: 1 }, { zoom: 2.0001, x: 1.001, y: 1 })).toBe(true)
    expect(sameCamera({ zoom: 2, x: 1, y: 1 }, { zoom: 2, x: 1.5, y: 1 })).toBe(false)
  })
})
