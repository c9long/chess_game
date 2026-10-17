import { Game, type GameEvent, initRules, type Snapshot } from '@game/rules'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AnnounceBatcher,
  type AnnounceContext,
  DEFAULT_ANNOUNCE,
  describeBareMove,
  describeResult,
  describeSquare,
  describeStep,
  describeTurn,
  repeatable,
} from './announce.ts'
import { indexOf } from './geometry.ts'
import { CASTLE_READY, EN_PASSANT_READY, KING_HUNT, TO_PROMOTION } from './test/positions.ts'

beforeAll(async () => {
  await initRules()
})

function step(g: Game, act: (g: Game) => GameEvent[], ctx: AnnounceContext = DEFAULT_ANNOUNCE) {
  const prev = g.snapshot()
  const events = act(g)
  const next = g.snapshot()
  return { text: describeStep(prev, next, events, ctx), prev, next, events }
}

const you = (seat: 'south' | 'west' | 'north' | 'east'): AnnounceContext => ({
  ...DEFAULT_ANNOUNCE,
  localSeat: seat,
})

describe('describeStep', () => {
  it('names the seat, the piece and both squares of a quiet move', () => {
    const g = Game.create({ mode: 'ffa' })
    expect(step(g, (x) => x.applyMove('e2e4')).text).toEqual(['South: pawn e2 to e4.'])
    expect(step(g, (x) => x.applyMove('a6c7')).text).toEqual(['West: knight a6 to c7.'])
    g.free()
  })

  it('speaks to the viewer about their own moves', () => {
    const g = Game.create({ mode: 'ffa' })
    expect(step(g, (x) => x.applyMove('e2e4'), you('south')).text).toEqual(['You: pawn e2 to e4.'])
    g.free()
  })

  it('describes a capture, the defeat it causes and whose pieces they were', () => {
    const g = Game.fromPosition(KING_HUNT)
    const { text } = step(g, (x) => x.applyMove('i1i16'), you('north'))
    expect(text[0]).toBe('South: queen i1 to i16, takes your king.')
    expect(text).toContain('You are defeated: leader captured.')
    g.free()
  })

  it('describes castling and en passant', () => {
    const g = Game.fromPosition(CASTLE_READY)
    expect(step(g, (x) => x.applyMove('i1k1')).text).toEqual([
      'South castled: king i1 to k1, rook l1 to j1.',
    ])
    g.free()
    const e = Game.fromPosition(EN_PASSANT_READY)
    step(e, (x) => x.applyMove('e2e4'))
    expect(step(e, (x) => x.applyMove('d4e3')).text[0]).toBe(
      "West: pawn d4 to e3, takes South's pawn en passant.",
    )
    e.free()
  })

  it('describes a promotion', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_PROMOTION) g.applyMove(m)
    const legal = g.legalMoveNotations().find((m) => m.startsWith('e8e9'))
    expect(legal).toBeDefined()
    const { text } = step(g, (x) => x.applyMove('e8e9q'))
    expect(text[0]).toBe('South: pawn e8 to e9, promotes to queen.')
    g.free()
  })

  it('announces a check that appears, once', () => {
    // South's queen moves next to North's king's file.
    const g = Game.fromPosition(
      'ffa 8nK7/16/16/16/16/16/16/wK15/16/16/16/16/16/16/16/sK6sQ7eK S AAAA - - 0 0',
    )
    const first = step(g, (x) => x.applyMove('h1i1'))
    expect(first.next.leaderUnderAttack[2]).toBe(true)
    expect(first.text).toContain("Check: North's king is under attack.")
    // Still attacked after the next move: not repeated.
    const second = step(g, (x) => x.applyMove(x.legalMoveNotations()[0] as string))
    expect(second.text.some((t) => t.startsWith("Check: North's"))).toBe(false)
    g.free()
  })

  it("leaves the viewer's own check to the host when asked", () => {
    const g = Game.fromPosition(
      'ffa 8nK7/16/16/16/16/16/16/wK15/16/16/16/16/16/16/16/sK6sQ7eK S AAAA - - 0 0',
    )
    const ctx = { ...DEFAULT_ANNOUNCE, localSeat: 'north' as const, ownCheck: false }
    const { text } = step(g, (x) => x.applyMove('h1i1'), ctx)
    expect(text.some((t) => t.startsWith('Check: your'))).toBe(false)
    // Other seats' checks are still said (the queen also attacks West's king).
    expect(text).toContain("Check: West's king is under attack.")
    g.free()
  })

  it('announces timeouts, abandons and the result', () => {
    const g = Game.create({ mode: 'ffa' })
    expect(step(g, (x) => x.applyTimeout('south')).text).toContain(
      'South is defeated: out of time.',
    )
    step(g, (x) => x.applyAbandon('north'))
    const last = step(g, (x) => x.applyAbandon('east'), you('west'))
    expect(last.text).toContain('East is defeated: left the game.')
    expect(last.text[last.text.length - 1]).toBe('Game over. You win.')
    g.free()
  })

  it('says an elimination that ends a solo game as such, not as an agreed draw', () => {
    // A host (singleplayer FFA) ends the game as a draw as soon as its player is out.
    const g = Game.fromPosition(KING_HUNT)
    const prev = g.snapshot()
    const events = [...g.applyMove('i1i16'), ...g.applyAgreedDraw()]
    const next = g.snapshot()
    const text = describeStep(prev, next, events, you('north'))
    expect(text).toContain('You are defeated: leader captured.')
    const last = text[text.length - 1] as string
    expect(last).toMatch(/^Game over\. You were eliminated, so the game ends here\. /)
    expect(last).toContain('share first place.')
    expect(text.join(' ')).not.toContain('agreement')
    g.free()
    // A real agreed draw (nobody knocked out in that step) is still one.
    const d = Game.create({ mode: 'ffa' })
    const before = d.snapshot()
    const drawn = d.applyAgreedDraw()
    expect(describeStep(before, d.snapshot(), drawn).at(-1)).toBe('Game over. A draw by agreement.')
    const outcome = d.snapshot().outcome
    expect(outcome).not.toBeNull()
    if (outcome) expect(describeResult(outcome.result)).toBe('Game over. A draw by agreement.')
    d.free()
  })

  it('tells a seat with several leaders when another one comes under attack', () => {
    const g = Game.create({ mode: 'ffa', civs: ['england', 'mali', 'mali', 'mali'] })
    const base = g.snapshot()
    g.free()
    const at = (squares: string[]): Snapshot =>
      ({
        ...base,
        leaderUnderAttack: [squares.length > 0, false, false, false],
        attackedLeaderSquares: [squares, [], [], []],
      }) as unknown as Snapshot
    const one = describeStep(at([]), at(['f1']), [])
    expect(one).toEqual(["Check: South's prime minister on f1 is under attack."])
    // Another Prime Minister attacked too: said again, naming both.
    expect(describeStep(at(['f1']), at(['f1', 'h1']), [])).toEqual([
      "Check: South's prime ministers on f1 and h1 are under attack.",
    ])
    // The same one still attacked, or one fewer: nothing new.
    expect(describeStep(at(['f1', 'h1']), at(['f1', 'h1']), [])).toEqual([])
    expect(describeStep(at(['f1', 'h1']), at(['h1']), [])).toEqual([])
  })

  it('names a winning team and a frozen army in Teams', () => {
    const g = Game.create({ mode: 'teams' })
    const a = step(g, (x) => x.applyTimeout('south'))
    expect(a.text).toContain('South is defeated: out of time.')
    expect(a.text).toContain("South's army is frozen.")
    // West moves, then North runs out of time too.
    step(g, (x) => x.applyMove('a6c7'))
    const b = step(g, (x) => x.applyTimeout('north'), you('east'))
    expect(b.text[b.text.length - 1]).toBe('Game over. Your team (West and East) wins.')
    g.free()
  })
})

