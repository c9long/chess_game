import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Game, initRules, initRulesSync, isRulesReady } from './index.ts'

// Each vitest file gets a fresh module graph, so this file sees an
// uninitialized engine.
describe('initRules', () => {
  it('refuses to create games before init', () => {
    expect(isRulesReady()).toBe(false)
    expect(() => Game.create({ mode: 'ffa' })).toThrow('call `await initRules()` first')
  })

  it('loads the bundled .wasm in Node (file: URL) and is idempotent', async () => {
    await Promise.all([initRules(), initRules()])
    expect(isRulesReady()).toBe(true)
    await initRules()
    initRulesSync(readFileSync(new URL('../wasm/rules_wasm_bg.wasm', import.meta.url)))
    const game = Game.create({ mode: 'ffa' })
    expect(game.legalMoves()).toHaveLength(30)
    game.free()
  })
})
