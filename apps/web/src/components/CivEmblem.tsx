import canada from '@game/assets/emblems/canada.svg?raw'
import china from '@game/assets/emblems/china.svg?raw'
import england from '@game/assets/emblems/england.svg?raw'
import france from '@game/assets/emblems/france.svg?raw'
import germany from '@game/assets/emblems/germany.svg?raw'
import japan from '@game/assets/emblems/japan.svg?raw'
import mali from '@game/assets/emblems/mali.svg?raw'
import russia from '@game/assets/emblems/russia.svg?raw'
import usa from '@game/assets/emblems/usa.svg?raw'
import { CIVILIZATIONS, type CivSlug } from '@game/config'

const EMBLEMS: Record<CivSlug, string> = {
  canada,
  usa,
  china,
  japan,
  germany,
  russia,
  england,
  france,
  mali,
}

/** True when the civ has emblem art (a roster entry without art yet gets a monogram instead). */
export function hasCivEmblem(slug: string): boolean {
  return Object.hasOwn(EMBLEMS, slug)
}

export function civName(slug: string): string {
  return CIVILIZATIONS.find((c) => c.slug === slug)?.name ?? 'No civilization'
}

/**
 * A civ's emblem (original, flag-free art from packages/assets), drawn in `currentColor`.
 * The SVGs are trusted local build assets, so inlining them is safe.
 */
export function CivEmblem({
  civ,
  className = 'h-6 w-6',
  title,
}: {
  civ: string
  className?: string
  title?: string
}) {
  const svg = EMBLEMS[civ as CivSlug]
  if (!svg) {
    return (
      <span
        className={`${className} inline-block rounded-full border border-dashed border-parchment/30`}
        role="img"
        aria-label="No civilization chosen"
      />
    )
  }
  return (
    <span
      className={`${className} inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full`}
      // title="" marks a decorative emblem (its meaning is given by nearby text).
      {...(title === ''
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': title ?? civName(civ) })}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, bundled SVG assets
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
