/**
 * Board camera: zoom and pan for small screens (pure math, unit-tested).
 *
 * The camera says which board point sits at the viewport centre (`x`, `y`, in squares from
 * the board centre, in the board's own south frame, before the perspective rotation) and how
 * far the board is zoomed in (`zoom`, 1 = the whole board fits). Storing the centre in board
 * units keeps the same point in view while the board turns to another perspective and when a
 * resize re-lays the board out at a new square size.
 *
 * Screen positions here are relative to the viewport centre (CSS px), and `angle` is the
 * board's rotation on screen (radians, clockwise, as in PixiJS).
 */

export interface Camera {
  readonly zoom: number
  /** Board point at the viewport centre, in squares from the board centre (south frame). */
  readonly x: number
  readonly y: number
}

export interface CameraViewport {
  /** Viewport size, CSS px. */
  readonly width: number
  readonly height: number
  /** Screen px per square at zoom 1. */
  readonly unit: number
  /** Half the board's extent (field, frame and margin), in squares. */
  readonly half: number
  /** Board rotation on screen, radians. */
  readonly angle: number
}

export interface Vec {
  x: number
  y: number
}

export const IDENTITY_CAMERA: Camera = { zoom: 1, x: 0, y: 0 }

function rot(x: number, y: number, angle: number): Vec {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: x * c - y * s, y: x * s + y * c }
}

/** Screen position (relative to the viewport centre) of a board point given in squares. */
export function boardToScreen(cam: Camera, vp: CameraViewport, bx: number, by: number): Vec {
  const k = vp.unit * cam.zoom
  const r = rot(bx - cam.x, by - cam.y, vp.angle)
  return { x: r.x * k, y: r.y * k }
}

/** Board point (squares) under a screen position (relative to the viewport centre). */
export function screenToBoard(cam: Camera, vp: CameraViewport, sx: number, sy: number): Vec {
  const k = vp.unit * cam.zoom
  const r = rot(sx / k, sy / k, -vp.angle)
  return { x: cam.x + r.x, y: cam.y + r.y }
}

/** How far the centre may move from the board centre along each screen axis, in squares. */
function limits(vp: CameraViewport, zoom: number): Vec {
  const k = vp.unit * zoom
  return {
    x: Math.max(0, vp.half - vp.width / 2 / k),
    y: Math.max(0, vp.half - vp.height / 2 / k),
  }
}

/**
 * Keeps the board covering the viewport: along a screen axis where the zoomed board is
 * larger than the viewport its edge never comes inside it, and where it is smaller it stays
 * centred. Zoom is not clamped here.
 */
export function clampCamera(cam: Camera, vp: CameraViewport): Camera {
  const u = rot(cam.x, cam.y, vp.angle)
  const lim = limits(vp, cam.zoom)
  const cx = Math.min(lim.x, Math.max(-lim.x, u.x))
  const cy = Math.min(lim.y, Math.max(-lim.y, u.y))
  if (cx === u.x && cy === u.y) return cam
  const b = rot(cx, cy, -vp.angle)
  // `+ 0` turns -0 into 0.
  return { zoom: cam.zoom, x: b.x + 0, y: b.y + 0 }
}

/**
 * The camera at `zoom` that keeps the board point `anchor` (squares) under the screen
 * position `screen` (relative to the viewport centre). Pinch and wheel zoom use it: the
 * point between the fingers stays between the fingers. Not clamped.
 */
export function anchorCamera(zoom: number, anchor: Vec, screen: Vec, vp: CameraViewport): Camera {
  const k = vp.unit * zoom
  const r = rot(screen.x / k, screen.y / k, -vp.angle)
  return { zoom, x: anchor.x - r.x, y: anchor.y - r.y }
}

/** Zooms to `zoom` around the screen position `screen` (it stays put), clamped. */
export function zoomAround(cam: Camera, vp: CameraViewport, zoom: number, screen: Vec): Camera {
  const anchor = screenToBoard(cam, vp, screen.x, screen.y)
  return clampCamera(anchorCamera(zoom, anchor, screen, vp), vp)
}

/** Moves the view by a screen delta (the board follows the finger), clamped. */
export function panBy(cam: Camera, vp: CameraViewport, dx: number, dy: number): Camera {
  const k = vp.unit * cam.zoom
  const r = rot(dx / k, dy / k, -vp.angle)
  return clampCamera({ zoom: cam.zoom, x: cam.x - r.x, y: cam.y - r.y }, vp)
}

/**
 * The smallest pan that brings `points` (board squares, e.g. a selected piece and its legal
 * targets) into view with `pad` squares to spare. When they can't all fit, the view centres
 * on them as far as it can while keeping `points[focus]` (the selected piece) in view.
 * Zoom is unchanged; the result is clamped.
 */
export function revealPoints(
  cam: Camera,
  vp: CameraViewport,
  points: readonly Vec[],
  pad: number,
  focus = 0,
): Camera {
  if (points.length === 0) return cam
  const k = vp.unit * cam.zoom
  const hv = { x: vp.width / 2 / k, y: vp.height / 2 / k }
  const u = rot(cam.x, cam.y, vp.angle)
  const ps = points.map((p) => rot(p.x, p.y, vp.angle))
  const f = ps[Math.min(ps.length - 1, Math.max(0, focus))] as Vec
  const axis = (c: number, lo: number, hi: number, half: number, fc: number): number => {
    const pd = Math.min(pad, Math.max(0, half - 0.5))
    if (hi - lo <= 2 * (half - pd)) {
      if (lo - pd < c - half) return lo - pd + half
      if (hi + pd > c + half) return hi + pd - half
      return c
    }
    // Too spread out: centre on them, but never lose the focus point.
    const mid = (lo + hi) / 2
    return Math.min(fc + half - pd, Math.max(fc - half + pd, mid))
  }
  const xs = ps.map((p) => p.x)
  const ys = ps.map((p) => p.y)
  const nx = axis(u.x, Math.min(...xs), Math.max(...xs), hv.x, f.x)
  const ny = axis(u.y, Math.min(...ys), Math.max(...ys), hv.y, f.y)
  if (nx === u.x && ny === u.y) return cam
  const b = rot(nx, ny, -vp.angle)
  return clampCamera({ zoom: cam.zoom, x: b.x, y: b.y }, vp)
}

