import type { SeatStateJson } from '@game/protocol/state'
import { describe, expect, it } from 'vitest'
import { plateDetail, plateName, seatTitle } from './PlayerCard.tsx'

const bot = {
  isBot: true,
  botLevel: '1200',
  civ: 'china',
  displayName: 'Bot 1200',
} as SeatStateJson

describe('seat names', () => {
  it('names a bot by its civ, with its strength as the detail', () => {
    expect(plateName(bot)).toBe('China bot')
    expect(seatTitle(bot)).toBe('China bot')
    expect(plateDetail(bot)).toBe('Bot 1200')
    expect(plateDetail({ ...bot, isBot: false, displayName: 'Alice' })).toBe('China')
  })

  it('says whose seat a stand-in bot is playing', () => {
    const standIn = { ...bot, displayName: 'Bot 1200 (for Alice)' }
    expect(plateName(standIn)).toBe('China bot (for Alice)')
    expect(seatTitle(standIn)).toBe('China bot (for Alice)')
  })
})
