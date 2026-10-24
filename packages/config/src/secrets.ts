/**
 * The one list of secret names, shared by the server's logger (redacted fields, scrubbed
 * library messages) and the error-report scrubber (error-scrub.ts).
 */

export const REDACTED = '[redacted]'

/** Field names whose values are never logged (pino's redact needs exact names) nor reported. */
export const SECRET_KEYS = [
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
]

/** Stems that mark any longer name as a secret too (`session_token`, `reconnectionToken`). */
export const SECRET_WORDS = 'pass|secret|token|cookie|authori[sz]ation|api[_-]?key|user_?code'

/** Exact names (`code`, not `statusCode`) or names containing a stem, in free text. */
const SECRET_NAME = String.raw`[\w.-]*(?:${SECRET_WORDS})[\w-]*|${SECRET_KEYS.join('|')}`

/**
 * The quote around a key: none, `"`, `'`, or an escaped `\"` (JSON inside a JSON string).
 * Values: an array (`"backupCodes":["a","b"]`), an escaped JSON string, a quoted string, an
 * auth scheme and its credential (`authorization=Basic <b64>`), or one bare word.
 */
const SECRET_PAIR = new RegExp(
  String.raw`(\\?["']?)\b(${SECRET_NAME})\1(\s*[:=]\s*)(?:\[[^\]]*\]|\\".*?\\"|"(?:[^"\\]|\\.)*"|'[^']*'|(?:Basic|Bearer|Digest)\s+[^\s"',;&}\]]+|[^\s"',;&}\]]+)`,
  'gi',
)
/**
 * A bare password can hold spaces (`password: correct horse battery`), so it runs to the end of
 * the line or the next `,`, `;` or `&`. Quoted and already redacted values are left to SECRET_PAIR.
 */
const PASSWORD_PAIR =
  /(\\?["']?)\b([\w.-]*pass[\w-]*)\1(\s*[:=]\s*)(?!\[redacted\]|\\?["'[])[^\r\n,;&]+/gi
/** Header lines (or JSON fields) whose whole value is a credential. */
const CREDENTIAL_HEADER = /\b((?:proxy-)?authorization|(?:set-)?cookie)(["']?\s*:\s*)[^\r\n]*/gi
const BEARER = /\bBearer\s+[\w.~+/-]+=*/gi
/** A password in a URL: `https://user:pass@host`. */
const USERINFO = /\/\/[^/\s@:?#]+:[^/\s@?#]*@/g
/** Drizzle's DrizzleQueryError ends with the query's parameter values (tokens, hashes, names). */
const QUERY_PARAMS = /(Failed query:[\s\S]*?\nparams:)[\s\S]*/g

/**
 * Redacts credentials in free text: secret-named values, auth headers, URL passwords and failed
 * queries' parameter values.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(QUERY_PARAMS, `$1 ${REDACTED}`)
    .replace(USERINFO, `//${REDACTED}@`)
    .replace(PASSWORD_PAIR, `$1$2$1$3${REDACTED}`)
    .replace(SECRET_PAIR, `$1$2$1$3${REDACTED}`)
    .replace(CREDENTIAL_HEADER, `$1$2${REDACTED}`)
    .replace(BEARER, `Bearer ${REDACTED}`)
}
