import type { ClockSync } from '@game/protocol'
import { remainingNow } from '@game/protocol/client'
import { useEffect, useRef, useState } from 'react'

/**
 * Smoothly counting clocks from the server's authoritative clock syncs. The offset to
 * server time keeps the smallest value seen (least network delay), as the protocol
 * recommends.
 */
export function useClocks(
  sync: ClockSync | null,
  /** Tick only while this seat's clock runs (the others don't change between syncs). */
  tickSeat?: number,
): [number, number, number, number] {
  const offset = useRef<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!sync || sync.serverTimestamp <= 0) return
    const candidate = sync.serverTimestamp - Date.now()
    if (offset.current === null || candidate > offset.current) offset.current = candidate
  }, [sync])

  useEffect(() => {
    if (!sync || sync.runningSeat < 0) return
    if (tickSeat !== undefined && sync.runningSeat !== tickSeat) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [sync, tickSeat])

  if (!sync) return [0, 0, 0, 0]
  return remainingNow(sync, now, offset.current ?? 0)
}

/** "9:58", "0:42.7" under 20 s, "0:00". */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < 20_000) {
    const tenths = Math.floor(clamped / 100)
    return `0:${String(Math.floor(tenths / 10)).padStart(2, '0')}.${tenths % 10}`
  }
  const total = Math.ceil(clamped / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
