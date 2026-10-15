import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { TURNSTILE_TEST_SECRET_KEY } from '../config.ts'

/** The token Cloudflare's always-pass test site key produces in the browser. */
export const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
export const PROD_LIKE_SECRET = 'prod-like-turnstile-secret'

/**
 * Local stand-in for Cloudflare's siteverify so tests don't depend on the network. It
 * accepts the dummy token for the always-pass test secret, like Cloudflare does.
 */
export async function startTurnstileStub(
  hostname = 'localhost',
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => {
      raw += c.toString()
    })
    req.on('end', () => {
      let body: { secret?: string; response?: string } = {}
      try {
        body = JSON.parse(raw)
      } catch {}
      const okSecret = body.secret === TURNSTILE_TEST_SECRET_KEY || body.secret === PROD_LIKE_SECRET
      const success = okSecret && body.response === TURNSTILE_DUMMY_TOKEN
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify(
          success
            ? { success: true, hostname, 'error-codes': [] }
            : { success: false, 'error-codes': ['invalid-input-response'] },
        ),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/siteverify`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
