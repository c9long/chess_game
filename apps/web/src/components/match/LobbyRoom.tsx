import { BOT_LEVELS, civInfo } from '@game/config'
import type { MatchStateJson, SeatStateJson } from '@game/protocol/state'
import {
  Armchair,
  Check,
  Clock,
  Copy,
  Crown,
  Ellipsis,
  EyeOff,
  Globe,
  Info,
  Lock,
  Mail,
  Plus,
  Users,
} from 'lucide-react'
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { leaveMatch, type MatchRoom, matchApi } from '../../lib/match.ts'
import { usePrefs } from '../../lib/prefs.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { CIV_SELECT_CONTENT_ATTR, CivSelect } from '../CivSelect.tsx'
import { CivAbilityLine } from '../civ/CivAbilityLine.tsx'
import { CivCard } from '../civ/CivCard.tsx'
import { CivInfoOverlay, civInfoLabel } from '../civ/CivInfoOverlay.tsx'
import { LobbyInvite } from '../social/LobbyInvite.tsx'
import {
  Button,
  cx,
  inputClass,
  Nameplate,
  Panel,
  Pill,
  SEAT_CLASSES,
  SEAT_ORDER,
  SeatTable,
} from '../ui.tsx'
import { RankedBadge } from './RankedBadge.tsx'
import {
  botName,
  MODE_LABEL,
  SEAT_LABEL,
  seatHex,
  seatName,
  seatsAround,
  seatTextHex,
  teamLabel,
} from './seats.ts'

const LEVEL_LABELS = BOT_LEVELS.map(String)

/** Bot strength on a 1..5 scale (for the pip meter), from its place in BOT_LEVELS. */
function strengthPips(level: string): number {
  const i = LEVEL_LABELS.indexOf(level)
  if (i < 0) return 1
  return Math.max(1, Math.ceil(((i + 1) / LEVEL_LABELS.length) * 5))
}

const smallSelect = cx(inputClass, 'select h-9 min-w-0 px-2 text-ui')

/**
 * A seat's civ emblem on an enamel disc in the seat's colour. Decorative (nearby text names
 * the civ) unless `named`, which makes it an image named after the civ.
 */
export function SeatEmblem({
  index,
  civ,
  size = 'md',
  named = false,
}: {
  index: number
  civ: string
  size?: 'sm' | 'md' | 'lg'
  named?: boolean
}) {
  const color = seatHex(index)
  const box = { sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-11 w-11' }[size]
  const glyph = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' }[size]
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-full border', box)}
      style={{ borderColor: `${color}99`, backgroundColor: `${color}1f`, color }}
    >
      {civ ? (
        <CivEmblem civ={civ} className={glyph} {...(named ? {} : { title: '' })} />
      ) : (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      )}
    </span>
  )
}

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
  const menuButton =
    'h-9 rounded-control border border-rule-strong text-ui font-semibold text-parchment transition-colors duration-150 hover:border-destructive-light/60 hover:text-destructive-light'
  return (
    <details ref={ref} className="group relative">
      <summary
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-control text-faint transition-colors duration-150 hover:bg-parchment/[0.07] hover:text-parchment group-open:bg-parchment/[0.07] group-open:text-parchment [&::-webkit-details-marker]:hidden"
        aria-label={`Seat options (${SEAT_LABEL[seatName(index)]})`}
        title="Seat options"
      >
        <Ellipsis aria-hidden="true" className="h-4 w-4" />
      </summary>
      <div className="absolute top-9 right-0 z-30 flex w-60 flex-col gap-3 rounded-panel border border-rule-brass bg-panel p-3 shadow-lift">
        {seat.isBot ? (
          <div className="flex flex-col gap-1.5 text-ui text-muted">
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
        <label className="flex flex-col gap-1.5 text-ui text-muted">
          Move to seat
          <select
            className={smallSelect}
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
            className={menuButton}
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
            className={menuButton}
            onClick={() => {
              send('kick', { seat: s })
              close()
            }}
          >
            Remove player
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
      className="flex items-center gap-2 text-caption whitespace-nowrap text-faint"
      title={`Bot strength: ${level === 'max' ? 'maximum' : `Elo ${level}`}`}
    >
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((p) => (
          <span
            key={p}
            className={cx('h-1.5 w-2.5 rounded-full', p <= pips ? 'bg-brass' : 'bg-parchment/15')}
          />
        ))}
      </span>
      {level === 'max' ? 'Max strength' : `Elo ${level}`}
    </span>
  )
}