describe('describeTurn', () => {
  it("says the viewer's turn, with their check", () => {
    const g = Game.fromPosition(
      'ffa 8nK7/16/16/16/16/16/16/wK15/16/16/16/16/16/16/16/sK6sQ7eK S AAAA - - 0 0',
    )
    expect(describeTurn(g.snapshot(), you('south'))).toBe('Your move.')
    g.applyMove('h1i1')
    expect(describeTurn(g.snapshot(), you('west'))).toBe(
      'Your move. Check: your king is under attack.',
    )
    g.free()
  })
})

describe('describeBareMove and describeSquare', () => {
  let snap: Snapshot
  beforeAll(() => {
    const g = Game.create({ mode: 'ffa' })
    g.applyMove('e2e4')
    snap = g.snapshot()
    g.free()
  })

  it('describes a move from the board difference', () => {
    expect(describeBareMove(snap, indexOf('e2'), indexOf('e4'), 'south')).toBe(
      'South: pawn e2 to e4.',
    )
  })

  it('says what a square holds', () => {
    expect(describeSquare(snap, indexOf('e4'))).toBe('e4, South pawn')
    expect(describeSquare(snap, indexOf('e5'))).toBe('e5, empty')
    expect(describeSquare(snap, indexOf('i1'), you('south'))).toBe('i1, your king')
    expect(describeSquare(snap, indexOf('a6'))).toBe('a6, West knight')
  })
})

describe('AnnounceBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads moves that arrive close together as one announcement', () => {
    vi.useFakeTimers()
    const spoken: string[] = []
    const a = new AnnounceBatcher((t) => spoken.push(t), { quietMs: 500, maxWaitMs: 2000 })
    a.queue(['West: knight a6 to c7.'])
    vi.advanceTimersByTime(300)
    a.queue(['North: pawn e15 to e14.'])
    vi.advanceTimersByTime(499)
    expect(spoken).toEqual([])
    vi.advanceTimersByTime(1)
    expect(spoken).toEqual(['West: knight a6 to c7. North: pawn e15 to e14.'])
  })

  it('never waits longer than maxWaitMs, and the own move goes out soon', () => {
    vi.useFakeTimers()
    const spoken: string[] = []
    const a = new AnnounceBatcher((t) => spoken.push(t), { quietMs: 500, maxWaitMs: 1000 })
    for (let i = 0; i < 5; i++) {
      a.queue([`m${i}.`])
      vi.advanceTimersByTime(300)
    }
    expect(spoken[0]).toBe('m0. m1. m2. m3.')
    vi.advanceTimersByTime(1000)
    a.queue(['You: pawn e2 to e4.'], true)
    vi.advanceTimersByTime(150)
    expect(spoken[spoken.length - 1]).toBe('You: pawn e2 to e4.')
    a.queue(['dropped.'])
    a.cancel()
    vi.advanceTimersByTime(5000)
    expect(spoken[spoken.length - 1]).toBe('You: pawn e2 to e4.')
  })

  it('makes identical cursor text differ so it is read again', () => {
    expect(repeatable('Not your turn', '')).toBe('Not your turn')
    const again = repeatable('Not your turn', 'Not your turn')
    expect(again).not.toBe('Not your turn')
    expect(again.trim()).toBe('Not your turn')
  })
})
