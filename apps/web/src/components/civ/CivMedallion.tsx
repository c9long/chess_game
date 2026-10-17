import { Shield } from 'lucide-react'
import { CivEmblem, hasCivEmblem } from '../CivEmblem.tsx'
import { cx } from '../ui.tsx'

/** Medallion sizes: 56px on full civ cards, 44/40/36px in rows, triggers and compact cards. */
const SIZE = {
  xl: 'h-14 w-14',
  lg: 'h-11 w-11',
  base: 'h-10 w-10',
  md: 'h-9 w-9',
} as const

export type MedallionSize = keyof typeof SIZE

/**
 * A civ's medallion (decorative): emblem art on brass-rimmed enamel, a monogram for a civ
 * without art yet, or an empty shield when no civ is chosen.
 */
export function CivMedallion({
  civ,
  size,
  className,
}: {
  civ: { readonly slug: string; readonly name: string } | undefined
  size: MedallionSize
  className?: string | undefined
}) {
  return (
    <span
      className={cx(
        'medallion grid shrink-0 place-items-center rounded-full',
        size !== 'xl' && 'medallion-sm',
        SIZE[size],
        className,
      )}
      aria-hidden="true"
    >
      {!civ ? (
        <Shield className="h-[42%] w-[42%] text-parchment/25" strokeWidth={1.75} />
      ) : hasCivEmblem(civ.slug) ? (
        <CivEmblem civ={civ.slug} title="" className="medallion-glyph h-[58%] w-[58%] text-brass" />
      ) : (
        <span
          className={cx(
            'medallion-glyph font-display font-semibold text-brass',
            size === 'xl' ? 'text-xl' : 'text-sm',
          )}
        >
          {civ.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  )
}
