import { specialArmy } from '../lib/civ-info.ts'
import { cx } from './ui.tsx'

/**
 * The "Special army" tag for a civ, or nothing for the standard army. `compact`: smaller, on
 * one line, for narrow places (under the name in the civ picker's trigger).
 */
export function SpecialArmyTag({
  civ,
  className,
  compact = false,
}: {
  civ: string
  className?: string
  compact?: boolean
}) {
  const army = specialArmy(civ)
  if (!army) return null
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-full border border-gold/40 bg-gold/10 font-sans font-semibold whitespace-nowrap uppercase text-gold',
        compact
          ? 'max-w-full px-1 text-[9px] leading-[13px] tracking-normal'
          : 'px-1.5 py-px text-[10px] tracking-wider',
        className,
      )}
      data-testid="special-army-tag"
    >
      {army.tag}
    </span>
  )
}

/**
 * What a civ's choice means for its army: a short explanation for a civ with a special army
 * (England's Prime Ministers), otherwise the standard-army note.
 */
export function CivArmyNote({ civ, className }: { civ: string; className?: string }) {
  const army = specialArmy(civ)
  if (!army) {
    return (
      <p className={cx('text-xs text-parchment/55', className)}>
        {civ
          ? 'This civilization plays the standard army; its emblem marks your seat.'
          : 'Most civilizations play the standard army.'}{' '}
        Civilizations tagged “Special army” field different pieces.
      </p>
    )
  }
  return (
    <div
      className={cx(
        'rounded-lg border border-gold/25 bg-gold/[0.06] px-3 py-2 text-xs text-parchment/75',
        className,
      )}
      data-testid="civ-army-note"
    >
      <SpecialArmyTag civ={civ} className="mr-1.5 align-[1px]" />
      {army.details}
    </div>
  )
}
