import { describe, expect, it } from 'vitest'
import { GameClock } from './clock.ts'

describe('GameClock', () => {
  it('runs only the seat to move and deducts the elapsed time', () => {
    const c = new GameClock(60_000, 0)
    c.startTurn(0, 1_000)
    expect(c.remainingAt(0, 1_400)).toBe(59_600)
    expect(c.remainingAt(1, 1_400)).toBe(60_000)
    expect(c.endTurn(1_500, { increment: true })).toBe(59_500)
    expect(c.running).toBe(-1)
  })

  it('adds the increment after a real move only', () => {
    const c = new GameClock(180_000, 2_000)
    c.startTurn(1, 0)
    expect(c.endTurn(10_000, { increment: true })).toBe(172_000)
    c.startTurn(2, 10_000)
    // a timeout / abandon / stalemate ends the turn without increment
    expect(c.endTurn(13_000, { increment: false })).toBe(177_000)
  })

  it('never adds an increment to a flagged clock or goes below zero', () => {
    const c = new GameClock(1_000, 2_000)
    c.startTurn(3, 0)
    expect(c.hasFlagged(999)).toBe(false)
    expect(c.hasFlagged(1_000)).toBe(true)
    expect(c.msUntilFlag(250)).toBe(750)
    expect(c.endTurn(5_000, { increment: true })).toBe(0)
  })

  it('charges nothing while no seat runs (automatic passes happen between turns)', () => {
    const c = new GameClock(10_000, 2_000)
    c.startTurn(0, 0)
    c.endTurn(1_000, { increment: true }) // South moves: 9 s + 2 s
    // The engine's turn walk auto-passes a defeated Teams seat instantly; the room starts
    // the next turn for the seat that can move, at the same instant.
    c.startTurn(2, 1_000)
    expect(c.remaining).toEqual([11_000, 10_000, 10_000, 10_000])
    expect(c.msUntilFlag(1_000)).toBe(10_000)
    expect(new GameClock(5, 0).msUntilFlag(0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('syncs remaining values as of a server timestamp', () => {
    const c = new GameClock(60_000, 0)
    c.startTurn(2, 1_000)
    expect(c.sync(3_000)).toEqual({
      remainingMs: [60_000, 60_000, 58_000, 60_000],
      runningSeat: 2,
      serverTimestamp: 3_000,
      turnStartedAt: 1_000,
    })
    c.endTurn(3_000, { increment: false })
    expect(c.sync(4_000).runningSeat).toBe(-1)
  })

  it('measures on the monotonic clock and reports wall-clock times to clients', () => {
    const c = new GameClock(60_000, 0)
    c.startTurn(0, 500) // monotonic ms
    expect(c.sync(2_500, 1_700_000_010_000)).toEqual({
      remainingMs: [58_000, 60_000, 60_000, 60_000],
      runningSeat: 0,
      serverTimestamp: 1_700_000_010_000,
      turnStartedAt: 1_700_000_008_000,
    })
  })
})
