import { describe, expect, it } from 'vitest'
import {
  type AgeGateInput,
  ageGateState,
  isTransientSessionError,
  retryDelayMs,
  UNREACHABLE_AFTER_FAILURES,
} from './age-gate.ts'

const CONFIRMED = { ageConfirmed: true, blocked: false }
const UNCONFIRMED = { ageConfirmed: false, blocked: false }
const BLOCKED = { ageConfirmed: false, blocked: true }

function input(over: Partial<AgeGateInput>): AgeGateInput {
  return {
    user: null,
    sessionUnsettled: false,
    legal: undefined,
    legalFor: undefined,
    failures: 0,
    requireAge: true,
    ...over,
  }
}

describe('ageGateState', () => {
  it('never asks a signed-in account confirmed at creation, whatever else is known', () => {
    const user = { id: 'u1', ageConfirmed: true }
    for (const legal of [undefined, UNCONFIRMED, BLOCKED]) {
      for (const legalFor of [undefined, null, 'u1', 'someone-else']) {
        for (const failures of [0, 10]) {
          expect(ageGateState(input({ user, legal, legalFor, failures }))).toBe('ok')
        }
      }
    }
  })

  it('asks a signed-in account that is not confirmed, once its own status says so', () => {
    const user = { id: 'u1', ageConfirmed: false }
    expect(ageGateState(input({ user, legal: UNCONFIRMED, legalFor: 'u1' }))).toBe('ask')
    // After answering, the refreshed status says confirmed even before the session catches up.
    expect(ageGateState(input({ user, legal: CONFIRMED, legalFor: 'u1' }))).toBe('ok')
  })

  it('does not use a status about someone else (or about a signed-out visitor) for a user', () => {
    const user = { id: 'u1', ageConfirmed: false }
    expect(ageGateState(input({ user, legal: UNCONFIRMED, legalFor: null }))).toBe('loading')
    expect(ageGateState(input({ user, legal: UNCONFIRMED, legalFor: 'u2' }))).toBe('loading')
  })

  it('waits while the session is loading instead of asking', () => {
    // Nothing known at all.
    expect(ageGateState(input({ sessionUnsettled: true }))).toBe('loading')
    // The server answered about a signed-in user, but the client's session isn't back yet
    // (say the page loaded while the API restarted): wait for the session, don't ask.
    expect(
      ageGateState(input({ sessionUnsettled: true, legal: UNCONFIRMED, legalFor: 'u1' })),
    ).toBe('loading')
  })

  it('keeps a signed-out answer while the session refetches', () => {
    expect(ageGateState(input({ sessionUnsettled: true, legal: CONFIRMED, legalFor: null }))).toBe(
      'ok',
    )
    expect(
      ageGateState(input({ sessionUnsettled: true, legal: UNCONFIRMED, legalFor: null })),
    ).toBe('ask')
  })

  it('asks a new signed-out visitor, and lets one who answered through', () => {
    expect(ageGateState(input({ legal: UNCONFIRMED, legalFor: null }))).toBe('ask')
    expect(ageGateState(input({ legal: CONFIRMED, legalFor: null }))).toBe('ok')
  })

  it('a status still loading or failing is never a reason to ask', () => {
    for (let failures = 0; failures < UNREACHABLE_AFTER_FAILURES; failures++) {
      expect(ageGateState(input({ failures }))).toBe('loading')
      expect(ageGateState(input({ user: { id: 'u1' }, failures }))).toBe('loading')
    }
    expect(ageGateState(input({ failures: UNREACHABLE_AFTER_FAILURES }))).toBe('unreachable')
    expect(
      ageGateState(input({ sessionUnsettled: true, failures: UNREACHABLE_AFTER_FAILURES + 2 })),
    ).toBe('unreachable')
  })

  it('keeps the previous answer for the same visitor through failures', () => {
    expect(ageGateState(input({ legal: CONFIRMED, legalFor: null, failures: 9 }))).toBe('ok')
  })

  it('sign-in pages skip the DOB screen but keep the under-13 block', () => {
    expect(ageGateState(input({ legal: UNCONFIRMED, legalFor: null, requireAge: false }))).toBe(
      'ok',
    )
    expect(ageGateState(input({ legal: BLOCKED, legalFor: null, requireAge: false }))).toBe(
      'blocked',
    )
    expect(ageGateState(input({ requireAge: false }))).toBe('loading')
  })

  it('refuses a blocked browser that is signed out or not confirmed', () => {
    expect(ageGateState(input({ legal: BLOCKED, legalFor: null }))).toBe('blocked')
    expect(
      ageGateState(
        input({ user: { id: 'u1', ageConfirmed: false }, legal: BLOCKED, legalFor: 'u1' }),
      ),
    ).toBe('blocked')
  })
})

describe('retryDelayMs', () => {
  it('backs off to a ceiling', () => {
    expect([1, 2, 3, 4, 5, 20].map(retryDelayMs)).toEqual([1000, 2000, 4000, 5000, 5000, 5000])
  })
})

describe('isTransientSessionError', () => {
  it('treats proxy and network failures as unknown, 401/403 as signed out', () => {
    expect(isTransientSessionError(null)).toBe(false)
    expect(isTransientSessionError({ status: 502, statusText: 'Bad Gateway' })).toBe(true)
    expect(isTransientSessionError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientSessionError({ status: 401 })).toBe(false)
    expect(isTransientSessionError({ status: 403 })).toBe(false)
  })
})
