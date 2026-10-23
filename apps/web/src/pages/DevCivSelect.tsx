import { useState } from 'react'
import { CivSelect } from '../components/CivSelect.tsx'
import type { CivOption } from '../lib/civ-select.ts'

/**
 * Development builds only: the civ dropdown with a synthetic roster of 120 civs (the real one
 * will pass 100), so a browser test can check that the rendered list filters, scrolls and keeps
 * the highlighted row in view at that size. Not routed in production builds.
 */
const SYNTHETIC: CivOption[] = Array.from({ length: 120 }, (_, i) => ({
  slug: `realm-${i}`,
  name: `Realm ${String(i).padStart(3, '0')}`,
}))
SYNTHETIC[7] = { slug: 'cote', name: "Côte d'Ivoire" }
SYNTHETIC[42] = { slug: 'sao-tome', name: 'São Tomé and Príncipe' }
SYNTHETIC[99] = { slug: 'aland', name: 'Åland' }

export function DevCivSelect() {
  const [civ, setCiv] = useState('')
  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <h1 id="dev-civ-label" className="font-display text-heading font-semibold">
        Synthetic roster (120 civs)
      </h1>
      <p className="mt-1 mb-5 text-ui text-faint">
        Development only: checks that the civ list filters and scrolls at roster scale.
      </p>
      <CivSelect value={civ} onChange={setCiv} labelId="dev-civ-label" civs={SYNTHETIC} />
      <p className="mt-4 text-ui text-muted">
        Chosen:{' '}
        <span className="font-semibold text-parchment" data-testid="dev-civ-value">
          {civ || 'none'}
        </span>
      </p>
    </div>
  )
}
