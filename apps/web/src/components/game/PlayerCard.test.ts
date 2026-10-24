import type { SeatStateJson } from '@game/protocol/state'
import { describe, expect, it } from 'vitest'
import { plateName, seatTitle } from './PlayerCard.tsx'

const bot = {
  isBot: true,
  botLevel: '1200',
  civ: 'china',
  displayName: 'Bot 1200',
} as SeatStateJson

describe('seat names', () => {
  it('names a bot by strength and civ', () => {
    expect(plateName(bot)).toBe('Bot 1200')
    expect(seatTitle(bot)).toBe('China bot')
  })

  it('says whose seat a stand-in bot is playing', () => {
    const standIn = { ...bot, displayName: 'Bot 1200 (for Alice)' }
    expect(plateName(standIn)).toBe('Bot 1200 (for Alice)')
    expect(seatTitle(standIn)).toBe('China bot (for Alice)')
  })
})
