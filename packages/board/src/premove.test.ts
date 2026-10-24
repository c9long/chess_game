import { Game, initRules } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { indexOf } from './geometry.ts'
import { MoveIndex } from './moves.ts'
import { choosePremove, PremoveSlot, premovesOver, premoveText } from './premove.ts'
import { TO_PROMOTION } from './test/positions.ts'

beforeAll(async () => {
  await initRules()
})

/** South to move: a rook on `rook`, West's pawn on b5 (its push goes to c5). */
const pawnAndRook = (rook: 'b1' | 'c1') =>
  `ffa 8nK7/16/16/16/16/16/16/wK14eK/16/16/16/1wP14/16/16/16/${rook === 'b1' ? '1sR6' : '2sR5'}sK7 S AAAA - - 0 0`

const sq = indexOf

describe('choosePremove', () => {
  it('takes a move from the seat’s out-of-turn moves, and nothing else', () => {
    const g = Game.create({ mode: 'ffa' })
    const west = new MoveIndex(g.movesForSeat('west'))
    const p = choosePremove(west, sq('b5'), sq('c5'), 'pawn')
    expect(p).toEqual({
      from: sq('b5'),
      to: sq('c5'),
      piece: 'pawn',
      promotion: null,
      capture: false,
      notation: 'b5c5',
    })
    expect(premoveText(p as NonNullable<typeof p>)).toBe('pawn b5 to c5')
    expect(choosePremove(west, sq('b5'), sq('e5'), 'pawn')).toBeNull()
    expect(choosePremove(west, sq('e2'), sq('e4'), 'pawn')).toBeNull() // South's pawn
    g.free()
  })

  it('promotes to a queen by default', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_PROMOTION) g.applyMove(m)
    // South to move here, so its out-of-turn moves are its legal moves.
    const p = choosePremove(new MoveIndex(g.movesForSeat('south')), sq('e8'), sq('e9'), 'pawn')
    expect(p?.promotion).toBe('queen')
    expect(p?.notation).toBe('e8e9q')
    expect(premoveText(p as NonNullable<typeof p>)).toBe('pawn e8 to e9, promotes to queen')
    g.free()
  })
})

describe('PremoveSlot', () => {
  it('holds one premove: a new one replaces it, cancel empties it', () => {
    const g = Game.create({ mode: 'ffa' })
    const west = new MoveIndex(g.movesForSeat('west'))
    const slot = new PremoveSlot()
    expect(slot.current).toBeNull()
    expect(slot.cancel()).toBeNull()
    const a = choosePremove(west, sq('b5'), sq('c5'), 'pawn')
    const b = choosePremove(west, sq('a6'), sq('c7'), 'knight')
    if (!a || !b) throw new Error('expected premoves')
    slot.set(a)
    slot.set(b)
    expect(slot.current).toBe(b)
    expect(slot.cancel()).toBe(b)
    expect(slot.current).toBeNull()
    g.free()
  })

  it('plays a premove that is still legal when the turn comes', () => {
    const g = Game.fromPosition(pawnAndRook('c1'))
    const slot = new PremoveSlot()
    const p = choosePremove(new MoveIndex(g.movesForSeat('west')), sq('b5'), sq('c5'), 'pawn')
    if (!p) throw new Error('expected a premove')
    slot.set(p)
    g.applyMove('i1i2')
    expect(slot.onPosition(g.snapshot(), 'west')).toBeNull()
    expect(slot.onTurn(new MoveIndex(g.legalMoves()))).toEqual({
      kind: 'play',
      notation: 'b5c5',
      premove: p,
    })
    expect(slot.current).toBeNull()
    // Nothing queued: nothing to do at the next turn.
    expect(slot.onTurn(new MoveIndex(g.legalMoves()))).toBeNull()
    g.free()
  })

  it('drops a premove that is no longer legal when the turn comes', () => {
    const g = Game.fromPosition(pawnAndRook('c1'))
    const slot = new PremoveSlot()
    const p = choosePremove(new MoveIndex(g.movesForSeat('west')), sq('b5'), sq('c5'), 'pawn')
    if (!p) throw new Error('expected a premove')
    slot.set(p)
    // South's rook blocks the push.
    g.applyMove('c1c5')
    expect(slot.onPosition(g.snapshot(), 'west')).toBeNull()
    expect(g.snapshot().seatToMove).toBe('west')
    expect(slot.onTurn(new MoveIndex(g.legalMoves()))).toEqual({ kind: 'drop', premove: p })
    expect(slot.current).toBeNull()
    g.free()
  })

  it('drops a premove at once when its piece is taken', () => {
    const g = Game.fromPosition(pawnAndRook('b1'))
    const slot = new PremoveSlot()
    const p = choosePremove(new MoveIndex(g.movesForSeat('west')), sq('b5'), sq('c5'), 'pawn')
    if (!p) throw new Error('expected a premove')
    slot.set(p)
    g.applyMove('b1b5')
    expect(slot.onPosition(g.snapshot(), 'west')).toEqual({ premove: p, reason: 'gone' })
    expect(slot.current).toBeNull()
    g.free()
  })

  it('drops a premove quietly when its seat stops taking turns, pieces kept or not', () => {
    for (const [mode, seat, status] of [
      ['teams', 'north', 'frozen'],
      ['ffa', 'west', 'removed'],
    ] as const) {
      const g = Game.create({ mode })
      const slot = new PremoveSlot()
      const from = seat === 'north' ? 'f16' : 'a6'
      const to = seat === 'north' ? 'e14' : 'c7'
      const p = choosePremove(new MoveIndex(g.movesForSeat(seat)), sq(from), sq(to), 'knight')
      if (!p) throw new Error('expected a premove')
      slot.set(p)
      g.applyAbandon(seat)
      const s = g.snapshot()
      expect(s.isOver).toBe(false)
      expect(s.statuses[seat === 'north' ? 2 : 1]).toBe(status)
      expect(premovesOver(s, seat)).toBe(true)
      // Out, not "gone": the step's own announcements say what happened to the seat.
      expect(slot.onPosition(s, seat)).toEqual({ premove: p, reason: 'out' })
      expect(slot.current).toBeNull()
      g.free()
    }
  })

  it('drops a premove quietly when the game ends', () => {
    const g = Game.create({ mode: 'ffa' })
    const slot = new PremoveSlot()
    const p = choosePremove(new MoveIndex(g.movesForSeat('west')), sq('a6'), sq('c7'), 'knight')
    if (!p) throw new Error('expected a premove')
    slot.set(p)
    expect(premovesOver(g.snapshot(), 'west')).toBe(false)
    g.applyAgreedDraw()
    expect(slot.onPosition(g.snapshot(), 'west')).toEqual({ premove: p, reason: 'out' })
    g.free()
  })

  it('keeps the promotion choice when the turn comes', () => {
    const g = Game.create({ mode: 'ffa' })
    for (const m of TO_PROMOTION) g.applyMove(m)
    const slot = new PremoveSlot()
    const p = choosePremove(new MoveIndex(g.movesForSeat('south')), sq('e8'), sq('e9'), 'pawn')
    if (!p) throw new Error('expected a premove')
    slot.set(p)
    expect(slot.onTurn(new MoveIndex(g.legalMoves()))).toMatchObject({
      kind: 'play',
      notation: 'e8e9q',
    })
    g.free()
  })
})
