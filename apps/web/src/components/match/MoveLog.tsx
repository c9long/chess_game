import type { MoveLogEntry } from '@game/protocol'
import { ArrowDown, ChevronDown } from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  attackedIn,
  clockText,
  groupRounds,
  isTurnItem,
  itemLabel,
  itemMarks,
  itemText,
  type LogItem,
  type LogStep,
  logItems,
  resultText,
} from '../../lib/move-log.ts'
import { SEAT_LABEL, seatHex, seatName, seatTextHex } from './seats.ts'

/**
 * The live game's log items from the room's actions (`useLiveMoveLog`). Checks come from the
 * engine's snapshot of each position, computed once per action.
 */
export function useLiveLogItems(entries: readonly MoveLogEntry[], ready: boolean): LogItem[] {
  const cache = useRef(new Map<string, boolean[]>())
  return useMemo(() => {
    if (!ready) return []
    const steps: LogStep[] = entries.map((e) => {
      const key = `${e.seq}|${e.positionString}`
      let attacked = cache.current.get(key)
      if (!attacked) {
        try {
          attacked = attackedIn(e.positionString)
        } catch {
          attacked = [false, false, false, false]
        }
        cache.current.set(key, attacked)
      }
      return { ...e, attacked }
    })
    return logItems(steps)
  }, [entries, ready])
}

const DEFEAT_NOTE: Record<string, string> = {
  leader_captured: 'leader captured',
  stalemate: 'stalemated',
  timeout: 'out of time',
  abandon: 'left the game',
  resign: 'resigned',
}

function SeatDot({ seat }: { seat: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: seat >= 0 ? seatHex(seat) : 'rgba(244,239,230,0.5)' }}
    />
  )
}

/** One move, pass or timeout in a seat's column. */
function Cell({
  item,
  current,
  currentKind,
  onSelect,
  future,
  tabStop,
}: {
  item: LogItem
  current: boolean
  currentKind: 'true' | 'step'
  onSelect: ((step: number) => void) | undefined
  /** Replay: after the step shown (dimmed, not yet played). */
  future: boolean
  /** Replay: the list's one Tab stop (roving tabindex). */
  tabStop: boolean
}) {
  const marks = itemMarks(item)
  const muted = item.kind !== 'move'
  const clock = item.clockMs
  const notation = (
    <span aria-hidden="true" className="flex min-w-0 items-baseline gap-px">
      <span
        className={`truncate ${muted ? 'font-sans text-[11px] italic text-parchment/60' : future ? 'text-parchment/60' : ''}`}
        style={
          muted || future ? undefined : { color: current ? undefined : seatTextHex(item.seat) }
        }
      >
        {itemText(item)}
      </span>
      {[...marks].map((m) => (
        <span
          key={m}
          className={future ? 'text-parchment/60' : m === '×' ? 'text-gold' : 'text-danger-light'}
        >
          {m}
        </span>
      ))}
    </span>
  )
  const body = (
    <>
      <span className="sr-only">{itemLabel(item)}</span>
      {clock === null ? (
        notation
      ) : (
        // The mover's time left after the move, small and muted under the notation.
        <span className="flex min-w-0 flex-col leading-[1.1]">
          {notation}
          <span
            aria-hidden="true"
            className={`text-[10px] ${future ? 'text-parchment/35' : 'text-parchment/50'}`}
            data-testid="move-log-clock"
          >
            {clockText(clock)}
          </span>
        </span>
      )}
    </>
  )
  const cls = `flex ${clock === null ? 'h-6' : 'min-h-6'} w-full min-w-0 items-center rounded-md px-1 text-left font-mono text-[12px] tracking-tight tabular-nums ${
    current ? 'bg-parchment/[0.12] text-parchment ring-1 ring-gold/60' : ''
  }`
  if (onSelect) {
    return (
      <button
        type="button"
        className={`${cls} hover:bg-parchment/[0.07] focus-visible:outline-2 focus-visible:outline-gold`}
        tabIndex={tabStop ? 0 : -1}
        aria-current={current ? currentKind : undefined}
        data-step={item.step}
        data-testid="move-log-item"
        onClick={() => onSelect(item.step)}
      >
        {body}
      </button>
    )
  }
  return (
    <span
      className={cls}
      aria-current={current ? currentKind : undefined}
      data-step={item.step}
      data-testid="move-log-item"
    >
      {body}
    </span>
  )
}

