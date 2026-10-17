import { describe, expect, it } from 'vitest'
import { actionFromEvents, INITIAL_CHECK, nextCheck } from './check-indicator.ts'

// Viewer South (0). Teams: after South's move, West (DEFEATED, no legal move) auto-passes,
// so the shown position is ply + 2 with North to move. When the board shows the room state
// without the matching `events` message (a reconnect, a dropped message, a patch rendered
// first), the action comes from the state's own `lastEvents` (move_made by South, then West's
// pass), so the self-check is still recognised.
describe('attack: check indicator without the events message', () => {
  const stateEvents = [
    { type: 'move_made', seat: 0, from: 'g1', to: 'g2' },
    { type: 'pass', seat: 1 },
  ]

  it('names the mover of a move followed by automatic passes', () => {
    expect(actionFromEvents(stateEvents)).toEqual({ seat: 0, action: 'move' })
    expect(actionFromEvents([{ type: 'defeat', seat: 2, reason: 'resigned' }])).toEqual({
      seat: 2,
      action: 'other',
    })
    expect(actionFromEvents([])).toBeNull()
  })

  it('recognises a self-check followed by an automatic pass (Teams)', () => {
    const before = nextCheck(
      INITIAL_CHECK,
      0,
      { ply: 10, seatToMove: 0, isOver: false, leaderUnderAttack: [false, false, false, false] },
      null,
    )
    // State patch only (no events message): South moved into check, West passed.
    const after = nextCheck(
      before.memo,
      0,
      { ply: 12, seatToMove: 2, isOver: false, leaderUnderAttack: [true, false, false, false] },
      actionFromEvents(stateEvents),
    )
    expect(after.notice).toBe('self_check')
  })

  it('after a reload, a self-check made by the last action still shows', () => {
    const after = nextCheck(
      INITIAL_CHECK,
      0,
      { ply: 12, seatToMove: 2, isOver: false, leaderUnderAttack: [true, false, false, false] },
      actionFromEvents(stateEvents),
    )
    expect(after.notice).toBe('self_check')
  })
})
