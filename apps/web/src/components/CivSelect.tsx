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
 * search box (typeahead); the search is case- and accent-insensitive and also finds civs by
 * their emblem, ability names and ability summaries (`CIV_INFO` in `@game/config`), with the
 * matched text marked.
 *
 * Rows: medallion and name; a civ with abilities adds one brass line with the ability names.
 * With `preview` on a wide screen (1024px+), the open list gets a pane showing the highlighted
 * civ's full card.
 *
 * Bundle rule: this imports Radix (Popover), so like `overlay.tsx` it may only be used from
 * lazily loaded code (the Play page and the lobby/match screen), never from an eager page.
 */
import { CIVILIZATIONS, civInfo } from '@game/config'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover } from 'radix-ui'
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  abilityNames,
  bestMatchIndex,
  buildSearchIndex,
  type CivOption,
  civKeywords,
  filterCivs,
  isTypeaheadKey,
  listNavIndex,
  searchHit,
} from '../lib/civ-select.ts'
import { useMediaQuery } from '../lib/media.ts'
import { safeCollisionPadding } from '../lib/safe-area.ts'
import { abilityPrefix, CivAbilityLine } from './civ/CivAbilityLine.tsx'
import { CivCard } from './civ/CivCard.tsx'
import { CivMedallion } from './civ/CivMedallion.tsx'
import { Highlight } from './civ/marks.tsx'
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

/** Extra search text for a civ: its emblem, ability names and ability summaries. */
function infoKeywords(civ: CivOption): string {
  return civKeywords(civInfo(civ.slug))
}

/** What a screen reader hears after a row's name: its abilities, or "Standard army." */
function rowDescription(slug: string): string {
  const info = civInfo(slug)
  if (!info) return ''
  if (info.abilities.length === 0) return 'Standard army.'
  const names = abilityNames(info)
  const summary = info.abilities.length === 1 ? ` ${info.abilities[0]?.summary}.` : ''
  return `${abilityPrefix(info.abilities.length)}${names}.${summary}`
}

/**
 * Pick a civilization. `value` is a civ slug ('' for none yet). Give it a name with `labelId`
 * (the id of a visible heading or label) or `label` (read by screen readers only). `attached`:
 * square the bottom corners, for a `CivCard` joined under the trigger. `preview`: show the
 * highlighted civ's card next to the open list on wide screens.
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
  attached = false,
  preview = false,
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
  attached?: boolean
  preview?: boolean
  className?: string
}) {
  const wideScreen = useMediaQuery('(min-width: 1024px)')
  const withPane = preview && wideScreen
  const baseId = useId()
  const ownLabelId = `${baseId}-label`
  const valueId = `${baseId}-value`
  const listId = `${baseId}-list`
  const abilityId = `${baseId}-ability`
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

  const searchIndex = useMemo(() => buildSearchIndex(civs, infoKeywords), [civs])
  const options = useMemo(() => filterCivs(searchIndex, query), [searchIndex, query])
  const selected = civs.find((c) => c.slug === value)
  const selectedHasAbility = Boolean(selected && civInfo(selected.slug)?.abilities.length)

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
          aria-describedby={selectedHasAbility ? abilityId : undefined}
          disabled={disabled}
          onKeyDown={onTriggerKeyDown}
          data-testid={testId}
          data-value={value}
          className={cx(
            'civ-trigger group/civ relative flex w-full min-w-0 items-center gap-3 rounded-control border text-left transition-[border-color,background-color,box-shadow] duration-150',
            'border-rule-strong bg-black/20 shadow-well',
            'enabled:hover:border-brass/55 data-[state=open]:border-gold/80 data-[state=open]:shadow-[0_0_0_3px_rgb(212_160_23/0.2)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            size === 'lg' ? 'h-14 pr-3 pl-1.5' : 'h-12 pr-2.5 pl-1.5',
            // Joined to a card below: square bottom corners, and the focus ring drawn inside the
            // border so it doesn't cut across the card.
            attached && 'rounded-b-none border-b-rule focus-visible:outline-offset-[-2px]',
            className,
          )}
        >
          <CivMedallion civ={selected} size={size} />
          {/* The ability line sits under the name, so the name keeps the full width (narrow
              triggers: the lobby card, a bot's seat menu). */}
          <span className="flex min-w-0 flex-1 flex-col items-start justify-center">
            <span
              id={valueId}
              className={cx(
                'max-w-full min-w-0 truncate',
                selected
                  ? cx(
                      'font-display font-semibold leading-tight text-parchment',
                      size === 'lg' ? 'text-lead' : 'text-body',
                    )
                  : 'text-body text-faint',
              )}
            >
              {selected ? selected.name : placeholder}
            </span>
            {selected ? (
              <CivAbilityLine
                civ={selected.slug}
                size="md"
                id={abilityId}
                className="mt-0.5 max-w-full"
              />
            ) : null}
          </span>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-plate border border-rule-brass text-brass transition-colors duration-150 group-hover/civ:border-brass/60 group-data-[state=open]/civ:border-gold/60 group-data-[state=open]/civ:text-gold"
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
            'z-50 flex max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-panel',
            withPane ? 'w-[44rem] flex-row' : 'w-[max(var(--radix-popover-trigger-width),17rem)]',
            'border border-rule-brass bg-panel text-parchment shadow-lift',
            'origin-(--radix-popover-content-transform-origin) data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in',
          )}
          style={{
            maxHeight: withPane
              ? 'min(30rem, var(--radix-popover-content-available-height, 30rem))'
              : 'min(27rem, var(--radix-popover-content-available-height, 27rem))',
          }}
        >
          <div className={cx('flex min-h-0 min-w-0 flex-col', withPane ? 'w-[22rem]' : 'w-full')}>
            <div className="relative shrink-0 border-b border-rule p-2">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-5 h-4 w-4 -translate-y-1/2 text-faint"
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-label="Search civilizations or abilities"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeId}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                placeholder="Search civilizations or abilities"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                data-testid={`${testId}-search`}
                className="h-10 w-full rounded-control border border-rule-strong bg-black/25 pr-3 pl-9 text-body text-parchment shadow-well outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-gold focus:ring-2 focus:ring-gold/30"
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
              {options.map((c, i) => (
                <CivRow
                  key={c.slug}
                  civ={c}
                  id={optionId(c.slug)}
                  active={i === active}
                  selected={c.slug === value}
                  query={query}
                  onHover={() => {
                    if (i !== active) setActive(i)
                  }}
                  onChoose={() => choose(c)}
                />
              ))}
              {options.length === 0 ? (
                <p className="px-3 py-6 text-center text-ui text-faint">
                  No civilization matches “{query.trim()}”. Try a shorter name or an ability.
                </p>
              ) : null}
            </div>
          </div>
          {withPane ? <PreviewPane civ={options[active] ?? selected} /> : null}
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

