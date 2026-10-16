import type { ClockSync } from '@game/protocol'
import type { SeatStateJson } from '@game/protocol/state'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { formatClock, useClocks } from '../../lib/clock.ts'
import type { SeatMaterial } from '../../lib/material.ts'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { DEFEAT_REASON_LABEL, SEAT_LABEL, STATUS_LABEL, seatName } from '../match/labels.ts'
import { MaterialLost } from './MaterialLost.tsx'

/** Bot strength as shown on chips: "1500" or "Max". */
export function botLevelText(level: string): string {
  return level === 'max' ? 'Max' : level
}

/** The name a seat goes by on the game screen: a player's name, or a bot's civilization. */
export function seatTitle(seat: SeatStateJson): string {
  if (seat.isBot) return `${civName(seat.civ)} bot`
  return seat.displayName
}

type StatusTone = 'resigned' | 'frozen' | 'out' | 'warn'

const STATUS_TONE: Record<StatusTone, string> = {
  resigned: 'border-seat-south-light/35 bg-seat-south/15 text-seat-south-light',
  frozen: 'border-[#9cc9e6]/35 bg-[#9cc9e6]/12 text-[#9cc9e6]',
  out: 'border-parchment/20 bg-parchment/[0.06] text-parchment/75',
  warn: 'border-seat-north/40 bg-seat-north/10 text-gold',
}

