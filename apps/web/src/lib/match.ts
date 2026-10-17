/**
 * Connection to the game server's Colyseus rooms (lobby browser + match rooms).
 *
 * The match room object lives in a small store rather than in a page component, so the
 * lobby browser can create/join a room and hand it to the match page without reconnecting.
 * Reconnection tokens are kept in sessionStorage and localStorage (lib/reconnect-store.ts) so
 * a page reload, or an app the phone OS killed in the background, can rejoin a seat within the
 * server's reconnect grace.
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
import { trackMoveLog } from './live-move-log.ts'
import { activeBearerToken, bearerMode } from './native-auth.ts'
import {
  clearAllReconnectTokens,
  clearReconnectToken,
  loadReconnectToken,
  saveReconnectToken,
} from './reconnect-store.ts'

let sdk: Client | undefined

/**
 * The SDK client. In the browser, matchmaking sends the Better Auth session cookie; in the
 * mobile apps it sends `Authorization: Bearer` from the token store (read on every call, so a
 * sign-in or sign-out takes effect at once). The server resolves the player at matchmaking
 * (`resolvePlayer`), so the token goes in that request's header only: `client.auth.token`
 * would also copy it into the WebSocket URL (`_authToken`), where proxies log it.
 */
export function gameClient(): Client {
  sdk ??= new Client(`${API_ORIGIN || window.location.origin}${COLYSEUS_PATH}`)
  if (bearerMode()) {
    // No cookie from the apps (the server's CORS grant for their origins has no credentials).
    sdk.http.options.credentials = 'omit'
    setMatchmakeBearer(sdk, activeBearerToken())
  }
  return sdk
}

/** Sets (or removes) the matchmaking requests' Authorization header. */
export function setMatchmakeBearer(client: Client, token: string | undefined): void {
  const headers: Record<string, string> = {
    ...((client.http.options.headers as Record<string, string> | undefined) ?? {}),
  }
  if (token) headers.authorization = `Bearer ${token}`
  else delete headers.authorization
  client.http.options.headers = headers
}

export type MatchRoom = Room<unknown, unknown>

/** Typed send/on for a match room (protocol message names and payloads). */
export function matchApi(room: MatchRoom): MatchClient {
  return matchClient(room as unknown as RoomLike)
}

/**
 * Why a room closed on us. 'lost': the SDK's automatic reconnection gave up (or couldn't
 * start); the saved token is kept, so a resume can still rejoin within the server's grace.
 * 'replaced': the seat was taken over by another connection of the same player (another tab,
 * or the app relaunched), which keeps playing.
 */
export type CloseReason = 'kicked' | 'closed' | 'left' | 'lost' | 'replaced'

interface MatchStore {
  room: MatchRoom | null
  /** Bumped whenever a room object is adopted (a rejoin gets a fresh match view). */
  generation: number
  /** The last room that closed on us (kicked, server closed it, connection lost for good). */
  closed: { roomId: string; reason: CloseReason } | null
  setRoom: (room: MatchRoom | null) => void
  markClosed: (roomId: string, reason: CloseReason) => void
}

export const useMatchStore = create<MatchStore>((set) => ({
  room: null,
  generation: 0,
  closed: null,
  setRoom: (room) =>
    set((s) => (room ? { room, closed: null, generation: s.generation + 1 } : { room })),
  // The room object stays (so a finished game keeps showing); nothing rejoins a closed room.
  markClosed: (roomId, reason) => set({ closed: { roomId, reason } }),
}))

export function rememberRoom(room: MatchRoom): void {
  saveReconnectToken(room.roomId, room.reconnectionToken)
}

/**
 * Forgets a room's saved token. With `token` (the one this tab used), the shared long-lived
 * copy is kept if another tab has since saved a newer one for the same seat.
 */
export function forgetRoom(roomId: string, token?: string): void {
  clearReconnectToken(roomId, 'all', token)
}

/** A finished game: the longer-lived copy of its token goes (this tab can still reload it). */
export function forgetFinishedRoom(roomId: string): void {
  clearReconnectToken(roomId, 'persistent')
}

/** The server's default reconnect grace, used until the room state says otherwise. */
export const DEFAULT_RECONNECT_GRACE_MS = 60_000

/** The server's reconnect grace (RECONNECT_GRACE_SECONDS, synced in the room state). */
export function reconnectGraceMs(state: Pick<MatchStateJson, 'reconnectGraceMs'> | null): number {
  const g = state?.reconnectGraceMs
  return typeof g === 'number' && g > 0 ? g : DEFAULT_RECONNECT_GRACE_MS
}

/** How long after a drop rejoining is still worth trying: the grace plus a margin. */
export function rejoinWindowMs(graceMs: number): number {
  return graceMs + 15_000
}

const RECONNECT_MAX_DELAY_MS = 2_000

/**
 * Automatic reconnection policy: retry quickly (at most 2 s apart) for a little longer than
 * the server's reconnect grace, instead of the SDK's default ~50 s with 5 s gaps.
 */
function tuneReconnection(room: MatchRoom, graceMs: number): void {
  room.reconnection.maxDelay = RECONNECT_MAX_DELAY_MS
  room.reconnection.maxRetries = Math.ceil(rejoinWindowMs(graceMs) / RECONNECT_MAX_DELAY_MS)
}

