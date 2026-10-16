import { PODIUM } from '../match/labels.ts'
import { CrownIcon } from './icons.tsx'

/**
 * A placement disc: gold with a crown for 1st, silver and bronze for 2nd and 3rd, muted
 * after that, and a dashed "—" when there is no placement (a cancelled game).
 */
export function Medal({
  place,
  size = 'md',
  label,
}: {
  place: number | null
  size?: 'sm' | 'md' | 'lg'
  /** Visible text under the screen-reader label (defaults to the place number). */
  label?: string | undefined
}) {
  const dims = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-11 w-11 text-base' }[size]
  const icon = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-5 w-5' }[size]
  if (!place) {
    return (
      <span
        className={`${dims} inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-parchment/25 font-semibold text-parchment/40`}
      >
        —
      </span>
    )
  }
  const color = PODIUM[place - 1]
  if (!color) {
    return (
      <span
        className={`${dims} inline-flex shrink-0 items-center justify-center rounded-full border border-parchment/15 bg-parchment/[0.04] font-semibold tabular-nums text-parchment/55`}
      >
        {label ?? place}
      </span>
    )
  }
  return (
    <span
      className={`${dims} relative inline-flex shrink-0 flex-col items-center justify-center rounded-full border font-bold tabular-nums`}
      style={{
        borderColor: `${color}b3`,
        color,
        background: `radial-gradient(circle at 35% 30%, ${color}40, ${color}14 70%)`,
      }}
    >
      {place === 1 ? <CrownIcon className={icon} /> : (label ?? place)}
      {place === 1 ? <span className="sr-only">{label ?? place}</span> : null}
    </span>
  )
}
