import { describe, expect, it } from 'vitest'
import { visibleFrameIndex, wrappedRound } from './match-room.ts'

describe('wrappedRound', () => {
  it('counts a new round when the mover hands the turn to the same or an earlier seat', () => {
    expect(wrappedRound(0, 1, 0)).toBe(false)
    expect(wrappedRound(3, 0, 3)).toBe(true)
    // North moves, East is out: back to South.
    expect(wrappedRound(2, 0, 2)).toBe(true)
    // Everyone else passed: the mover moves again.
    expect(wrappedRound(1, 1, 1)).toBe(true)
    // West moves, North is out: East next, same round.
    expect(wrappedRound(1, 3, 1)).toBe(false)
  })

  it('only counts an off-turn action when the turn pointer went back', () => {
    // East resigns while South is to move: nothing changes.
    expect(wrappedRound(0, 0, 3)).toBe(false)
    expect(wrappedRound(2, 1, 3)).toBe(true)
  })

  it('ignores a finished game', () => {
    expect(wrappedRound(3, -1, 3)).toBe(false)
  })
})

describe('visibleFrameIndex', () => {
  // Frame 0 is the start; four actions per round.
  const rounds = [0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3]

  it('shows the start until a round is at least two full rounds old', () => {
    expect(visibleFrameIndex(rounds.slice(0, 5), 1, 2)).toBe(0)
    expect(visibleFrameIndex(rounds.slice(0, 9), 2, 2)).toBe(0)
  })

  it('shows the end of the round before the last two complete ones', () => {
    expect(visibleFrameIndex(rounds.slice(0, 13), 3, 2)).toBe(4)
    expect(visibleFrameIndex(rounds, 4, 2)).toBe(8)
  })

  it('shows everything with no delay', () => {
    expect(visibleFrameIndex(rounds, 4, 0)).toBe(13)
  })
})
