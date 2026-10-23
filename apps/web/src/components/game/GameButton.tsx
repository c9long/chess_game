import type { ComponentProps } from 'react'
import { cx } from '../ui.tsx'

type Variant = 'secondary' | 'ghost' | 'primary' | 'danger'

const VARIANTS: Record<Variant, string> = {
  secondary:
    'border border-rule-brass bg-parchment/[0.03] text-parchment shadow-rim enabled:hover:border-brass/60 enabled:hover:bg-parchment/[0.07]',
  ghost: 'text-muted enabled:hover:bg-parchment/[0.06] enabled:hover:text-parchment',
  primary: 'bg-gold text-ink shadow-gold enabled:hover:bg-gold-bright',
  danger:
    'border border-rule-brass bg-parchment/[0.03] text-parchment shadow-rim enabled:hover:border-destructive-light/70 enabled:hover:bg-destructive/30 enabled:hover:text-destructive-light',
}

/**
 * A compact (40px) button for the game screen's action rows. Kept local to the game screens
 * so their dense layout doesn't depend on the shared button's sizing; the variants follow the
 * shared ones (`secondary` brass outline, `ghost` quiet, `primary` gold, `danger` an outline
 * that turns brick on hover, for Resign).
 */
export function GameButton({
  variant = 'secondary',
  className = '',
  ...rest
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-control px-3 text-ui font-semibold whitespace-nowrap transition-[color,background-color,border-color] duration-150 select-none enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  )
}
