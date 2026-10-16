/**
 * Review (attack) test for the draw-offer lapse rule: an offer made by a defeated Teams seat
 * that passes automatically (RULES "Stalemate is a loss": a defeated Teams player with no
 * legal move passes) is never the seat to move; its passed turn still ends the round.
 */
import { describe, expect, it } from 'vitest'
import { lapseReason } from '../game/draw-logic.ts'

describe('lapseReason', () => {
  it('an offer by a seat that keeps passing lapses after one full round', () => {
    // Teams: West (1) is defeated and passes every turn; it offered a draw. Votes: West
    // accepted, the other three pending. Play goes S -> (W passes) -> N -> E -> S -> ...
    const votes = [0, 1, 0, 0]
    const voters = [true, true, true, true] as const
    const taken = new Set<number>()
    const lapses: (string | null)[] = []
    for (let round = 0; round < 3; round++) {
      for (const [mover, passes] of [
        [0, [1]],
        [2, []],
        [3, []],
      ] as const) {
        taken.add(mover)
        for (const p of passes) taken.add(p)
        // The engine skips West (it passes), so the seat to move is never West.
        const next = mover === 0 ? 2 : mover === 2 ? 3 : 0
        lapses.push(lapseReason(votes, voters, 1, next, taken))
      }
    }
    // The offer lapses once every other voter has had a turn and West's (passed) turn came round.
    expect(lapses).toContain('round')
  })
})
