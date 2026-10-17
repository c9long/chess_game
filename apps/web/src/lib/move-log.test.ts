import type { GameEvent } from '@game/rules'
import { Game, initRulesSync } from '@game/rules'
import { beforeAll, describe, expect, it } from 'vitest'
import { appendEntry } from './live-move-log.ts'
import {
  attackedIn,
  groupRounds,
  itemLabel,
  itemMarks,
  itemsOfStep,
  itemText,
  type LogStep,
  logItems,
  resultText,
} from './move-log.ts'

beforeAll(() => {
  initRulesSync()
})

const NONE = [false, false, false, false]

function move(seat: number, notation: string, extra: GameEvent[] = [], seq = 1): LogStep {
  const seats = ['south', 'west', 'north', 'east'] as const
  const [from, to] = [notation.slice(0, 2), notation.slice(2, 4)]
  return {
    seq,
    action: 'move',
    seat,
    notation,
    events: [
      {
        type: 'move_made',
        seat: seats[seat] ?? 'south',
        notation,
        from: from as never,
        to: to as never,
        promotion: null,
        flag: 'normal',
        piece: 'pawn',
      },
      ...extra,
    ],
    attacked: NONE,
  }
}

describe('move log model', () => {
  it('lists a real game’s moves by round with the engine’s notation', () => {
    const game = Game.create({ mode: 'ffa' })
    const steps: LogStep[] = []
    try {
      for (let i = 0; i < 6; i++) {
        const seat = ['south', 'west', 'north', 'east'].indexOf(game.snapshot().seatToMove)
        const notation = game.legalMoveNotations()[0] as string
        const events = game.applyMove(notation)
        steps.push({
          seq: i + 1,
          action: 'move',
          seat,
          notation,
          events,
          attacked: attackedIn(game.positionString()),
        })
      }
    } finally {
      game.free()
    }
    const items = logItems(steps)
    expect(items.map((i) => i.notation)).toEqual(steps.map((s) => s.notation))
    const rounds = groupRounds(items)
    expect(rounds).toHaveLength(2)
    expect(rounds[0]?.cells.map((c) => c?.seat)).toEqual([0, 1, 2, 3])
    expect(rounds[1]?.cells.map((c) => c?.seat ?? null)).toEqual([0, 1, null, null])
    expect(items.every((i) => i.checks.length === 0 && i.captures.length === 0)).toBe(true)
  })

  it('marks captures, promotions, checks and defeats from the engine’s events', () => {
    const step: LogStep = {
      ...move(0, 'h8g9q', [
        {
          type: 'capture',
          seat: 'south',
          square: 'g9',
          captured: { kind: 'knight', owner: 'west' },
        },
        { type: 'promotion', seat: 'south', square: 'g9', kind: 'queen' },
      ]),
      attacked: [false, false, true, false],
    }
    const [item] = itemsOfStep(step, 0)
    expect(item?.captures).toEqual([{ kind: 'knight', owner: 'west' }])
    expect(item?.promotion).toBe('queen')
    expect(item?.checks).toEqual([2])
    expect(itemMarks(item as never)).toBe('×+')
    expect(itemLabel(item as never)).toBe(
      'South: h8g9q, takes West’s knight, promotes to queen, check on North',
    )
    // A check that was already there isn't new.
    expect(itemsOfStep(step, 0, [false, false, true, false])[0]?.checks).toEqual([])
    // The mover's own leader under attack (a self-check) is not a check mark.
    expect(itemsOfStep({ ...step, attacked: [true, false, false, false] }, 0)[0]?.checks).toEqual(
      [],
    )

    const kill = itemsOfStep(
      move(1, 'b8d9', [
        { type: 'capture', seat: 'west', square: 'd9', captured: { kind: 'king', owner: 'north' } },
        { type: 'defeat', seat: 'north', reason: 'leader_captured' },
        { type: 'army_removed', seat: 'north' },
      ]),
      3,
    )[0]
    expect(kill?.step).toBe(3)
    expect(kill?.defeats).toEqual([{ seat: 2, reason: 'leader_captured' }])
    expect(itemMarks(kill as never)).toBe('×#')
    expect(itemLabel(kill as never)).toContain('North defeated, leader captured')
  })

  it('splits passes into their own cells and skips seats that are out', () => {
    const teams = itemsOfStep(
      move(0, 'e2e4', [{ type: 'pass', seat: 'west', notation: '--' }], 9),
      4,
    )
    expect(teams.map((i) => [i.kind, i.seat, itemText(i)])).toEqual([
      ['move', 0, 'e2e4'],
      ['pass', 1, 'pass'],
    ])
    expect(teams[1]?.key).toBe('9:1')

    // West is out (FFA): South, North, East, then South starts round 2.
    const rounds = groupRounds(
      logItems([move(0, 'e2e4', [], 1), move(2, 'e15e13', [], 2), move(3, 'p5n5', [], 3)]).concat(
        logItems([move(0, 'e4e5', [], 4)]),
      ),
    )
    expect(rounds.map((r) => r.cells.map((c) => c?.notation ?? null))).toEqual([
      ['e2e4', null, 'e15e13', 'p5n5'],
      ['e4e5', null, null, null],
    ])
  })

  it('puts off-turn actions under the round, and ends with the result', () => {
    const resign: LogStep = {
      seq: 5,
      action: 'resign',
      seat: 3,
      notation: null,
      events: [
        { type: 'defeat', seat: 'east', reason: 'resign' },
        { type: 'army_removed', seat: 'east' },
      ],
      attacked: NONE,
    }
    const draw: LogStep = {
      seq: 7,
      action: 'agreed_draw',
      seat: 0,
      notation: null,
      events: [
        {
          type: 'game_ended',
          outcome: {
            result: { type: 'ffa_agreed_draw', survivors: [true, true, true, false] },
            placements: [1, 1, 1, 4],
          },
        },
      ],
      attacked: NONE,
    }
    const items = logItems([move(0, 'e2e4'), move(1, 'a5c5', [], 2), resign, draw])
    const rounds = groupRounds(items)
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.notes.map((n) => itemText(n))).toEqual(['East resigned', 'Draw agreed'])
    // The resignation's own defeat isn't repeated in its description.
    expect(itemLabel(rounds[0]?.notes[0] as never)).toBe('East resigned')
    const end = items.at(-1)
    expect(end?.seat).toBe(-1)
    expect(end?.result?.type).toBe('ffa_agreed_draw')
    expect(resultText(end?.result as never)).toBe('Draw agreed')
    expect(resultText({ type: 'ffa_winner', seat: 'west' })).toBe('West wins')
    expect(resultText({ type: 'teams_winner', team: 'west_east' })).toBe('Team West–East wins')
    expect(resultText(end?.result as never, 'player_eliminated')).toContain('bots share 1st')
  })

  it('a live log appends each action once, after the game so far', () => {
    const entry = (seq: number) => ({
      seq,
      action: 'move' as const,
      seat: 0 as const,
      notation: 'e2e4',
      events: [],
      positionString: `p${seq}`,
      seatToMove: 1 as const,
      clock: {
        remainingMs: [0, 0, 0, 0] as [number, number, number, number],
        runningSeat: -1 as const,
        serverTimestamp: 0,
        turnStartedAt: 0,
      },
    })
    const one = appendEntry([], entry(1))
    expect(one).toEqual([
      { seq: 1, action: 'move', seat: 0, notation: 'e2e4', events: [], positionString: 'p1' },
    ])
    expect(appendEntry(one, entry(1))).toBe(one)
    expect(appendEntry(one, entry(2)).map((e) => e.seq)).toEqual([1, 2])
  })
})
