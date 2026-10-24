/**
 * @game/rules: the Rust rules engine (crates/rules-core via crates/rules-wasm)
 * for the browser and the Node server, with typed results.
 *
 * ```ts
 * import { Game, initRules } from '@game/rules'
 * await initRules() // browser (Vite) or Node; or initRulesSync() in Node
 * const game = Game.create({ mode: 'ffa' })
 * const events = game.applyMove('c2b3')
 * const snap = game.snapshot()
 * ```
 *
 * Never re-implement rules in TypeScript: ask the engine.
 */

export { Game } from './game.ts'
export {
  assertRulesReady,
  initRules,
  initRulesSync,
  isRulesReady,
  isSupportedRulesVersion,
  MIN_SUPPORTED_RULES_VERSION,
  RULES_VERSION,
  type WasmBytes,
  type WasmSource,
} from './init.ts'
export * from './types.ts'
