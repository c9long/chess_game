/**
 * The civilization dropdown: a thick row (medallion, name, chevron) that opens a searchable list
 * of thick rows. Built for a roster of 100+ civs, so it is driven by data (`CIVILIZATIONS` by
 * default) and never lays civs out as a grid.
 *
 * Accessibility (WAI-ARIA 1.2 combobox): the trigger is a select-only `combobox` button; the open
 * popover holds a search `combobox` input that owns the `listbox` through
 * `aria-activedescendant`, so focus stays in the input while the arrow keys, Page Up/Down,
 * Home and End move the highlight. Enter (or a click) chooses and Escape closes, with focus
 * back on the trigger; Tab (Shift+Tab) closes and moves on to the next (previous) field after
 * the trigger, as with a native select. Typing on the closed trigger opens the list with that text in the
 * search box (typeahead); the search is case- and accent-insensitive.
 *
 * Bundle rule: this imports Radix (Popover), so like `overlay.tsx` it may only be used from
 * lazily loaded code (the Play page and the lobby/match screen), never from an eager page.
 */
import { CIVILIZATIONS } from '@game/config'
import { Check, ChevronDown, Search, Shield } from 'lucide-react'
import { Popover } from 'radix-ui'
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { specialArmy } from '../lib/civ-info.ts'
import {
  bestMatchIndex,
  buildSearchIndex,
  type CivOption,
  filterCivs,
  isTypeaheadKey,
  listNavIndex,
} from '../lib/civ-select.ts'
import { safeCollisionPadding } from '../lib/safe-area.ts'
import { SpecialArmyTag } from './CivArmyNote.tsx'
import { CivEmblem, hasCivEmblem } from './CivEmblem.tsx'
import { cx } from './ui.tsx'

/**
 * Attribute on the open list (portalled to the end of the page), so an enclosing menu's
 * outside-click handler can tell a click in the list from a click outside the menu.
 */
export const CIV_SELECT_CONTENT_ATTR = 'data-civ-select-content'

type Size = 'lg' | 'md'

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]'

/**
 * Focuses the next (or previous) tab stop after `from` in page order, outside any civ list (one
 * may still be fading out), or `from` itself when there is none.
 */
function focusTabbableFrom(from: HTMLElement, dir: 'next' | 'prev') {
  const stops = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      el === from ||
      (el.tabIndex >= 0 &&
        el.getClientRects().length > 0 &&
        !el.closest(`[${CIV_SELECT_CONTENT_ATTR}], [inert], [aria-hidden="true"]`)),
  )
  const at = stops.indexOf(from)
  const target = at < 0 ? from : (stops[dir === 'next' ? at + 1 : at - 1] ?? from)
  target.focus()
}

