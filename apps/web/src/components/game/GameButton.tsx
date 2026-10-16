import type { ButtonHTMLAttributes } from 'react'

type Variant = 'secondary' | 'ghost' | 'primary'

const VARIANTS: Record<Variant, string> = {
  secondary:
    'border border-parchment/20 bg-ink/30 text-parchment enabled:hover:border-parchment/45 enabled:hover:bg-parchment/[0.06]',
  ghost: 'text-parchment/80 enabled:hover:bg-parchment/[0.06] enabled:hover:text-parchment',
  primary: 'bg-gold text-ink enabled:hover:bg-gold-bright',
}

/**
 * A compact (40px) button for the game screen's action rows. Kept local to the game screens
 * so their dense layout doesn't depend on the shared button's sizing.
 */
export function GameButton({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color] duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}