/**
 * The civ line on a seat plate, as a button that opens the civ's details (popover, or a bottom
 * sheet on phones). The hit area is 44px tall; negative margins keep the plate's layout.
 */
function SeatCivButton({ index, seat, civ }: { index: number; seat: SeatStateJson; civ: string }) {
  const who = seat.isBot ? botName(seat.botLevel) : seat.displayName
  return (
    <CivInfoOverlay
      civ={civ}
      kicker={{ seat: SEAT_LABEL[seatName(index)], who }}
      kickerColor={seatTextHex(index)}
      seatColor={seatTextHex(index)}
      side="bottom"
      trigger={
        <button
          type="button"
          aria-label={civInfoLabel(civ)}
          data-testid={`civ-info-${seatName(index)}`}
          // The visible box hugs the text (so its focus ring does too); an invisible layer
          // widens the hit area into the gaps around it without covering the name above or
          // the tags below.
          className="group/civinfo relative -mx-1 mt-0.5 flex w-fit max-w-[calc(100%+0.5rem)] min-w-0 flex-col items-start gap-0.5 rounded-plate px-1 py-0.5 text-left before:absolute before:-inset-x-1 before:-top-0.5 before:-bottom-2"
        >
          <span className="flex max-w-full min-w-0 items-center gap-1 text-ui text-muted group-hover/civinfo:text-parchment">
            <span className="truncate decoration-brass/60 underline-offset-2 group-hover/civinfo:underline group-focus-visible/civinfo:underline">
              {civName(civ)}
            </span>
            <Info
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-faint group-hover/civinfo:text-brass"
            />
          </span>
          <CivAbilityLine civ={civ} className="max-w-full" />
        </button>
      }
    />
  )
}

/**
 * One seat at the lobby table: a brass-edged plate with the seat's colour down its inner edge,
 * the player's name in Fraunces, their civ (a button that opens its card) and where they stand
 * (ready, guest, reconnecting). An open seat is a dashed outline with the host's bot controls.
 */
function LobbySeat({
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
  const reduce = useReducedMotion()
  const seatKey = SEAT_ORDER[index] ?? 'south'
  // Rematch lobby: an empty seat kept for a player who accepted, until they arrive.
  const heldFor = !seat.occupied && seat.heldFor ? seat.heldFor : ''
  const bodyKey = seat.occupied
    ? seat.isBot
      ? 'bot'
      : `p-${seat.displayName}`
    : heldFor
      ? `held-${heldFor}`
      : 'open'

  return (
    <article
      className={cx(
        'relative flex w-full max-w-[17rem] flex-col rounded-plate border py-3 pr-3 pl-4 transition-colors duration-200',
        seat.occupied
          ? 'border-rule-brass bg-surface-rail shadow-plate'
          : 'border-dashed border-rule-strong bg-black/10',
        me && 'border-brass/70',
      )}
      data-testid={`seat-${seatName(index)}`}
      data-seat={seatKey}
    >
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-y-0 left-0 w-1 rounded-l-plate',
          SEAT_CLASSES[seatKey].bg,
          !seat.occupied && 'opacity-35',
        )}
      />
      <header className="flex min-h-8 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-caption font-medium">
          <span className={SEAT_CLASSES[seatKey].text}>{SEAT_LABEL[seatName(index)]}</span>
          {mode === 'teams' ? <span className="text-faint">, {teamLabel(index % 2)}</span> : null}
        </span>
        {viewerIsHost && seat.occupied ? (
          <SeatMenu index={index} seat={seat} me={me} send={send} />
        ) : null}
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={bodyKey}
          className="flex flex-col"
          initial={reduce ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
          {seat.occupied ? (
            <>
              {/* Phones: the emblem above the name, so a narrow plate still shows the whole name. */}
              <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:gap-3">
                <SeatEmblem index={index} civ={seat.civ} size="lg" named />
                <div className="w-full min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="truncate font-display text-lead leading-snug font-semibold text-parchment"
                      data-testid="seat-name"
                    >
                      {seat.isBot ? botName(seat.botLevel) : seat.displayName}
                    </span>
                    {hostSeat === index ? (
                      <span className="shrink-0 text-brass" title="Host">
                        <Crown aria-hidden="true" className="h-4 w-4" />
                        <span className="sr-only">(host)</span>
                      </span>
                    ) : null}
                  </p>
                  {seat.civ ? (
                    <SeatCivButton index={index} seat={seat} civ={seat.civ} />
                  ) : (
                    <p className="mt-0.5 truncate text-ui text-faint">Choosing a civilization</p>
                  )}
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {me ? <Pill tone="brass">You</Pill> : null}
                {seat.isGuest ? <Pill>Guest</Pill> : null}
                {seat.isBot ? (
                  <StrengthMeter level={seat.botLevel} />
                ) : seat.ready ? (
                  <Pill tone="success">
                    <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
                    Ready
                  </Pill>
                ) : (
                  <Pill>Not ready</Pill>
                )}
                {!seat.isBot && !seat.connected ? <Pill tone="danger">Reconnecting</Pill> : null}
              </div>
            </>
          ) : heldFor ? (
            <HeldSeat name={heldFor} until={seat.heldUntil ?? 0} />
          ) : (
            <div className="flex flex-col gap-2.5">
              <div>
                <p className="font-display text-lead leading-snug font-semibold text-muted">
                  Open seat
                </p>
                <p className="flex items-center gap-2 text-ui text-faint">
                  <motion.span
                    aria-hidden="true"
                    className={cx('h-1.5 w-1.5 rounded-full', SEAT_CLASSES[seatKey].bg)}
                    animate={reduce ? { opacity: 0.8 } : { opacity: [0.35, 1, 0.35] }}
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
                    }
                  />
                  Waiting for a player
                </p>
              </div>
              {ranked ? (
                <p className="text-caption text-faint" data-testid="ranked-seat-hint">
                  Ranked seats wait for a player with an account. Bots can’t sit here.
                </p>
              ) : viewerIsHost ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`bot-level-${index}`}>
                    Bot strength
                  </label>
                  <select
                    id={`bot-level-${index}`}
                    className={cx(smallSelect, 'w-auto min-w-24 flex-1')}
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
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      send('addBot', { seat: index as 0 | 1 | 2 | 3, level: level as never })
                    }
                    data-testid="add-bot"
                  >
                    <Plus aria-hidden="true" />
                    Add bot
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </article>
  )
}