/** An off-turn action (a resignation, a leave, an agreed draw) under its round's row. */
function Note({
  item,
  current,
  currentKind,
  onSelect,
  endReason,
  future,
  tabStop,
}: {
  item: LogItem
  current: boolean
  currentKind: 'true' | 'step'
  onSelect: ((step: number) => void) | undefined
  endReason: string | undefined
  future: boolean
  tabStop: boolean
}) {
  const cls = `flex min-h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] ${
    current
      ? 'bg-parchment/[0.12] text-parchment ring-1 ring-gold/60'
      : future
        ? 'text-parchment/60'
        : 'text-parchment/70'
  }`
  const body = (
    <>
      <SeatDot seat={item.seat} />
      <span className="sr-only">{itemLabel(item, endReason)}</span>
      <span aria-hidden="true" className="truncate">
        {itemText(item, endReason)}
      </span>
    </>
  )
  return onSelect ? (
    <button
      type="button"
      className={`${cls} hover:bg-parchment/[0.07] focus-visible:outline-2 focus-visible:outline-gold`}
      tabIndex={tabStop ? 0 : -1}
      aria-current={current ? currentKind : undefined}
      data-step={item.step}
      data-testid="move-log-item"
      onClick={() => onSelect(item.step)}
    >
      {body}
    </button>
  ) : (
    <span
      className={cls}
      aria-current={current ? currentKind : undefined}
      data-step={item.step}
      data-testid="move-log-item"
    >
      {body}
    </span>
  )
}

/**
 * The moves by round, one column per seat (South, West, North, East), with captures (×),
 * checks (+), leader captures (#), passes and defeats marked. A plain list for screen readers
 * (each move has a full description), never a live region: the board already announces moves.
 *
 * Live (no `currentStep`): the newest move is highlighted and kept in view, unless the viewer
 * scrolled up to read earlier moves. Replay: `currentStep` is highlighted and each move is a
 * button that jumps there.
 */
