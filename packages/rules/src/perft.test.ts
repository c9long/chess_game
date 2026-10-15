import { beforeAll, describe, expect, it } from 'vitest'
import { Game, type GameMode, initRulesSync } from './index.ts'

beforeAll(() => {
  initRulesSync()
})

/**
 * Perft driven entirely through the public TypeScript wrapper: clone, apply
 * each legal move by notation, recurse. Must match native rules-core counts
 * (crates/rules-core/tests/perft.rs).
 */
function perft(game: Game, depth: number): number {
  if (depth === 0) return 1
  const moves = game.legalMoveNotations()
  if (depth === 1) return moves.length
  let total = 0
  for (const m of moves) {
    const child = game.clone()
    child.applyMove(m)
    total += perft(child, depth - 1)
    child.free()
  }
  return total
}

/** Same, but through the structured `legalMoves()` objects at every node. */
function perftStructured(game: Game, depth: number): number {
  if (depth === 0) return 1
  const moves = game.legalMoves()
  if (depth === 1) return moves.length
  let total = 0
  for (const m of moves) {
    const child = game.clone()
    child.applyMove(m.notation)
    total += perftStructured(child, depth - 1)
    child.free()
  }
  return total
}

const NATIVE: Record<GameMode, number[]> = {
  ffa: [1, 28, 777, 21_560, 592_802],
  teams: [1, 28, 777, 21_560, 592_802],
}

describe.each(['ffa', 'teams'] as const)('perft %s', (mode) => {
  it('matches native counts to depth 3', () => {
    const game = Game.create({ mode })
    for (let d = 0; d <= 3; d++) expect(perft(game, d)).toBe(NATIVE[mode][d])
    expect(perftStructured(game, 3)).toBe(21_560)
    expect(game.perft(3)).toBe(21_560)

    const t0 = performance.now()
    const n = perft(game, 3)
    const ms = performance.now() - t0
    const t1 = performance.now()
    game.perft(3)
    const wasmMs = performance.now() - t1
    console.log(
      `[perft ${mode}] JS-side depth 3: ${n} leaves in ${ms.toFixed(1)} ms ` +
        `(${Math.round(n / (ms / 1000)).toLocaleString('en-US')} leaves/s); ` +
        `in-WASM perft(3): ${wasmMs.toFixed(1)} ms`,
    )
    game.free()
  })

  it('matches native counts at depth 4', () => {
    const game = Game.create({ mode })
    const t0 = performance.now()
    expect(perft(game, 4)).toBe(NATIVE[mode][4])
    const ms = performance.now() - t0
    const t1 = performance.now()
    expect(game.perft(4)).toBe(NATIVE[mode][4])
    const wasmMs = performance.now() - t1
    console.log(
      `[perft ${mode}] JS-side depth 4: ${ms.toFixed(0)} ms; in-WASM perft(4): ${wasmMs.toFixed(0)} ms`,
    )
    game.free()
  })
})
