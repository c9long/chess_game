/**
 * Pure lobby rules over the synced state (unit-tested without Colyseus): seat filling,
 * swapping, phase changes and the start conditions (PLAN §3 "Lobby room").
 */
import type { ErrorCode, MatchPhase } from '@game/protocol'
import type { MatchState, SeatState } from '@game/protocol/state'

export type SeatNum = 0 | 1 | 2 | 3
export const SEAT_NUMS: readonly SeatNum[] = [0, 1, 2, 3]

/** Server-only identity of a seated human (never synced: user ids stay private). */
export interface SeatBinding {
  userId: string
  displayName: string
  isGuest: boolean
  sessionId: string
}

export function teamFor(mode: string, seat: number): number {
  return mode === 'teams' ? seat % 2 : -1
}

export function filledCount(state: MatchState): number {
  return state.seats.filter((s) => s.occupied).length
}

export function firstFreeSeat(state: MatchState): SeatNum | -1 {
  const i = state.seats.findIndex((s) => !s.occupied)
  return i === -1 ? -1 : (i as SeatNum)
}

export function clearSeat(seat: SeatState): void {
  seat.occupied = false
  seat.sessionId = ''
  seat.displayName = ''
  seat.isGuest = false
  seat.isBot = false
  seat.botLevel = ''
  seat.civ = ''
  seat.ready = false
  seat.connected = false
  seat.graceDeadline = 0
  seat.status = ''
}

export function seatHuman(
  state: MatchState,
  seat: SeatNum,
  player: { displayName: string; isGuest: boolean; sessionId: string },
): void {
  const s = state.seats[seat] as SeatState
  clearSeat(s)
  s.occupied = true
  s.sessionId = player.sessionId
  s.displayName = player.displayName
  s.isGuest = player.isGuest
  s.connected = true
  s.team = teamFor(state.mode, seat)
}

export function seatBot(state: MatchState, seat: SeatNum, level: string, civ: string): void {
  const s = state.seats[seat] as SeatState
  clearSeat(s)
  s.occupied = true
  s.isBot = true
  s.botLevel = level
  s.displayName = `Bot ${level === 'max' ? 'Max' : level}`
  s.civ = civ
  s.ready = true
  s.connected = true
  s.team = teamFor(state.mode, seat)
}

const SEAT_FIELDS = [
  'occupied',
  'sessionId',
  'displayName',
  'isGuest',
  'isBot',
  'botLevel',
  'civ',
  'ready',
  'connected',
  'graceDeadline',
  'status',
] as const

/** Swaps two seats' occupants (teams follow the seat, so this is how hosts pick teams). */
export function swapSeats(state: MatchState, a: SeatNum, b: SeatNum): void {
  const sa = state.seats[a] as SeatState
  const sb = state.seats[b] as SeatState
  for (const f of SEAT_FIELDS) {
    const tmp = sa[f]
    ;(sa as unknown as Record<string, unknown>)[f] = sb[f]
    ;(sb as unknown as Record<string, unknown>)[f] = tmp
  }
  sa.team = teamFor(state.mode, a)
  sb.team = teamFor(state.mode, b)
}

const LOBBY_PHASES: readonly string[] = ['waiting', 'civ_select']

export function isLobbyPhase(phase: string): boolean {
  return LOBBY_PHASES.includes(phase)
}

/** waiting <-> civ_select follows the seat count while in the lobby. */
export function refreshLobbyPhase(state: MatchState): void {
  if (!isLobbyPhase(state.phase)) return
  state.phase = (filledCount(state) === 4 ? 'civ_select' : 'waiting') satisfies MatchPhase
}

/** Why the game can't start yet, or null if it can. */
export function startBlocker(
  state: MatchState,
  opts: { ignorePhase?: boolean } = {},
): ErrorCode | null {
  if (!opts.ignorePhase && state.phase !== 'civ_select') return 'wrong_phase'
  if (state.seats.some((s) => !s.occupied)) return 'wrong_phase'
  if (state.seats.some((s) => !s.civ)) return 'civ_required'
  if (state.seats.some((s) => !s.isBot && (!s.ready || !s.connected))) return 'not_ready'
  return null
}

/** The host after `leavingUserId` leaves: the first remaining human in seat order. */
export function nextHost(
  bindings: readonly (SeatBinding | null)[],
  leavingUserId: string | null,
): string | null {
  for (const b of bindings) if (b && b.userId !== leavingUserId) return b.userId
  return null
}

/** Seat index of a user, or -1. */
export function seatOfUser(bindings: readonly (SeatBinding | null)[], userId: string): number {
  return bindings.findIndex((b) => b?.userId === userId)
}

export function seatOfSession(
  bindings: readonly (SeatBinding | null)[],
  sessionId: string,
): number {
  return bindings.findIndex((b) => b?.sessionId === sessionId)
}
