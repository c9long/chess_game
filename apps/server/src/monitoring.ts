import { z } from 'zod'

export const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))

/** The Sentry ingest origin of a DSN (`https://<key>@<host>/<project id>`), or undefined. */
export function sentryIngestOrigin(dsn: string): string | undefined {
  try {
    const u = new URL(dsn)
    const ok = /^https?:$/.test(u.protocol) && u.username && /^\/(?:.+\/)?\d+$/.test(u.pathname)
    return ok ? u.origin : undefined
  } catch {
    return undefined
  }
}

const dsn = (name: string) =>
  optionalString.refine((v) => v === undefined || sentryIngestOrigin(v) !== undefined, {
    message: `${name} must look like https://<key>@<host>/<project id>`,
  })

/** Part of loadConfig's schema; instrument.ts parses it alone, before the app is loaded. */
export const sentryEnvSchema = z.object({
  /** Required: a missing NODE_ENV must never fall back to development secrets. */
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    error: 'NODE_ENV must be set explicitly to development, test or production',
  }),
  SENTRY_DSN: dsn('SENTRY_DSN'),
  SENTRY_ENVIRONMENT: optionalString,
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  /** The served web build's DSN: the page's CSP lets the browser report to its ingest host. */
  VITE_SENTRY_DSN: dsn('VITE_SENTRY_DSN'),
})

export interface SentrySettings {
  dsn: string
  environment: string
  tracesSampleRate: number
}

export function sentrySettings(e: z.infer<typeof sentryEnvSchema>): SentrySettings | undefined {
  if (!e.SENTRY_DSN) return undefined
  return {
    dsn: e.SENTRY_DSN,
    environment: e.SENTRY_ENVIRONMENT ?? e.NODE_ENV,
    tracesSampleRate: e.SENTRY_TRACES_SAMPLE_RATE,
  }
}

/** The subset of the SDK the server calls, so nothing here imports it. */
export interface ErrorReporter {
  captureException(err: unknown, hint?: { extra?: Record<string, unknown> }): unknown
  flush(timeoutMs?: number): Promise<boolean>
}

let reporter: ErrorReporter | undefined

/** Set by instrument.ts once the SDK runs (tests set a fake). */
export function setErrorReporter(next: ErrorReporter | undefined): void {
  reporter = next
  hourStart = Number.NEGATIVE_INFINITY
}

const HOUR_MS = 3_600_000
const MAX_PER_HOUR = 30
const MAX_SAME_PER_HOUR = 5
let hourStart = Number.NEGATIVE_INFINITY
let sentThisHour = 0
const sentPerMessage = new Map<string, number>()

/**
 * Reports an unexpected server error; a no-op when error tracking is off. At most 30 reports an
 * hour, 5 with the same message, since clients can cause some errors (Colyseus logs undecodable
 * messages as errors) and must not use up the plan's monthly quota. The log still has them all.
 */
export function reportError(err: unknown, extra?: Record<string, unknown>): void {
  if (!reporter) return
  const now = Date.now()
  if (now - hourStart >= HOUR_MS) {
    hourStart = now
    sentThisHour = 0
    sentPerMessage.clear()
  }
  const key = (err instanceof Error ? err.message : String(err)).slice(0, 200)
  const same = sentPerMessage.get(key) ?? 0
  if (sentThisHour >= MAX_PER_HOUR || same >= MAX_SAME_PER_HOUR) return
  sentThisHour++
  sentPerMessage.set(key, same + 1)
  reporter.captureException(err, extra ? { extra } : undefined)
}

/** Sends queued reports before the process exits (resolves at once when off). */
export async function flushErrorReports(timeoutMs = 2_000): Promise<void> {
  await reporter?.flush(timeoutMs)
}
