/**
 * Privacy scrubbing for error reports (Sentry), shared by the server and the web app so both
 * strip the same things (privacy policy, "Error reports"). Plain data in, plain data out: this
 * package has no SDK dependency, so the events are typed structurally.
 */
import { REDACTED, SECRET_KEYS, SECRET_WORDS, scrubSecrets } from './secrets.ts'

export { REDACTED }

/** Request headers kept on an event; everything else (cookies, authorization, referer) goes. */
const SAFE_HEADERS = new Set(['user-agent', 'content-type', 'content-length', 'accept', 'host'])

/**
 * Object keys whose values are dropped wherever they appear in an event (span attributes use
 * dotted names: `user.id`, `url.query`, `http.request.header.cookie`). Any name ending in
 * `userId` or `user_id` goes too (`targetUserId`, `enduser.id`).
 */
const SENSITIVE_KEY = new RegExp(
  String.raw`${SECRET_WORDS}|^(?:${SECRET_KEYS.join('|')})$|e-?mail|user[_.]?name|^user(\.id)?$|ip_?address|user_?id$|^enduser\.id$|^query_string$|^url\.query$|^body$`,
  'i',
)

const EMAIL = /[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
/** Candidate IPv6 runs (optionally ending in an IPv4 address); `ipv6` decides. */
const IPV6 =
  /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{0,4})(?![\w:]|\.\d)/gi
/** Only runs with `::` or seven colons are addresses, so clock times like 12:34:56 stay. */
const ipv6 = (m: string) =>
  /[0-9a-f]/i.test(m) && (m.includes('::') || m.split(':').length === 8) ? '[ip]' : m
/**
 * A URL's query string and fragment, dropped whole (tokens, codes, names). Only in URL-looking
 * tokens (`scheme://…` or a path starting with `/`), so prose like "really? yes" stays.
 */
const URL_QUERY = /((?:\b[a-z][\w+.-]*:\/\/|(?<![\w/])\/)[^\s"'<>?#]*)[?#][^\s"'<>]*/gi
/** Path segments that are a username (profiles) or a one-time token (Better Auth links). */
const PATH_SECRET = /\/(u|players|reset-password|verify-email)\/[^/?#\s"'<>]+/gi
/** A user id in the friends, blocks and admin user API paths (not the fixed route words). */
const PATH_USER_ID =
  /\/(friends(?:\/requests)?|blocks|admin\/users)\/(?!(?:match|requests|settings)(?:[/?#\s"'<>]|$))[^/?#\s"'<>]+/gi
/** Postgres constraint details: `Key (username)=(alice_99) already exists.` */
const KEY_DETAIL = /(\bKey \([^)]*\)=\()[^)]*\)/g
/** Labels DOM breadcrumbs copy from elements (`button[title="Challenge alice"]`). */
const DOM_LABEL = /\[(aria-label|name|title|alt)="[\s\S]*?"\]/g

export function scrubText(text: string): string {
  return scrubSecrets(text.replace(KEY_DETAIL, `$1${REDACTED})`).replace(URL_QUERY, '$1'))
    .replace(DOM_LABEL, `[$1="${REDACTED}"]`)
    .replace(PATH_SECRET, `/$1/${REDACTED}`)
    .replace(PATH_USER_ID, `/$1/${REDACTED}`)
    .replace(EMAIL, '[email]')
    .replace(IPV6, ipv6)
    .replace(IPV4, '[ip]')
}

type Json = Record<string, unknown>

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * SDK-made metadata (SDK and module versions, debug ids): only secret-named keys are dropped,
 * since version numbers like `120.0.0.0` would read as IP addresses.
 */
const METADATA = new Set(['sdk', 'modules', 'debug_meta'])
/**
 * Version fields in `contexts` (browser, OS, runtime) are kept as they are for the same reason;
 * everything else there (logger data, trace attributes, `setContext`) is scrubbed.
 */
const VERSION_KEY = /version$|^build$/i
/** Deeper than this, objects are dropped rather than passed on unscrubbed. */
const MAX_DEPTH = 12

/** `text`: scrub every string; `raw`: keep strings; `contexts`: scrub all but versions. */
type Mode = 'text' | 'raw' | 'contexts'

function childMode(mode: Mode, key: string, depth: number): Mode {
  if (depth === 0 && METADATA.has(key)) return 'raw'
  if (depth === 0 && key === 'contexts') return 'contexts'
  if (mode === 'contexts' && VERSION_KEY.test(key)) return 'raw'
  return mode
}

/** Copies `value` without sensitive keys, and with its strings scrubbed as `mode` says. */
function scrubDeep(value: unknown, mode: Mode = 'text', depth = 0): unknown {
  if (typeof value === 'string') return mode === 'raw' ? value : scrubText(value)
  if (typeof value !== 'object' || value === null) return value
  if (depth > MAX_DEPTH) return REDACTED
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, mode, depth + 1))
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(k)) continue
    out[k] = scrubDeep(v, childMode(mode, k, depth), depth + 1)
  }
  return out
}

/** Keeps a request's method, scrubbed URL and harmless headers; drops everything else. */
function scrubRequest(req: Json): Json {
  const out: Json = {}
  if (typeof req.url === 'string') out.url = scrubText(req.url)
  if (typeof req.method === 'string') out.method = req.method
  if (isRecord(req.headers)) {
    const headers: Json = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (SAFE_HEADERS.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
    }
    out.headers = headers
  }
  return out
}

/** Scrubs a span (`beforeSendSpan`): a copy with secret-named fields dropped, strings scrubbed. */
export function scrubData<T>(data: T): T {
  if (!isRecord(data)) return data
  return scrubDeep(data) as T
}

/**
 * Scrubs an error event (`beforeSend`). Returns a copy: the user and any secret-named field are
 * dropped (breadcrumbs included), the request is cut down to method, URL and harmless headers,
 * and all text is scrubbed.
 */
export function scrubEvent<T>(event: T): T {
  if (!isRecord(event)) return event
  const { request, ...rest } = event
  const out = scrubDeep(rest) as Json
  if (isRecord(request)) out.request = scrubRequest(request)
  return out as T
}

/**
 * Privacy options for both Sentry SDKs. `dataCollection` (SDK 11; it replaced
 * `sendDefaultPii`) is all off; the scrubber still runs on whatever remains.
 */
export const SENTRY_PRIVACY_OPTIONS = {
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  beforeSend: scrubEvent,
  beforeSendSpan: scrubData,
}
