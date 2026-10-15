import { CIVILIZATIONS } from '@game/config'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CIV_IDS,
  GAME_EVENT_TYPES,
  Game,
  type GameEventType,
  type GameMode,
  initRulesSync,
  SEATS,
  type Seat,
} from './index.ts'
import { validateEvents, validateMove, validateSnapshot } from './test/validate.ts'

beforeAll(() => {
  initRulesSync()
})

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: readonly T[], r: () => number): T {
  const item = items[Math.floor(r() * items.length)]
  if (item === undefined) throw new Error('empty list')
  return item
}

describe('wire contract', () => {
  it('civ ids match @game/config', () => {
    expect([...CIV_IDS]).toEqual(CIVILIZATIONS.map((c) => c.slug))
  })

  it('every engine output in random games matches the TypeScript types exactly', () => {
    const seen = new Set<GameEventType>()
    let plies = 0
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(seed)
      const mode: GameMode = seed % 2 === 0 ? 'ffa' : 'teams'
      const game = Game.create({ mode, civs: [pick(CIV_IDS, r), 'usa', 'mali', 'japan'] })
      for (let i = 0; i < 2_000; i++) {
        const before = game.snapshot()
        validateSnapshot(before)
        if (before.isOver) break
        const moves = game.legalMoves()
        expect(moves.length).toBeGreaterThan(0)
        for (const m of moves) validateMove(m)
        let events: unknown
        const roll = r()
        if (roll < 0.004) {
          events = game.applyTimeout(before.seatToMove)
        } else if (roll < 0.008) {
          const inPlay = SEATS.filter((_, k) =>
            ['active', 'defeated'].includes(before.statuses[k] ?? ''),
          )
          events = game.applyAbandon(pick<Seat>(inPlay, r))
        } else {
          // Prefer captures so games end in a reasonable number of plies.
          const captures = moves.filter((m) => m.capture)
          const m = captures.length > 0 && r() < 0.7 ? pick(captures, r) : pick(moves, r)
          events = game.applyMove(m.notation)
          plies++
        }
        validateEvents(events)
        for (const e of events) seen.add(e.type)
        // Position strings restore the exact state.
        if (i % 25 === 0) {
          const copy = Game.fromPosition(game.positionString())
          expect(copy.snapshot()).toEqual(game.snapshot())
          copy.free()
        }
      }
      expect(game.snapshot().isOver).toBe(true)
      game.free()
    }
    // Passes are rare in random play; they are covered in game.test.ts.
    const expected = GAME_EVENT_TYPES.filter((t) => t !== 'pass')
    expect([...seen].filter((t) => t !== 'pass').sort()).toEqual([...expected].sort())
    expect(plies).toBeGreaterThan(1_000)
  }, 60_000) // CPU-bound (~4 s alone); generous for loaded machines and parallel runs
})

// Compile-time check that GAME_EVENT_TYPES lists every event type.
type Missing = Exclude<GameEventType, (typeof GAME_EVENT_TYPES)[number]>
const _complete: Missing extends never ? true : false = true
void _complete
