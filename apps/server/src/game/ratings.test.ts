import { describe, expect, it } from 'vitest'
import {
  DISPLAY_BASE,
  defaultBotAnchor,
  defaultRating,
  displayRating,
  poolForGame,
  type RatedSeat,
  type RatingEntrant,
  rateGame,
} from './ratings.ts'

const fresh = (seat: number, placement: number, team = seat % 2): RatingEntrant => ({
  seat,
  team,
  placement,
  rating: defaultRating(),
})

describe('display rating', () => {
  it('maps a new player to the base and is the inverse of the bot anchors', () => {
    expect(displayRating(defaultRating())).toBe(DISPLAY_BASE)
    expect(displayRating(defaultBotAnchor('1500'))).toBe(1500)
    expect(displayRating(defaultBotAnchor('600'))).toBe(600)
    expect(displayRating(defaultBotAnchor('max'))).toBe(2700)
  })
})

describe('rateGame', () => {
  it('FFA: orders new ratings by placement', () => {
    const next = rateGame('ffa', [fresh(0, 3), fresh(1, 1), fresh(2, 4), fresh(3, 2)])
    const mu = (s: number) => next.get(s)?.mu ?? 0
    expect(mu(1)).toBeGreaterThan(mu(3))
    expect(mu(3)).toBeGreaterThan(mu(0))
    expect(mu(0)).toBeGreaterThan(mu(2))
    for (const s of [0, 1, 2, 3]) expect(next.get(s)?.sigma).toBeLessThan(defaultRating().sigma)
  })

  it('FFA: tied placements (move-limit tie) move tied players alike', () => {
    const next = rateGame('ffa', [fresh(0, 1), fresh(1, 1), fresh(2, 3), fresh(3, 4)])
    const mu = (s: number) => next.get(s)?.mu ?? 0
    expect(mu(0)).toBeCloseTo(mu(1), 6)
    expect(mu(0)).toBeGreaterThan(mu(2))
    expect(mu(2)).toBeGreaterThan(mu(3))
    // A tie for 1st sits between outright 1st and 2nd of the untied finish.
    const strict = rateGame('ffa', [fresh(0, 1), fresh(1, 2), fresh(2, 3), fresh(3, 4)])
    expect(mu(0)).toBeLessThan(strict.get(0)?.mu ?? 0)
    expect(mu(0)).toBeGreaterThan(strict.get(1)?.mu ?? 0)
    expect(mu(2)).toBeCloseTo(strict.get(2)?.mu ?? 0, 6)
    // All four surviving (move-limit tie, equal ratings): nobody moves.
    const all = rateGame('ffa', [fresh(0, 1), fresh(1, 1), fresh(2, 1), fresh(3, 1)])
    for (const s of [0, 1, 2, 3]) expect(all.get(s)?.mu).toBeCloseTo(25, 6)
  })

  it('Teams: the winning team gains and teammates move together', () => {
    const next = rateGame('teams', [fresh(0, 1), fresh(1, 2), fresh(2, 1), fresh(3, 2)])
    const base = defaultRating().mu
    expect(next.get(0)?.mu).toBeGreaterThan(base)
    expect(next.get(2)?.mu).toBeCloseTo(next.get(0)?.mu ?? 0, 6)
    expect(next.get(1)?.mu).toBeLessThan(base)
    expect(next.get(3)?.mu).toBeCloseTo(next.get(1)?.mu ?? 0, 6)
  })

  it('Teams draw: equal teams stay equal', () => {
    const next = rateGame('teams', [fresh(0, 1), fresh(1, 1), fresh(2, 1), fresh(3, 1)])
    expect(next.get(0)?.mu).toBeCloseTo(next.get(1)?.mu ?? 0, 6)
  })

  it('shadow: beating a strong bot anchor gains more than beating a weak one', () => {
    const vs = (level: string) =>
      rateGame('ffa', [
        fresh(0, 1),
        { seat: 1, team: 1, placement: 2, rating: defaultBotAnchor(level) },
        { seat: 2, team: 0, placement: 3, rating: defaultBotAnchor(level) },
        { seat: 3, team: 1, placement: 4, rating: defaultBotAnchor(level) },
      ]).get(0)?.mu ?? 0
    expect(vs('2400')).toBeGreaterThan(vs('600'))
  })
})

describe('poolForGame', () => {
  const human = (seat: number, isGuest = false): RatedSeat => ({
    seat,
    team: seat % 2,
    placement: seat + 1,
    userId: `u${seat}`,
    isGuest,
    botLevel: null,
  })
  const bot = (seat: number): RatedSeat => ({
    seat,
    team: seat % 2,
    placement: seat + 1,
    userId: null,
    isGuest: false,
    botLevel: '1200',
  })

  it('never feeds the retired public OpenSkill pool (public ratings are Elo)', () => {
    expect(poolForGame([human(0), human(1), human(2), human(3)])).toBeNull()
  })

  it('is shadow for casual games with bots and at least one registered human', () => {
    expect(poolForGame([human(0), bot(1), bot(2), bot(3)])).toBe('shadow')
    expect(poolForGame([human(0), human(1, true), bot(2), bot(3)])).toBe('shadow')
  })

  it('rates nothing when only guests (and bots) play, or humans with a guest and no bot', () => {
    expect(poolForGame([human(0, true), bot(1), bot(2), bot(3)])).toBeNull()
    expect(poolForGame([human(0), human(1), human(2), human(3, true)])).toBeNull()
  })
})
