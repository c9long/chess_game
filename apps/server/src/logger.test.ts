import { Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger, NOT_REPORTED, scrubMessage } from './logger.ts'
import { setErrorReporter } from './monitoring.ts'

function sink() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString())
      cb()
    },
  })
  return { lines, stream }
}

describe('logger', () => {
  it('redacts secrets at any logged depth', () => {
    const lines: string[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString())
        cb()
      },
    })
    const log = createLogger('info', sink)
    log.info(
      {
        password: 'hunter2',
        body: { token: 'tok-123', newPassword: 'pw-456', nested: { secret: 's3cr3t' } },
        headers: { cookie: 'sid=1', 'set-cookie': 'a=b', authorization: 'Bearer xyz' },
      },
      'login',
    )
    const out = lines.join('')
    for (const leaked of ['hunter2', 'tok-123', 'pw-456', 's3cr3t', 'sid=1', 'a=b', 'Bearer xyz']) {
      expect(out).not.toContain(leaked)
    }
    expect(out).toContain('[redacted]')
  })

  it('scrubs secret-looking pairs and URL tokens from free text', () => {
    expect(scrubMessage('password=hunter2 ok')).toBe('password=[redacted]')
    expect(scrubMessage('GET /verify-email?token=abc.def&x=1')).toBe(
      'GET /verify-email?token=[redacted]&x=1',
    )
  })
})

describe('logger error reports', () => {
  afterEach(() => setErrorReporter(undefined))

  function tracked() {
    const captureException = vi.fn()
    setErrorReporter({ captureException, flush: async () => true })
    return captureException
  }

  it('reports error-level lines with their fields, and nothing below that level', () => {
    const captureException = tracked()
    const log = createLogger('info', sink().stream).child({ component: 'rooms' })
    log.info({ room: 'r1' }, 'fine')
    log.warn({ room: 'r1' }, 'odd')
    log.error({ room: 'r1', err: 'connection reset', token: 't0k' }, 'record failed')
    expect(captureException).toHaveBeenCalledTimes(1)
    const [err, hint] = captureException.mock.calls[0] ?? []
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('record failed')
    // The fields go as they are; the SDK's beforeSend (error-scrub.ts) drops `token`.
    expect(hint).toEqual({
      extra: {
        service: 'server',
        component: 'rooms',
        room: 'r1',
        err: 'connection reset',
        token: 't0k',
      },
    })
  })

  it('reports an Error passed as err (or alone) with its own stack', () => {
    const captureException = tracked()
    const { lines, stream } = sink()
    const log = createLogger('info', stream)
    const boom = Object.assign(new Error('boom'), { params: ['secret-param'] })
    log.error({ err: boom, path: '/x' }, 'unhandled error')
    log.fatal(boom)
    expect(captureException.mock.calls.map((c) => c[0])).toEqual([boom, boom])
    expect(captureException.mock.calls[0]?.[1]).toEqual({
      extra: { service: 'server', path: '/x' },
    })
    // Logged as type, message and stack only, never the error's other fields.
    expect(lines.join('')).toContain('"message":"boom"')
    expect(lines.join('')).not.toContain('secret-param')
  })

  it('reports Errors under other keys as type, message and stack only', () => {
    const captureException = tracked()
    const cause = Object.assign(new Error('db down'), { name: 'DrizzleQueryError', params: ['p1'] })
    const log = createLogger('info', sink().stream)
    log.error({ err: new Error('boom'), cause }, 'failed')
    log.error({ cause }, 'no err field')
    expect(captureException).toHaveBeenCalledTimes(2)
    for (const [, hint] of captureException.mock.calls) {
      expect(hint.extra.cause).toEqual({
        type: 'DrizzleQueryError',
        message: 'db down',
        stack: expect.stringContaining('db down'),
      })
    }
    expect(JSON.stringify(captureException.mock.calls.map((c) => c[1]))).not.toContain('p1')
  })

  it("scrubs a logged error's message and stack", () => {
    const { lines, stream } = sink()
    const boom = new Error('Failed query: select 1 where "id" = $1\nparams: tok-77')
    createLogger('info', stream).error({ err: boom }, 'query failed')
    const { err } = JSON.parse(lines[0] ?? '{}')
    expect(err.message).toBe('Failed query: select 1 where "id" = $1\nparams: [redacted]')
    expect(err.stack).not.toContain('tok-77')
  })

  it('titles multi-line messages with their first line', () => {
    const captureException = tracked()
    createLogger('info', sink().stream).error({}, 'Error: bad message\n    at decode (x.js:1:2)')
    const [err, hint] = captureException.mock.calls[0] ?? []
    expect((err as Error).message).toBe('Error: bad message')
    expect(hint.extra.log).toContain('at decode')
  })

  it('skips lines marked NOT_REPORTED, and still logs them without the mark', () => {
    const captureException = tracked()
    const { lines, stream } = sink()
    createLogger('info', stream).error({ [NOT_REPORTED]: true, status: 503 }, 'request')
    expect(captureException).not.toHaveBeenCalled()
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ status: 503, msg: 'request' })
    expect(lines[0]).not.toContain('not reported')
  })
})
