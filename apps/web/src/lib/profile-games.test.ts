import type { ProfileGame, ProfileGamePlayer } from '@game/protocol'
import { describe, expect, it } from 'vitest'
import { playedOnLabel, sidesOf } from './profile-games.ts'

const seat = (n: number, team: number | null = null): ProfileGamePlayer => ({
  seat: n,
  team,
  kind: 'bot',
  name: 'Bot 1200',
  civ: 'japan',
  placement: n + 1,
})

const game = (over: Partial<ProfileGame> = {}): ProfileGame => ({
  playedOn: '2026-10-20',
  mode: 'ffa',
  timeControl: '10+0',
  ranked: false,
  rated: false,
  rulesVersion: 3,
  endReason: 'checkmate',
  seat: 0,
  team: null,
  civ: 'england',
  placement: 1,
  ratingDelta: null,
  others: [seat(1), seat(2), seat(3)],
  ...over,
})

describe('playedOnLabel', () => {
  it('shows the UTC day as that calendar day, in any time zone', () => {
    expect(playedOnLabel('2026-10-24')).toBe(
      new Date(2026, 9, 24).toLocaleDateString(undefined, { dateStyle: 'medium' }),
    )
    expect(playedOnLabel('garbage')).toBe('garbage')
  })
})

describe('sidesOf', () => {
  it('puts everyone against the owner in free-for-all', () => {
    const g = game()
    expect(sidesOf(g)).toEqual({ partners: [], opponents: g.others })
  })

  it('splits a teams game into the partner and the other team', () => {
    const g = game({
      mode: 'teams',
      seat: 1,
      team: 1,
      others: [seat(0, 0), seat(2, 0), seat(3, 1)],
    })
    const { partners, opponents } = sidesOf(g)
    expect(partners.map((p) => p.seat)).toEqual([3])
    expect(opponents.map((p) => p.seat)).toEqual([0, 2])
  })
})