/** Seconds left until `until` (server ms; ticks once a second while counting). */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= 0) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/**
 * A rematch lobby's empty seat held for the player who accepted ("Saved for …"), until they
 * arrive or the hold runs out (the server then clears it and the seat opens up).
 */
function HeldSeat({ name, until }: { name: string; until: number }) {
  const left = useSecondsLeft(until)
  return (
    <div className="flex flex-col gap-1" data-testid="seat-held">
      <p className="min-w-0 text-ui text-muted [overflow-wrap:anywhere]">
        Saved for{' '}
        <span className="font-display text-lead font-semibold text-parchment">{name}</span>
      </p>
      <p className="text-caption text-faint">
        Rematch: their seat and civilization wait for them
        {left > 0 ? (
          <>
            {' '}
            for <span className="tabular-nums">{left}</span> s more
          </>
        ) : null}
        .
      </p>
    </div>
  )
}

/**
 * A small board on a walnut frame, turned to the viewer: each edge carries its seat's colour,
 * with the seat's civ emblem once chosen. `children` sits over the middle of the board (a
 * countdown); `quiet` dims the squares so that text reads over them.
 */
export function TableBoard({
  seats,
  viewer,
  className,
  quiet = false,
  emblems = true,
  children,
}: {
  seats: readonly { readonly occupied: boolean; readonly civ: string }[]
  viewer: number
  className?: string
  quiet?: boolean
  /** Show each seat's civ emblem on its edge (off for a thumbnail-sized board). */
  emblems?: boolean
  children?: ReactNode
}) {
  const at = seatsAround(viewer)
  const sides = [
    {
      i: at.bottom,
      bar: 'inset-x-[18%] bottom-0 h-1',
      spot: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
    },
    {
      i: at.left,
      bar: 'inset-y-[18%] left-0 w-1',
      spot: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
    },
    {
      i: at.top,
      bar: 'inset-x-[18%] top-0 h-1',
      spot: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
    },
    {
      i: at.right,
      bar: 'inset-y-[18%] right-0 w-1',
      spot: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2',
    },
  ]
  return (
    <div
      aria-hidden={children ? undefined : true}
      className={cx(
        'relative aspect-square rounded-panel bg-walnut p-[6%] shadow-lift ring-1 ring-brass/30',
        className,
      )}
    >
      <div
        className={cx(
          'relative h-full w-full overflow-hidden rounded-plate ring-1 ring-black/50',
          quiet && 'opacity-30',
        )}
        style={{
          background:
            'repeating-conic-gradient(var(--color-board-light) 0 25%, var(--color-board-dark) 0 50%) 0 0 / calc(100% / 8) calc(100% / 8)',
        }}
      />
      {sides.map(({ i, bar }) => (
        <span
          key={`bar-${i}`}
          aria-hidden="true"
          className={cx('absolute rounded-full', bar)}
          style={{ background: seatHex(i) }}
        />
      ))}
      {sides.map(({ i, spot }) => {
        const s = seats[i]
        return emblems && s?.occupied && s.civ ? (
          <span key={`civ-${i}`} aria-hidden="true" className={cx('absolute', spot)}>
            <span
              className="grid h-8 w-8 place-items-center rounded-full bg-baize-deep"
              style={{ boxShadow: `0 0 0 2px ${seatHex(i)}`, color: seatHex(i) }}
            >
              <CivEmblem civ={s.civ} className="h-5 w-5" title="" />
            </span>
          </span>
        ) : null
      })}
      {children ? <div className="absolute inset-0 grid place-items-center">{children}</div> : null}
    </div>
  )
}

