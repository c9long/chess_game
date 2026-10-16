import { CivEmblem } from '../CivEmblem.tsx'
import { MedallionRow } from './MedallionRow.tsx'

/** The medallion row with its emblem art (lazy: the nine inlined SVGs stay out of the entry chunk). */
export default function CivMedallions() {
  return (
    <MedallionRow
      renderGlyph={(slug) => (
        <CivEmblem
          civ={slug}
          className="medallion-glyph h-[58%] w-[58%] animate-fade-in text-brass"
        />
      )}
    />
  )
}
