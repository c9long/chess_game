import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger, scrubMessage } from './logger.ts'

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
    expect(scrubMessage('password=hunter2 ok')).toBe('password=[redacted] ok')
    expect(scrubMessage('GET /verify-email?token=abc.def&x=1')).toBe(
      'GET /verify-email?token=[redacted]&x=1',
    )
  })
})