/** The name on a seat's plate in a line-up: the player, a bot, "You" or an open seat. */
function lineupName(seat: SeatStateJson, i: number, viewer: number, youLabel: boolean): string {
  if (seat.isBot) return botName(seat.botLevel)
  if (!seat.occupied) return 'Open seat'
  return youLabel && i === viewer ? 'You' : seat.displayName
}

/**
 * The four seats as nameplates around a centre (the countdown, a board), turned so the
 * viewer's seat is at the bottom. `youLabel` names the viewer's plate "You".
 */
export function LineupTable({
  state,
  viewer,
  children,
  testId,
  youLabel = false,
  stackBelow = 'sm',
  plateClass = 'w-52',
}: {
  state: MatchStateJson
  viewer: number
  children: ReactNode
  testId?: string
  youLabel?: boolean
  stackBelow?: 'sm' | 'md' | 'lg' | 'never'
  plateClass?: string
}) {
  const at = seatsAround(viewer)
  const plate = (i: number) => {
    const seat = state.seats[i]
    if (!seat) return null
    return (
      <Nameplate
        seat={i}
        name={lineupName(seat, i, viewer, youLabel)}
        detail={
          seat.civ
            ? civName(seat.civ)
            : seat.occupied
              ? 'Choosing a civilization'
              : SEAT_LABEL[seatName(i)]
        }
        emblem={<SeatEmblem index={i} civ={seat.civ} size="md" />}
        className={cx('max-w-full', plateClass, !seat.occupied && 'border-dashed')}
        data-testid={testId ? `${testId}-${seatName(i)}` : undefined}
      />
    )
  }
  return (
    <SeatTable
      stackBelow={stackBelow}
      north={plate(at.top)}
      west={plate(at.left)}
      east={plate(at.right)}
      south={plate(at.bottom)}
      data-testid={testId}
      role="group"
      aria-label="Seats"
    >
      {children}
    </SeatTable>
  )
}

