import { describe, expect, it } from 'vitest'
import {
  type CheckAction,
  type CheckMemo,
  type CheckNotice,
  type CheckPosition,
  INITIAL_CHECK,
  nextCheck,
} from './check-indicator.ts'

const SOUTH = 0
const WEST = 1
const NORTH = 2
const EAST = 3

/** A position: `attacked` lists the seats whose leader the engine reports under attack. */
function pos(ply: number, seatToMove: number, attacked: number[] = [], isOver = false) {
  return {
    ply,
    seatToMove,
    isOver,
    leaderUnderAttack: [0, 1, 2, 3].map((s) => attacked.includes(s)),
  } satisfies CheckPosition
}

const move = (seat: number): CheckAction => ({ seat, action: 'move' })

/** Feeds positions in order (each with the action that produced it) and collects the notices. */
function run(
  viewer: number,
  steps: [CheckPosition, CheckAction | null][],
  memo: CheckMemo = INITIAL_CHECK,
): CheckNotice[] {
  const out: CheckNotice[] = []
  let m = memo
  for (const [p, a] of steps) {
    const r = nextCheck(m, viewer, p, a)
    m = r.memo
    out.push(r.notice)
  }
  return out
}

describe('check indicator visibility', () => {
  it('shows check when the viewer’s turn starts with their leader attacked', () => {
    // East (just before South) attacks South's leader: South's turn starts in check.
    expect(run(SOUTH, [[pos(4, SOUTH, [SOUTH]), move(EAST)]])).toEqual(['check'])
  })

  it('holds back a check made while it is not the viewer’s turn until their turn starts', () => {
    expect(
      run(SOUTH, [
        [pos(1, WEST), move(SOUTH)],
        [pos(2, NORTH, [SOUTH]), move(WEST)], // West attacks South: not shown yet
        [pos(3, EAST, [SOUTH]), move(NORTH)], // still not South's turn
        [pos(4, SOUTH, [SOUTH]), move(EAST)], // South's turn: now shown
      ]),
    ).toEqual(['none', 'none', 'none', 'check'])
  })

  it('shows nothing if the attack is gone by the time the viewer’s turn starts', () => {
    expect(
      run(SOUTH, [
        [pos(2, NORTH, [SOUTH]), move(WEST)],
        [pos(3, EAST), move(NORTH)], // North captured the attacker
        [pos(4, SOUTH), move(EAST)],
      ]),
    ).toEqual(['none', 'none', 'none'])
  })

  it('shows self-check right after the viewer’s own move and keeps it while attacked', () => {
    expect(
      run(SOUTH, [
        [pos(0, SOUTH), null],
        [pos(1, WEST, [SOUTH]), move(SOUTH)], // South walks into an attack
        [pos(2, NORTH, [SOUTH]), move(WEST)], // West doesn't take: still attacked
        [pos(3, EAST, [SOUTH]), move(NORTH)],
        [pos(4, SOUTH, [SOUTH]), move(EAST)], // back to South, still attacked: check
      ]),
    ).toEqual(['none', 'self_check', 'self_check', 'self_check', 'check'])
  })

  it('ends self-check once the leader is no longer attacked, and does not re-arm it', () => {
    expect(
      run(SOUTH, [
        [pos(1, WEST, [SOUTH]), move(SOUTH)],
        [pos(2, NORTH), move(WEST)], // West blocked the line
        [pos(3, EAST, [SOUTH]), move(NORTH)], // North attacks again: opponents' check, held
        [pos(4, SOUTH, [SOUTH]), move(EAST)],
      ]),
    ).toEqual(['self_check', 'none', 'none', 'check'])
  })

  it('leaving the leader attacked on the viewer’s own turn becomes a self-check', () => {
    expect(
      run(SOUTH, [
        [pos(4, SOUTH, [SOUTH]), move(EAST)],
        [pos(5, WEST, [SOUTH]), move(SOUTH)], // South moved something else
      ]),
    ).toEqual(['check', 'self_check'])
  })

  it('is only for the viewer’s own seat: other seats and spectators see nothing', () => {
    // West is in check on West's turn: South (a player) sees nothing...
    expect(run(SOUTH, [[pos(1, WEST, [WEST]), move(SOUTH)]])).toEqual(['none'])
    // ...nor does a spectator, whoever is attacked or moved.
    expect(
      run(-1, [
        [pos(1, WEST, [WEST, SOUTH]), move(SOUTH)],
        [pos(2, NORTH, [NORTH]), move(WEST)],
      ]),
    ).toEqual(['none', 'none'])
    // A self-check by another player is theirs alone.
    expect(run(NORTH, [[pos(1, WEST, [SOUTH]), move(SOUTH)]])).toEqual(['none'])
  })

  it('clears everything once the game is over', () => {
    expect(
      run(SOUTH, [
        [pos(1, WEST, [SOUTH]), move(SOUTH)],
        [pos(2, NORTH, [SOUTH], true), { seat: WEST, action: 'resign' }],
      ]),
    ).toEqual(['self_check', 'none'])
  })

  it('a non-move action by the viewer is not a self-check', () => {
    expect(run(SOUTH, [[pos(1, WEST, [SOUTH]), { seat: SOUTH, action: 'timeout' }]])).toEqual([
      'none',
    ])
  })

  it('without events, recognises the viewer’s own move by a single turn from their turn', () => {
    expect(
      run(SOUTH, [
        [pos(0, SOUTH), null],
        [pos(1, WEST, [SOUTH]), null],
      ]),
    ).toEqual(['none', 'self_check'])
    // Several turns at once (a reconnect catch-up): who made the check is unknown, so hold it.
    expect(
      run(SOUTH, [
        [pos(0, SOUTH), null],
        [pos(2, NORTH, [SOUTH]), null],
      ]),
    ).toEqual(['none', 'none'])
    // First position seen, not the viewer's turn: hold it.
    expect(run(SOUTH, [[pos(7, EAST, [SOUTH]), null]])).toEqual(['none'])
    // First position seen on the viewer's turn: show it.
    expect(run(SOUTH, [[pos(8, SOUTH, [SOUTH]), null]])).toEqual(['check'])
  })

  it('works for any viewer seat (Teams: a partner never attacks)', () => {
    expect(
      run(EAST, [
        [pos(3, SOUTH, [EAST]), move(EAST)],
        [pos(4, WEST, [EAST]), move(SOUTH)],
        [pos(5, NORTH), move(WEST)],
        [pos(6, EAST, [EAST]), move(NORTH)],
      ]),
    ).toEqual(['self_check', 'self_check', 'none', 'check'])
  })
})
