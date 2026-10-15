import { Game, type GameEvent, initRules, type Snapshot } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { indexOf } from './geometry.ts'
import { type AnimationPlan, planTransition, soundCues } from './plan.ts'
import { CASTLE_READY, KING_HUNT, TO_EN_PASSANT, TO_PROMOTION } from './test/positions.ts'

beforeAll(async () => {
  await initRules()
})

/** Applies `act` and returns the plan, built with and without the events. */
function step(
  g: Game,
  act: (g: Game) => GameEvent[],
): { withEvents: AnimationPlan; diffOnly: AnimationPlan; prev: Snapshot; next: Snapshot } {
  const prev = g.snapshot()
  const events = act(g)
  const next = g.snapshot()
  return {
    withEvents: planTransition(prev, next, events),
    diffOnly: planTransition(prev, next),
    prev,
    next,
  }
}

const moves = (p: AnimationPlan) =>
  p.moves.map((m) => ({
    from: m.from,
    to: m.to,
    kind: m.piece.kind,
    promoteTo: m.promoteTo,
    rook: m.castleRook,
  }))

describe('planTransition', () => {
  it('slides a quiet move', () => {
    const g = Game.create({ mode: 'ffa' })
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('e2e4'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('e2'), to: indexOf('e4'), kind: 'pawn', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([])
      expect(p.dissolves).toEqual([])
      expect(p.appears).toEqual([])
      expect(p.seatToMoveChanged).toBe(true)
      expect(p.incremental).toBe(true)
      expect(soundCues(p)).toEqual(['move'])
    }
    g.free()
  })

  it('captures on the destination', () => {
    const g = Game.create({ mode: 'ffa' })
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('c2b3'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('c2'), to: indexOf('b3'), kind: 'pawn', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([
        { square: indexOf('b3'), piece: { kind: 'pawn', owner: 'west' }, onDestination: true },
      ])
      expect(soundCues(p)[0]).toBe('capture')
    }
    g.free()
  })

  it('moves both pieces of a castle, leader first', () => {
    const g = Game.fromPosition(CASTLE_READY)
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('g1i1'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('g1'), to: indexOf('i1'), kind: 'king', promoteTo: null, rook: false },
        { from: indexOf('j1'), to: indexOf('h1'), kind: 'rook', promoteTo: null, rook: true },
      ])
      expect(p.captures).toEqual([])
      expect(p.incremental).toBe(true)
      expect(soundCues(p)).toEqual(['castle'])
    }
    g.free()
  })

  it('removes the right pawn en passant', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_EN_PASSANT) g.applyMove(m)
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('d5c6'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('d5'), to: indexOf('c6'), kind: 'pawn', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([
        { square: indexOf('d6'), piece: { kind: 'pawn', owner: 'west' }, onDestination: false },
      ])
    }
    g.free()
  })

  it('promotes the moving pawn', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_PROMOTION) g.applyMove(m)
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('e6e7q'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('e6'), to: indexOf('e7'), kind: 'pawn', promoteTo: 'queen', rook: false },
      ])
      expect(soundCues(p)).toEqual(['move', 'promotion'])
    }
    g.free()
  })

  it('dissolves an army removed by an FFA timeout', () => {
    const g = Game.create({ mode: 'ffa' })
    const { withEvents, diffOnly } = step(g, (x) => x.applyTimeout('south'))
    for (const p of [withEvents, diffOnly]) {
      expect(p.moves).toEqual([])
      expect(p.captures).toEqual([])
      expect(p.dissolves).toHaveLength(16)
      expect(p.dissolves.every((d) => d.piece.owner === 'south')).toBe(true)
      expect(p.statusChanges).toEqual([{ seat: 'south', status: 'removed' }])
      expect(soundCues(p)).toEqual(['defeat'])
    }
    g.free()
  })

  it('captures a leader and dissolves the rest of that army (FFA)', () => {
    const g = Game.fromPosition(KING_HUNT)
    const { withEvents, diffOnly } = step(g, (x) => x.applyMove('g1g12'))
    for (const p of [withEvents, diffOnly]) {
      expect(moves(p)).toEqual([
        { from: indexOf('g1'), to: indexOf('g12'), kind: 'queen', promoteTo: null, rook: false },
      ])
      expect(p.captures).toEqual([
        { square: indexOf('g12'), piece: { kind: 'king', owner: 'north' }, onDestination: true },
      ])
      expect(p.dissolves).toEqual([
        { square: indexOf('c11'), piece: { kind: 'pawn', owner: 'north' } },
      ])
      expect(p.statusChanges).toEqual([{ seat: 'north', status: 'removed' }])
      expect(soundCues(p)).toEqual(['capture', 'defeat'])
    }
    g.free()
  })

  it('freezes a Teams seat that times out without touching the board', () => {
    const g = Game.create({ mode: 'teams' })
    const { withEvents, diffOnly } = step(g, (x) => x.applyTimeout('south'))
    for (const p of [withEvents, diffOnly]) {
      expect(p.moves).toEqual([])
      expect(p.captures).toEqual([])
      expect(p.dissolves).toEqual([])
      expect(p.statusChanges).toEqual([{ seat: 'south', status: 'frozen' }])
      expect(soundCues(p)).toEqual(['freeze'])
    }
    g.free()
  })

  it('reports a position jump as non-incremental appearances', () => {
    const start = Game.create({ mode: 'ffa' })
    const other = Game.fromPosition(KING_HUNT)
    const p = planTransition(start.snapshot(), other.snapshot())
    expect(p.incremental).toBe(false)
    expect(p.appears.length + p.moves.length).toBeGreaterThan(0)
    start.free()
    other.free()
  })
})
