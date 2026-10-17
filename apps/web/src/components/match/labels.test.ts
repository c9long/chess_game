import { describe, expect, it } from 'vitest'
import { defeatReasonLabel } from './labels.ts'

describe('defeatReasonLabel', () => {
  it('names the leader kind for a seat that started with several leaders', () => {
    expect(defeatReasonLabel('leader_captured', 'prime_minister', 4)).toBe(
      'All Prime Ministers captured',
    )
  })

  it('keeps the standard labels otherwise', () => {
    expect(defeatReasonLabel('leader_captured', 'king', 1)).toBe('Leader captured')
    expect(defeatReasonLabel('leader_captured', null, 1)).toBe('Leader captured')
    expect(defeatReasonLabel('timeout', 'prime_minister', 4)).toBe('Out of time')
    expect(defeatReasonLabel('resign', 'prime_minister', 4)).toBe('Resigned')
  })
})