/** A civ's medallion: emblem art on brass-rimmed enamel, or a monogram for a civ without art yet. */
function Medallion({ civ, size }: { civ: CivOption | undefined; size: Size }) {
  return (
    <span
      className={cx(
        'medallion medallion-sm grid shrink-0 place-items-center rounded-full',
        size === 'lg' ? 'h-11 w-11' : 'h-9 w-9',
      )}
      aria-hidden="true"
    >
      {!civ ? (
        <Shield className="h-[42%] w-[42%] text-parchment/25" strokeWidth={1.75} />
      ) : hasCivEmblem(civ.slug) ? (
        <CivEmblem civ={civ.slug} title="" className="medallion-glyph h-[58%] w-[58%] text-brass" />
      ) : (
        <span className="medallion-glyph font-display text-sm font-semibold text-brass">
          {civ.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  )
}

/**
 * Pick a civilization. `value` is a civ slug ('' for none yet). Give it a name with `labelId`
 * (the id of a visible heading or label) or `label` (read by screen readers only).
 */
export function CivSelect({
  value,
  onChange,
  labelId,
  label = 'Civilization',
  placeholder = 'Choose a civilization',
  disabled = false,
  size = 'lg',
  civs = CIVILIZATIONS,
  testId = 'civ-select',
  className,
}: {
  value: string
  onChange: (slug: string) => void
  labelId?: string
  label?: string
  placeholder?: string
  disabled?: boolean
  size?: Size
  civs?: readonly CivOption[]
  testId?: string
  className?: string
}) {
  const baseId = useId()
  const ownLabelId = `${baseId}-label`
  const valueId = `${baseId}-value`
  const listId = `${baseId}-list`
  const optionId = (slug: string) => `${baseId}-opt-${slug}`
  const nameId = labelId ?? ownLabelId

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  // Clear of a phone's notch and home indicator too (measured when the list opens).
  const collisionPadding = useMemo(() => (open ? safeCollisionPadding(12) : 12), [open])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  /** Set by Tab in the open list: where focus goes once the list has closed. */
  const tabOut = useRef<'next' | 'prev' | null>(null)

  const searchIndex = useMemo(() => buildSearchIndex(civs), [civs])
  const options = useMemo(() => filterCivs(searchIndex, query), [searchIndex, query])
  const selected = civs.find((c) => c.slug === value)

  /** Open the list, optionally with typed text in the search box or the highlight at an end. */
  const openList = useCallback(
    (initial: { query?: string; at?: 'first' | 'last' } = {}) => {
      const q = initial.query ?? ''
      const list = filterCivs(searchIndex, q)
      const sel = list.findIndex((c) => c.slug === value)
      setQuery(q)
      setActive(
        q
          ? bestMatchIndex(list, q)
          : initial.at === 'last'
            ? list.length - 1
            : initial.at === 'first' || sel < 0
              ? Math.min(0, list.length - 1)
              : sel,
      )
      setOpen(true)
    },
    [searchIndex, value],
  )

  function choose(civ: CivOption | undefined) {
    if (!civ) return
    setOpen(false)
    if (civ.slug !== value) onChange(civ.slug)
  }

  function onQuery(q: string) {
    setQuery(q)
    setActive(bestMatchIndex(filterCivs(searchIndex, q), q))
  }

  // Keep the highlighted row in view (scrolling only the list, never the page).
  const activeSlug = open ? options[active]?.slug : undefined
  useEffect(() => {
    if (!activeSlug) return
    const frame = requestAnimationFrame(() => {
      const list = listRef.current
      const row = list?.querySelector<HTMLElement>(`[data-slug="${activeSlug}"]`)
      if (!list || !row) return
      const pad = 6
      if (row.offsetTop - pad < list.scrollTop) list.scrollTop = row.offsetTop - pad
      else if (row.offsetTop + row.offsetHeight + pad > list.scrollTop + list.clientHeight) {
        list.scrollTop = row.offsetTop + row.offsetHeight + pad - list.clientHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [activeSlug])

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (open || disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openList()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      openList({ at: e.key === 'Home' ? 'first' : 'last' })
    } else if (isTypeaheadKey(e)) {
      e.preventDefault()
      openList({ query: e.key })
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing) return // an IME is composing text in the search box
    const next = listNavIndex(e.key, active, options.length)
    if (next !== null) {
      e.preventDefault()
      setActive(next)
      return
    }
    const inInput = e.target === inputRef.current
    if (e.key === 'Enter' || (e.key === ' ' && !inInput)) {
      e.preventDefault()
      choose(options[active])
    } else if (e.key === 'Tab') {
      // Close and move on from the trigger (the list is portalled to the end of the page, so
      // the browser's own next tab stop would be meaningless); see onCloseAutoFocus.
      e.preventDefault()
      tabOut.current = e.shiftKey ? 'prev' : 'next'
      setOpen(false)
    } else if (!inInput && isTypeaheadKey(e)) {
      // Typing while the list itself has focus (touch devices start there) goes to the search.
      e.preventDefault()
      onQuery(query + e.key)
      inputRef.current?.focus()
    }
  }

  const activeId = open && options[active] ? optionId(options[active].slug) : undefined

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) openList()
        else setOpen(false)
      }}
    >
      {labelId ? null : (
        <span id={ownLabelId} className="sr-only">
          {label}
        </span>
      )}
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={`${nameId} ${valueId}`}
          disabled={disabled}
          onKeyDown={onTriggerKeyDown}
          data-testid={testId}
          data-value={value}
          className={cx(
            'civ-trigger group/civ relative flex w-full min-w-0 items-center gap-3 rounded-xl border text-left transition-[border-color,background-color,box-shadow] duration-150',
            'border-parchment/15 bg-gradient-to-b from-parchment/[0.06] to-ink/50 shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_10px_24px_-18px_rgb(0_0_0/0.9)]',
            'hover:border-gold/45 hover:from-gold/[0.08] data-[state=open]:border-gold/70 data-[state=open]:shadow-[0_0_0_3px_rgb(212_160_23/0.18)]',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-parchment/15',
            size === 'lg' ? 'h-14 pr-3 pl-1.5' : 'h-12 pr-2.5 pl-1.5',
            className,
          )}
        >
          <Medallion civ={selected} size={size} />
          <span
            id={valueId}
            className={cx(
              'min-w-0 flex-1 truncate',
              selected
                ? cx(
                    'font-display font-semibold tracking-tight text-parchment',
                    size === 'lg' ? 'text-lg' : 'text-base',
                  )
                : 'text-sm text-parchment/55',
            )}
          >
            {selected ? selected.name : placeholder}
          </span>
          {selected ? <SpecialArmyTag civ={selected.slug} /> : null}
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-gold/25 bg-ink/40 text-gold/80 transition group-hover/civ:border-gold/50 group-hover/civ:text-gold group-data-[state=open]/civ:border-gold/60 group-data-[state=open]/civ:text-gold"
          >
            <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/civ:rotate-180" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={collisionPadding}
          {...{ [CIV_SELECT_CONTENT_ATTR]: '' }}
          // Radix gives the content role="dialog"; name it, so screen readers don't announce an
          // unnamed dialog before the search box and the list.
          aria-labelledby={nameId}
          onCloseAutoFocus={(e) => {
            const dir = tabOut.current
            tabOut.current = null
            const trigger = triggerRef.current
            if (!dir || !trigger) return
            e.preventDefault()
            focusTabbableFrom(trigger, dir)
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            // Touch devices with an empty search start on the list, so the on-screen keyboard
            // doesn't cover it; tapping the search box brings the keyboard up.
            const coarse = window.matchMedia?.('(pointer: coarse)').matches
            if (coarse && !query) listRef.current?.focus()
            else {
              const input = inputRef.current
              input?.focus()
              input?.setSelectionRange(input.value.length, input.value.length)
            }
          }}
          onKeyDown={onListKeyDown}
          className={cx(
            'z-50 flex w-[max(var(--radix-popover-trigger-width),17rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl',
            'border border-gold/30 bg-panel text-parchment shadow-2xl shadow-black/70 ring-1 ring-black/40',
            'origin-(--radix-popover-content-transform-origin) data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in',
          )}
          style={{ maxHeight: 'min(27rem, var(--radix-popover-content-available-height, 27rem))' }}
        >
          <div className="relative shrink-0 border-b border-parchment/10 bg-gradient-to-b from-gold/[0.07] to-transparent p-2">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-5 h-4 w-4 -translate-y-1/2 text-parchment/45"
            />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search civilizations"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="done"
              placeholder="Search civilizations"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              data-testid={`${testId}-search`}
              className="h-10 w-full rounded-lg border border-parchment/15 bg-ink/70 pr-3 pl-9 text-sm text-parchment outline-none transition placeholder:text-parchment/60 focus:border-gold/70 focus:ring-2 focus:ring-gold/25"
            />
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={nameId}
            aria-activedescendant={activeId}
            data-testid={`${testId}-list`}
            // Clicking a row must not move focus off the search box.
            onMouseDown={(e) => e.preventDefault()}
            className="relative min-h-0 flex-1 overscroll-contain overflow-y-auto p-1.5 outline-none [scrollbar-color:rgb(201_165_90/0.35)_transparent] [scrollbar-width:thin]"
          >
            {options.map((c, i) => {
              const isActive = i === active
              const isSelected = c.slug === value
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the popover (the search box keeps focus; aria-activedescendant points here)
                <div
                  key={c.slug}
                  id={optionId(c.slug)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  data-slug={c.slug}
                  data-active={isActive || undefined}
                  data-testid={`civ-${c.slug}`}
                  onPointerMove={() => {
                    if (!isActive) setActive(i)
                  }}
                  onClick={() => choose(c)}
                  className={cx(
                    'civ-row relative flex h-14 cursor-pointer items-center gap-3 rounded-lg pr-3 pl-1.5 transition-colors duration-100 select-none',
                    'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-gold before:opacity-0 before:transition-opacity',
                    isActive && 'bg-gold/[0.11] before:opacity-100',
                    isSelected && !isActive && 'bg-parchment/[0.04]',
                  )}
                >
                  <Medallion civ={c} size="md" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cx(
                          'min-w-0 truncate font-display text-base font-semibold tracking-tight',
                          isSelected
                            ? 'text-gold-bright'
                            : isActive
                              ? 'text-parchment'
                              : 'text-parchment/80',
                        )}
                      >
                        {c.name}
                      </span>
                      <SpecialArmyTag civ={c.slug} />
                    </span>
                    {specialArmy(c.slug) ? (
                      <span className="truncate text-[11px] leading-tight text-parchment/60">
                        {specialArmy(c.slug)?.summary}
                      </span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <Check
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-gold"
                      strokeWidth={2.5}
                    />
                  ) : null}
                </div>
              )
            })}
            {options.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-parchment/55">
                No civilization matches “{query.trim()}”.
              </p>
            ) : null}
          </div>
          <p className="sr-only" aria-live="polite">
            {query.trim()
              ? `${options.length} ${options.length === 1 ? 'civilization' : 'civilizations'} found`
              : ''}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
