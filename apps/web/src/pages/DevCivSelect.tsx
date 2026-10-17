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
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 id="dev-civ-label" className="mb-3 font-display text-lg font-semibold">
        Synthetic roster (120 civs)
      </h1>
      <CivSelect value={civ} onChange={setCiv} labelId="dev-civ-label" civs={SYNTHETIC} />
      <p className="mt-3 text-sm text-parchment/70" data-testid="dev-civ-value">
        {civ || 'none'}
      </p>
    </div>
  )
}
