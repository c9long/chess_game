/**
 * Details about a seated civilization (an opponent's or your own): the compact `CivCard` in a
 * popover anchored to the trigger from 640px, or in a bottom sheet on phones. It opens on a
 * click, a tap, Enter or Space (never on hover); Escape, an outside click or the close button
 * close it, and focus goes back to the trigger.
 *
 * Bundle rule: this imports `overlay.tsx` (Radix), so use it only from lazily loaded code.
 */
import { civInfo } from '@game/config'
import { type ReactElement, useId, useState } from 'react'
import { abilityNames } from '../../lib/civ-select.ts'
import { useMediaQuery } from '../../lib/media.ts'
import { civName } from '../CivEmblem.tsx'
import { BottomSheet, Popover, SheetTitle } from '../overlay.tsx'
import { CivCard } from './CivCard.tsx'

/**
 * The accessible name of a button that opens a civ's details: "England, ability Magna Carta:
 * show civilization details" (no ability part for the standard army).
 */
export function civInfoLabel(civ: string): string {
  const info = civInfo(civ)
  const count = info?.abilities.length ?? 0
  const ability =
    count === 0 ? '' : `, ${count === 1 ? 'ability' : 'abilities'} ${abilityNames(info)}`
  return `${civName(civ)}${ability}: show civilization details`
}

export function CivInfoOverlay({
  civ,
  kicker,
  kickerColor,
  seatColor,
  side = 'bottom',
  trigger,
}: {
  civ: string
  /**
   * Who sits there, in the seat colour: the seat label in small capitals, then the player's
   * name as written (or "Bot · 1500").
   */
  kicker?: { seat: string; who: string } | undefined
  kickerColor?: string | undefined
  /** Tints the ability's piece art (the seat's light piece colour). */
  seatColor?: string | undefined
  /** Where the desktop popover opens from the trigger. */
  side?: 'top' | 'bottom' | 'left' | undefined
  /** A button; it gets the open handler, `aria-haspopup="dialog"` and `aria-expanded`. */
  trigger: ReactElement
}) {
  const wide = useMediaQuery('(min-width: 640px)')
  const [open, setOpen] = useState(false)
  const headingId = useId()
  const card = (nameAs?: (h: ReactElement) => ReactElement) => (
    <CivCard
      civ={civ}
      variant="compact"
      kicker={
        kicker ? (
          <>
            <span className="tracking-wider uppercase">{kicker.seat}</span> · {kicker.who}
          </>
        ) : undefined
      }
      kickerColor={kickerColor}
      seatColor={seatColor}
      fold="rest"
      headingId={headingId}
      {...(nameAs ? { nameAs } : {})}
    />
  )
  if (wide) {
    return (
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
        labelledBy={headingId}
        side={side}
        testId="civ-info-popover"
      >
        {card()}
      </Popover>
    )
  }
  return (
    <BottomSheet open={open} onOpenChange={setOpen} trigger={trigger} testId="civ-info-popover">
      {card((h) => (
        <SheetTitle asChild>{h}</SheetTitle>
      ))}
    </BottomSheet>
  )
}
