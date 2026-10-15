import { randomBytes, randomInt } from 'node:crypto'
import { LEGAL_VERSIONS } from '@game/config'
import type { Express } from 'express'
import request from 'supertest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { MemoryEmailSender, type StoredEmail } from '../email/sender.ts'
import { TEST_DATABASE_URL } from './env.ts'
import { PROD_LIKE_SECRET, startTurnstileStub, TURNSTILE_DUMMY_TOKEN } from './turnstile-stub.ts'

export const WEB_ORIGIN = 'http://localhost:5173'

export function randomIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
}

export function uniqueName(prefix = 'p'): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`
}

/**
 * A browser-like client: keeps cookies, sends the web Origin, and has its own client IP
 * (sent as CF-Connecting-IP, since tests run with TRUST_CLOUDFLARE=true).
 */
export class TestClient {
  readonly agent: ReturnType<typeof request.agent>
  ip: string
  readonly origin: string

  constructor(app: Express, ip = randomIp(), origin = WEB_ORIGIN) {
    this.agent = request.agent(app)
    this.ip = ip
    this.origin = origin
  }

  private headers<T extends request.Test>(t: T, captcha: boolean): T {
    t.set('origin', this.origin).set('cf-connecting-ip', this.ip)
    if (captcha) t.set('x-captcha-response', TURNSTILE_DUMMY_TOKEN)
    return t
  }

  get(path: string) {
    return this.headers(this.agent.get(path), false)
  }

  post(path: string, body: object = {}, { captcha = false } = {}) {
    return this.headers(this.agent.post(path), captcha).send(body)
  }

  delete(path: string, body: object = {}) {
    return this.headers(this.agent.delete(path), false).send(body)
  }
}

/** Production-like settings: separate https play./api. origins behind Cloudflare. */
export const PROD_ENV = {
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: 'x'.repeat(48),
  IP_HASH_SECRET: 'p'.repeat(48),
  TURNSTILE_SITE_KEY: 'prod-site-key',
  TURNSTILE_SECRET_KEY: PROD_LIKE_SECRET,
  RESEND_API_KEY: 're_test_unused',
  API_PUBLIC_URL: 'https://api.example.test',
  WEB_ORIGIN: 'https://play.example.test',
  PASSKEY_RP_ID: 'example.test',
  TRUST_CLOUDFLARE: 'true',
}

export async function startHarness(env: Record<string, string> = {}) {
  const webOrigin = env.WEB_ORIGIN ?? WEB_ORIGIN
  const stub = await startTurnstileStub(new URL(webOrigin).hostname)
  const isProd = env.NODE_ENV === 'production'
  const loaded = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    TRUST_CLOUDFLARE: 'true',
    LOG_LEVEL: 'silent',
    API_PUBLIC_URL: WEB_ORIGIN,
    WEB_ORIGIN,
    GUEST_PURGE_INTERVAL_MINUTES: '0',
    // Production refuses a siteverify override, so it is applied after validation below.
    ...(isProd ? {} : { TURNSTILE_SITEVERIFY_URL: stub.url }),
    ...env,
  })
  // Tests never call Cloudflare: point siteverify at the local stub.
  const config = { ...loaded, turnstile: { ...loaded.turnstile, siteVerifyUrl: stub.url } }
  const mailbox = new MemoryEmailSender()
  const ctx = createApp(config, { email: mailbox })
  return {
    ...ctx,
    config,
    mailbox,
    client: (ip?: string) => new TestClient(ctx.app, ip, config.webOrigin),
    close: async () => {
      await ctx.close()
      await stub.close()
    },
  }
}

export type Harness = Awaited<ReturnType<typeof startHarness>>

export function linkFrom(mail: StoredEmail | undefined): URL {
  const m = mail?.text.match(/https?:\/\/\S+/)
  if (!m) throw new Error('no link in email')
  return new URL(m[0])
}

export function lastMail(h: Harness, to: string, kind: StoredEmail['kind']): StoredEmail {
  const mail = h.mailbox
    .list(to)
    .filter((m) => m.kind === kind)
    .at(-1)
  if (!mail) throw new Error(`no ${kind} email for ${to}`)
  return mail
}

export async function confirmAge(c: TestClient, dateOfBirth = '1990-05-17') {
  return c.post('/api/legal/age-confirmation', { dateOfBirth })
}

export async function acceptLegal(c: TestClient) {
  return c.post('/api/legal/acceptances', {
    documents: Object.entries(LEGAL_VERSIONS).map(([document, version]) => ({ document, version })),
  })
}

export interface Account {
  client: TestClient
  email: string
  username: string
  password: string
  userId: string
}

/** Signs up through the real flow (age, clickwrap, captcha), then verifies the email. */
export async function signUpVerified(h: Harness, client = h.client()): Promise<Account> {
  const username = uniqueName('u')
  const email = `${username}@example.test`
  const password = 'correct horse battery staple'
  await confirmAge(client)
  await acceptLegal(client)
  const res = await client.post(
    '/api/auth/sign-up/email',
    { email, password, name: username, username },
    { captcha: true },
  )
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${res.text}`)
  const token = linkFrom(lastMail(h, email, 'verify-email')).searchParams.get('token')
  const verify = await client.get(`/api/auth/verify-email?token=${token}`)
  if (verify.status !== 200) throw new Error(`verify failed: ${verify.status} ${verify.text}`)
  return { client, email, username, password, userId: res.body.user.id }
}

export async function createGuest(h: Harness, client = h.client()) {
  await confirmAge(client)
  await acceptLegal(client)
  const res = await client.post('/api/auth/sign-in/anonymous', {}, { captcha: true })
  if (res.status !== 200) throw new Error(`guest sign-in failed: ${res.status} ${res.text}`)
  return { client, user: res.body.user as { id: string; name: string; isAnonymous: boolean } }
}
