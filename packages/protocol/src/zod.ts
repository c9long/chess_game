import { z } from 'zod'

/**
 * Zod for the protocol schemas. In a browser it validates without generated code: Zod's
 * compiled fast path probes `new Function` when an object schema is created, and the web
 * app's Content-Security-Policy has no 'unsafe-eval' (apps/server/src/http/static-web.ts),
 * so the probe would be blocked and reported as a CSP violation. The server keeps the
 * compiled path. Every protocol module imports `z` from here, so this runs before any
 * schema exists.
 */
if ('document' in globalThis) z.config({ jitless: true })

export { z }
