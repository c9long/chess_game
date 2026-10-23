import type { TextRange } from '../../lib/civ-select.ts'
import { cx } from '../ui.tsx'

/** The ability marker: a small four-point star in brass (decorative). */
export function AbilityStar({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0 fill-brass', className)}
    >
      <path d="M5 0C5.55 3.1 6.9 4.45 10 5 6.9 5.55 5.55 6.9 5 10 4.45 6.9 3.1 5.55 0 5 3.1 4.45 4.45 3.1 5 0Z" />
    </svg>
  )
}

/** A thin ornament between a card's identity line and its abilities. */
export function OrnamentRule({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('flex items-center gap-2', className)}>
      <span className="h-px flex-1 bg-rule" />
      <AbilityStar className="h-2 w-2 fill-brass/60" />
      <span className="h-px flex-1 bg-rule" />
    </div>
  )
}

/** `text` with the matched `range` (if any) marked, as search results show it. */
export function Highlight({ text, range }: { text: string; range?: TextRange | null | undefined }) {
  if (!range) return text
  const [start, end] = range
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-[2px] bg-brass/25 text-parchment">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  )
}
