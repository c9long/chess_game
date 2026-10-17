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

describe('Game', () => {
  it('starts in the §2 setup with 28 legal moves for South', () => {
    const game = Game.create({ mode: 'ffa' })
    const s = snap(game)
    expect(s.seatToMove).toBe('south')
    expect(s.board[squareIndex('f1')]).toEqual({ kind: 'queen', owner: 'south' })
    expect(s.board[squareIndex('a7')]).toEqual({ kind: 'king', owner: 'west' })
    expect(s.board[squareIndex('l6')]).toEqual({ kind: 'queen', owner: 'east' })
    expect(s.board[squareIndex('g12')]).toEqual({ kind: 'king', owner: 'north' })
    expect(s.board.filter((p) => p !== null)).toHaveLength(64)
    expect(s.moveLimit).toBe(100)
    const moves = game.legalMoves()
    for (const m of moves) validateMove(m)
    expect(moves).toHaveLength(28)
    expect(moves.map((m) => m.notation).sort()).toEqual(game.legalMoveNotations().sort())
    expect(moves.find((m) => m.notation === 'c2b3')).toEqual({
      notation: 'c2b3',
      from: 'c2',
      to: 'b3',
      promotion: null,
      flag: 'normal',
      piece: 'pawn',
      capture: true,
    })
    game.free()
  })

  it('plays a scripted game with a capture and a promotion', () => {
    const game = Game.create({ mode: 'ffa', civs: ['mali', 'japan', 'france', 'usa'] })
    const [, capture] = play(game, ['e2e4', 'b3c2'])
    expect(capture).toEqual([
      {
        type: 'move_made',
        seat: 'west',
        notation: 'b3c2',
        from: 'b3',
        to: 'c2',
        promotion: null,
        flag: 'normal',
        piece: 'pawn',
      },
      { type: 'capture', seat: 'west', square: 'c2', captured: { kind: 'pawn', owner: 'south' } },
    ])
    expect(snap(game).noProgress).toBe(0)
    play(game, [
      'j11j10',
      'k4j4',
      'e4e5',
      'b9c9',
      'j10j9',
      'j4i4',
      'e5e6',
      'b8c8',
      'i11i10',
      'k5j5',
    ])

    // A pawn reaching its promotion line must promote.
    expect(() => game.applyMove('e6e7')).toThrow('illegal move e6e7')
    const promo = game.legalMoves().filter((m) => m.from === 'e6')
    expect(promo.map((m) => m.promotion).sort()).toEqual(['bishop', 'knight', 'queen', 'rook'])
    const [events] = play(game, ['e6e7q'])
    expect(events).toEqual([
      {
        type: 'move_made',
        seat: 'south',
        notation: 'e6e7q',
        from: 'e6',
        to: 'e7',
        promotion: 'queen',
        flag: 'normal',
        piece: 'pawn',
      },
      { type: 'promotion', seat: 'south', square: 'e7', kind: 'queen' },
    ])
    const s = snap(game)
    expect(s.board[squareIndex('e7')]).toEqual({ kind: 'queen', owner: 'south' })
    expect(s.board[squareIndex('c2')]).toEqual({ kind: 'pawn', owner: 'west' })
    expect(s.ply).toBe(13)
    expect(s.seatToMove).toBe('west')
    expect(s.config.civs.map((c) => c.id)).toEqual(['mali', 'japan', 'france', 'usa'])
    game.free()
  })

  it('reports en passant, castling and leader capture', () => {
    const game = Game.create({ mode: 'ffa' })
    play(game, ['c2c4'])
    expect(snap(game).epTargets).toEqual([{ skipped: 'c3', pawn: 'c4' }, null, null, null])
    const ep = game.legalMoves().find((m) => m.notation === 'b4c3')
    expect(ep).toMatchObject({ flag: 'en_passant', capture: true })
    const [events] = play(game, ['b4c3'])
    expect(events?.slice(1)).toEqual([
      { type: 'capture', seat: 'west', square: 'c4', captured: { kind: 'pawn', owner: 'south' } },
      { type: 'en_passant', seat: 'west', capturedSquare: 'c4' },
    ])

    const castle = Game.fromPosition(
      'ffa 2nRnNnBnQnKnBnNnR2/2nPnPnPnPnPnPnPnP2/wRwP8ePeR/wNwP8ePeN/wBwP8ePeB/wKwP8ePeK/wQwP8ePeQ/wBwP8ePeB/wNwP8ePeN/wRwP8ePeR/2sPsPsPsPsPsPsPsP2/2sRsNsBsQsK2sR2 S AAAA Sc1,Sj1,Wa3,Wa10,Nc12,Nj12,El3,El10 - 0 0',
    )
    const [c] = play(castle, ['g1i1'])
    expect(c?.[1]).toEqual({ type: 'castle', seat: 'south', rookFrom: 'j1', rookTo: 'h1' })
    expect(snap(castle).castling[0]).toEqual({ long: false, short: false })

    const attack = Game.fromPosition(
      'ffa 6nK5/12/12/12/12/wK10eK/12/12/12/12/12/sR5sK5 S AAAA - - 0 0',
    )
    expect(attack.leaderUnderAttack('west')).toBe(true)
    expect(attack.leaderUnderAttack('south')).toBe(false)
    expect(snap(attack).leaderUnderAttack).toEqual([false, true, false, false])
    // Leader squares come from the civ roster's leader role, not from looking for kings.
    expect(snap(attack).leaderSquares).toEqual([['g1'], ['a7'], ['g12'], ['l7']])
    expect(attack.leaderSquares('west')).toEqual(['a7'])
    const [kill] = play(attack, ['a1a7'])
    expect(kill?.slice(1)).toEqual([
      { type: 'capture', seat: 'south', square: 'a7', captured: { kind: 'king', owner: 'west' } },
      { type: 'defeat', seat: 'west', reason: 'leader_captured' },
      { type: 'army_removed', seat: 'west' },
    ])
    expect(snap(attack).statuses).toEqual(['active', 'removed', 'active', 'active'])
    expect(snap(attack).leaderSquares).toEqual([['g1'], [], ['g12'], ['l7']])
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
    expect(() => game.applyMove('b3c3')).toThrow('the game is over')
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
      'teams nKnB10/nPnPnP9/sRsNsB9/12/12/wK10eK/12/12/12/12/12/6sK5 W AADF - - 0 0 def=Ns,Et',
    )
    const [events] = play(game, ['a7b7'])
    expect(events?.[1]).toEqual({ type: 'pass', seat: 'north', notation: '--' })
    expect(snap(game).seatToMove).toBe('south')
    game.free()
  })

  it('round-trips position strings', () => {
    const game = Game.create({ mode: 'teams', enPassant: false, moveLimitRounds: 12 })
    play(game, ['c2c4', 'b5c4', 'c11c9', 'k8j8', 'd1c3'])
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
    expect(() => game.applyMove('c2c5')).toThrow('illegal move c2c5')
    expect(() => game.applyMove('b3b4')).toThrow('illegal move b3b4') // West's pawn, South to move
    expect(() => game.applyMove('hello')).toThrow('invalid move "hello"')
    expect(() => game.applyMove('m1m2')).toThrow('invalid move')
    expect(() => game.applyTimeout('up' as never)).toThrow('invalid seat "up"')
    expect(() => game.leaderUnderAttack('up' as never)).toThrow('invalid seat "up"')
    expect(() => game.perft(7)).toThrow('too deep')
    // The failed calls left the game untouched.
    expect(game.snapshot().ply).toBe(0)
    let caught: unknown
    try {
      game.applyMove('c2c5')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    game.free()

    expect(() => Game.create({ mode: 'duel' as never })).toThrow('invalid config: unknown variant')
    expect(() => Game.create({ mode: 'ffa', moveLimitRounds: 0 })).toThrow('move_limit_rounds')
    expect(() => Game.create({ mode: 'ffa', rulesVersion: 2 })).toThrow('unsupported rules_version')
    expect(() =>
      Game.create({ mode: 'ffa', civs: [{ id: 'mali', version: 9 }, 'mali', 'mali', 'mali'] }),
    ).toThrow('unknown civ version')
    expect(() => Game.create({ mode: 'ffa', extra: 1 } as never)).toThrow('unknown field `extra`')
    expect(() => Game.fromPosition('ffa nonsense')).toThrow(/^invalid position: /)
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