function seatStatus(
  seat: SeatStateJson,
  defeatReason: string | null,
): { text: string; tone: StatusTone } | null {
  // A resignation replaces the generic status (it says more, and the line stays short).
  if (defeatReason === 'resign') {
    const resigned = DEFEAT_REASON_LABEL.resign ?? 'Resigned'
    return seat.status === 'frozen'
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
  return null
}

/**
 * A seat's clock. It is its own component so the 100 ms ticks re-render only this span, not
 * the player row or the rest of the game screen. A minimum width, so the row doesn't shift as
 * the text goes from "10:00" to "9:59" (and, in the roomy desktop rows, to "0:19.9"; the
 * compact chips keep that room for the name).
 */
function SeatClock({
  sync,
  index,
  out,
  inGame,
  toMove,
  reduceMotion,
}: {
  sync: ClockSync | null
  index: number
  out: boolean
  inGame: boolean
  toMove: boolean
  reduceMotion: boolean
}) {
  const remainingMs = useClocks(sync, index)[index] ?? 0
  const low = remainingMs < 20_000 && !out && inGame
  return (
    <motion.span
      className={`min-w-[calc(5ch+0.5rem)] shrink-0 justify-self-end rounded px-1 text-center font-mono text-sm leading-[18px] tabular-nums lg:min-w-[calc(6ch+1.25rem)] lg:rounded-lg lg:px-2.5 lg:py-1 lg:text-base lg:leading-normal ${
        toMove ? 'bg-parchment text-ink' : 'text-parchment/80 lg:bg-ink/60'
      } ${low && !toMove ? '!text-seat-south-light' : ''} ${
        low && toMove ? '!bg-seat-south !text-parchment' : ''
      }`}
      animate={low && toMove && !reduceMotion ? { opacity: [1, 0.6, 1] } : { opacity: 1 }}
      transition={
        low && toMove && !reduceMotion
          ? { duration: 1, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
          : { duration: 0.2 }
      }
      data-testid="clock"
    >
      {out ? '—' : formatClock(remainingMs)}
    </motion.span>
  )
}

/**
 * One player on the game screen. Below 1024px it is a compact chip (seat-colour bar on top,
 * emblem, name, clock) for the strip under the board; from 1024px a full row in the side panel
 * (seat-colour bar on the left, civ and seat, pieces lost).
 */
export const PlayerCard = memo(function PlayerCard({
  index,
  seat,
  me,
  color,
  toMove,
  inGame,
  timed,
  clock,
  defeatReason,
  material,
  reduceMotion,
}: {
  index: number
  seat: SeatStateJson
  me: boolean
  color: string
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
}) {
  const name = seatName(index)
  const out = seat.status === 'removed' || seat.status === 'frozen'
  const status = seatStatus(seat, defeatReason)
  const armyRemoved = seat.status === 'removed'

  return (
    <li
      className={`relative isolate grid h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] content-center items-center gap-x-2 gap-y-0.5 overflow-hidden rounded-xl border border-parchment/[0.07] bg-panel/80 pt-[3px] pr-2 pl-2 lg:flex lg:h-[76px] lg:gap-3 lg:border-transparent lg:bg-transparent lg:pt-0 lg:pr-3 lg:pl-4`}
      data-testid={`player-${name}`}
      data-to-move={toMove || undefined}
    >
      {toMove ? (
        <motion.span
          layoutId="turn-ring"
          // Measure only when the turn moves, not on every re-render of the row.
          layoutDependency={toMove}
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-xl border-2"
          style={{ borderColor: `${color}cc`, backgroundColor: `${color}1f` }}
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
        />
      ) : null}
      {/* Seat colour: a bar on top of a chip, on the left of a row. */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-[3px] transition-opacity duration-300 lg:inset-x-auto lg:top-3 lg:bottom-3 lg:left-1 lg:h-auto lg:w-[3px] lg:rounded-full ${
          out ? 'opacity-40' : ''
        }`}
        style={{ backgroundColor: color }}
      />
      <span
        className={`row-span-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-[filter,opacity] duration-300 lg:h-11 lg:w-11 ${
          out ? 'opacity-50 grayscale' : ''
        }`}
        style={{ borderColor: `${color}66`, backgroundColor: `${color}26`, color }}
      >
        <CivEmblem civ={seat.civ} className="h-5 w-5 lg:h-7 lg:w-7" />
      </span>

      <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:justify-center lg:gap-0.5">
        <p className="col-span-2 flex min-w-0 items-center gap-1.5 leading-tight lg:col-span-1">
          <span
            className={`truncate text-[13px] font-semibold transition-colors duration-300 lg:text-[15px] ${
              out ? 'text-parchment/70' : me ? 'text-gold lg:text-parchment' : ''
            }`}
          >
            {seat.isBot ? civName(seat.civ) : seat.displayName}
          </span>
          {me ? (
            <span className="hidden shrink-0 rounded border border-gold/50 bg-gold/15 px-1 text-[10px] leading-4 font-bold tracking-wider text-gold uppercase lg:inline-block">
              <span className="sr-only">(</span>you<span className="sr-only">)</span>
            </span>
          ) : null}
          {seat.isBot ? (
            <span className="hidden shrink-0 rounded border border-parchment/20 bg-parchment/[0.06] px-1 text-[10px] leading-4 font-bold tracking-wider text-parchment/65 uppercase lg:inline-block">
              Bot · {botLevelText(seat.botLevel)}
            </span>
          ) : null}
        </p>
        {/* Full rows: civ and seat (a bot's civ is already its name). */}
        <p className="hidden truncate text-xs leading-tight text-parchment/65 lg:block">
          {seat.isBot ? SEAT_LABEL[name] : `${civName(seat.civ)} · ${SEAT_LABEL[name]}`}
        </p>
        <div className="flex h-4 min-w-0 items-center gap-1.5 lg:gap-2">
          <AnimatePresence initial={false}>
            {status ? (
              <motion.span
                key={status.text}
                initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={`shrink-0 truncate rounded-full border px-1.5 text-[10px] leading-[14px] font-semibold tracking-wide uppercase ${STATUS_TONE[status.tone]}`}
                data-testid={`status-${name}`}
              >
                {status.text}
              </motion.span>
            ) : null}
          </AnimatePresence>
          {armyRemoved ? (
            <span className="hidden truncate text-[11px] text-parchment/65 lg:inline">
              Army removed
            </span>
          ) : material ? (
            <>
              <span className="hidden min-w-0 lg:inline-flex">
                <MaterialLost material={material} color={color} />
              </span>
              <span className="inline-flex min-w-0 lg:hidden">
                <MaterialLost material={material} color={color} compact />
              </span>
            </>
          ) : null}
          {/* Phone chips: the bot's strength where a row has its chip. */}
          {seat.isBot && !status ? (
            <span className="truncate text-[10px] font-semibold text-parchment/65 uppercase lg:hidden">
              Bot {botLevelText(seat.botLevel)}
            </span>
          ) : null}
        </div>
      </div>

      {timed ? (
        <SeatClock
          sync={clock}
          index={index}
          out={out}
          inGame={inGame}
          toMove={toMove}
          reduceMotion={reduceMotion}
        />
      ) : null}
    </li>
  )
})
