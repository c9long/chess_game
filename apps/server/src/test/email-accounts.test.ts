import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { acceptLegal, confirmAge, type Harness, startHarness } from './harness.ts'

describe('EMAIL_ACCOUNTS=false (no mail service)', () => {
  let h: Harness
  beforeAll(async () => {
    h = await startHarness({ EMAIL_ACCOUNTS: 'false' })
  })
  afterAll(async () => {
    await h.close()
  })

  it('tells the web app to hide email sign-up', async () => {
    const res = await h.client().get('/api/config')
    expect(res.body.emailAccounts).toBe(false)
  })

  it('refuses email sign-up and sends no email', async () => {
    const client = h.client()
    await confirmAge(client)
    await acceptLegal(client)
    const res = await client.post(
      '/api/auth/sign-up/email',
      {
        email: 'nomail@example.test',
        password: 'correct horse battery staple',
        name: 'NoMail',
        username: 'NoMail',
      },
      { captcha: true },
    )
    expect(res.body.code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED')
    expect(h.mailbox.list('nomail@example.test')).toHaveLength(0)
  })
})
