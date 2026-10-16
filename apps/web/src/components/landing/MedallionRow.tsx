import { CIVILIZATIONS } from '@game/config'
import type { ReactNode } from 'react'

/**
 * The nine civilizations as uniform brass-on-enamel medallions (never per-country colours).
 * Entry-safe: the emblem art comes from `renderGlyph`, which the lazily loaded CivMedallions
 * supplies; until then the medallions show empty, at the same size, so nothing shifts.
 */
export function MedallionRow({ renderGlyph }: { renderGlyph?: (slug: string) => ReactNode }) {
  return (
    <ul
      className="mx-auto grid max-w-md grid-cols-3 gap-x-4 gap-y-7 lg:max-w-none lg:grid-cols-9 lg:gap-x-3"
      data-testid="civ-medallions"
    >
      {CIVILIZATIONS.map((c) => (
        <li key={c.slug} className="group flex flex-col items-center gap-3 text-center">
          <span className="medallion relative grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full lg:h-20 lg:w-20">
            {renderGlyph ? renderGlyph(c.slug) : null}
          </span>
          <span className="text-[0.7rem] leading-tight font-semibold tracking-[0.14em] text-parchment/65 uppercase transition-colors duration-200 group-hover:text-parchment">
            {c.name}
          </span>
        </li>
      ))}
    </ul>
  )
}
