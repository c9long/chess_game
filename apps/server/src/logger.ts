import { REDACTED, SECRET_KEYS, scrubSecrets } from '@game/config/secrets'
import { type DestinationStream, type LoggerOptions, pino } from 'pino'
import { reportError } from './monitoring.ts'

/**
 * Keys whose values are never written to logs, at any nesting depth we log. Request logging
 * records only method, path (no query string) and status, so tokens in URLs never reach the log
 * either.
 */
export const REDACT_KEYS = [...SECRET_KEYS, 'url']

const paths = REDACT_KEYS.flatMap((k) =>
  /^[A-Za-z_$][\w$]*$/.test(k)
    ? [k, `*.${k}`, `*.*.${k}`]
    : [`["${k}"]`, `*["${k}"]`, `*.*["${k}"]`],
)

/** A field that keeps an error-level line out of error reports (pino doesn't log symbols). */
export const NOT_REPORTED = Symbol('not reported')

const ERROR_LEVEL = 50

/**
 * An error as its type, message and stack only: its other fields can hold the failed query's
 * parameter values (DrizzleQueryError), so they never reach a log or a report. The text is
 * scrubbed too, since the message itself can quote them.
 */
function serializeError(e: Error) {
  return {
    type: e.name,
    message: scrubSecrets(e.message),
    stack: e.stack === undefined ? undefined : scrubSecrets(e.stack),
  }
}

/** Log fields for an error report, with any Error value cut down as `serializeError` does. */
function reportFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, v instanceof Error ? serializeError(v) : v]),
  )
}

/** Reports an error-level log line: its `err` if that is an Error, else its message. */
function reportLogged(bindings: Record<string, unknown>, args: unknown[]): void {
  const [first, second] = args
  if (first instanceof Error) {
    reportError(first, reportFields(bindings))
    return
  }
  const fields = typeof first === 'object' && first !== null ? first : {}
  if (NOT_REPORTED in fields) return
  const { err, ...rest } = fields as Record<string, unknown>
  if (err instanceof Error) {
    reportError(err, reportFields({ ...bindings, ...rest }))
    return
  }
  const msg = String((typeof first === 'string' ? first : second) ?? '')
  const [title = '', ...more] = msg.split('\n')
  reportError(
    new Error(title),
    reportFields({
      ...bindings,
      ...rest,
      ...(err === undefined ? {} : { err }),
      ...(more.length > 0 ? { log: msg } : {}),
    }),
  )
}

export function createLogger(level: string, destination?: DestinationStream) {
  const options: LoggerOptions = {
    level,
    base: { service: 'server' },
    redact: { paths, censor: REDACTED },
    serializers: {
      err: (e: unknown) => (e instanceof Error ? serializeError(e) : e),
    },
    hooks: {
      // Every error-level line also goes to error tracking (a no-op when it is off), so call
      // sites only log.
      logMethod(args, method, lvl) {
        method.apply(this, args)
        if (lvl >= ERROR_LEVEL) reportLogged(this.bindings(), args)
      },
    },
  }
  return destination ? pino(options, destination) : pino(options)
}

export type Logger = ReturnType<typeof createLogger>

/** Scrubs secret-looking key/value pairs from free-form log text (e.g. library messages). */
export const scrubMessage = scrubSecrets
