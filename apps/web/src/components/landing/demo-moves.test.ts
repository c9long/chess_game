import { Game, initRulesSync, type MoveView } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_GAMES, pickDemoMove, playStillPosition, seededRandom } from './demo-moves.ts'

beforeAll(() => {
  initRulesSync()
})

describe('seededRandom', () => {
  it('replays the same sequence for the same seed', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    const xs = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(xs)
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0)
    for (const x of xs) expect(x).toBeLessThan(1)
  })
})

describe('pickDemoMove', () => {
  it('always returns one of the engine’s legal moves, and a whole game finishes', () => {
    const game = Game.create({ mode: 'ffa' })
    const ctx = { start: game.snapshot(), random: seededRandom(7) }
    let plies = 0
    try {
      while (plies < 600) {
        const legal = game.legalMoveNotations()
        const move = pickDemoMove(game, ctx)
        if (!move) break
        expect(legal).toContain(move.notation)
        game.applyMove(move.notation)
        plies++
      }
      const snap = game.snapshot()
      expect(snap.isOver || plies === 600).toBe(true)
    } finally {
      game.free()
    }
  })

  it('keeps the leader at home in the opening (unless it captures or castles)', () => {
    const game = Game.create({ mode: 'ffa' })
    const ctx = { start: game.snapshot(), random: seededRandom(1) }
    const opening: MoveView[] = []
    try {
      for (let i = 0; i < 16; i++) {
        const move = pickDemoMove(game, ctx) as MoveView
        opening.push(move)
        game.applyMove(move.notation)
      }
    } finally {
      game.free()
    }
    const walks = opening.filter((m) => m.piece === 'king' && !m.capture && m.flag !== 'castle')
    expect(walks).toEqual([])
  })

  it('returns null once the game is over', () => {
    const game = Game.create({ mode: 'ffa' })
    const ctx = { start: game.snapshot(), random: seededRandom(3) }
    try {
      game.applyAgreedDraw()
      expect(pickDemoMove(game, ctx)).toBeNull()
    } finally {
      game.free()
    }
  })
})

describe('the landing page demo games', () => {
  it.each(DEMO_GAMES.map((g, i) => [i, g] as const))(
    'game %i stays whole for the first 60 plies and ends within 400',
    (_i, g) => {
      const game = Game.create({ mode: 'ffa', civs: g.civs })
      const ctx = { start: game.snapshot(), random: seededRandom(g.seed) }
      try {
        for (let ply = 0; ply < 400 && !game.snapshot().isOver; ply++) {
          const move = pickDemoMove(game, ctx) as MoveView
          game.applyMove(move.notation)
          const snap = game.snapshot()
          if (snap.ply <= 60)
            expect(snap.statuses).toEqual(['active', 'active', 'active', 'active'])
        }
        expect(game.snapshot().isOver).toBe(true)
      } finally {
        game.free()
      }
    },
  )

  it('shows every army on the board in the still (reduced motion) position', () => {
    for (const g of DEMO_GAMES) {
      const game = Game.create({ mode: 'ffa', civs: g.civs })
      try {
        playStillPosition(game, { start: game.snapshot(), random: seededRandom(g.seed) }, 44)
        const snap = game.snapshot()
        expect(snap.ply).toBeGreaterThan(20)
        expect(snap.statuses).toEqual(['active', 'active', 'active', 'active'])
      } finally {
        game.free()
      }
    }
  })
})
