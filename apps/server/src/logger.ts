import { type DestinationStream, pino } from 'pino'

/**
 * Keys whose values are never written to logs, at any nesting depth we log. Request
 * logging records only method, path (no query string) and status, so tokens in URLs
 * never reach the log either.
 */
export const REDACT_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'secret',
  'backupCodes',
  'code',
  'otp',
  'totpURI',
  'authorization',
  'cookie',
  'set-cookie',
  'x-captcha-response',
  'dateOfBirth',
  'url',
]

const paths = REDACT_KEYS.flatMap((k) =>
  /^[A-Za-z_$][\w$]*$/.test(k)
    ? [k, `*.${k}`, `*.*.${k}`]
    : [`["${k}"]`, `*["${k}"]`, `*.*["${k}"]`],
)

export function createLogger(level: string, destination?: DestinationStream) {
  const options = { level, base: { service: 'server' }, redact: { paths, censor: '[redacted]' } }
  return destination ? pino(options, destination) : pino(options)
}

export type Logger = ReturnType<typeof createLogger>

const SECRET_PATTERN =
  /((?:password|token|secret|code|otp|cookie|authorization)["']?\s*[:=]\s*["']?)[^"',\s}&]+/gi

/** Scrubs secret-looking key/value pairs from free-form log text (e.g. library messages). */
export function scrubMessage(text: string): string {
  return text
    .replace(SECRET_PATTERN, '$1[redacted]')
    .replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]')
}