/**
 * Zoom limits for a board whose squares are `unit` px at zoom 1: zooming in stops once a
 * square is about 76 px (at least 2x, at most 4x), and the one-tap zoom (the zoom button,
 * a double tap) aims for squares of about 44 px, a comfortable fingertip target.
 */
export function zoomLimits(unit: number): { max: number; step: number } {
  const u = Math.max(1, unit)
  const max = Math.min(4, Math.max(2, 76 / u))
  const step = Math.min(max, Math.max(1.5, 44 / u))
  return { max, step }
}

/**
 * Past the zoom limits a pinch meets growing resistance (a rubber band), so the board never
 * stops dead under the fingers; the camera springs back to the limit when the fingers lift.
 */
export function rubberZoom(raw: number, min: number, max: number): number {
  if (raw < min) return min * (1 - 0.35 * (1 - Math.exp(-(min - raw) / min / 0.35)))
  if (raw > max) return max * (1 + 0.25 * (1 - Math.exp(-(raw - max) / max / 0.25)))
  return raw
}

/** Two cameras are the same view (within a hundredth of a square and a thousandth of zoom). */
export function sameCamera(a: Camera, b: Camera): boolean {
  return (
    Math.abs(a.zoom - b.zoom) < 1e-3 && Math.abs(a.x - b.x) < 1e-2 && Math.abs(a.y - b.y) < 1e-2
  )
}

/** A pointer position during a pan (screen CSS px) and when it was seen (ms). */
export interface PanSample {
  readonly x: number
  readonly y: number
  readonly t: number
}

/**
 * Momentum after a one-finger pan (a fling): the board glides on at the finger's release
 * speed and slows down exponentially (time constant `tau`), like a scrolled list on a phone.
 */
export const FLING = {
  /** Slower releases (px/ms) just stop. */
  minSpeed: 0.25,
  /** Release speeds are capped here (px/ms). */
  maxSpeed: 4,
  /** Deceleration time constant, ms. */
  tau: 325,
  /** The glide ends below this speed (px/ms). */
  stopSpeed: 0.02,
  /** Samples older than this before the release don't count (ms). */
  windowMs: 100,
  /** A finger that rested this long before lifting means no fling (ms). */
  restMs: 60,
} as const

/**
 * The finger's speed at release (px/ms, screen axes) from its recent samples, oldest first:
 * the movement over the last `FLING.windowMs`. Zero when the finger rested before lifting.
 */
export function releaseVelocity(samples: readonly PanSample[], now: number): Vec {
  const last = samples[samples.length - 1]
  if (!last || now - last.t > FLING.restMs) return { x: 0, y: 0 }
  let first = last
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i] as PanSample
    if (last.t - s.t > FLING.windowMs) break
    first = s
  }
  // Slow frames: the sample before the last one counts if it is reasonably recent.
  const before = samples[samples.length - 2]
  if (first === last && before && last.t - before.t <= 2 * FLING.windowMs) first = before
  const dt = last.t - first.t
  if (dt <= 0) return { x: 0, y: 0 }
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt }
}

/**
 * The glide for a release velocity (px/ms): how long it lasts (ms) and its velocity after
 * the speed cap, or null when the release was too slow to fling.
 */
export function flingPlan(v: Vec): { duration: number; velocity: Vec } | null {
  const speed = Math.hypot(v.x, v.y)
  if (!(speed >= FLING.minSpeed)) return null
  const k = Math.min(1, FLING.maxSpeed / speed)
  const capped = speed * k
  return {
    duration: FLING.tau * Math.log(capped / FLING.stopSpeed),
    velocity: { x: v.x * k, y: v.y * k },
  }
}

/** How far the glide has carried the board after `t` ms (screen px). */
export function flingOffset(v: Vec, t: number): Vec {
  const f = FLING.tau * (1 - Math.exp(-Math.max(0, t) / FLING.tau))
  return { x: v.x * f, y: v.y * f }
}

/**
 * The zoom button's disc on a board at zoom 1: its size and how far it slides outward (right)
 * past the board's corner. The disc sits in the bottom-right corner of the board's footprint,
 * whose frame and margin are `gap` CSS px wide, and keeps 1.5 px clear of the corner square
 * (the field's corner, `gap` in from both edges): on small boards it shrinks to `min`, then
 * slides out by up to `maxShift` into the page gutter.
 */
export function zoomDiscFit(
  gap: number,
  max: number,
  min = 24,
  maxShift = 8,
): { disc: number; shift: number } {
  for (let disc = max; disc >= min; disc -= 2) {
    const r = disc / 2
    const inset = gap - r // field corner to disc centre along each axis, before sliding
    const need = r + 1.5
    if (inset >= need / Math.SQRT2) return { disc, shift: 0 }
    if (inset < 0) continue
    const shift = Math.ceil(Math.sqrt(need * need - inset * inset) - inset)
    if (shift <= maxShift) return { disc, shift }
  }
  return { disc: min, shift: maxShift }
}
