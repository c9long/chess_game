import { cx } from '../ui.tsx'

/** "Ranked" tag: a ranked lobby or game (Elo-rated, registered accounts only, no bots). */
export function RankedBadge({
  size = 'sm',
  className = '',
}: {
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-full border border-brass/50 bg-black/15 font-medium whitespace-nowrap text-brass',
        size === 'md' ? 'h-7 gap-1.5 px-3 text-ui' : 'h-6 gap-1 px-2.5 text-caption',
        className,
      )}
      title="Ranked: Elo-rated, registered accounts only, no bots"
      data-testid="ranked-badge"
    >
      <svg
        viewBox="0 0 16 16"
        className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'}
        aria-hidden="true"
      >
        <path
          d="M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
          fill="currentColor"
        />
      </svg>
      Ranked
    </span>
  )
}

/** Elo change, signed and coloured (+12 green, -8 red, 0 muted). */
export function EloDelta({ delta, className = '' }: { delta: number; className?: string }) {
  const tone = delta > 0 ? 'text-ok' : delta < 0 ? 'text-destructive-light' : 'text-faint'
  return (
    <span className={cx('tabular-nums', tone, className)}>
      {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0'}
    </span>
  )
}
