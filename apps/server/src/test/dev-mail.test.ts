import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, startHarness } from './harness.ts'

describe('dev mailbox (development/test only)', () => {
  let h: Harness
  beforeAll(async () => {
    h = await startHarness()
  })
  afterAll(async () => {
    await h.close()
  })

  it('is advertised in /api/config when emails are stored instead of sent', async () => {
    const res = await request(h.app).get('/api/config')
    expect(res.body.devMailbox).toBe(true)
  })

  it('answers local requests', async () => {
    await h.mailbox.send({
      kind: 'verify-email',
      to: 'dev@example.test',
      subject: 'Verify',
      text: 'http://localhost:5173/verify-email?token=t',
      html: '',
    })
    const res = await request(h.app)
      .get('/api/dev/mail?to=dev@example.test')
      .set('Host', 'localhost:5173')
    expect(res.status).toBe(200)
    expect(res.body.messages).toHaveLength(1)
  })

  it('refuses a foreign Host header (DNS rebinding from a web page)', async () => {
    const res = await request(h.app).get('/api/dev/mail').set('Host', 'attacker.example:3000')
    expect(res.status).toBe(404)
  })
})
