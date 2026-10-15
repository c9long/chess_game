import { createMatchState, type MatchState } from '@game/protocol/state'
import { describe, expect, it } from 'vitest'
import {
  clearSeat,
  filledCount,
  firstFreeSeat,
  nextHost,
  refreshLobbyPhase,
  type SeatBinding,
  seatBot,
  seatHuman,
  startBlocker,
  swapSeats,
} from './lobby-logic.ts'

function lobby(mode: 'ffa' | 'teams' = 'ffa'): MatchState {
  const s = createMatchState()
  s.mode = mode
  return s
}

const human = (name: string) => ({ displayName: name, isGuest: false, sessionId: `s-${name}` })

describe('lobby state machine', () => {
  it('fills seats in order and moves waiting -> civ_select -> waiting with the seat count', () => {
    const s = lobby()
    expect(s.phase).toBe('waiting')
    seatHuman(s, 0, human('a'))
    expect(firstFreeSeat(s)).toBe(1)
    seatBot(s, 1, '1200', 'mali')
    seatBot(s, 2, 'max', 'usa')
    refreshLobbyPhase(s)
    expect(s.phase).toBe('waiting')
    seatHuman(s, 3, human('b'))
    refreshLobbyPhase(s)
    expect(filledCount(s)).toBe(4)
    expect(firstFreeSeat(s)).toBe(-1)
    expect(s.phase).toBe('civ_select')
    clearSeat(s.seats[3] as NonNullable<(typeof s.seats)[number]>)
    refreshLobbyPhase(s)
    expect(s.phase).toBe('waiting')
  })

  it('never changes the phase outside the lobby', () => {
    const s = lobby()
    s.phase = 'in_game'
    refreshLobbyPhase(s)
    expect(s.phase).toBe('in_game')
  })

  it('starts only with 4 seats, all civs chosen and all humans ready and connected', () => {
    const s = lobby()
    seatHuman(s, 0, human('a'))
    seatBot(s, 1, '600', 'canada')
    seatBot(s, 2, '600', 'canada')
    expect(startBlocker(s)).toBe('wrong_phase')
    seatHuman(s, 3, human('b'))
    refreshLobbyPhase(s)
    expect(startBlocker(s)).toBe('civ_required')
    for (const i of [0, 3] as const) (s.seats[i] as { civ: string }).civ = 'japan'
    expect(startBlocker(s)).toBe('not_ready')
    for (const i of [0, 3] as const) (s.seats[i] as { ready: boolean }).ready = true
    expect(startBlocker(s)).toBeNull()
    ;(s.seats[3] as { connected: boolean }).connected = false
    expect(startBlocker(s)).toBe('not_ready')
    expect(startBlocker(s, { ignorePhase: true })).toBe('not_ready')
  })

  it('bots join ready with a civ', () => {
    const s = lobby()
    seatBot(s, 2, '2100', 'england')
    expect(s.seats[2]).toMatchObject({
      occupied: true,
      isBot: true,
      botLevel: '2100',
      civ: 'england',
      ready: true,
      displayName: 'Bot 2100',
    })
  })

  it('swaps seats and recomputes Teams sides (S+N vs W+E)', () => {
    const s = lobby('teams')
    seatHuman(s, 0, human('a'))
    seatHuman(s, 1, human('b'))
    expect(s.seats.map((x) => x.team)).toEqual([0, 1, -1, -1])
    swapSeats(s, 1, 2)
    expect(s.seats[2]?.displayName).toBe('b')
    expect(s.seats[1]?.occupied).toBe(false)
    expect(s.seats[2]?.team).toBe(0)
  })

  it('passes the host to the next human in seat order', () => {
    const b = (id: string): SeatBinding => ({
      userId: id,
      displayName: id,
      isGuest: false,
      sessionId: id,
    })
    expect(nextHost([b('a'), null, b('c'), b('d')], 'a')).toBe('c')
    expect(nextHost([b('a'), null, null, null], 'a')).toBeNull()
  })
})
