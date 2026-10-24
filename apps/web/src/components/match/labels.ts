import {
  botName,
  GAME_MODES,
  isUntimed,
  RANKED_REPEAT_MAX,
  RANKED_REPEAT_WINDOW_MS,
  SEAT_NAMES,
  type SeatName,
  type ServerMessages,
  TIME_CONTROL_IDS,
} from '@game/protocol'
import { pieceName } from '../../lib/civ-info.ts'

/** Text labels for seats, modes and results (no renderer dependency, safe for any page). */
export const SEAT_LABEL: Record<SeatName, string> = {
  south: 'South',
  west: 'West',
  north: 'North',
  east: 'East',
}

export function seatName(index: number): SeatName {
  return SEAT_NAMES[index] ?? 'south'
}

export function teamLabel(team: number): string {
  return team === 0 ? 'Team South–North' : team === 1 ? 'Team West–East' : ''
}

export function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

export const MODE_LABEL: Record<string, string> = { ffa: 'Free-for-all', teams: 'Teams 2v2' }

/** The toast for an AFK bot takeover (`takeoverEvent`). */
export function takeoverNotice(e: ServerMessages['takeoverEvent']): string {
  if (e.type === 'started') {
    return `${e.name} didn’t reconnect in time, so ${botName(e.botLevel)} plays on for them.`
  }
  return `${e.name} is back and plays on.`
}

/** End reasons where 1st place is shared: a draw, not a win. */
const DRAW_REASONS = new Set(['agreed_draw', 'move_limit'])

/** A finished seat's result: "Victory", "Draw", "2nd place", or "Finished" without a place. */
export function resultLabel(
  placement: number | null,
  endReason: string | null,
): { label: string; win: boolean } {
  if (placement === 1) {
    return DRAW_REASONS.has(endReason ?? '')
      ? { label: 'Draw', win: false }
      : { label: 'Victory', win: true }
  }
  return { label: placement ? `${ordinal(placement)} place` : 'Finished', win: false }
}

/** "Free-for-all, 10+0, casual"; ranked games get the Ranked tag beside it (and "not rated"). */
export function matchLine(m: {
  mode: string
  timeControl: string
  ranked: boolean
  rated: boolean
}): string {
  const untimed = isUntimed(m.timeControl)
  return [
    MODE_LABEL[m.mode] ?? m.mode,
    untimed ? 'untimed, against bots' : m.timeControl,
    !m.ranked && !untimed ? 'casual' : null,
    m.ranked && !m.rated ? 'not rated' : null,
  ]
    .filter(Boolean)
    .join(', ')
}

export const REPEAT_WINDOW_HOURS = Math.round(RANKED_REPEAT_WINDOW_MS / 3_600_000)

/** Why a ranked game is unrated: shared by the lobby and the game screen so they read alike. */
const repeatLimitReason = (who: string) =>
  `${who} have already played ${RANKED_REPEAT_MAX} rated games together in the last ${REPEAT_WINDOW_HOURS} hours`

/** A full ranked lobby whose four players reached the repeat limit (`state.unratedRepeat`). */
export const UNRATED_REPEAT_NOTE = `${repeatLimitReason('You four')}, so this game won’t change anyone’s Elo. It still plays by ranked rules.`

/**
 * The game screen's line for a ranked game played unrated, else null. While it runs that can
 * only be the repeat limit (the start check sets `rated`). A finished game can also have lost
 * its Elo at the end (an account deleted mid-game), so it doesn't claim the reason; a
 * cancelled one says nothing, as its result already explains it.
 */
export function unratedGameNote(
  state: { ranked: boolean; rated: boolean; phase: string; result: { type: string } },
  spectator: boolean,
): string | null {
  if (!state.ranked || state.rated) return null
  if (state.phase === 'finished') {
    return state.result.type === 'aborted' ? null : 'Not rated: nobody’s Elo changed.'
  }
  if (state.phase !== 'in_game') return null
  // No "Ranked" here: the Ranked badge sits just above the note.
  return `Not rated: ${repeatLimitReason(spectator ? 'these four players' : 'you four')}.`
}

/** Everyone's starting Elo (shown greyed out before a first ranked game). */
export const ELO_START = 1200

/** Every Elo rating bucket (mode x time control), in display order. */
export const RATING_BUCKETS = GAME_MODES.flatMap((mode) =>
  TIME_CONTROL_IDS.map((timeControl) => ({ mode, timeControl })),
)

export const STATUS_LABEL: Record<string, string> = {
  active: 'In play',
  defeated: 'Defeated',
  frozen: 'Frozen',
  removed: 'Eliminated',
}

export const END_REASON_LABEL: Record<string, string> = {
  last_standing: 'Last civilization standing',
  team_eliminated: 'A team was eliminated',
  team_resigned: 'A team resigned',
  move_limit: 'Move limit reached (25 rounds without a capture or pawn move)',
  agreed_draw: 'Every player still in the game agreed to a draw',
  // Solo FFA: the game ends when its (only) player is out; history rows are the viewer's own.
  player_eliminated: 'You were eliminated',
  server_shutdown: 'Game cancelled: the server restarted',
  server_restart: 'Game cancelled: the server restarted',
  persist_failed: 'Game cancelled: the result could not be saved',
  resimulation_mismatch: 'Game cancelled: the result could not be verified',
  room_disposed: 'Game cancelled',
}

/** How a seat was knocked out (rules defeat reasons). */
export const DEFEAT_REASON_LABEL: Record<string, string> = {
  leader_captured: 'Leader captured',
  stalemate: 'Stalemated',
  timeout: 'Out of time',
  abandon: 'Left the game',
  resign: 'Resigned',
}

/**
 * How a seat was knocked out, for display. A seat that started with several leader pieces
 * (England's Prime Minister) is out only when the last one falls, so its leader capture reads
 * "All Prime Ministers captured". `leaderKind` and `leaderCount` come from the engine's start
 * position for that seat's civ.
 */
export function defeatReasonLabel(
  reason: string,
  leaderKind: string | null,
  leaderCount: number,
): string {
  if (reason === 'leader_captured' && leaderKind && leaderCount > 1) {
    return `All ${pieceName(leaderKind, leaderCount)} captured`
  }
  return DEFEAT_REASON_LABEL[reason] ?? reason
}

/** Medal colours for 1st, 2nd and 3rd (gold, silver, bronze). */
export const PODIUM = ['#d4a017', '#c9ccd1', '#c7834a'] as const

/** "just now", "5 min ago", "2 h ago", "3 days ago", else a short date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
