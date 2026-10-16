/**
 * Connection to the game server's Colyseus rooms (lobby browser + match rooms).
 *
 * The match room object lives in a small store rather than in a page component, so the
 * lobby browser can create/join a room and hand it to the match page without reconnecting.
 * Reconnection tokens are kept in sessionStorage so a page reload can rejoin a seat within
 * the server's reconnect grace.
 */
import { Client, MatchMakeError, type Room } from '@colyseus/sdk'
import {
  COLYSEUS_PATH,
  type CreateOptions,
  type JoinOptions,
  PROTOCOL_VERSION,
  ROOM_NAMES,
} from '@game/protocol'
import { type MatchClient, matchClient, type RoomLike } from '@game/protocol/client'
import type { MatchStateJson } from '@game/protocol/state'
import { create } from 'zustand'
import { API_ORIGIN } from './auth-client.ts'

let sdk: Client | undefined

/** The SDK client (sends the Better Auth session cookie with every request). */
export function gameClient(): Client {
  sdk ??= new Client(`${API_ORIGIN || window.location.origin}${COLYSEUS_PATH}`)
  return sdk
}

export type MatchRoom = Room<unknown, unknown>

/** Typed send/on for a match room (protocol message names and payloads). */
export function matchApi(room: MatchRoom): MatchClient {
  return matchClient(room as unknown as RoomLike)
}

export type CloseReason = 'kicked' | 'closed' | 'left'

interface MatchStore {
  room: MatchRoom | null
  /** The last room that closed on us (kicked, server closed it, connection lost for good). */
  closed: { roomId: string; reason: CloseReason } | null
  setRoom: (room: MatchRoom | null) => void
  markClosed: (roomId: string, reason: CloseReason) => void
}

export const useMatchStore = create<MatchStore>((set) => ({
  room: null,
  closed: null,
  setRoom: (room) => set(room ? { room, closed: null } : { room }),
  // The room object stays (so a finished game keeps showing); nothing rejoins a closed room.
  markClosed: (roomId, reason) => set({ closed: { roomId, reason } }),
}))

const TOKEN_KEY = (roomId: string) => `match:reconnect:${roomId}`

export function rememberRoom(room: MatchRoom): void {
  try {
    sessionStorage.setItem(TOKEN_KEY(room.roomId), room.reconnectionToken)
  } catch {
    // Storage can be unavailable (private mode); reloads then just can't rejoin.
  }
}

export function forgetRoom(roomId: string): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY(roomId))
  } catch {}
}

function savedToken(roomId: string): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY(roomId))
  } catch {
    return null
  }
}

function adopt(room: MatchRoom): MatchRoom {
  rememberRoom(room)
  useMatchStore.getState().setRoom(room)
  return room
}

/** Create options without the protocol version (added here), for a lobby or a solo game. */
export type NewMatchOptions = CreateOptions extends infer T
  ? T extends unknown
    ? Omit<T, 'protocolVersion'>
    : never
  : never

/** Creates a lobby, or a solo game against bots (`kind: 'solo'`), and takes its seat. */
export async function createMatch(options: NewMatchOptions) {
  const full = { protocolVersion: PROTOCOL_VERSION, ...options } as CreateOptions
  const room = await gameClient().create(ROOM_NAMES.match, full)
  return adopt(room as MatchRoom)
}

export async function joinMatch(roomId: string, password?: string) {
  const options: JoinOptions = { protocolVersion: PROTOCOL_VERSION }
  if (password) options.password = password
  const room = await gameClient().joinById(roomId, options)
  return adopt(room as MatchRoom)
}

/** Rejoins after a reload using the saved token; null if there is none or it expired. */
export async function reconnectMatch(roomId: string): Promise<MatchRoom | null> {
  const token = savedToken(roomId)
  if (!token) return null
  try {
    const room = await gameClient().reconnect(token)
    return adopt(room as MatchRoom)
  } catch {
    forgetRoom(roomId)
    return null
  }
}

/**
 * Leaves the current room on purpose. The room is marked closed ('left') so the match page
 * never rejoins it (a consented in-game leave gives the seat up).
 */
export async function leaveMatch(): Promise<void> {
  const { room } = useMatchStore.getState()
  useMatchStore.setState({
    room: null,
    closed: room ? { roomId: room.roomId, reason: 'left' } : null,
  })
  if (!room) return
  forgetRoom(room.roomId)
  try {
    await room.leave(true)
  } catch {}
}

/**
 * Plain-JSON copy of the synced room state (what the UI renders), or null until the first
 * full state has arrived (right after joining, the schema object exists but is still empty).
 */
export function stateJson(room: MatchRoom): MatchStateJson | null {
  const s = room.state as { toJSON?: () => unknown } | undefined
  if (!s?.toJSON) return null
  const json = s.toJSON() as Partial<MatchStateJson>
  return Array.isArray(json.seats) && json.seats.length === 4 ? (json as MatchStateJson) : null
}

/** Matchmaking error code (the server answers `{ error: <code> }`), or undefined. */
export function matchErrorCode(err: unknown): string | undefined {
  if (err instanceof MatchMakeError) return err.message
  if (err instanceof Error && /^[a-z_]+$/.test(err.message)) return err.message
  return undefined
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Please sign in or continue as a guest first.',
  age_confirmation_required: 'Please confirm your date of birth first.',
  legal_acceptance_required: 'Please accept the current Terms of Service first.',
  username_required: 'Choose a username before playing.',
  protocol_mismatch: 'Your game client is out of date. Reload the page.',
  invalid_options: 'Some game settings were not valid.',
  invalid_password: 'That password is not right.',
  too_many_attempts: 'Too many wrong passwords. Wait a minute and try again.',
  room_not_found: 'That lobby no longer exists.',
  room_not_joinable: 'That lobby can no longer be joined.',
  room_full: 'That lobby is full.',
  already_seated: 'You already have a seat in that lobby.',
  already_in_room: 'You are already in another lobby. Leave it first.',
  kicked: 'The host removed you from that lobby.',
  maintenance: 'The server is restarting for maintenance. Try again in a few minutes.',
  not_implemented: 'That option is not available yet.',
  not_your_turn: 'It is not your turn.',
  illegal_move: 'That move is not legal.',
  not_host: 'Only the host can do that.',
  wrong_phase: 'That can’t be done at this stage of the game.',
  invalid_seat: 'That seat does not exist.',
  seat_occupied: 'That seat is taken.',
  seat_empty: 'That seat is empty.',
  not_a_bot: 'That seat is not a bot.',
  civ_required: 'Choose a civilization first.',
  civ_unavailable: 'That civilization is not available.',
  not_ready: 'Every player must be seated, have a civilization and be ready.',
  not_seated: 'You don’t have a seat in this game.',
  invalid_message: 'That request was not valid.',
  internal: 'The server hit a problem. Please try again.',
}

export function matchErrorMessage(err: unknown): string {
  const code = matchErrorCode(err)
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  return 'Could not reach the game server. Check your connection and try again.'
}

export function errorCodeMessage(code: string, fallback?: string): string {
  return ERROR_MESSAGES[code] ?? fallback ?? 'That action was refused.'
}
