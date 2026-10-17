import { civInfo } from '@game/config'
import { abilityNames, type TextRange } from '../../lib/civ-select.ts'
import { cx } from '../ui.tsx'
import { AbilityStar, Highlight } from './marks.tsx'

/** "Ability: " or "Abilities: " for screen readers, before ability names shown inline. */
export function abilityPrefix(count: number): string {
  return count === 1 ? 'Ability: ' : 'Abilities: '
}

/**
 * A civ's ability names on one line (a gold star, then the names in italic, joined with " · "),
 * for civ list rows, the picker trigger, lobby seats and player rows. Nothing for a civ that
 * plays the standard army. `highlight`: a search match in the joined names. The names truncate
 * within whatever width the caller gives (e.g. `max-w-full` in an `items-start` column).
 */
export function CivAbilityLine({
  civ,
  size = 'sm',
  highlight,
  id,
  className,
  ...rest
}: {
  civ: string
  size?: 'sm' | 'md' | undefined
  highlight?: TextRange | null | undefined
  id?: string | undefined
  className?: string | undefined
  'aria-hidden'?: boolean | undefined
}) {
  const info = civInfo(civ)
  if (!info || info.abilities.length === 0) return null
  const names = abilityNames(info)
  return (
    <span
      id={id}
      className={cx('flex min-w-0 items-center gap-1.5', className)}
      data-testid="civ-ability-line"
      {...rest}
    >
      <AbilityStar className="h-2 w-2" />
      <span
        className={cx(
          'min-w-0 truncate font-display leading-tight text-gold-bright italic',
          size === 'md' ? 'text-[12.5px]' : 'text-xs',
        )}
      >
        <span className="sr-only">{abilityPrefix(info.abilities.length)}</span>
        <Highlight text={names} range={highlight} />
      </span>
    </span>
  )
}
