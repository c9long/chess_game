import { SEAT_NAMES, type SeatName } from '@game/protocol'

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

export const STATUS_LABEL: Record<string, string> = {
  active: 'In play',
  defeated: 'Defeated',
  frozen: 'Frozen',
  removed: 'Eliminated',
}

export const END_REASON_LABEL: Record<string, string> = {
  last_standing: 'Last civilization standing',
  team_eliminated: 'A team was eliminated',
  move_limit: 'Move limit reached (25 rounds without a capture or pawn move)',
  server_shutdown: 'Game cancelled: the server restarted',
  server_restart: 'Game cancelled: the server restarted',
  persist_failed: 'Game cancelled: the result could not be saved',
  resimulation_mismatch: 'Game cancelled: the result could not be verified',
  room_disposed: 'Game cancelled',
}
