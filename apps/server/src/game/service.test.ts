import { describe, expect, it } from 'vitest'
import { AttemptLimiter } from './service.ts'

describe('AttemptLimiter', () => {
  it('blocks a key after `limit` failures within the window, then forgets', () => {
    const l = new AttemptLimiter(5, 60_000)
    for (let i = 0; i < 4; i++) l.fail('ip:1', 1_000)
    expect(l.blocked('ip:1', 1_000)).toBe(false)
    l.fail('ip:1', 1_000)
    expect(l.blocked('ip:1', 2_000)).toBe(true)
    expect(l.blocked('ip:2', 2_000)).toBe(false)
    expect(l.blocked('ip:1', 61_001)).toBe(false)
  })
})
