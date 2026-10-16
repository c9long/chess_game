/**
 * Review attack: Elo math against independent hand computation (Python reference, see the
 * review notes). FFA pairwise with ties, upsets, K transitions at 30 games and 2400, Teams
 * averages, and rounding drift.
 */
import { describe, expect, it } from 'vitest'
import { type EloEntrant, kFactor, rateFfa, rateTeams } from './elo.ts'

type Row = [rating: number, games: number, peak: number, placement: number]
const ents = (rows: Row[]): EloEntrant[] =>
  rows.map(([rating, games, peak, placement], seat) => ({
    seat,
    team: seat % 2,
    rating,
    games,
    peak,
    placement,
  }))
const d = (rs: { delta: number }[]) => rs.map((r) => r.delta)

describe('attack: FFA Elo golden values', () => {
  it('two-way tie for first among new players', () => {
    expect(
      d(
        rateFfa(
          ents([
            [1200, 0, 1200, 1],
            [1200, 0, 1200, 1],
            [1200, 0, 1200, 3],
            [1200, 0, 1200, 4],
          ]),
        ),
      ),
    ).toEqual([13, 13, -7, -20])
  })

  it('upset: the lowest-rated wins', () => {
    expect(
      d(
        rateFfa(
          ents([
            [1000, 50, 1100, 1],
            [1600, 50, 1700, 2],
            [1500, 50, 1500, 3],
            [1400, 50, 1400, 4],
          ]),
        ),
      ),
    ).toEqual([19, -2, -6, -10])
  })

  it('K boundaries: 29 games K40, 30 games at 2400 K10, 30 games below 2400 K20', () => {
    expect(kFactor({ rating: 2400, games: 29, peak: 2400 })).toBe(40)
    expect(kFactor({ rating: 2400, games: 30, peak: 2400 })).toBe(10)
    expect(kFactor({ rating: 2399, games: 30, peak: 2399 })).toBe(20)
    expect(
      d(
        rateFfa(
          ents([
            [2400, 29, 2400, 1],
            [2400, 30, 2400, 1],
            [1800, 30, 1800, 1],
            [1800, 29, 1800, 4],
          ]),
        ),
      ),
    ).toEqual([-6, -1, 10, -7])
  })

  it('three-way tie behind a winner (drift: sum -1)', () => {
    const r = rateFfa(
      ents([
        [1500, 5, 1500, 2],
        [1500, 5, 1500, 2],
        [1500, 5, 1500, 2],
        [1500, 5, 1500, 1],
      ]),
    )
    expect(d(r)).toEqual([-7, -7, -7, 20])
    expect(d(r).reduce((a, b) => a + b, 0)).toBe(-1)
  })
})

describe('attack: Teams Elo golden values', () => {
  it('team means, each player own K (one with peak >= 2400)', () => {
    expect(
      d(
        rateTeams(
          ents([
            [1000, 10, 1000, 2],
            [1600, 40, 1650, 1],
            [1400, 40, 2450, 2],
            [1800, 40, 1800, 1],
          ]),
        ),
      ),
    ).toEqual([-2, 1, -1, 1])
  })

  it('upset win for the weaker team', () => {
    expect(
      d(
        rateTeams(
          ents([
            [1000, 10, 1000, 1],
            [1600, 40, 1650, 2],
            [1400, 40, 2450, 1],
            [1800, 40, 1800, 2],
          ]),
        ),
      ),
    ).toEqual([38, -19, 9, -19])
  })

  it('agreed draw (all placements 1)', () => {
    expect(
      d(
        rateTeams(
          ents([
            [1300, 10, 1300, 1],
            [1200, 40, 1250, 1],
            [1500, 40, 1500, 1],
            [1700, 40, 1700, 1],
          ]),
        ),
      ),
    ).toEqual([3, -1, 1, -1])
  })
})
