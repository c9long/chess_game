import { CIVILIZATIONS, civInfo } from '@game/config'
import type { ReactNode } from 'react'

/**
 * The nine civilizations for the landing page: a brass-on-enamel medallion (never
 * per-country colours), the name and the emblem's one-line identity, plus any ability
 * (England's Magna Carta). Entry-safe: the emblem art comes from `renderGlyph`, which the lazily
 * loaded CivMedallions supplies; until then the medallions are empty at the same size, so nothing
 * shifts.
 */
export function MedallionRow({ renderGlyph }: { renderGlyph?: (slug: string) => ReactNode }) {
  return (
    <ul
      className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="civ-medallions"
    >
      {CIVILIZATIONS.map((c) => {
        const info = civInfo(c.slug)
        const ability = info?.abilities[0]
        return (
          <li key={c.slug} className="flex items-start gap-4">
            <span className="medallion relative grid h-14 w-14 shrink-0 place-items-center rounded-full">
              {renderGlyph ? renderGlyph(c.slug) : null}
            </span>
            <span className="min-w-0 pt-1">
              <span className="block font-display text-xl font-semibold tracking-tight text-parchment">
                {c.name}
              </span>
              {info ? (
                <span className="mt-1 block text-sm leading-relaxed text-parchment/60">
                  {info.identity}
                </span>
              ) : null}
              {ability ? (
                <span className="mt-2 block text-sm leading-relaxed text-parchment/80">
                  <span className="font-display font-semibold text-gold">{ability.name}.</span>{' '}
                  {ability.summary}.
                </span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
