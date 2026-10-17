/**
 * Haptic feedback for game moments, next to the board's sounds. Today it uses the Vibration
 * API (Android browsers; iPhone Safari and desktops have none, so it does nothing there). The
 * app shells will route the same calls to native haptics (docs/MOBILE.md phase 3) by
 * installing a driver with `setFeedbackDriver`. Off when the Vibration board preference is.
 * Reduced motion doesn't affect it: vibration is not motion.
 */
import { SEAT_NAMES, type SeatName } from '@game/protocol'
import { isNative } from './platform.ts'
import { usePrefs } from './prefs.ts'

export type FeedbackKind = 'move' | 'capture' | 'check' | 'yourTurn' | 'gameEnd'

/** Vibration patterns in ms (vibrate, pause, vibrate...): short for routine, longer for news. */
export const PATTERNS: Record<FeedbackKind, number | number[]> = {
  move: 12,
  capture: 28,
  check: [45, 60, 45],
  yourTurn: [18, 70, 18],
  gameEnd: [70, 90, 70, 90, 120],
}

export type FeedbackDriver = (kind: FeedbackKind) => void

function vibrate(pattern: number | number[]): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
      ? navigator.vibrate(pattern)
      : false
  } catch {
    return false
  }
}

const vibrationDriver: FeedbackDriver = (kind) => {
  vibrate(PATTERNS[kind])
}

let driver: FeedbackDriver = vibrationDriver

/** Installs another driver (the app shells' native haptics). */
export function setFeedbackDriver(next: FeedbackDriver | null): void {
  driver = next ?? vibrationDriver
}

/** Whether this device can give feedback at all (decides if the setting is shown). */
export function canVibrate(): boolean {
  if (driver !== vibrationDriver || isNative()) return true
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** Gives feedback for a moment of the game, unless turned off or the page is hidden. */
export function feedback(kind: FeedbackKind): void {
  if (!usePrefs.getState().vibration) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  driver(kind)
}

/** A rules event as the board sees it: from the `events` message or the synced state. */
export interface FeedbackEvent {
  type?: unknown
  /** Acting seat: a seat name (`events` message) or index (synced state). */
  seat?: unknown
  /** `capture` in the `events` message: the captured piece, with its owner's seat name. */
  captured?: unknown
  /** `capture` in the synced state: the captured piece's owner seat index. */
  pieceOwner?: unknown
}

function seatIndex(v: unknown): number {
  if (typeof v === 'number') return v
  return typeof v === 'string' ? SEAT_NAMES.indexOf(v as SeatName) : -1
}

/**
 * The one moment worth feeling after a position change (the board plays its sounds at the
 * same points): game end, then check on you, then your turn, then a capture by or of you,
 * then your own move. Other players' routine moves stay silent, so "your turn" stands out
 * (a 4-player round would otherwise buzz on every move). One vibration per change, since a
 * new pattern cancels the one still running.
 */
export function feedbackFor(input: {
  /** Rules events of the action that led to the new position. */
  events: readonly FeedbackEvent[] | undefined
  /** The viewer's seat index, or -1 (watching). */
  mySeat: number
  /** It just became the viewer's turn. */
  yourTurn: boolean
  /** The viewer's check indicator just turned on. */
  check: boolean
  /** The game just ended. */
  ended: boolean
}): FeedbackKind | null {
  const events = input.events ?? []
  const types = new Set(events.map((e) => String(e.type)))
  if (input.ended || types.has('game_ended')) return 'gameEnd'
  if (input.check) return 'check'
  if (input.yourTurn) return 'yourTurn'
  const me = input.mySeat
  if (me < 0) return null
  const mine = (e: FeedbackEvent) => seatIndex(e.seat) === me
  const capturedMine = (e: FeedbackEvent) => {
    const owner =
      e.pieceOwner !== undefined && e.pieceOwner !== -1
        ? e.pieceOwner
        : (e.captured as { owner?: unknown } | undefined)?.owner
    return seatIndex(owner) === me
  }
  if (events.some((e) => e.type === 'capture' && (mine(e) || capturedMine(e)))) return 'capture'
  if (events.some((e) => e.type === 'en_passant' && mine(e))) return 'capture'
  const moves = new Set(['move_made', 'castle', 'promotion'])
  if (events.some((e) => moves.has(String(e.type)) && mine(e))) return 'move'
  return null
}
