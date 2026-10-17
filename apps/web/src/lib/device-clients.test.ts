import { describe, expect, it } from 'vitest'
import { deviceClientName } from './device-clients.ts'

describe('deviceClientName', () => {
  it('names the desktop and mobile apps, and shows unknown ids as they are', () => {
    expect(deviceClientName('game-unity-client')).toBe('the desktop game app')
    expect(deviceClientName('game-mobile-client')).toBe('the mobile app')
    expect(deviceClientName('something-else')).toBe('something-else')
  })
})
