import { Eye } from 'lucide-react'

/**
 * "3 watching": the spectator count of a room, shown to players and spectators alike.
 * `className` sets the display too (default `inline-flex`; e.g. `hidden wide:inline-flex`).
 */
export function SpectatorCount({
  count,
  className = 'inline-flex',
}: {
  count: number
  className?: string
}) {
  if (count <= 0) return null
  return (
    <span
      className={`items-center gap-1 text-xs text-parchment/65 tabular-nums ${className}`}
      data-testid="spectator-count"
    >
      <Eye aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {count} watching
    </span>
  )
}
