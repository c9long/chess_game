import { describe, expect, it } from 'vitest'
import {
  ELO_START,
  type EloEntrant,
  expectedScore,
  kFactor,
  newEloPlayer,
  pairScore,
  rateElo,
  rateFfa,
  rateTeams,
} from './elo.ts'

/** [rating, games, peak, placement] per seat (team = seat % 2). */
type Row = [number, number, number, number]
const entrants = (rows: Row[]): EloEntrant[] =>
  rows.map(([rating, games, peak, placement], seat) => ({
    seat,
    team: seat % 2,
    rating,
    games,
    peak,
    placement,
  }))
const deltas = (rs: { delta: number }[]) => rs.map((r) => r.delta)

describe('Elo building blocks', () => {
  it('starts everyone at 1200', () => {
    expect(ELO_START).toBe(1200)
    expect(newEloPlayer()).toEqual({ rating: 1200, games: 0, peak: 1200 })
  })

  it('uses the FIDE K factors: 40 for 30 games, then 20, 10 once the peak reached 2400', () => {
    expect(kFactor({ rating: 1200, games: 0, peak: 1200 })).toBe(40)
    expect(kFactor({ rating: 2500, games: 29, peak: 2500 })).toBe(40)
    expect(kFactor({ rating: 1800, games: 30, peak: 1850 })).toBe(20)
    expect(kFactor({ rating: 2399, games: 120, peak: 2399 })).toBe(20)
    expect(kFactor({ rating: 2400, games: 30, peak: 2400 })).toBe(10)
    // Once reached, K stays 10 even after dropping below 2400.
    expect(kFactor({ rating: 2350, games: 80, peak: 2410 })).toBe(10)
  })

  it('computes the logistic expected score and pairwise results', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5)
    expect(expectedScore(1600, 1200)).toBeCloseTo(10 / 11, 12)
    expect(expectedScore(1200, 1600)).toBeCloseTo(1 / 11, 12)
    expect(pairScore(1, 2)).toBe(1)
    expect(pairScore(3, 2)).toBe(0)
    expect(pairScore(1, 1)).toBe(0.5)
  })
})

describe('free-for-all Elo (golden values)', () => {
  it('four new players at 1200: +20, +7, -7, -20', () => {
    const r = rateFfa(
      entrants([
        [1200, 0, 1200, 1],
        [1200, 0, 1200, 2],
        [1200, 0, 1200, 3],
        [1200, 0, 1200, 4],
      ]),
    )
    expect(deltas(r)).toEqual([20, 7, -7, -20])
    expect(r.map((x) => x.after)).toEqual([1220, 1207, 1193, 1180])
    expect(r.map((x) => x.before)).toEqual([1200, 1200, 1200, 1200])
  })

  it('mixed ratings and K factors', () => {
    // Raw: -8.3255, +23.4633, -10.0156, +1.6017
    const r = rateFfa(
      entrants([
        [1500, 40, 1550, 3],
        [1300, 10, 1300, 1],
        [1200, 0, 1200, 4],
        [1400, 35, 1400, 2],
      ]),
    )
    expect(deltas(r)).toEqual([-8, 23, -10, 2])
  })

  it('a tie for first (agreed draw or move-limit tie, 1-1-3-4)', () => {
    // Raw: +14.2862, +3.5248, -4.6892, -11.9574
    const r = rateFfa(
      entrants([
        [1200, 0, 1200, 1],
        [1300, 50, 1350, 1],
        [1250, 50, 1250, 3],
        [1100, 5, 1100, 4],
      ]),
    )
    expect(deltas(r)).toEqual([14, 4, -5, -12])
  })

  it('a four-way tie moves ratings toward each other', () => {
    // Raw: +15.1758, +2.7273, -2.7273, -7.5879
    const r = rateFfa(
      entrants([
        [1200, 0, 1200, 1],
        [1400, 50, 1400, 1],
        [1600, 50, 1600, 1],
        [1800, 50, 1800, 1],
      ]),
    )
    expect(deltas(r)).toEqual([15, 3, -3, -8])
  })

  it('an upset: the lowest-rated player wins, the 2500 finishes last', () => {
    // Raw: -9.8114 (K 10), +39.2457 (K 40), +6.6457, -6.6457
    const r = rateFfa(
      entrants([
        [2500, 100, 2550, 4],
        [1000, 3, 1000, 1],
        [1500, 30, 1500, 2],
        [2000, 60, 2000, 3],
      ]),
    )
    expect(deltas(r)).toEqual([-10, 39, 7, -7])
  })

  it('equal K factors keep the total unchanged (before rounding)', () => {
    const r = rateFfa(
      entrants([
        [1234, 50, 1300, 2],
        [1456, 50, 1500, 4],
        [1678, 50, 1700, 1],
        [1890, 50, 1900, 3],
      ]),
    )
    expect(Math.abs(deltas(r).reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(2)
  })
})

describe('Teams Elo (golden values)', () => {
  it('four new players: the winners +20, the losers -20', () => {
    const r = rateTeams(
      entrants([
        [1200, 0, 1200, 1],
        [1200, 0, 1200, 2],
        [1200, 0, 1200, 1],
        [1200, 0, 1200, 2],
      ]),
    )
    expect(deltas(r)).toEqual([20, -20, 20, -20])
  })

  it('an upset: team mean 1200 beats team mean 1800, each player with their own K', () => {
    // E = 1 / (1 + 10^1.5) = 0.0307; raw: +19.3869 (K 20), -19.3869 (K 20),
    // +38.7739 (K 40), -9.6935 (K 10: peak 2450)
    const r = rateTeams(
      entrants([
        [1300, 40, 1300, 1],
        [1700, 40, 1750, 2],
        [1100, 10, 1100, 1],
        [1900, 40, 2450, 2],
      ]),
    )
    expect(deltas(r)).toEqual([19, -19, 39, -10])
  })

  it('a draw (agreed or move limit) scores 0.5 for both teams', () => {
    // Team means 1450 vs 1300: E = 0.7034; raw: -4.0677, +4.0677, -4.0677, +8.1354
    const r = rateTeams(
      entrants([
        [1500, 40, 1500, 1],
        [1300, 40, 1300, 1],
        [1400, 40, 1400, 1],
        [1300, 5, 1300, 1],
      ]),
    )
    expect(deltas(r)).toEqual([-4, 4, -4, 8])
  })

  it('uses the best placement of each team (a defeated partner still shares the win)', () => {
    const r = rateTeams(
      entrants([
        [1200, 0, 1200, 3],
        [1200, 0, 1200, 2],
        [1200, 0, 1200, 1],
        [1200, 0, 1200, 4],
      ]),
    )
    expect(deltas(r)).toEqual([20, -20, 20, -20])
  })
})

describe('rateElo', () => {
  it('dispatches on the mode', () => {
    const rows = entrants([
      [1200, 0, 1200, 1],
      [1200, 0, 1200, 2],
      [1200, 0, 1200, 1],
      [1200, 0, 1200, 2],
    ])
    expect(deltas(rateElo('teams', rows))).toEqual([20, -20, 20, -20])
    // FFA: seats 0 and 2 tie for first, 1 and 3 tie for second.
    expect(deltas(rateElo('ffa', rows))).toEqual([13, -13, 13, -13])
  })

  it('never returns -0', () => {
    const r = rateFfa(
      entrants([
        [1200, 50, 1200, 1],
        [1200, 50, 1200, 1],
      ]),
    )
    expect(r.map((x) => Object.is(x.delta, -0))).toEqual([false, false])
  })
})
