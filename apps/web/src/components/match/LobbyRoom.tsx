import { BOT_LEVELS } from '@game/config'
import type { MatchStateJson, SeatStateJson } from '@game/protocol/state'
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { leaveMatch, type MatchRoom, matchApi } from '../../lib/match.ts'
import { useMediaQuery } from '../../lib/media.ts'
import { usePrefs } from '../../lib/prefs.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { CIV_SELECT_CONTENT_ATTR, CivSelect } from '../CivSelect.tsx'
import { CheckIcon, CopyIcon, CrownIcon, DotsIcon, PlusIcon } from '../game/icons.tsx'
import { Button } from '../ui.tsx'
import { RankedBadge } from './RankedBadge.tsx'
import {
  MODE_LABEL,
  SEAT_LABEL,
  seatColorName,
  seatHex,
  seatName,
  seatTextHex,
  teamLabel,
} from './seats.ts'

const LEVEL_LABELS = BOT_LEVELS.map(String)

function levelText(level: string): string {
  return level === 'max' ? 'Max' : level
}

/** Bot strength on a 1..5 scale (for the pip meter), from its place in BOT_LEVELS. */
function strengthPips(level: string): number {
  const i = LEVEL_LABELS.indexOf(level)
  if (i < 0) return 1
  return Math.max(1, Math.ceil(((i + 1) / LEVEL_LABELS.length) * 5))
}

