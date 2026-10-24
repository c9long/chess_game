import { Writable } from 'node:stream'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { setErrorReporter } from '../monitoring.ts'
import { errorHandler } from './error-handler.ts'

/** Routes that fail the ways real ones can, in front of the app's error handler. */
function makeApp() {
  const app = express()
  app.use(express.json({ limit: '32kb' }))
  app.post('/echo', (req, res) => {
    res.json(req.body)
  })
  app.get('/boom', () => {
    throw new Error('database exploded')
  })
  app.get('/async-boom', async () => {
    await Promise.resolve()
    throw new Error('async failure')
  })
  const sink = new Writable({ write: (_chunk, _enc, cb) => cb() })
  app.use(errorHandler(createLogger('info', sink)))
  return app
}

afterEach(() => setErrorReporter(undefined))

describe('errorHandler', () => {
  it('answers INTERNAL and reports server errors when error tracking is on', async () => {
    const captureException = vi.fn()
    setErrorReporter({ captureException, flush: async () => true })
    const app = makeApp()
    for (const path of ['/boom', '/async-boom']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(500)
      expect(res.body, path).toEqual({ error: 'INTERNAL' })
    }
    // The thrown error itself (its stack), not just the log line's message.
    expect(captureException).toHaveBeenCalledTimes(2)
    expect(captureException.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(captureException.mock.calls[0]?.[0]).toMatchObject({ message: 'database exploded' })
    expect(captureException.mock.calls[0]?.[1]).toEqual({
      extra: { service: 'server', path: '/boom' },
    })
  })

  it('does not report client mistakes (bad or oversized JSON)', async () => {
    const captureException = vi.fn()
    setErrorReporter({ captureException, flush: async () => true })
    const app = makeApp()
    const bad = await request(app)
      .post('/echo')
      .set('content-type', 'application/json')
      .send('{"oops"')
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'BAD_REQUEST' })
    const big = await request(app)
      .post('/echo')
      .send({ x: 'y'.repeat(40_000) })
    expect(big.status).toBe(413)
    expect(captureException).not.toHaveBeenCalled()
  })

  it('still answers when error tracking is off', async () => {
    const res = await request(makeApp()).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'INTERNAL' })
  })
})
