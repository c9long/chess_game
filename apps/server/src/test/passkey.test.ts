import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, signUpVerified, startHarness } from './harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

describe('passkeys (WebAuthn options)', () => {
  it('issues registration options for a signed-in user with the configured RP', async () => {
    const a = await signUpVerified(h)
    const res = await a.client.get('/api/auth/passkey/generate-register-options')
    expect(res.status).toBe(200)
    expect(res.body.rp).toEqual({ name: "LinkedList's Chess Game", id: 'localhost' })
    expect(typeof res.body.challenge).toBe('string')
    expect(res.body.challenge.length).toBeGreaterThan(20)
    expect(res.body.user.name).toContain(a.username)
    expect(res.body.authenticatorSelection.residentKey).toBe('preferred')
    // The challenge is bound to the browser by a signed cookie.
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
    expect(set.some((c) => /^[^=]*passkey[^=]*=/.test(c))).toBe(true)
  })

  it('refuses registration options without a session', async () => {
    const res = await h.client().get('/api/auth/passkey/generate-register-options')
    expect(res.status).toBe(401)
  })

  it('issues authentication options for passkey sign-in', async () => {
    const res = await h.client().get('/api/auth/passkey/generate-authenticate-options')
    expect(res.status).toBe(200)
    expect(res.body.rpId).toBe('localhost')
    expect(typeof res.body.challenge).toBe('string')
  })
})