function adopt(room: MatchRoom): MatchRoom {
  rememberRoom(room)
  // Before any page listens: the game so far (`moveLog`) comes right after joining.
  trackMoveLog(room)
  tuneReconnection(room, reconnectGraceMs(stateJson(room)))
  // The grace comes with the first full state: tune again then.
  let tuned = false
  room.onStateChange(() => {
    if (tuned) return
    const state = stateJson(room)
    if (!state) return
    tuned = true
    tuneReconnection(room, reconnectGraceMs(state))
  })
  // A rejoin can hand out a new token: keep the saved one current (not for a finished game,
  // whose long-lived copy was cleared on purpose).
  room.onReconnect(() => {
    if (stateJson(room)?.phase !== 'finished') rememberRoom(room)
  })
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

/**
 * Rejoins with the saved token (after a reload, or when the SDK's own reconnection gave up);
 * null if there is none or it failed. The token is forgotten only when the server refused it
 * (seat gone, grace over); a network failure keeps it, so a later attempt can still work.
 */
export async function reconnectMatch(roomId: string): Promise<MatchRoom | null> {
  const token = loadReconnectToken(roomId)
  if (!token) return null
  try {
    const room = await gameClient().reconnect(token)
    return adopt(room as MatchRoom)
  } catch (err) {
    const network = err instanceof TypeError || navigator.onLine === false
    if (!network) forgetRoom(roomId, token)
    return null
  }
}

/**
 * Watches a game or lobby as a spectator (read-only). The server answers with a seat in the
 * match's watch room, whose `roomId` differs from the match room's. The room is not adopted
 * into the match store (a spectator holds no seat, and watching must not replace a lobby the
 * player is seated in), and no reconnection token is saved: a reload simply watches again.
 */
export async function watchMatch(roomId: string, password?: string): Promise<MatchRoom> {
  const options: JoinOptions = { protocolVersion: PROTOCOL_VERSION, spectate: true }
  if (password) options.password = password
  const room = (await gameClient().joinById(roomId, options)) as MatchRoom
  // Before any page listens: the game so far (`moveLog`) comes right after joining.
  trackMoveLog(room)
  return room
}

/** Whether a saved token is still there for a room (a rejoin may still work). */
export function hasSavedToken(roomId: string): boolean {
  return loadReconnectToken(roomId) !== null
}

/** How long a ping may go unanswered on resume before the socket is treated as dead. */
const RESUME_PING_TIMEOUT_MS = 3_000

/**
 * The app or tab came back (lib/resume.ts): make sure the match connection is alive, without
 * waiting for the SDK's backoff or a dead socket's timeout.
 * - Reconnecting already: restart the retry budget, so the next attempt comes soon.
 * - Socket looks open: ping it; no answer in time means it died while away (common after a
 *   phone suspended the app), so drop it now and let the SDK rejoin with the token at once.
 * Returns what it found.
 */
export function checkConnection(room: MatchRoom): 'reconnecting' | 'checking' | 'closed' {
  // Only the live room: one that closed (left, kicked, gave up) must not be revived here.
  const live = () => {
    const s = useMatchStore.getState()
    return s.room === room && s.closed?.roomId !== room.roomId
  }
  if (!live() || !room.connection) return 'closed'
  if (room.reconnection.isReconnecting) {
    room.reconnection.retryCount = 0
    return 'reconnecting'
  }
  let answered = false
  room.ping(() => {
    answered = true
  })
  window.setTimeout(() => {
    if (answered || room.reconnection.isReconnecting || !live()) return
    try {
      // 4010 = MAY_TRY_RECONNECT: the SDK treats it as a drop and reconnects right away.
      room.connection.close(4010, 'resume: no answer')
    } catch {}
  }, RESUME_PING_TIMEOUT_MS)
  return 'checking'
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
  forgetRoom(room.roomId, room.reconnectionToken)
  try {
    await room.leave(true)
  } catch {}
}

/**
 * The account's session ended on this device (sign-out, account deletion): leave the live
 * match room, which is still seated as that account, and forget every saved reconnection
 * token, so the next person to use this browser can't rejoin those seats.
 */
export async function endMatchSession(): Promise<void> {
  clearAllReconnectTokens()
  await leaveMatch()
  clearAllReconnectTokens()
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
  account_required:
    'Ranked games are for registered players. Create a free account (your guest games come with you) to play ranked.',
  ranked_no_bots: 'Bots can’t play in ranked games. Wait for players with an account to join.',
  not_invited: 'That lobby is a friends challenge: only invited players can join.',
  spectating: 'You are watching this game, so you can’t play in it.',
  spectators_full: 'Too many people are watching this game already. Try again later.',
  rematch_pending: 'A rematch has already been proposed. Answer it instead.',
  no_rematch: 'There is no rematch to answer any more.',
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
  not_playing: 'You are no longer taking turns in this game.',
  draw_offer_pending: 'A draw offer is already waiting for answers.',
  draw_offer_cooldown: 'Make a few more moves before offering another draw.',
  no_draw_offer: 'There is no draw offer to answer any more.',
  already_responded: 'You have already answered this.',
  resign_proposal_pending: 'You already asked your teammate. Wait for their answer.',
  resign_proposal_cooldown: 'Make a few more moves before asking your teammate again.',
  no_resign_proposal: 'There is no request from your teammate to answer any more.',
  invalid_message: 'That request was not valid.',
  internal: 'The server hit a problem. Please try again.',
}

export function matchErrorMessage(err: unknown): string {
  const code = matchErrorCode(err)
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  return 'Could not reach the game server. Check your connection and try again.'
}

/** Codes whose server message carries live detail (e.g. moves left), so it beats a fixed text. */
const SERVER_DETAIL_CODES = new Set([
  'draw_offer_cooldown',
  'resign_proposal_cooldown',
  'seat_occupied',
])

export function errorCodeMessage(code: string, fallback?: string): string {
  if (fallback && SERVER_DETAIL_CODES.has(code)) return fallback
  return ERROR_MESSAGES[code] ?? fallback ?? 'That action was refused.'
}