export function MoveLog({
  items,
  names,
  currentStep = null,
  onSelect,
  endReason,
  emptyText = 'No moves yet.',
  className = '',
}: {
  items: readonly LogItem[]
  /** Column headings: a short name per seat. */
  names: readonly string[]
  /** Replay: the step shown on the board (-1 = the start), else null. */
  currentStep?: number | null
  onSelect?: (step: number) => void
  /** The game's end reason, for the result line. */
  endReason?: string | undefined
  emptyText?: string
  className?: string
}) {
  const rounds = useMemo(() => groupRounds(items), [items])
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const replay = currentStep !== null
  const currentKind = replay ? 'step' : 'true'
  const newest = items.at(-1)
  const lastStep = newest?.step
  const isCurrent = (item: LogItem) =>
    replay ? item.step === currentStep : newest !== undefined && item.key === newest.key
  const isFuture = (item: LogItem) => replay && item.step > (currentStep ?? -1)
  // Replay: one Tab stop for the whole list (the move shown, else the first), the arrow keys
  // and Home / End move between moves (the page's step keys), and focus follows the step.
  const tabStepKey = replay
    ? (items.find((i) => i.step === currentStep) ?? items[0])?.key
    : undefined
  const isTabStop = (item: LogItem) => item.key === tabStepKey
  const ended = [...items].reverse().find((i) => i.result)
  const showResult = ended?.result && (!replay || (currentStep ?? -1) >= ended.step)

  const follow = useCallback(() => {
    const el = scroller.current
    if (!el || el.clientHeight === 0) return
    if (!replay) {
      if (stick.current) el.scrollTop = el.scrollHeight
      return
    }
    if (lastStep !== undefined && currentStep === lastStep) {
      el.scrollTop = el.scrollHeight
      return
    }
    const target = el.querySelector<HTMLElement>(`[data-step="${currentStep}"]`)
    if (!target) {
      if (currentStep === -1) el.scrollTop = 0
      return
    }
    const box = el.getBoundingClientRect()
    const r = target.getBoundingClientRect()
    if (r.top < box.top + 4) el.scrollTop += r.top - box.top - 4
    else if (r.bottom > box.bottom - 4) el.scrollTop += r.bottom - box.bottom + 4
  }, [replay, currentStep, lastStep])

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new moves and steps
  useLayoutEffect(() => {
    follow()
  }, [follow, items.length, showResult])

  // Replay: focus on a move follows the step (the roving Tab stop moved with it).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step changes
  useLayoutEffect(() => {
    const el = scroller.current
    if (!replay || !el?.contains(document.activeElement)) return
    const target = el.querySelector<HTMLElement>('[tabindex="0"]')
    if (target && target !== document.activeElement) target.focus({ preventScroll: true })
  }, [replay, currentStep])

  // Shown again (a phone's collapsed log opened) or resized: keep following.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => follow())
    ro.observe(el)
    return () => ro.disconnect()
  }, [follow])

  function onScroll() {
    const el = scroller.current
    if (!el || replay) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    stick.current = bottom
    setAtBottom(bottom)
  }

  const defeatNotes = (round: (typeof rounds)[number]): ReactNode[] =>
    [...round.cells, ...round.notes]
      .filter((i): i is LogItem => i !== null)
      .sort((a, b) => a.seq - b.seq)
      .flatMap((i) =>
        // A resignation's or a leave's own note already says it.
        i.defeats
          .filter((d) => isTurnItem(i) || d.seat !== i.seat)
          .map((d) => (
            <li
              key={`${i.key}:d${d.seat}`}
              className={`col-span-4 flex min-h-5 items-center gap-1.5 px-1.5 text-[11px] text-parchment/55`}
              aria-hidden="true"
            >
              <SeatDot seat={d.seat} />
              {SEAT_LABEL[seatName(d.seat)]} is out: {DEFEAT_NOTE[d.reason] ?? d.reason}
            </li>
          )),
      )

  return (
    <div className={`relative flex min-h-0 flex-col ${className}`} data-testid="move-log">
      <div
        aria-hidden="true"
        className="grid shrink-0 grid-cols-[1.5rem_repeat(4,minmax(0,1fr))] gap-x-1 border-b border-parchment/10 px-1.5 pb-1.5 text-[11px] text-parchment/60"
      >
        <span className="text-right pr-1">#</span>
        {[0, 1, 2, 3].map((s) => {
          const seatLabel = SEAT_LABEL[seatName(s)]
          const name = names[s] || seatLabel
          return (
            // The seat's initial tells columns apart without colour (names truncate, and
            // several guests can share one).
            <span key={s} className="flex min-w-0 items-center gap-1 px-1.5" title={name}>
              <SeatDot seat={s} />
              <span className="shrink-0 font-semibold text-parchment/80">{seatLabel[0]}</span>
              {name === seatLabel ? null : <span className="truncate">{name}</span>}
            </span>
          )
        })}
      </div>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
        // Live, nothing inside is focusable: the list itself takes focus so keyboards can scroll.
        {...(onSelect ? {} : { tabIndex: 0, role: 'region', 'aria-label': 'Move log' })}
      >
        {items.length === 0 ? (
          <p className="px-1.5 py-2 text-xs text-parchment/60">{emptyText}</p>
        ) : (
          <ol aria-label="Moves by round" className="flex flex-col gap-0.5">
            {rounds.map((round) => (
              <li
                key={round.number}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-1"
              >
                <span
                  aria-hidden="true"
                  className="pt-1 pr-1 text-right text-[11px] tabular-nums text-parchment/55"
                >
                  {round.number}
                </span>
                <ol aria-label={`Round ${round.number}`} className="grid grid-cols-4 gap-x-1">
                  {round.cells.map((item, s) =>
                    item ? (
                      <li key={item.key} className="min-w-0">
                        <Cell
                          item={item}
                          current={isCurrent(item)}
                          currentKind={currentKind}
                          onSelect={onSelect}
                          future={isFuture(item)}
                          tabStop={isTabStop(item)}
                        />
                      </li>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a seat's empty cell
                      <li key={`empty-${s}`} aria-hidden="true" className="h-6" />
                    ),
                  )}
                  {round.notes.map((item) => (
                    <li key={item.key} className="col-span-4 min-w-0">
                      <Note
                        item={item}
                        current={isCurrent(item)}
                        currentKind={currentKind}
                        onSelect={onSelect}
                        endReason={endReason}
                        future={isFuture(item)}
                        tabStop={isTabStop(item)}
                      />
                    </li>
                  ))}
                  {defeatNotes(round)}
                </ol>
              </li>
            ))}
            {showResult && ended?.result ? (
              <li
                className="mt-1 rounded-md border border-gold/25 bg-gold/[0.07] px-2 py-1.5 text-xs text-parchment/85"
                data-testid="move-log-result"
              >
                <span className="font-semibold text-gold">Game over</span> ·{' '}
                {resultText(ended.result, endReason)}
              </li>
            ) : null}
          </ol>
        )}
      </div>
      {!replay && !atBottom ? (
        <button
          type="button"
          className="absolute right-2 bottom-2 inline-flex h-8 items-center gap-1 rounded-full border border-parchment/15 bg-ink/95 px-3 text-xs font-semibold text-parchment/85 shadow-lg shadow-black/40 hover:text-parchment"
          onClick={() => {
            const el = scroller.current
            stick.current = true
            setAtBottom(true)
            if (el) el.scrollTop = el.scrollHeight
          }}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          Latest
        </button>
      ) : null}
    </div>
  )
}

