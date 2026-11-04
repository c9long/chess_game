import { type MarkerShape, SEAT_STYLES } from '@game/board'
import type { Seat } from '@game/rules'

/** The four marker outlines in a 20×20 box, matching the board's (`markerPath` in textures.ts). */
const PATHS: Record<MarkerShape, (k: number) => string> = {
  circle: (k) => {
    const r = 7.2 * k
    return `M${10 - r} 10a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`
  },
  square: (k) => {
    const h = 6.24 * k
    return `M${10 - h} ${10 - h}h${2 * h}v${2 * h}h${-2 * h}z`
  },
  triangle: (k) =>
    `M10 ${10 - 8 * k}L${10 + 8 * k} ${10 + 6.24 * k}L${10 - 8 * k} ${10 + 6.24 * k}z`,
  diamond: (k) => `M10 ${10 - 8.4 * k}L${10 + 6.8 * k} 10L10 ${10 + 8.4 * k}L${10 - 6.8 * k} 10z`,
}

/**
 * A seat's colour-blind marker (circle, square, triangle, diamond), drawn like the badge on its
 * pieces: the shape in the seat colour with a dark edge and a white inner rim. Decorative:
 * nearby text names the seat.
 */
export function SeatMarker({ seat, className }: { seat: Seat; className?: string }) {
  const style = SEAT_STYLES[seat]
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" data-marker={style.marker}>
      <path
        d={PATHS[style.marker](1)}
        fill={style.base}
        stroke="#120d0a"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        d={PATHS[style.marker](0.8)}
        fill="none"
        stroke="rgb(255 255 255 / 0.95)"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
    </svg>
  )
}