function Badge({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'gold' | 'ok' }) {
  const tones = {
    muted: 'border-parchment/20 text-parchment/65',
    gold: 'border-gold/50 bg-gold/10 text-gold',
    ok: 'border-seat-east/50 bg-seat-east/10 text-[#7fd8b7]',
  }
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider whitespace-nowrap uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

const selectClass =
  'h-9 min-w-0 rounded-lg border border-parchment/20 bg-ink/70 px-2 text-sm text-parchment outline-none focus:border-gold'

/** Host controls for an occupied seat, tucked into a "⋯" menu. */
function SeatMenu({
  index,
  seat,
  me,
  send,
}: {
  index: number
  seat: SeatStateJson
  me: boolean
  send: ReturnType<typeof matchApi>['send']
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const civLabelId = useId()
  const others = [0, 1, 2, 3].filter((i) => i !== index)
  const close = () => ref.current?.removeAttribute('open')
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element
      // The bot's civ list opens in a popover outside the menu: a click there isn't "outside".
      if (target.closest?.(`[${CIV_SELECT_CONTENT_ATTR}]`)) return
      if (ref.current?.open && !ref.current.contains(target)) {
        ref.current.removeAttribute('open')
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])
  const s = index as 0 | 1 | 2 | 3
  return (
    <details ref={ref} className="group relative">
      <summary
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-parchment/60 hover:bg-parchment/10 hover:text-parchment group-open:bg-parchment/10 group-open:text-parchment [&::-webkit-details-marker]:hidden"
        aria-label={`Seat options (${SEAT_LABEL[seatName(index)]})`}
        title="Seat options"
      >
        <DotsIcon />
      </summary>
      <div className="absolute top-9 right-0 z-30 flex w-56 flex-col gap-2 rounded-xl tracking-normal normal-case border border-parchment/15 bg-panel p-3 shadow-2xl shadow-black/60">
        {seat.isBot ? (
          <div className="flex flex-col gap-1 text-xs text-parchment/60">
            <span id={civLabelId}>
              {/* Screen readers hear which seat this changes ("West bot Civilization France"). */}
              <span className="sr-only">{SEAT_LABEL[seatName(index)]} bot </span>
              Civilization
            </span>
            <CivSelect
              value={seat.civ}
              onChange={(civ) => send('setBotCiv', { seat: s, civ: civ as never })}
              labelId={civLabelId}
              size="md"
              testId={`civ-select-${seatName(index)}`}
            />
          </div>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-parchment/60">
          Move to seat
          <select
            className={selectClass}
            value=""
            onChange={(e) => {
              if (!e.target.value) return
              send('swapSeats', { a: s, b: Number(e.target.value) as 0 | 1 | 2 | 3 })
              close()
            }}
          >
            <option value="">Swap with…</option>
            {others.map((o) => (
              <option key={o} value={o}>
                {SEAT_LABEL[seatName(o)]}
              </option>
            ))}
          </select>
        </label>
        {seat.isBot ? (
          <button
            type="button"
            className="h-9 rounded-lg border border-parchment/15 text-sm font-semibold text-parchment/80 hover:border-seat-south-light/60 hover:text-seat-south-light"
            onClick={() => {
              send('removeBot', { seat: s })
              close()
            }}
          >
            Remove bot
          </button>
        ) : !me ? (
          <button
            type="button"
            className="h-9 rounded-lg border border-parchment/15 text-sm font-semibold text-parchment/80 hover:border-seat-south-light/60 hover:text-seat-south-light"
            onClick={() => {
              send('kick', { seat: s })
              close()
            }}
          >
            Kick player
          </button>
        ) : null}
      </div>
    </details>
  )
}

function StrengthMeter({ level }: { level: string }) {
  const pips = strengthPips(level)
  return (
    <span
      className="flex items-center gap-2 text-[11px] whitespace-nowrap text-parchment/60"
      title={`Bot strength: ${level === 'max' ? 'maximum' : `Elo ${level}`}`}
    >
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((p) => (
          <span
            key={p}
            className={`h-1.5 w-2 rounded-full sm:w-3 ${p <= pips ? 'bg-parchment/70' : 'bg-parchment/15'}`}
          />
        ))}
      </span>
      {level === 'max' ? 'Max' : `Elo ${level}`}
    </span>
  )
}

function SeatCard({
  index,
  seat,
  me,
  viewerIsHost,
  hostSeat,
  mode,
  ranked,
  send,
}: {
  index: number
  seat: SeatStateJson
  me: boolean
  viewerIsHost: boolean
  hostSeat: number
  mode: string
  /** Ranked lobby: no bots, so the host gets no bot controls for open seats. */
  ranked: boolean
  send: ReturnType<typeof matchApi>['send']
}) {
  const [level, setLevel] = useState('1200')
  const color = seatHex(index)
  const reduce = useReducedMotion()
  const bodyKey = seat.occupied ? (seat.isBot ? 'bot' : `p-${seat.displayName}`) : 'open'

  return (
    <article
      className={`relative flex h-full min-h-[148px] flex-col gap-3 overflow-visible rounded-2xl border p-3.5 sm:min-h-[176px] sm:p-4 ${
        seat.occupied
          ? seat.isBot
            ? 'bg-ink/50 bg-[repeating-linear-gradient(135deg,rgba(244,239,230,0.025)_0_6px,transparent_6px_12px)]'
            : 'bg-panel/85'
          : 'border-dashed bg-panel/40'
      }`}
      style={{ borderColor: `${color}66` }}
      data-testid={`seat-${seatName(index)}`}
    >
      {seat.occupied ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 rounded-t-2xl"
          style={{ background: color }}
        />
      ) : null}
      <header className="flex min-h-8 items-center justify-between gap-2 text-[11px] tracking-[0.18em] uppercase">
        <span className="truncate font-semibold" style={{ color: seatTextHex(index) }}>
          {SEAT_LABEL[seatName(index)]}
          <span className="hidden sm:inline"> · {seatColorName(index)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {mode === 'teams' ? (
            <span className="hidden tracking-normal normal-case text-parchment/45 sm:inline">
              {teamLabel(index % 2)}
            </span>
          ) : null}
          {viewerIsHost && seat.occupied ? (
            <SeatMenu index={index} seat={seat} me={me} send={send} />
          ) : null}
        </span>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={bodyKey}
          className="flex flex-1 flex-col"
          initial={reduce ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {seat.occupied ? (
            // Phones: the emblem above the name, so a narrow card still shows the whole name.
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border sm:h-12 sm:w-12"
                style={{ borderColor: `${color}80`, backgroundColor: `${color}26`, color }}
              >
                <CivEmblem civ={seat.civ} className="h-6 w-6 sm:h-8 sm:w-8" />
              </span>
              <div className="w-full min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5 font-semibold">
                  <span className="truncate" data-testid="seat-name">
                    {seat.isBot ? `Bot · ${levelText(seat.botLevel)}` : seat.displayName}
                  </span>
                  {hostSeat === index ? (
                    <span className="shrink-0 text-gold" title="Host">
                      <CrownIcon className="h-4 w-4" />
                      <span className="sr-only">(host)</span>
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-xs text-parchment/55">
                  {seat.civ ? civName(seat.civ) : 'Choosing a civilization…'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {me ? <Badge tone="gold">You</Badge> : null}
                  {seat.isBot ? <Badge>Bot</Badge> : null}
                  {seat.isGuest ? <Badge>Guest</Badge> : null}
                  {seat.isBot ? null : seat.ready ? (
                    <Badge tone="ok">Ready</Badge>
                  ) : (
                    <Badge>Not ready</Badge>
                  )}
                  {!seat.isBot && !seat.connected ? <Badge>Reconnecting</Badge> : null}
                </div>
                {seat.isBot ? (
                  <div className="mt-2">
                    <StrengthMeter level={seat.botLevel} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-center gap-3">
              <p className="flex items-center gap-2 text-sm text-parchment/55">
                <motion.span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                  animate={reduce ? { opacity: 0.7 } : { opacity: [0.4, 1, 0.4] }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
                  }
                />
                Waiting for a player
              </p>
              {ranked ? (
                <p className="text-xs text-parchment/45" data-testid="ranked-seat-hint">
                  Ranked: waiting for a player with an account. Bots can’t take ranked seats.
                </p>
              ) : viewerIsHost ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2 [&>select]:min-w-28">
                  <label className="sr-only" htmlFor={`bot-level-${index}`}>
                    Bot strength
                  </label>
                  <select
                    id={`bot-level-${index}`}
                    className={`${selectClass} flex-1`}
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    data-testid="bot-level"
                  >
                    {LEVEL_LABELS.map((l) => (
                      <option key={l} value={l}>
                        {l === 'max' ? 'Max strength' : `Elo ${l}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-parchment/25 px-3 text-sm font-semibold whitespace-nowrap text-parchment hover:border-parchment/50 hover:bg-parchment/5 focus-visible:outline-2 focus-visible:outline-gold"
                    onClick={() =>
                      send('addBot', { seat: index as 0 | 1 | 2 | 3, level: level as never })
                    }
                    data-testid="add-bot"
                  >
                    <PlusIcon className="h-3.5 w-3.5" /> Add bot
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </article>
  )
}

/** The line-up before the start: one card per seat with its emblem in the seat colour. */
export function Lineup({ state, testId }: { state: MatchStateJson; testId?: string }) {
  return (
    <ul className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4" data-testid={testId}>
      {state.seats.map((seat, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: seats are fixed positions
          key={i}
          className="relative flex flex-col items-center gap-2 overflow-hidden rounded-2xl border border-parchment/10 bg-panel/80 px-3 py-4"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1"
            style={{ background: seatHex(i) }}
          />
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border"
            style={{
              borderColor: `${seatHex(i)}80`,
              backgroundColor: `${seatHex(i)}26`,
              color: seatHex(i),
            }}
          >
            {seat.civ ? <CivEmblem civ={seat.civ} className="h-7 w-7" /> : null}
          </span>
          <span className="max-w-full truncate text-sm font-semibold">
            {seat.isBot
              ? `Bot · ${levelText(seat.botLevel)}`
              : seat.occupied
                ? seat.displayName
                : '…'}
          </span>
          <span className="text-xs text-parchment/55">
            {seat.civ ? civName(seat.civ) : ''} · {SEAT_LABEL[seatName(i)]}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Countdown({ endsAt, state }: { endsAt: number; state: MatchStateJson }) {
  const [now, setNow] = useState(Date.now())
  const systemReduced = useReducedMotion()
  const reduce = Boolean(systemReduced) || usePrefs.getState().reducedMotion
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  const secs = Math.max(1, Math.ceil((endsAt - now) / 1000))
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink/80 px-4 py-8 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col items-center">
        <p className="text-sm font-semibold tracking-[0.35em] text-gold uppercase">Game starting</p>
        <div className="relative mt-6 flex h-32 w-32 items-center justify-center">
          {reduce ? null : (
            <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="rgba(244,239,230,0.1)"
                strokeWidth="3"
              />
              <motion.circle
                key={secs}
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke={seatHex(Math.max(0, 3 - ((secs - 1) % 4)))}
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1, ease: 'linear' }}
              />
            </svg>
          )}
          {/* A live region that stays mounted (a newly inserted one is often not announced);
              only the animated number inside it is re-keyed each second. */}
          <div className="relative" aria-live="assertive" aria-atomic="true">
            <motion.p
              key={secs}
              className="font-display text-8xl font-semibold tabular-nums"
              initial={reduce ? false : { scale: 1.35, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {secs}
            </motion.p>
          </div>
        </div>
        <div className="mt-8 w-full">
          <Lineup state={state} />
        </div>
      </div>
    </div>
  )
}

function ChecklistRow({ done, label, value }: { done: boolean; label: string; value: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          done
            ? 'border-seat-east/60 bg-seat-east/20 text-[#7fd8b7]'
            : 'border-parchment/25 text-transparent'
        }`}
        aria-hidden="true"
      >
        <CheckIcon className="h-3 w-3" />
      </span>
      <span className={done ? 'text-parchment/85' : 'text-parchment/60'}>{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-parchment/70">{value}</span>
      <span className="sr-only">{done ? '(done)' : '(not yet)'}</span>
    </li>
  )
}

function useCopy(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [
    copied,
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 2000)
      } catch {}
    },
  ]
}

function CopiedLabel({ copied, idle }: { copied: boolean; idle: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {copied ? (
        <motion.span
          key="copied"
          className="inline-flex items-center gap-1.5 text-[#7fd8b7]"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <CheckIcon className="h-4 w-4" /> Link copied
        </motion.span>
      ) : (
        <motion.span
          key="idle"
          className="inline-flex items-center gap-1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <CopyIcon className="h-4 w-4" /> {idle}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

export function LobbyRoom({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const navigate = useNavigate()
  const { state, mySeat } = feed
  const send = useMemo(() => matchApi(room).send, [room])
  const [copied, copy] = useCopy()
  const civLabelId = useId()
  const [startScope, animateStart] = useAnimate<HTMLDivElement>()
  const systemReduced = useReducedMotion()
  const prefReduced = usePrefs((s) => s.reducedMotion)
  const reduce = Boolean(systemReduced) || prefReduced
  const wide = useMediaQuery('(min-width: 640px)')
  const me = mySeat >= 0 ? state.seats[mySeat] : undefined
  const viewerIsHost = mySeat >= 0 && state.hostSeat === mySeat
  const everyoneReady = state.seats.every(
    (s) => s.occupied && s.civ && (s.isBot || (s.ready && s.connected)),
  )
  const canStart = viewerIsHost && state.phase === 'civ_select' && everyoneReady
  const seated = state.seats.filter((s) => s.occupied).length
  const withCiv = state.seats.filter((s) => s.occupied && s.civ).length
  const humans = state.seats.filter((s) => s.occupied && !s.isBot)
  const humansReady = humans.filter((s) => s.ready && s.connected).length
  const inviteUrl = typeof window === 'undefined' ? '' : window.location.href

  // Start becomes available: one gold glow so the host notices.
  const couldStart = useRef(canStart)
  useEffect(() => {
    const now = canStart && !couldStart.current
    couldStart.current = canStart
    if (!now || reduce || !startScope.current) return
    animateStart(
      startScope.current,
      {
        boxShadow: [
          '0 0 0 0px rgba(212,160,23,0.55)',
          '0 0 0 8px rgba(212,160,23,0.2)',
          '0 0 0 14px rgba(212,160,23,0)',
        ],
      },
      { duration: 1.1, ease: 'easeOut' },
    )
  }, [canStart, reduce, animateStart, startScope])

  async function leave() {
    navigate('/play')
    await leaveMatch()
  }

  // Seats in the cross from 640px; on phones a 2x2 grid that starts with the viewer's seat.
  // The DOM follows the visual reading order in both layouts, so Tab moves through the seats
  // as they appear (cross: North, West, East, South).
  const seatOrder = wide
    ? [2, 1, 3, 0]
    : [0, 1, 2, 3].map((rank) => (mySeat >= 0 ? (mySeat + rank) % 4 : rank))
  const place = [
    'sm:col-start-2 sm:row-start-3',
    'sm:col-start-1 sm:row-start-2',
    'sm:col-start-2 sm:row-start-1',
    'sm:col-start-3 sm:row-start-2',
  ]
  const seatCard = (i: number) => {
    const seat = state.seats[i]
    if (!seat) return null
    return (
      <div key={i} className={`${place[i]} min-w-0`}>
        <SeatCard
          index={i}
          seat={seat}
          me={i === mySeat}
          viewerIsHost={viewerIsHost}
          hostSeat={state.hostSeat}
          mode={state.mode}
          ranked={state.ranked}
          send={send}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.3em] text-gold uppercase">
            {state.hasPassword ? 'Private lobby' : 'Public lobby'}
            {state.ranked ? <RankedBadge /> : null}
          </p>
          <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight">
            {state.name}
          </h1>
          <p className="mt-1 text-sm text-parchment/60">
            {MODE_LABEL[state.mode]} · {state.timeControl} · Blind pick ·{' '}
            {state.ranked ? 'Elo-rated · ' : 'Casual · '}
            {seated}/4 seated
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-10 min-w-44" onClick={() => copy(inviteUrl)}>
            <CopiedLabel copied={copied} idle="Copy invite link" />
          </Button>
          <Button variant="ghost" className="h-10" onClick={leave} data-testid="leave-lobby">
            Leave
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] lg:gap-8">
        <section
          aria-label="Seats"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:grid-rows-3 sm:gap-4 lg:row-span-2"
        >
          {seatOrder.map(seatCard)}
          <div className="hidden items-center justify-center sm:col-start-2 sm:row-start-2 sm:flex">
            <MiniBoard seats={state.seats} />
          </div>
        </section>

        {me ? (
          <section className="rounded-2xl border border-parchment/10 bg-panel/85 p-5 max-sm:order-first">
            <h2 id={civLabelId} className="mb-1 font-display text-lg font-semibold">
              Your civilization
            </h2>
            <p className="mb-4 text-xs text-parchment/55">
              For now a civilization is your emblem; special abilities arrive in a later update.
            </p>
            <CivSelect
              value={me.civ}
              onChange={(civ) => send('setCiv', { civ: civ as never })}
              labelId={civLabelId}
            />
            {/* Phones: a bar fixed to the bottom of the screen; larger screens: in the card. */}
            <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-parchment/10 bg-ink/90 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:z-auto sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <Button
                className="h-11 flex-1"
                variant={me.ready ? 'secondary' : 'primary'}
                disabled={!me.civ}
                onClick={() => send('setReady', { ready: !me.ready })}
                data-testid="ready"
              >
                {me.ready ? 'Not ready' : me.civ ? 'Ready' : 'Choose a civilization'}
              </Button>
              {viewerIsHost ? (
                <div ref={startScope} className="flex flex-1 rounded-lg">
                  <Button
                    className="h-11 w-full whitespace-nowrap"
                    disabled={!canStart}
                    onClick={() => send('startGame', {})}
                    data-testid="start-game"
                  >
                    Start game
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="text-sm text-parchment/60">You are watching this lobby.</p>
        )}

        {viewerIsHost ? (
          <section className="self-start rounded-2xl border border-gold/30 bg-gold/5 p-5">
            <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold">
              <CrownIcon className="h-4 w-4 text-gold" /> You’re the host
            </h2>
            <p className="mb-4 text-xs text-parchment/60">
              {state.ranked
                ? 'Share the invite link with players who have accounts. Swap seats to set teams. Start when the list is complete.'
                : 'Invite friends or fill empty seats with bots. Swap seats to set teams. Start when the list is complete.'}
            </p>
            <ul className="flex flex-col gap-2" data-testid="start-checklist">
              <ChecklistRow done={seated === 4} label="Seats filled" value={`${seated}/4`} />
              <ChecklistRow
                done={seated === 4 && withCiv === 4}
                label="Civilizations chosen"
                value={`${withCiv}/${seated}`}
              />
              <ChecklistRow
                done={humans.length > 0 && humansReady === humans.length}
                label="Players ready"
                value={`${humansReady}/${humans.length}`}
              />
            </ul>
            {seated < 4 ? (
              <div className="mt-4 flex min-w-0 items-center gap-2 rounded-lg border border-parchment/15 bg-ink/50 p-1 pl-3">
                <input
                  readOnly
                  value={inviteUrl}
                  aria-label="Invite link"
                  className="min-w-0 flex-1 truncate bg-transparent text-xs text-parchment/70 outline-none"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center rounded-md bg-parchment/10 px-2.5 text-xs font-semibold text-parchment hover:bg-parchment/15"
                  onClick={() => copy(inviteUrl)}
                >
                  {copied ? <CheckIcon className="h-4 w-4 text-[#7fd8b7]" /> : 'Copy'}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {state.phase === 'countdown' ? (
        <Countdown endsAt={state.countdownEndsAt} state={state} />
      ) : null}
    </div>
  )
}

/** A small decorative board with the four seat colours on their home edges and their emblems. */
function MiniBoard({ seats }: { seats: readonly SeatStateJson[] }) {
  const cells = Array.from({ length: 144 }, (_, i) => i)
  // Emblem spots: South bottom, West left, North top, East right.
  const spots = [
    'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
    'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
    'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
    'right-0 top-1/2 translate-x-1/2 -translate-y-1/2',
  ]
  return (
    <div className="relative aspect-square w-full max-w-52 rounded-lg border border-parchment/15 p-2 shadow-2xl shadow-black/50">
      <div className="grid h-full w-full grid-cols-12 overflow-hidden rounded">
        {cells.map((i) => {
          const f = i % 12
          const r = Math.floor(i / 12)
          return (
            <span
              key={i}
              className={(f + r) % 2 === 0 ? 'bg-[#e4cfa3]' : 'bg-[#8b623d]'}
              aria-hidden="true"
            />
          )
        })}
      </div>
      <span
        className="absolute inset-x-6 bottom-0 h-1 rounded"
        style={{ background: seatHex(0) }}
      />
      <span className="absolute inset-y-6 left-0 w-1 rounded" style={{ background: seatHex(1) }} />
      <span className="absolute inset-x-6 top-0 h-1 rounded" style={{ background: seatHex(2) }} />
      <span className="absolute inset-y-6 right-0 w-1 rounded" style={{ background: seatHex(3) }} />
      {seats.map((s, i) =>
        s.occupied && s.civ ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: seats are fixed positions
            key={i}
            aria-hidden="true"
            className={`absolute flex h-8 w-8 items-center justify-center rounded-full border-2 bg-ink ${spots[i]}`}
            style={{ borderColor: seatHex(i), color: seatHex(i) }}
          >
            <CivEmblem civ={s.civ} className="h-5 w-5" />
          </span>
        ) : null,
      )}
    </div>
  )
}
