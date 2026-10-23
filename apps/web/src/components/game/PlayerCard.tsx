import { civInfo } from '@game/config'
import type { ClockSync } from '@game/protocol'
import type { SeatStateJson } from '@game/protocol/state'
import { AnimatePresence, motion } from 'motion/react'
import { memo, type ReactNode } from 'react'
import { formatClock, useClocks } from '../../lib/clock.ts'
import type { SeatMaterial } from '../../lib/material.ts'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { CivAbilityLine } from '../civ/CivAbilityLine.tsx'
import { CivInfoOverlay, civInfoLabel } from '../civ/CivInfoOverlay.tsx'
import { AbilityStar } from '../civ/marks.tsx'
import {
  DEFEAT_REASON_LABEL,
  ordinal,
  SEAT_LABEL,
  STATUS_LABEL,
  seatName,
} from '../match/labels.ts'
import { botName, seatTextHex } from '../match/seats.ts'
import { cx, SEAT_CLASSES } from '../ui.tsx'
import { MaterialLost } from './MaterialLost.tsx'
import { Medal } from './Medal.tsx'

/**
 * How sentences name a seat (the turn banner's screen-reader text, toasts, the move log): a
 * player's name, or a bot by its civilization ("China bot"), since three bots of one strength
 * share a plate name.
 */
export function seatTitle(seat: SeatStateJson): string {
  if (seat.isBot) return `${civName(seat.civ)} bot`
  return seat.displayName
}

/**
 * The name engraved on a seat's plate, the same in the lobby, the game, the result and the
 * replay: a player's name, or the bot by its strength ("Bot 1500"). The civ is the detail.
 */
export function plateName(seat: SeatStateJson): string {
  return seat.isBot ? botName(seat.botLevel) : seat.displayName
}

/** Which edge of the board a plate sits on (its seat colour runs along the board-facing side). */
export type PlateEdge = 'top' | 'bottom' | 'left' | 'right'

type StatusTone = 'resigned' | 'frozen' | 'out' | 'warn' | 'check' | 'won'

const STATUS_TONE: Record<StatusTone, string> = {
  resigned: 'border-destructive-light/40 text-destructive-light',
  frozen: 'border-[#9cc9e6]/40 text-[#9cc9e6]',
  out: 'border-rule-strong text-muted',
  warn: 'border-warn/45 text-warn',
  check: 'border-danger bg-danger text-ink',
  won: 'border-gold/55 text-gold',
}

function seatStatus(
  seat: SeatStateJson,
  defeatReason: string | null,
  inGame: boolean,
  inCheck: boolean,
  won: boolean,
): { text: string; tone: StatusTone } | null {
  if (won) return { text: 'Winner', tone: 'won' }
  // A resignation replaces the generic status (it says more, and the line stays short).
  // "(frozen)" only while the game goes on: once it is over the losing team's pieces have
  // left the board (a Teams resignation), so there is nothing frozen in place to point at.
  if (defeatReason === 'resign') {
    const resigned = DEFEAT_REASON_LABEL.resign ?? 'Resigned'
    return seat.status === 'frozen' && inGame
      ? { text: `${resigned} (frozen)`, tone: 'resigned' }
      : { text: resigned, tone: 'resigned' }
  }
  if (seat.status && seat.status !== 'active') {
    return {
      text: STATUS_LABEL[seat.status] ?? seat.status,
      tone: seat.status === 'frozen' ? 'frozen' : 'out',
    }
  }
  if (!seat.isBot && !seat.connected) return { text: 'Reconnecting', tone: 'warn' }
  if (inCheck) return { text: 'In check', tone: 'check' }
  return null
}

/**
 * A seat's clock. It is its own component so the 100 ms ticks re-render only this span, not
 * the plate or the rest of the game screen. Tabular figures and a minimum width, so the plate
 * doesn't shift as the text goes from "10:00" to "9:59" and on to "0:19.9".
 */