/** The highlighted civ's full card beside the list (wide screens; the rows say it for screen readers). */
function PreviewPane({ civ }: { civ: CivOption | undefined }) {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-rule bg-black/10"
      data-testid="civ-preview"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-width:thin]">
        {civ ? (
          <CivCard civ={civ.slug} variant="full" />
        ) : (
          <p className="text-ui text-faint">Highlight a civilization to read about it.</p>
        )}
      </div>
      <p className="shrink-0 border-t border-rule px-5 py-2 text-caption text-faint">
        Arrow keys to browse, Enter to choose
      </p>
    </div>
  )
}

/**
 * One civ in the open list: medallion and name, then its ability names in brass (if any). When
 * the search matched an ability summary or the emblem, that text shows as an extra line with
 * the match marked. Screen readers hear the abilities through `aria-describedby`.
 */
function CivRow({
  civ,
  id,
  active,
  selected,
  query,
  onHover,
  onChoose,
}: {
  civ: CivOption
  id: string
  active: boolean
  selected: boolean
  query: string
  onHover: () => void
  onChoose: () => void
}) {
  const info = civInfo(civ.slug)
  const hit = searchHit(civ.name, info, query)
  const description = rowDescription(civ.slug)
  const extra =
    hit?.field === 'summary'
      ? {
          text: info?.abilities[hit.index]?.summary ?? '',
          range: hit.range,
          // One ability: its summary is already in the row's description.
          hidden: info?.abilities.length === 1,
        }
      : hit?.field === 'emblem' && info
        ? { text: info.emblem, range: hit.range, hidden: false }
        : null
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the popover (the search box keeps focus; aria-activedescendant points here)
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-describedby={description ? `${id}-desc` : undefined}
      data-slug={civ.slug}
      data-active={active || undefined}
      data-testid={`civ-${civ.slug}`}
      onPointerMove={onHover}
      onClick={onChoose}
      className={cx(
        'civ-row relative flex min-h-14 cursor-pointer items-center gap-3 rounded-control py-1 pr-3 pl-1.5 transition-colors duration-100 select-none',
        'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brass before:opacity-0 before:transition-opacity',
        active && 'bg-parchment/[0.07] before:opacity-100',
        selected && !active && 'bg-parchment/[0.03]',
      )}
    >
      <CivMedallion civ={civ} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cx(
            'line-clamp-2 min-w-0 font-display text-body leading-tight font-semibold',
            selected || active ? 'text-parchment' : 'text-muted',
          )}
        >
          <Highlight text={civ.name} range={hit?.field === 'name' ? hit.range : null} />
        </span>
        <CivAbilityLine
          civ={civ.slug}
          className="max-w-full"
          aria-hidden
          highlight={hit?.field === 'ability' ? hit.range : null}
        />
        {extra ? (
          <span
            className="line-clamp-2 text-caption leading-snug text-faint"
            aria-hidden={extra.hidden || undefined}
          >
            <Highlight text={extra.text} range={extra.range} />
          </span>
        ) : null}
      </span>
      {description ? (
        <span id={`${id}-desc`} hidden>
          {description}
        </span>
      ) : null}
      {selected ? (
        <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-brass" strokeWidth={2.5} />
      ) : null}
    </div>
  )
}
