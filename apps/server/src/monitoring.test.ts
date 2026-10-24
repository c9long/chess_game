import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flushErrorReports,
  reportError,
  sentryIngestOrigin,
  setErrorReporter,
} from './monitoring.ts'

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url))

/** Runs a one-line script behind the instrument.ts preload, the way the server starts. */
function preloaded(script: string, env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', './src/instrument.ts', '-e', script], {
    cwd: SERVER_DIR,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env },
    encoding: 'utf8',
    timeout: 20_000,
  })
  expect(r.stderr).toBe('')
  return r.stdout.trim()
}

afterEach(() => setErrorReporter(undefined))

describe('sentryIngestOrigin', () => {
  it('takes the ingest origin from a DSN', () => {
    expect(sentryIngestOrigin('https://key@o1.ingest.us.sentry.io/123')).toBe(
      'https://o1.ingest.us.sentry.io',
    )
    // Self-hosted Sentry under a path prefix.
    expect(sentryIngestOrigin('https://key@sentry.example.com/errors/7')).toBe(
      'https://sentry.example.com',
    )
  })

  it('rejects anything that is not a DSN', () => {
    for (const bad of ['', 'nope', 'https://o1.ingest.sentry.io/123', 'https://k@h/abc']) {
      expect(sentryIngestOrigin(bad), bad).toBeUndefined()
    }
  })
})

describe('reportError', () => {
  it('does nothing until a reporter is set', async () => {
    expect(() => reportError(new Error('x'))).not.toThrow()
    await expect(flushErrorReports()).resolves.toBeUndefined()
  })

  it('passes errors and context to the reporter', () => {
    const captureException = vi.fn()
    setErrorReporter({ captureException, flush: async () => true })
    const err = new Error('x')
    reportError(err, { room: 'r1' })
    reportError(err)
    expect(captureException).toHaveBeenNthCalledWith(1, err, { extra: { room: 'r1' } })
    expect(captureException).toHaveBeenNthCalledWith(2, err, undefined)
  })
})

describe('reportError rate cap', () => {
  afterEach(() => vi.useRealTimers())

  it('sends at most 5 reports with the same message and 30 in all each hour', () => {
    vi.useFakeTimers({ now: 0 })
    const captureException = vi.fn()
    setErrorReporter({ captureException, flush: async () => true })
    for (let i = 0; i < 8; i++) reportError(new Error('same'))
    expect(captureException).toHaveBeenCalledTimes(5)
    for (let i = 0; i < 40; i++) reportError(new Error(`e${i}`))
    expect(captureException).toHaveBeenCalledTimes(30)
    vi.setSystemTime(3_599_999)
    reportError(new Error('same hour'))
    expect(captureException).toHaveBeenCalledTimes(30)
    vi.setSystemTime(3_600_000)
    reportError(new Error('same'), { i: 1 })
    expect(captureException).toHaveBeenCalledTimes(31)
    expect(captureException).toHaveBeenLastCalledWith(new Error('same'), { extra: { i: 1 } })
  })
})

describe('instrument.ts preload', () => {
  const probe = 'console.log(typeof globalThis.__SENTRY__)'

  it('leaves the SDK unloaded without SENTRY_DSN', () => {
    expect(preloaded(probe, {})).toBe('undefined')
    // A malformed DSN leaves it off too (loadConfig then refuses to start).
    expect(preloaded(probe, { SENTRY_DSN: 'not-a-dsn' })).toBe('undefined')
  })

  it('starts the SDK when SENTRY_DSN is set', () => {
    // Nothing is sent: no error is captured, and the host is unreachable anyway.
    expect(preloaded(probe, { SENTRY_DSN: 'http://key@127.0.0.1:9/1' })).toBe('object')
  })
})
