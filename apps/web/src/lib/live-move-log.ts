/**
 * The live game's actions for the move log, per match room. Listening starts the moment a
 * room is joined (lib/match.ts), before any page mounts: the server sends `welcome`,
 * `moveLog` (the game so far) and a `clock` right after joining, and a message nobody listens
 * for yet would be lost. The latest `welcome` and clock are kept too, for the page to read
 * when it mounts (`joinedFeed`).
 */
import type { ClockSync, MoveLogEntry, ServerMessages } from '@game/protocol'
import { useSyncExternalStore } from 'react'
import type { MatchRoom } from './match.ts'

interface LiveLog {
  entries: readonly MoveLogEntry[]
  listeners: Set<() => void>
  welcome: ServerMessages['welcome'] | null
  clock: ClockSync | null
}

const logs = new WeakMap<object, LiveLog>()
const EMPTY: readonly MoveLogEntry[] = []

/** Appends an `events` message to a log (ignored when the log already has that action). */
export function appendEntry(
  entries: readonly MoveLogEntry[],
  e: ServerMessages['events'],
): readonly MoveLogEntry[] {
  const last = entries.at(-1)
  if (last && e.seq <= last.seq) return entries
  const { seq, action, seat, notation, events, positionString } = e
  return [
    ...entries,
    { seq, action, seat, notation, events, positionString, clockMs: e.clockMs ?? null },
  ]
}

/** Starts collecting a room's move log (once per room object). */
export function trackMoveLog(room: MatchRoom): void {
  if (logs.has(room)) return
  const log: LiveLog = { entries: EMPTY, listeners: new Set(), welcome: null, clock: null }
  logs.set(room, log)
  const set = (entries: readonly MoveLogEntry[]) => {
    if (entries === log.entries) return
    log.entries = entries
    for (const l of log.listeners) l()
  }
  // The game so far, on join and on every reconnect: it replaces whatever was collected.
  room.onMessage('moveLog', (m: ServerMessages['moveLog']) => set(m.entries))
  room.onMessage('events', (e: ServerMessages['events']) => {
    log.clock = e.clock
    set(appendEntry(log.entries, e))
  })
  room.onMessage('welcome', (w: ServerMessages['welcome']) => {
    log.welcome = w
  })
  room.onMessage('clock', (c: ClockSync) => {
    log.clock = c
  })
}

/** The latest `welcome` and clock sync a room got, including any before a page listened. */
export function joinedFeed(room: MatchRoom): {
  welcome: ServerMessages['welcome'] | null
  clock: ClockSync | null
} {
  const log = logs.get(room)
  return { welcome: log?.welcome ?? null, clock: log?.clock ?? null }
}

/** The room's actions so far, oldest first (re-renders on every new action). */
export function useLiveMoveLog(room: MatchRoom): readonly MoveLogEntry[] {
  trackMoveLog(room)
  const log = logs.get(room) as LiveLog
  return useSyncExternalStore(
    (onChange) => {
      log.listeners.add(onChange)
      return () => log.listeners.delete(onChange)
    },
    () => log.entries,
  )
}