function SeatClock({
  sync,
  index,
  out,
  inGame,
  toMove,
  reduceMotion,
  size,
  block,
}: {
  sync: ClockSync | null
  index: number
  out: boolean
  inGame: boolean
  toMove: boolean
  reduceMotion: boolean
  size: 'compact' | 'full'
  /** Full width (the upright plates beside the board). */
  block: boolean
}) {
  const remainingMs = useClocks(sync, index)[index] ?? 0
  const low = remainingMs < 20_000 && !out && inGame
  const pulse = low && toMove && !reduceMotion
  return (
    <motion.span
      className={cx(
        // No colour transition: the turn passes every few hundred ms against bots, and a
        // half-faded swap leaves the figures unreadable.
        'shrink-0 rounded-control text-center font-semibold tabular-nums',
        size === 'compact'
          ? 'min-w-[calc(5ch+0.5rem)] px-1 text-caption leading-5'
          : 'min-w-[calc(6ch+1rem)] px-2 text-lead leading-8',
        block && 'w-full',
        toMove ? 'bg-parchment text-ink' : 'bg-black/25 text-parchment/85 shadow-well',
        out && 'text-faint',
        low && !toMove && '!text-destructive-light',
        low && toMove && '!bg-destructive !text-parchment',
      )}
      animate={pulse ? { opacity: [1, 0.6, 1] } : { opacity: 1 }}
      transition={
        pulse
          ? { duration: 1, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
          : { duration: 0.2 }
      }
      data-testid="clock"
    >
      {out ? '—' : formatClock(remainingMs)}
    </motion.span>
  )
}

const EDGE_BAR: Record<PlateEdge, string> = {
  top: 'inset-x-0 top-0 h-[3px]',
  bottom: 'inset-x-0 bottom-0 h-[3px]',
  left: 'inset-y-0 left-0 w-[3px]',
  right: 'inset-y-0 right-0 w-[3px]',
}

/**
 * One player's nameplate at the board's edge: a brass-edged plate with the seat colour along
 * the side that faces the board, the civ's enamel medallion (it opens the civ's details), the
 * name engraved in Fraunces, a detail line (civ or bot strength, status, pieces lost) and the
 * clock. `shape` is `row` above and below the board and `column` for the upright plates beside
 * it; `size` is `compact` on phones. `toMove` lights the plate gold, `inCheck` (the viewer's
 * own plate only) in the check colour, and a seat that is out is struck through and dimmed.
 */
export const PlayerPlate = memo(function PlayerPlate({
  index,
  seat,
  me,
  toMove,
  inGame,
  timed,
  clock,
  defeatReason,
  material,
  reduceMotion,
  friendAction,
  inCheck = false,
  won = false,
  place = null,
  partner = false,
  edge,
  shape = 'row',
  size = 'full',
  popoverSide = 'bottom',
  className,
}: {
  index: number
  seat: SeatStateJson
  me: boolean
  toMove: boolean
  inGame: boolean
  /** False in untimed games (no clock shown). */
  timed: boolean
  /** The server's clock sync (the clock counts down from it). */
  clock: ClockSync | null
  /** How the seat was knocked out (rules defeat reason), if it was. */
  defeatReason: string | null
  /** Pieces lost so far (null while unknown, or when the army was removed). */
  material: SeatMaterial | null
  reduceMotion: boolean
  /** "Add friend" and the player menu for another registered player, if any. */
  friendAction?: ReactNode
  /** The viewer's leader is in check (their own plate only). */
  inCheck?: boolean
  /** The game is over and this seat won it (alone: not a shared first place). */
  won?: boolean
  /** The seat's final placing, once the game is over (shown as a medal in the clock's place). */
  place?: number | null
  /** Teams: the viewer's partner (the seat opposite). */
  partner?: boolean
  edge: PlateEdge
  shape?: 'row' | 'column'
  size?: 'compact' | 'full'
  /** Where the civ details open on wide screens (towards the board). */
  popoverSide?: 'top' | 'bottom' | 'left'
  /** Placement classes from the layout (grid area, alignment). */
  className?: string | undefined
}) {
  const name = seatName(index)
  const out = seat.status === 'removed' || seat.status === 'frozen'
  const status = seatStatus(seat, defeatReason, inGame, inCheck && !out, won && !out)
  const armyRemoved = seat.status === 'removed'
  const hasAbility = (civInfo(seat.civ)?.abilities.length ?? 0) > 0
  const compact = size === 'compact'
  const column = shape === 'column'
  const seatClasses = SEAT_CLASSES[name]
  const title = plateName(seat)
  const detail = civName(seat.civ)
  const medal = place ? <Medal place={place} size="sm" label={ordinal(place)} /> : null
  // Phones: the mark gives way (truncates) before the clock or the menu would be pushed out.
  const partnerMark = partner ? (
    <span
      className={cx(
        'rounded-full border border-brass/50 px-1.5 text-caption leading-4 font-semibold text-brass',
        compact ? 'min-w-0 truncate' : 'shrink-0',
      )}
    >
      Partner
    </span>
  ) : null

  const medallion = (
    <CivInfoOverlay
      civ={seat.civ}
      kicker={{
        seat: SEAT_LABEL[name],
        who: title,
      }}
      kickerColor={seatTextHex(index)}
      seatColor={seatTextHex(index)}
      side={popoverSide}
      trigger={
        // The medallion opens the civ's details; an invisible 44px hit area around the disc.
        <button
          type="button"
          aria-label={civInfoLabel(seat.civ)}
          data-testid={`civ-info-${name}`}
          className={cx(
            'relative flex shrink-0 items-center justify-center rounded-full border border-brass/45 bg-black/20 shadow-plate transition-[filter,opacity] duration-300 before:absolute before:rounded-full hover:border-brass/80',
            compact
              ? 'h-7 w-7 before:-inset-2'
              : column
                ? 'h-10 w-10 before:-inset-1'
                : 'h-9 w-9 before:-inset-1',
            seatClasses.text,
            out && 'opacity-50 grayscale',
          )}
        >
          <CivEmblem
            civ={seat.civ}
            title=""
            className={compact ? 'h-[18px] w-[18px]' : column ? 'h-6 w-6' : 'h-[22px] w-[22px]'}
          />
          {hasAbility ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -bottom-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-baize-deep ring-1 ring-brass/70"
            >
              <AbilityStar className="h-2 w-2 fill-brass" />
            </span>
          ) : null}
        </button>
      }
    />
  )

  const nameLine = (
    <p
      className={cx(
        'flex min-w-0 items-baseline gap-1 leading-tight',
        column && 'w-full justify-center',
      )}
    >
      <span className="sr-only">{SEAT_LABEL[name]}: </span>
      <span
        data-name
        title={title}
        className={cx(
          'min-w-0 truncate font-display font-semibold text-parchment transition-colors duration-300',
          compact ? 'text-ui' : 'text-[0.9375rem]',
          out && 'text-parchment/70 line-through decoration-parchment/50 decoration-1',
        )}
      >
        {title}
      </span>
      {/* Phones keep the name's room: the plate at the bottom left is always yours. */}
      {me ? (
        <span className={compact ? 'sr-only' : 'shrink-0 text-caption text-faint'}>(you)</span>
      ) : null}
    </p>
  )

  const statusChip = (
    <AnimatePresence initial={false}>
      {status ? (
        <motion.span
          key={status.text}
          initial={reduceMotion ? false : { opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cx(
            'shrink-0 truncate rounded-full border px-1.5 text-caption leading-4 font-semibold',
            STATUS_TONE[status.tone],
          )}
          data-testid={`status-${name}`}
        >
          {status.text}
        </motion.span>
      ) : null}
    </AnimatePresence>
  )

  const lost = armyRemoved ? (
    compact ? null : (
      <span className="shrink-0 truncate text-caption text-faint">Army removed</span>
    )
  ) : material ? (
    <MaterialLost material={material} color={seatTextHex(index)} compact={compact} />
  ) : null

  // Untimed games have no clock: the plate says whose turn it is instead.
  const turnNote =
    !timed && toMove ? (
      <span className="shrink-0 text-caption font-semibold text-gold">
        {seat.isBot ? 'Thinking' : 'To move'}
      </span>
    ) : null

  const plateState =
    inCheck && !out
      ? 'border-danger shadow-[0_0_0_1px_rgb(255_90_31/0.45)]'
      : toMove || (won && !out)
        ? 'border-gold/85 shadow-[0_0_0_1px_rgb(212_160_23/0.4)]'
        : out
          ? 'border-rule'
          : 'border-rule-brass'

  const shared = cx(
    'relative isolate min-w-0 overflow-hidden rounded-plate border bg-surface-rail shadow-plate transition-[border-color,box-shadow] duration-200',
    plateState,
    className,
  )
  const bar = (
    <span
      aria-hidden="true"
      className={cx(
        'absolute transition-opacity duration-300',
        EDGE_BAR[edge],
        seatClasses.bg,
        out && 'opacity-35',
      )}
    />
  )

  // Once the game is over each plate shows its placing where the clock was.
  const clockSlot = medal ? (
    <span className="flex shrink-0 items-center" data-testid={`place-${name}`}>
      {medal}
    </span>
  ) : timed ? (
    <SeatClock
      sync={clock}
      index={index}
      out={out}
      inGame={inGame}
      toMove={toMove}
      reduceMotion={reduceMotion}
      size={compact ? 'compact' : 'full'}
      block={column}
    />
  ) : (
    turnNote
  )

  if (column) {
    // Every row is reserved (ability, status, clock), so the two side plates keep one height
    // and nothing jumps as the turn passes or a status comes and goes.
    return (
      <li
        className={cx(
          shared,
          'flex w-full flex-col items-center gap-1.5 px-2.5 pt-3 pb-2.5 text-center',
          timed ? 'min-h-[12.5rem]' : 'min-h-[10.5rem]',
        )}
        data-testid={`player-${name}`}
        data-to-move={toMove || undefined}
        data-seat={name}
      >
        {bar}
        {friendAction ? (
          <div className="absolute top-1 right-1 flex justify-center">{friendAction}</div>
        ) : null}
        {medallion}
        <div className="flex w-full min-w-0 flex-col items-center gap-0.5">
          {nameLine}
          <p className="w-full truncate text-caption text-faint">{detail}</p>
          <span className="flex h-4 max-w-full justify-center">
            {hasAbility ? <CivAbilityLine civ={seat.civ} className="max-w-full" /> : null}
          </span>
        </div>
        <div className="flex h-5 max-w-full min-w-0 flex-wrap items-center justify-center gap-1.5 overflow-hidden">
          {partnerMark}
          {statusChip}
          {lost}
        </div>
        <div className="mt-auto flex min-h-8 w-full items-center justify-center">{clockSlot}</div>
      </li>
    )
  }

  if (compact) {
    // Phones: the name has the whole first line; the civ, status and clock share the second.
    return (
      <li
        className={cx(shared, 'flex min-h-12 w-full items-center gap-2 py-1 pr-1.5 pl-2')}
        data-testid={`player-${name}`}
        data-to-move={toMove || undefined}
        data-seat={name}
      >
        {bar}
        {medallion}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          {nameLine}
          <div className="flex h-5 min-w-0 items-center gap-1.5 text-caption leading-4 text-faint">
            {statusChip}
            {status || armyRemoved ? null : partnerMark}
            {/* The civ gives way first when the line is short. */}
            {status || armyRemoved || partner ? null : (
              <span className="min-w-0 truncate">{detail}</span>
            )}
            {lost}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {friendAction ? (
                <span className="-my-1 flex items-center">{friendAction}</span>
              ) : null}
              {clockSlot}
            </span>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li
      className={cx(shared, 'flex h-12 w-full items-center gap-2.5 pr-2 pl-2.5')}
      data-testid={`player-${name}`}
      data-to-move={toMove || undefined}
      data-seat={name}
    >
      {bar}
      {medallion}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        {nameLine}
        <div className="flex h-4 min-w-0 items-center gap-1.5 text-caption leading-4 text-faint">
          {statusChip}
          {partnerMark}
          {armyRemoved ? null : <span className="min-w-0 truncate">{detail}</span>}
          {hasAbility && !status && !partner ? (
            <span className="flex max-w-[45%] min-w-0">
              <CivAbilityLine civ={seat.civ} className="max-w-full" />
            </span>
          ) : null}
          {lost}
          {friendAction ? (
            <span className="-my-1 ml-auto flex shrink-0 items-center pl-0.5">{friendAction}</span>
          ) : null}
        </div>
      </div>
      {clockSlot}
    </li>
  )
})
