/**
 * PLAN §12 security check: no plaintext secrets in the database or the logs. Runs real
 * flows (signup, verification, password reset, TOTP + backup codes) with a log capture,
 * then scans every text-like column of every table and every log line.
 */
import { Writable } from 'node:stream'
import { sql } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { createLogger } from '../logger.ts'
import { setErrorReporter } from '../monitoring.ts'
import {
  acceptLegal,
  confirmAge,
  type Harness,
  lastMail,
  linkFrom,
  signUpVerified,
  startHarness,
  TestClient,
  WEB_ORIGIN,
} from './harness.ts'

let h: Harness
const lines: string[] = []
let app: ReturnType<typeof createApp>
const client = () => new TestClient(app.app)

beforeAll(async () => {
  h = await startHarness()
  // Same config, but with a logger that records everything down to trace level.
  const sink = new Writable({
    write(chunk, _enc, done) {
      lines.push(chunk.toString())
      done()
    },
  })
  app = createApp(h.config, { email: h.mailbox, logger: createLogger('trace', sink) })
})
afterAll(async () => {
  await app.close()
  await h.close()
})

/** Every value in every text-like column of every user table, as one big string. */
async function dumpDatabase(): Promise<string> {
  const cols = (await h.db.execute(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'jsonb', 'json')`)) as unknown as {
    table_name: string
    column_name: string
  }[]
  const parts: string[] = []
  for (const { table_name, column_name } of cols) {
    // Better Auth looks sessions up by their random token; it is a server-side handle, not a
    // user secret, and it is the one value that has to be stored as is.
    if (table_name === 'sessions' && column_name === 'token') continue
    const rows = (await h.db.execute(
      sql`select ${sql.identifier(column_name)}::text as v from ${sql.identifier(table_name)}`,
    )) as unknown as { v: string | null }[]
    for (const r of rows) if (r.v) parts.push(r.v)
  }
  return parts.join('\n')
}

describe('no plaintext secrets', () => {
  it('stores no passwords, TOTP secrets, backup codes or reset tokens, and logs none', async () => {
    const c = client()
    // Signup + verification through the logged app.
    await confirmAge(c)
    await acceptLegal(c)
    const username = `sec_${Date.now().toString(36)}`
    const email = `${username}@example.test`
    const password = 'plaintext canary password 7'
    await c.post(
      '/api/auth/sign-up/email',
      { email, password, name: username, username },
      { captcha: true },
    )
    const verifyToken = linkFrom(lastMail(h, email, 'verify-email')).searchParams.get('token') ?? ''
    await c.get(`/api/auth/verify-email?token=${verifyToken}`)
    const signIn = await client().post(
      '/api/auth/sign-in/email',
      { email, password },
      { captcha: true },
    )
    expect(signIn.status).toBe(200)

    // TOTP + backup codes.
    const enable = await c.post('/api/auth/two-factor/enable', { password })
    const { totpURI, backupCodes } = enable.body as { totpURI: string; backupCodes: string[] }
    const totp = OTPAuth.URI.parse(totpURI) as OTPAuth.TOTP
    await c.post('/api/auth/two-factor/verify-totp', { code: totp.generate() })

    // Password reset (the token stays valid in the DB until used).
    await client().post(
      '/api/auth/request-password-reset',
      { email, redirectTo: `${WEB_ORIGIN}/reset-password` },
      { captcha: true },
    )
    const resetToken =
      linkFrom(lastMail(h, email, 'reset-password')).searchParams.get('token') ?? ''
    expect(resetToken.length).toBeGreaterThan(10)

    // Another account through the normal harness, for good measure.
    const other = await signUpVerified(h)

    const db = await dumpDatabase()
    const logs = lines.join('')
    const secrets = {
      password,
      otherPassword: other.password,
      totpSecret: totp.secret.base32,
      backupCode: backupCodes[0] as string,
      resetToken,
      verifyToken,
    }
    for (const [name, value] of Object.entries(secrets)) {
      expect(db.includes(value), `${name} found in the database`).toBe(false)
      expect(logs.includes(value), `${name} found in the logs`).toBe(false)
    }
    // Session tokens and cookies never reach the logs either.
    const cookie = String(signIn.headers['set-cookie'] ?? '')
    const sessionToken = /session_token=([^.;]+)/.exec(cookie)?.[1] ?? ''
    expect(sessionToken.length).toBeGreaterThan(10)
    expect(logs.includes(sessionToken)).toBe(false)
    // One request line per call made above, at least.
    expect(lines.length).toBeGreaterThanOrEqual(8)
  })
})

describe('Better Auth failures', () => {
  afterEach(() => setErrorReporter(undefined))

  it('are logged and reported with the real error, minus its query parameters', () => {
    const captureException = vi.fn()
    setErrorReporter({ captureException, flush: async () => true })
    // A DrizzleQueryError: the message ends with the parameter values, and so do its fields.
    const failure = Object.assign(
      new Error('Failed query: select * from "session" where "id" = $1\nparams: tok-9f2k'),
      { name: 'DrizzleQueryError', params: ['tok-9f2k'] },
    )
    const before = lines.length
    app.auth.options.logger?.log?.('error', 'INTERNAL_SERVER_ERROR', failure)
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls[0]?.[0]).toBe(failure)
    const line = JSON.parse(lines.slice(before).join('') || '{}')
    expect(line.msg).toBe('INTERNAL_SERVER_ERROR')
    expect(line.err).toMatchObject({ type: 'DrizzleQueryError' })
    expect(line.err.message).toMatch(/^Failed query: select/)
    expect(lines.slice(before).join('')).not.toContain('tok-9f2k')
  })
})