const OPEN_KEY = 'moveLog:open'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/** "12. South e2e4×": the newest item, for a phone's collapsed log. */
function latestText(items: readonly LogItem[]): string {
  const rounds = groupRounds(items)
  const last = items.at(-1)
  if (!last) return 'No moves yet'
  const round = rounds.at(-1)?.number ?? 1
  if (!isTurnItem(last)) return `${round}. ${itemText(last)}`
  return `${round}. ${SEAT_LABEL[seatName(last.seat)]} ${itemText(last)}${itemMarks(last)}`
}

/**
 * The game screen's move log: a section of the side panel on wide screens (filling the room
 * left between the players and the actions); on phones and tablets a bar under the actions
 * showing the newest move, which opens the log below it (nothing above moves).
 */
export function MoveLogPanel({
  items,
  names,
  endReason,
  className = '',
}: {
  items: readonly LogItem[]
  names: readonly string[]
  endReason?: string | undefined
  className?: string
}) {
  const [open, setOpen] = useState(readOpen)
  const bodyId = useId()
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col rounded-xl border border-parchment/10 bg-ink/25 ${className}`}
      data-testid="move-log-panel"
    >
      <h2 id={headingId} className="sr-only">
        Moves
      </h2>
      <button
        type="button"
        className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm wide:hidden"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((o) => {
            try {
              localStorage.setItem(OPEN_KEY, o ? '0' : '1')
            } catch {}
            return !o
          })
        }}
        data-testid="move-log-toggle"
      >
        <span className="font-semibold">Moves</span>
        <span
          aria-hidden="true"
          className="min-w-0 flex-1 truncate font-mono text-xs text-parchment/60"
        >
          {latestText(items)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-parchment/60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <p
        aria-hidden="true"
        className="hidden px-3 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.18em] text-parchment/60 uppercase wide:block"
      >
        Moves
      </p>
      <div
        id={bodyId}
        className={`${open ? 'flex' : 'hidden'} h-48 flex-col pb-1 wide:flex wide:h-auto wide:min-h-0 wide:flex-1`}
      >
        <MoveLog items={items} names={names} endReason={endReason} className="flex-1" />
      </div>
    </section>
  )
}
