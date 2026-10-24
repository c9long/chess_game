import { beforeAll, describe, expect, it } from 'vitest'
import { Game, type GameEvent, initRulesSync, type Snapshot, squareIndex } from './index.ts'
import { validateEvents, validateMove, validateSnapshot } from './test/validate.ts'

beforeAll(() => {
  initRulesSync()
})

function play(game: Game, moves: string[]): GameEvent[][] {
  return moves.map((m) => {
    const events = game.applyMove(m)
    validateEvents(events)
    return events
  })
}

function snap(game: Game): Snapshot {
  const s = game.snapshot()
  validateSnapshot(s)
  return s
}

/** South e2 pawn, West d4 pawn (attacks e3), kings on their home squares: e2e4 allows d4xe3 e.p. */
const EP_BOARD = '8nK7/16/16/16/16/16/16/wK14eK/16/16/16/16/3wP12/16/4sP11/8sK7'
describe('Game', () => {
  it('starts in the §2 setup (16×16) with 30 legal moves for South', () => {
    const game = Game.create({ mode: 'ffa' })
    const s = snap(game)
    expect(s.seatToMove).toBe('south')
    expect(s.board).toHaveLength(256)
    expect(s.board[squareIndex('h1')]).toEqual({ kind: 'queen', owner: 'south' })
    expect(s.board[squareIndex('a9')]).toEqual({ kind: 'king', owner: 'west' })
    expect(s.board[squareIndex('p8')]).toEqual({ kind: 'queen', owner: 'east' })
    expect(s.board[squareIndex('i16')]).toEqual({ kind: 'king', owner: 'north' })
    expect(s.board[squareIndex('p16')]).toBeNull()
    expect(s.board.filter((p) => p !== null)).toHaveLength(64)
    expect(s.moveLimit).toBe(100)
    const moves = game.legalMoves()
    for (const m of moves) validateMove(m)
    expect(moves).toHaveLength(30)
    expect(moves.map((m) => m.notation).sort()).toEqual(game.legalMoveNotations().sort())
    expect(moves.some((m) => m.capture)).toBe(false)
    expect(moves.find((m) => m.notation === 'f1d2')).toEqual({
      notation: 'f1d2',
      from: 'f1',
      to: 'd2',
      promotion: null,
      flag: 'normal',
      piece: 'knight',
      capture: false,
    })
    game.free()
  })

  it('lists the moves a seat could make out of turn (premoves) without changing the turn', () => {
    const game = Game.create({ mode: 'ffa' })
    const west = game.movesForSeat('west')
    for (const m of west) validateMove(m)
    expect(west).toHaveLength(30)
    expect(west.map((m) => m.notation)).toContain('b5c5')
    expect(west.every((m) => m.from.startsWith('a') || m.from.startsWith('b'))).toBe(true)
    // The seat to move gets its own legal moves.
    expect(game.movesForSeat('south')).toEqual(game.legalMoves())
    expect(snap(game).seatToMove).toBe('south')
    expect(() => game.movesForSeat('up' as never)).toThrow('invalid seat')
    game.free()
  })

  it('plays a scripted game with a capture and a promotion', () => {
    const game = Game.create({ mode: 'ffa', civs: ['mali', 'japan', 'france', 'usa'] })
    // South's rook slides into the empty corner; West's rook takes it.
    const [, capture] = play(game, ['e1a1', 'a5a1'])
    expect(capture).toEqual([
      {
        type: 'move_made',
        seat: 'west',
        notation: 'a5a1',
        from: 'a5',
        to: 'a1',
        promotion: null,
        flag: 'normal',
        piece: 'rook',
      },
      { type: 'capture', seat: 'west', square: 'a1', captured: { kind: 'rook', owner: 'south' } },
    ])
    expect(snap(game).noProgress).toBe(0)
    // South walks its e-pawn to rank 8; the others shuffle pawns.
    play(game, [
      'j15j14',
      'o5n5',
      'e2e4',
      'b10c10',
      'j14j13',
      'n5m5',
      'e4e5',
      'b11c11',
      'i15i14',
      'o6n6',
      'e5e6',
      'c10d10',
      'j13j12',
      'o7n7',
      'e6e7',
      'c11d11',
      'i14i13',
      'o8n8',
      'e7e8',
      'b12c12',
      'h15h14',
      'o9n9',
    ])

    // A pawn reaching its promotion line (rank 9 for South) must promote.
    expect(() => game.applyMove('e8e9')).toThrow('illegal move e8e9')
    const promo = game.legalMoves().filter((m) => m.from === 'e8')
    expect(promo.map((m) => m.promotion).sort()).toEqual(['bishop', 'knight', 'queen', 'rook'])
    const [events] = play(game, ['e8e9q'])
    expect(events).toEqual([
      {
        type: 'move_made',
        seat: 'south',
        notation: 'e8e9q',
        from: 'e8',
        to: 'e9',
        promotion: 'queen',
        flag: 'normal',
        piece: 'pawn',
      },
      { type: 'promotion', seat: 'south', square: 'e9', kind: 'queen' },
    ])
    const s = snap(game)
    expect(s.board[squareIndex('e9')]).toEqual({ kind: 'queen', owner: 'south' })
    expect(s.board[squareIndex('a1')]).toEqual({ kind: 'rook', owner: 'west' })
    expect(s.ply).toBe(25)
    expect(s.seatToMove).toBe('west')
    expect(s.config.civs.map((c) => c.id)).toEqual(['mali', 'japan', 'france', 'usa'])
    game.free()
  })

  it('has no en passant in the current rules version, only when replaying version 2', () => {
    const current = Game.fromPosition(`ffa ${EP_BOARD} S AAAA - - 0 0`)
    play(current, ['e2e4'])
    expect(snap(current).epTargets).toEqual([null, null, null, null])
    expect(current.legalMoveNotations()).not.toContain('d4e3')
    expect(snap(current).config).toMatchObject({ enPassant: false, rulesVersion: 3 })
    current.free()
    const v2 = Game.fromPosition(`ffa ${EP_BOARD} S AAAA - - 0 0 rv=2`)
    play(v2, ['e2e4'])
    expect(v2.legalMoveNotations()).toContain('d4e3')
    v2.free()
  })

  it('reports en passant, castling and leader capture', () => {
    // South e2 pawn, West d4 pawn (attacks e3), kings on their home squares.
    const game = Game.fromPosition(`ffa ${EP_BOARD} S AAAA - - 0 0 ep=on`)
    play(game, ['e2e4'])
    expect(snap(game).epTargets).toEqual([{ skipped: 'e3', pawn: 'e4' }, null, null, null])
    const ep = game.legalMoves().find((m) => m.notation === 'd4e3')
    expect(ep).toMatchObject({ flag: 'en_passant', capture: true })
    const [events] = play(game, ['d4e3'])
    expect(events?.slice(1)).toEqual([
      { type: 'capture', seat: 'west', square: 'e4', captured: { kind: 'pawn', owner: 'south' } },
      { type: 'en_passant', seat: 'west', capturedSquare: 'e4' },
    ])

    const castle = Game.fromPosition(
      'ffa 4nRnNnBnQnKnBnNnR4/4nPnPnPnPnPnPnPnP4/16/16/wRwP12ePeR/wNwP12ePeN/wBwP12ePeB/wKwP12ePeK/wQwP12ePeQ/wBwP12ePeB/wNwP12ePeN/wRwP12ePeR/16/16/4sPsPsPsPsPsPsPsP4/4sRsNsBsQsK2sR4 S AAAA Se1,Sl1,Wa5,Wa12,Ne16,Nl16,Ep5,Ep12 - 0 0',
    )
    const [c] = play(castle, ['i1k1'])
    expect(c?.[1]).toEqual({ type: 'castle', seat: 'south', rookFrom: 'l1', rookTo: 'j1' })
    expect(snap(castle).castling[0]).toEqual({ long: false, short: false })

    const attack = Game.fromPosition(
      'ffa 8nK7/16/16/16/16/16/16/wK14eK/16/16/16/16/16/16/16/sR7sK7 S AAAA - - 0 0',
    )
    expect(attack.leaderUnderAttack('west')).toBe(true)
    expect(attack.leaderUnderAttack('south')).toBe(false)
    expect(snap(attack).leaderUnderAttack).toEqual([false, true, false, false])
    // Leader squares come from the civ roster's leader role, not from looking for kings.
    expect(snap(attack).leaderSquares).toEqual([['i1'], ['a9'], ['i16'], ['p9']])
    expect(attack.leaderSquares('west')).toEqual(['a9'])
    const [kill] = play(attack, ['a1a9'])
    expect(kill?.slice(1)).toEqual([
      { type: 'capture', seat: 'south', square: 'a9', captured: { kind: 'king', owner: 'west' } },
      { type: 'defeat', seat: 'west', reason: 'leader_captured' },
      { type: 'army_removed', seat: 'west' },
    ])
    expect(snap(attack).statuses).toEqual(['active', 'removed', 'active', 'active'])
    expect(snap(attack).leaderSquares).toEqual([['i1'], [], ['i16'], ['p9']])
    for (const g of [game, castle, attack]) g.free()
  })

  it('handles timeouts and abandons (Teams)', () => {
    const game = Game.create({ mode: 'teams' })
    expect(game.applyTimeout('south')).toEqual([
      { type: 'defeat', seat: 'south', reason: 'timeout' },
      { type: 'frozen', seat: 'south' },
    ])
    expect(() => game.applyTimeout('south')).toThrow('south is not on move (west is)')
    expect(() => game.applyAbandon('south')).toThrow('south no longer takes turns')
    const events = game.applyAbandon('north')
    validateEvents(events)
    expect(events).toEqual([
      { type: 'defeat', seat: 'north', reason: 'abandon' },
      { type: 'frozen', seat: 'north' },
      { type: 'army_removed', seat: 'south' },
      { type: 'army_removed', seat: 'north' },
      {
        type: 'game_ended',
        outcome: { result: { type: 'teams_winner', team: 'west_east' }, placements: [2, 1, 2, 1] },
      },
    ])
    const s = snap(game)
    expect(s.isOver).toBe(true)
    expect(s.statuses).toEqual(['frozen', 'active', 'frozen', 'active'])
    expect(s.defeats).toEqual([
      { seat: 'south', reason: 'timeout' },
      { seat: 'north', reason: 'abandon' },
    ])
    expect(s.outcome?.placements).toEqual([2, 1, 2, 1])
    expect(game.legalMoves()).toEqual([])
    expect(() => game.applyMove('b5c5')).toThrow('the game is over')
    game.free()
  })

  it('handles timeouts and abandons (FFA) through to a winner', () => {
    const game = Game.create({ mode: 'ffa' })
    expect(game.applyTimeout('south')).toEqual([
      { type: 'defeat', seat: 'south', reason: 'timeout' },
      { type: 'army_removed', seat: 'south' },
    ])
    expect(snap(game).board.some((p) => p?.owner === 'south')).toBe(false)
    game.applyAbandon('east')
    const events = game.applyTimeout('west')
    expect(events.at(-1)).toEqual({
      type: 'game_ended',
      outcome: { result: { type: 'ffa_winner', seat: 'north' }, placements: [4, 2, 1, 3] },
    })
    game.free()
  })

  it('handles resignation in Teams (the whole team, any time)', () => {
    const game = Game.create({ mode: 'teams' })
    expect(game.drawVoters()).toEqual([true, true, true, true])
    expect(() => game.applyResign('up' as never)).toThrow('invalid seat "up"')
    // North resigns while South is on move: North and South both resign, West–East win.
    const events = game.applyResign('north')
    validateEvents(events)
    expect(events).toEqual([
      { type: 'defeat', seat: 'north', reason: 'resign' },
      { type: 'frozen', seat: 'north' },
      { type: 'defeat', seat: 'south', reason: 'resign' },
      { type: 'frozen', seat: 'south' },
      { type: 'army_removed', seat: 'south' },
      { type: 'army_removed', seat: 'north' },
      {
        type: 'game_ended',
        outcome: { result: { type: 'teams_winner', team: 'west_east' }, placements: [2, 1, 2, 1] },
      },
    ])
    const s = snap(game)
    expect(s.isOver).toBe(true)
    expect(s.statuses).toEqual(['frozen', 'active', 'frozen', 'active'])
    expect(s.defeats).toEqual([
      { seat: 'north', reason: 'resign' },
      { seat: 'south', reason: 'resign' },
    ])
    expect(game.drawVoters()).toEqual([false, false, false, false])
    expect(() => game.applyResign('west')).toThrow('the game is over')
    game.free()
  })

  it('handles resignation in FFA (army removed)', () => {
    const game = Game.create({ mode: 'ffa' })
    expect(game.applyResign('south')).toEqual([
      { type: 'defeat', seat: 'south', reason: 'resign' },
      { type: 'army_removed', seat: 'south' },
    ])
    expect(snap(game).seatToMove).toBe('west')
    expect(game.positionString()).toContain('def=Sr')
    game.free()
  })

  it('ends the game in an agreed draw', () => {
    // FFA: survivors share 1st, defeated seats keep reverse-defeat placements.
    const ffa = Game.create({ mode: 'ffa' })
    ffa.applyTimeout('south')
    ffa.applyResign('north')
    expect(ffa.drawVoters()).toEqual([false, true, false, true])
    const events = ffa.applyAgreedDraw()
    validateEvents(events)
    expect(events).toEqual([
      {
        type: 'game_ended',
        outcome: {
          result: { type: 'ffa_agreed_draw', survivors: [false, true, false, true] },
          placements: [4, 1, 3, 1],
        },
      },
    ])
    expect(snap(ffa).isOver).toBe(true)
    expect(() => ffa.applyAgreedDraw()).toThrow('the game is over')
    // The draw survives a position-string round trip.
    const text = ffa.positionString()
    expect(text.endsWith(' end=draw')).toBe(true)
    const copy = Game.fromPosition(text)
    expect(copy.snapshot()).toEqual(ffa.snapshot())
    for (const g of [ffa, copy]) g.free()

    // Teams: everyone 1st.
    const teams = Game.create({ mode: 'teams' })
    expect(teams.applyAgreedDraw()).toEqual([
      {
        type: 'game_ended',
        outcome: { result: { type: 'teams_agreed_draw' }, placements: [1, 1, 1, 1] },
      },
    ])
    expect(snap(teams).outcome?.result).toEqual({ type: 'teams_agreed_draw' })
    teams.free()
  })

  it('reports automatic passes', () => {
    // Teams: North DEFEATED and boxed in, East FROZEN.
    const game = Game.fromPosition(
      'teams nKnB14/nPnPnP13/sRsNsB13/16/16/16/16/wK14eK/16/16/16/16/16/16/16/8sK7 W AADF - - 0 0 def=Ns,Et',
    )
    const [events] = play(game, ['a9b9'])
    expect(events?.[1]).toEqual({ type: 'pass', seat: 'north', notation: '--' })
    expect(snap(game).seatToMove).toBe('south')
    game.free()
  })

  it('round-trips position strings', () => {
    const game = Game.create({ mode: 'teams', enPassant: false, moveLimitRounds: 12 })
    play(game, ['e2e4', 'b5c5', 'e15e13', 'o8n8', 'f1e3'])
    const text = game.positionString()
    expect(text).toContain('ep=off ml=12')
    const copy = Game.fromPosition(text)
    expect(copy.positionString()).toBe(text)
    expect(copy.snapshot()).toEqual(game.snapshot())
    expect(copy.legalMoves()).toEqual(game.legalMoves())

    const clone = game.clone()
    clone.applyMove(clone.legalMoveNotations()[0] ?? '')
    expect(clone.snapshot().ply).toBe(6)
    expect(game.snapshot().ply).toBe(5)
    for (const g of [game, copy, clone]) g.free()
  })

  it('throws engine errors for invalid input', () => {
    const game = Game.create({ mode: 'ffa' })
    expect(() => game.applyMove('e2e5')).toThrow('illegal move e2e5')
    expect(() => game.applyMove('b5c5')).toThrow('illegal move b5c5') // West's pawn, South to move
    expect(() => game.applyMove('hello')).toThrow('invalid move "hello"')
    expect(() => game.applyMove('q1q2')).toThrow('invalid move')
    expect(() => game.applyTimeout('up' as never)).toThrow('invalid seat "up"')
    expect(() => game.leaderUnderAttack('up' as never)).toThrow('invalid seat "up"')
    expect(() => game.perft(7)).toThrow('too deep')
    // The failed calls left the game untouched.
    expect(game.snapshot().ply).toBe(0)
    let caught: unknown
    try {
      game.applyMove('e2e5')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    game.free()

    expect(() => Game.create({ mode: 'duel' as never })).toThrow('invalid config: unknown variant')
    expect(() => Game.create({ mode: 'ffa', moveLimitRounds: 0 })).toThrow('move_limit_rounds')
    expect(() => Game.create({ mode: 'ffa', rulesVersion: 1 })).toThrow('unsupported rules_version')
    expect(() =>
      Game.create({ mode: 'ffa', civs: [{ id: 'mali', version: 9 }, 'mali', 'mali', 'mali'] }),
    ).toThrow('unknown civ version')
    expect(() => Game.create({ mode: 'ffa', extra: 1 } as never)).toThrow('unknown field `extra`')
    expect(() => Game.fromPosition('ffa nonsense')).toThrow(/^invalid position: /)
  })

  it('plays England (civ v2) with four Prime Ministers', () => {
    const game = Game.create({ mode: 'ffa', civs: ['england', 'canada', 'canada', 'canada'] })
    const s = snap(game)
    expect(s.config.civs[0]).toEqual({ id: 'england', version: 2 })
    expect(s.config.civs[1]).toEqual({ id: 'canada', version: 1 })
    for (const sq of ['f1', 'h1', 'i1', 'k1'] as const) {
      expect(s.board[squareIndex(sq)]).toEqual({ kind: 'prime_minister', owner: 'south' })
    }
    expect(s.leaderSquares[0]).toEqual(['f1', 'h1', 'i1', 'k1'])
    expect(s.attackedLeaderSquares).toEqual([[], [], [], []])
    expect(s.castling[0]).toEqual({ long: false, short: false })
    // 34 opening moves: 30 minus the knights' 6 plus the Prime Ministers' 10.
    const moves = game.legalMoves()
    expect(moves).toHaveLength(34)
    const pmMoves = moves.filter((m) => m.piece === 'prime_minister').map((m) => m.notation)
    expect(pmMoves.sort()).toEqual([
      'f1d2',
      'f1e3',
      'f1g3',
      'h1g3',
      'h1i3',
      'i1h3',
      'i1j3',
      'k1j3',
      'k1l3',
      'k1m2',
    ])
    const events = game.applyMove('f1e3')
    expect(events[0]).toMatchObject({ type: 'move_made', piece: 'prime_minister' })
    expect(game.positionString()).toContain('civ=england.2,canada.1,canada.1,canada.1')
    const copy = Game.fromPosition(game.positionString())
    expect(copy.snapshot()).toEqual(game.snapshot())
    copy.free()
    game.free()
  })

  it('England pawns promote to Q, R, B or N, never to a Prime Minister', () => {
    const game = Game.fromPosition(
      'ffa wK14nK/16/16/16/16/16/16/16/7sP8/16/16/16/16/16/16/sM14eK S AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1',
    )
    const promos = game
      .legalMoves()
      .filter((m) => m.from === 'h8')
      .map((m) => m.promotion)
    expect(promos.sort()).toEqual(['bishop', 'knight', 'queen', 'rook'])
    expect(() => game.applyMove('h8h9m')).toThrow('illegal move')
    game.free()
  })

  it('rings only the attacked Prime Minister and defeats England on the last one', () => {
    // West's rook on m3 attacks the Prime Minister on c3, not those on f1 and k1.
    const game = Game.fromPosition(
      'ffa wK14nK/16/16/16/16/16/16/16/16/16/16/16/16/2sM9wR3/16/5sM4sM4eK W AAAA - - 0 0 civ=england.2,canada.1,canada.1,canada.1',
    )
    let s = snap(game)
    expect(s.leaderUnderAttack).toEqual([true, false, false, false])
    expect(s.attackedLeaderSquares).toEqual([['c3'], [], [], []])
    expect(s.leaderSquares[0]).toEqual(['f1', 'k1', 'c3'])
    const events = game.applyMove('m3c3')
    expect(events.some((e) => e.type === 'defeat')).toBe(false)
    s = snap(game)
    expect(s.statuses[0]).toBe('active')
    expect(s.leaderSquares[0]).toEqual(['f1', 'k1'])
    game.free()
  })

  it('accepts its own snapshot config as input', () => {
    const game = Game.create({
      mode: 'teams',
      civs: ['china', { id: 'germany', version: 1 }, 'russia', 'england'],
      enPassant: false,
    })
    const { config } = game.snapshot()
    const again = Game.create(config)
    expect(again.positionString()).toBe(game.positionString())
    game.free()
    again.free()
  })
})
