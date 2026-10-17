import { GAME_MODES, SEAT_NAMES, type SeatName, TIME_CONTROL_IDS } from '@game/protocol'
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
