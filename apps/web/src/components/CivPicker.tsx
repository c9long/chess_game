import { CIVILIZATIONS } from '@game/config'
import { CivEmblem } from './CivEmblem.tsx'

/** The nine civ emblems as selectable tiles (a radiogroup). */
export function CivPicker({
  value,
  disabled = false,
  onPick,
  label = 'Civilization',
}: {
  value: string
  disabled?: boolean
  onPick: (civ: string) => void
  label?: string
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={label}>
      {CIVILIZATIONS.map((c) => {
        const active = c.slug === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled tile in a radiogroup
          <button
            key={c.slug}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onPick(c.slug)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-gold bg-gold/15 text-parchment'
                : 'border-parchment/15 text-parchment/70 hover:border-parchment/40 hover:text-parchment'
            }`}
            data-testid={`civ-${c.slug}`}
          >
            <CivEmblem civ={c.slug} className={`h-9 w-9 ${active ? 'text-gold' : ''}`} />
            {c.name}
          </button>
        )
      })}
    </div>
  )
}
