/**
 * Tiny typed client helpers for the web (and a reference for the Unity client). They work
 * with any Colyseus SDK room (only `send` and `onMessage` are used), so this package does
 * not depend on the SDK.
 *
 * ```ts
 * import { Client } from '@colyseus/sdk'
 * import { COLYSEUS_PATH, PROTOCOL_VERSION, ROOM_NAMES } from '@game/protocol'
 * import { matchClient } from '@game/protocol/client'
 *
 * const sdk = new Client(`${location.origin}${COLYSEUS_PATH}`)  // cookies are sent
 * const room = await sdk.create(ROOM_NAMES.match, {
 *   protocolVersion: PROTOCOL_VERSION, name: 'Friday game', mode: 'ffa', timeControl: '3+2',
 * })
 * const match = matchClient(room)
 * match.on('events', (e) => applyToBoard(e.positionString, e.events))
 * match.send('setCiv', { civ: 'mali' })
 * ```
 */
import type { ClientMessages, ClientMessageType, ClockSync, ServerMessages } from './messages.ts'

/** The part of a Colyseus SDK `Room` these helpers need. */
export interface RoomLike {
  send(type: string, payload?: unknown): void
  onMessage(type: string, callback: (payload: never) => void): () => void
}

export interface MatchClient {
  send<K extends ClientMessageType>(type: K, payload: ClientMessages[K]): void
  on<K extends keyof ServerMessages>(
    type: K,
    callback: (payload: ServerMessages[K]) => void,
  ): () => void
}

export function matchClient(room: RoomLike): MatchClient {
  return {
    send: (type, payload) => room.send(type, payload),
    on: (type, callback) => room.onMessage(type, callback as (payload: never) => void),
  }
}

/**
 * Estimates server time from a clock sync. Keep the smallest-latency offset you have seen:
 * `offset = sync.serverTimestamp - receivedAtClientMs` (it includes half the round trip).
 */
export function clockOffset(sync: ClockSync, receivedAtClientMs: number): number {
  return sync.serverTimestamp - receivedAtClientMs
}

/** Remaining ms per seat right now, for smooth countdown rendering. */
export function remainingNow(
  sync: ClockSync,
  clientNowMs: number,
  offsetMs: number,
): [number, number, number, number] {
  const serverNow = clientNowMs + offsetMs
  const out: number[] = [...sync.remainingMs]
  const seat: number = sync.runningSeat
  if (seat >= 0) {
    const elapsed = Math.max(0, serverNow - sync.serverTimestamp)
    out[seat] = Math.max(0, (out[seat] ?? 0) - elapsed)
  }
  return out as [number, number, number, number]
}
