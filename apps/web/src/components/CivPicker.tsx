import { CIVILIZATIONS } from '@game/config'
import { type KeyboardEvent, useRef, useState } from 'react'
import { gridNavIndex } from '../lib/grid-nav.ts'
import { CivEmblem } from './CivEmblem.tsx'

const COLS = 3

/**
 * The nine civ emblems as selectable tiles (a radiogroup). One tile is in the tab order (the
 * chosen one, else the first); arrow keys, Home and End move focus between tiles, and Space or
 * Enter picks the focused one.
 */
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
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const selected = CIVILIZATIONS.findIndex((c) => c.slug === value)
  // The tile last moved to with the keyboard, until the selection changes.
  const [focus, setFocus] = useState<{ index: number; value: string } | null>(null)
  const tabStop = focus && focus.value === value ? focus.index : Math.max(selected, 0)

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = gridNavIndex(e.key, index, CIVILIZATIONS.length, COLS)
    if (next === null) return
    e.preventDefault()
    setFocus({ index: next, value })
    tiles.current[next]?.focus()
  }

  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={label}>
      {CIVILIZATIONS.map((c, i) => {
        const active = c.slug === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled tile in a radiogroup
          <button
            key={c.slug}
            ref={(el) => {
              tiles.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onFocus={() => {
              if (i !== tabStop) setFocus({ index: i, value })
            }}
            onClick={() => onPick(c.slug)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50 ${
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