/** The start countdown's number in a ring that fills once a second in turn-order colours. */
export function CountdownRing({
  secs,
  reduce,
  size = 'lg',
}: {
  secs: number
  reduce: boolean
  size?: 'md' | 'lg'
}) {
  return (
    <div
      className={cx(
        'relative flex items-center justify-center rounded-full bg-baize-deep/90 shadow-well',
        size === 'lg' ? 'h-32 w-32' : 'h-24 w-24',
      )}
    >
      {reduce ? null : (
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="rgb(244 239 230 / 0.1)"
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
          className={cx(
            'font-display leading-none font-semibold tabular-nums',
            size === 'lg' ? 'text-7xl' : 'text-5xl',
          )}
          initial={reduce ? false : { scale: 1.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {secs}
        </motion.p>
      </div>
    </div>
  )
}

/** Seconds left on a countdown to `endsAt` (at least 1), ticking ten times a second. */
export function useCountdownSecs(endsAt: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  return Math.max(1, Math.ceil((endsAt - now) / 1000))
}

export function Countdown({
  endsAt,
  state,
  viewer = -1,
}: {
  endsAt: number
  state: MatchStateJson
  viewer?: number
}) {
  const systemReduced = useReducedMotion()
  const reduce = Boolean(systemReduced) || usePrefs.getState().reducedMotion
  const secs = useCountdownSecs(endsAt)
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-baize-deep/90 px-4 pt-[calc(2rem+var(--safe-top))] pb-[calc(2rem+var(--safe-bottom))] backdrop-blur-sm">
      <div className="flex w-full max-w-3xl flex-col items-center">
        <h2 className="mb-6 font-display text-heading font-semibold">The game is starting</h2>
        <LineupTable state={state} viewer={viewer} plateClass="w-full sm:w-56">
          <div className="flex justify-center sm:px-4">
            <CountdownRing secs={secs} reduce={reduce} />
          </div>
        </LineupTable>
      </div>
    </div>
  )
}

function ChecklistRow({ done, label, value }: { done: boolean; label: string; value: string }) {
  return (
    <li className="flex min-h-10 items-center gap-3 py-2 text-ui">
      <span
        className={cx(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
          done ? 'border-ok/60 bg-ok/15 text-ok' : 'border-rule-strong text-transparent',
        )}
        aria-hidden="true"
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span className={done ? 'text-parchment' : 'text-muted'}>{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-muted">{value}</span>
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
          className="inline-flex items-center gap-2 text-ok"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <Check aria-hidden="true" className="h-4 w-4" /> Link copied
        </motion.span>
      ) : (
        <motion.span
          key="idle"
          className="inline-flex items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <Copy aria-hidden="true" className="h-4 w-4" /> {idle}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/** One fact about the lobby in the header (mode, clock, pick), with a small icon. */
function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0 [&>svg]:text-faint">
      {icon}
      <span>{children}</span>
    </li>
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

  // Start becomes available: one brief ring so the host notices (the screen's one flourish).
  const couldStart = useRef(canStart)
  useEffect(() => {
    const now = canStart && !couldStart.current
    couldStart.current = canStart
    if (!now || reduce || !startScope.current) return
    animateStart(
      startScope.current,
      {
        boxShadow: [
          '0 0 0 0px rgba(212,160,23,0.5)',
          '0 0 0 7px rgba(212,160,23,0.18)',
          '0 0 0 12px rgba(212,160,23,0)',
        ],
      },
      { duration: 1.1, ease: 'easeOut' },
    )
  }, [canStart, reduce, animateStart, startScope])

  async function leave() {
    navigate('/play')
    await leaveMatch()
  }

  // Seats around the table, turned so the viewer sits at the bottom (as the board will be).
  const at = seatsAround(mySeat)
  const seatPlate = (i: number) => {
    const seat = state.seats[i]
    if (!seat) return null
    return (
      <LobbySeat
        index={i}
        seat={seat}
        me={i === mySeat}
        viewerIsHost={viewerIsHost}
        hostSeat={state.hostSeat}
        mode={state.mode}
        ranked={state.ranked}
        send={send}
      />
    )
  }

  const kind = state.inviteOnly
    ? { icon: <Mail aria-hidden="true" />, text: 'Friends challenge' }
    : state.hasPassword
      ? { icon: <Lock aria-hidden="true" />, text: 'Private lobby' }
      : { icon: <Globe aria-hidden="true" />, text: 'Public lobby' }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:pt-10 sm:pb-12">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="line-clamp-2 font-display text-title font-semibold text-balance [overflow-wrap:anywhere]">
            {state.name}
          </h1>
          <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ui text-muted">
            <Fact icon={kind.icon}>{kind.text}</Fact>
            <Fact icon={<Users aria-hidden="true" />}>{MODE_LABEL[state.mode]}</Fact>
            <Fact icon={<Clock aria-hidden="true" />}>
              <span className="tabular-nums">{state.timeControl}</span>
            </Fact>
            <Fact icon={<EyeOff aria-hidden="true" />}>Blind pick</Fact>
            <Fact icon={<Armchair aria-hidden="true" />}>
              <span className="tabular-nums">{seated}</span> of 4 seated
            </Fact>
            <li>{state.ranked ? <RankedBadge /> : <Pill>Casual</Pill>}</li>
          </ul>
          {state.inviteOnly ? (
            <p className="mt-2 max-w-[65ch] text-ui text-faint" data-testid="invite-only-note">
              Invite-only: just the friends who were challenged can join. Fill empty seats with
              bots.
            </p>
          ) : null}
          {state.inviteOnly && viewerIsHost ? <LobbyInvite roomId={room.roomId} /> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {state.inviteOnly ? null : (
            <Button variant="secondary" className="min-w-48" onClick={() => copy(inviteUrl)}>
              <CopiedLabel copied={copied} idle="Copy invite link" />
            </Button>
          )}
          <Button variant="quiet" onClick={leave} data-testid="leave-lobby">
            Leave
          </Button>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-5">
        <section aria-label="Seats" className="min-w-0 lg:row-span-2">
          <SeatTable
            stackBelow="md"
            className="gap-4 md:gap-5"
            north={seatPlate(at.top)}
            west={seatPlate(at.left)}
            east={seatPlate(at.right)}
            south={seatPlate(at.bottom)}
          >
            <div className="flex justify-center py-2 md:px-1 md:py-0">
              <TableBoard
                seats={state.seats}
                viewer={mySeat}
                className="w-[clamp(9rem,18vw,15rem)]"
              />
            </div>
          </SeatTable>
        </section>

        <div className="min-w-0 max-md:order-first lg:col-start-2 lg:row-start-1">
          {me ? (
            <Panel title="Your civilization" titleId={civLabelId}>
              <CivSelect
                value={me.civ}
                onChange={(civ) => send('setCiv', { civ: civ as never })}
                labelId={civLabelId}
                attached={civInfo(me.civ) !== null}
              />
              {me.civ ? (
                <CivCard
                  civ={me.civ}
                  variant="attached"
                  fold="all"
                  seatColor={seatTextHex(mySeat)}
                />
              ) : null}
              {/* Phones: a bar fixed to the bottom of the screen; larger screens: in the panel. */}
              <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-rule-brass bg-surface-rail/95 px-4 pt-2.5 pb-[max(0.625rem,var(--safe-bottom))] backdrop-blur sm:static sm:z-auto sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                <Button
                  className="flex-1"
                  variant={me.ready ? 'secondary' : 'primary'}
                  disabled={!me.civ}
                  onClick={() => send('setReady', { ready: !me.ready })}
                  data-testid="ready"
                >
                  {me.ready ? 'Not ready' : 'Ready'}
                </Button>
                {viewerIsHost ? (
                  <div ref={startScope} className="flex flex-1 rounded-control">
                    <Button
                      className="w-full"
                      disabled={!canStart}
                      onClick={() => send('startGame', {})}
                      data-testid="start-game"
                    >
                      Start game
                    </Button>
                  </div>
                ) : null}
              </div>
              <p className="mt-3 hidden text-caption text-faint sm:block" aria-live="polite">
                {!me.civ
                  ? 'Choose a civilization, then get ready.'
                  : me.ready && !viewerIsHost
                    ? 'You’re ready. The host starts the game once every seat is ready.'
                    : null}
              </p>
            </Panel>
          ) : (
            <Panel tone="plain">
              <p className="text-ui text-muted">You are watching this lobby.</p>
            </Panel>
          )}
        </div>

        {viewerIsHost ? (
          <div className="min-w-0 self-start lg:col-start-2 lg:row-start-2">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Crown aria-hidden="true" className="h-4 w-4 text-brass" />
                  You’re the host
                </span>
              }
            >
              <p className="text-ui text-muted">
                {state.inviteOnly
                  ? 'Your challenged friends can join while the invitation is open. Fill empty seats with bots, swap seats to set teams, and start when every box is ticked.'
                  : state.ranked
                    ? 'Share the invite link with players who have accounts. Swap seats to set teams, and start when every box is ticked.'
                    : 'Invite friends or fill empty seats with bots. Swap seats to set teams, and start when every box is ticked.'}
              </p>
              <ul
                className="mt-3 divide-y divide-rule border-y border-rule"
                data-testid="start-checklist"
              >
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
              {seated < 4 && !state.inviteOnly ? (
                <div className="mt-4 flex min-w-0 items-center gap-2 rounded-control border border-rule-strong bg-black/20 p-1 pl-3 shadow-well has-[input:focus-visible]:border-gold has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-gold">
                  <input
                    readOnly
                    value={inviteUrl}
                    aria-label="Invite link"
                    className="min-w-0 flex-1 truncate bg-transparent text-caption text-muted outline-none"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="quiet"
                    size="sm"
                    className="shrink-0"
                    onClick={() => copy(inviteUrl)}
                  >
                    {copied ? <Check aria-hidden="true" className="text-ok" /> : null}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              ) : null}
            </Panel>
          </div>
        ) : null}
      </div>

      {state.phase === 'countdown' ? (
        <Countdown endsAt={state.countdownEndsAt} state={state} viewer={mySeat} />
      ) : null}
    </div>
  )
}
