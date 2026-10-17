/**
 * Name moderation (PLAN §3 "Moderation"): a small profanity/slur filter and reserved or
 * impersonating names, used by the NamePolicy for usernames (sign-up, choosing a username,
 * guest upgrade) and, for profanity only, lobby names.
 *
 * Matching works on normalized forms: lower case, accents stripped, leetspeak undone
 * (0→o, 1→i or l, 3→e, 4→a, 5→s, 7→t, 8→b, 9→g, @→a, $→s, !→i, +→t), letters repeated any
 * number of times (`fuuuck`), and separators (`f_u_c_k`, `f.u.c.k`). To avoid the Scunthorpe
 * problem, ambiguous words are matched only as whole words (`ass` blocks "ass" and "Big_Ass"
 * but not "Class" or "Assassin"), and words that contain a blocked term (`Scunthorpe`,
 * `Therapist`) are on an allowlist. Word lists: name-terms.json.
 */
import { readFileSync } from 'node:fs'
import { APP_NAME } from '@game/config'

interface Terms {
  substring: string[]
  token: string[]
  allow: string[]
}

const TERMS = JSON.parse(
  readFileSync(new URL('./name-terms.json', import.meta.url), 'utf8'),
) as Terms

/** The neutral answer for every moderated name: it never says which rule matched. */
export const NAME_UNAVAILABLE = 'That username isn’t available. Try another.'

const LEET_COMMON: Record<string, string> = {
  '0': 'o',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '+': 't',
}

/** Lower case without accents or other marks ("Émile" → "emile"). */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

/** Leetspeak undone; `1` is read as `i` in one variant and `l` in the other. */
function unleet(s: string, one: 'i' | 'l'): string {
  let out = ''
  for (const ch of s) out += ch === '1' ? one : (LEET_COMMON[ch] ?? ch)
  return out
}

const lettersOnly = (s: string) => s.replace(/[^a-z]/g, '')

/**
 * Regex for a term with repeated letters allowed: each run of k equal letters needs at least
 * k ("nigger" needs two g's, so "Niger" is not a match; "fuuuck" is).
 */
function termPattern(term: string): string {
  let out = ''
  for (let i = 0; i < term.length; ) {
    let j = i
    while (term[j] === term[i]) j++
    out += `${term[i]}{${j - i},}`
    i = j
  }
  return out
}

const SUBSTRING = TERMS.substring.map((t) => ({ term: t, re: new RegExp(termPattern(t), 'g') }))
const TOKEN = TERMS.token.map((t) => new RegExp(`^${termPattern(t)}$`))
const ALLOW = TERMS.allow.map((w) => new RegExp(termPattern(w), 'g'))

/**
 * The word segments of a name, as several normalized readings: separators split words
 * (anything but letters and digits), and each segment is read with leetspeak undone (both
 * `1` readings) and with its digits dropped (`ass123` → `ass`).
 */
function segments(name: string): string[][] {
  const folded = fold(name)
  // Leet symbols (@ $ ! +) are letters here, so "@ss" stays one segment.
  const raw = folded.split(/[^\p{L}\p{N}@$!+]+/u).filter(Boolean)
  return raw.map((seg) => {
    const readings = new Set<string>()
    for (const one of ['i', 'l'] as const) readings.add(lettersOnly(unleet(seg, one)))
    readings.add(lettersOnly(seg))
    // Letter/digit boundaries split words too ("ass4you" → "ass", "you").
    for (const part of seg.split(/[^a-z]+/)) if (part) readings.add(part)
    readings.delete('')
    return [...readings]
  })
}

/** camelCase words of a name ("BigAss" → big, ass), for whole-word terms. */
function camelWords(name: string): string[] {
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .split(/[^\p{L}\p{N}@$!+]+/u)
    .flatMap((seg) => seg.split(/(?<=\p{Ll})(?=\p{Lu})/u))
  const out = new Set<string>()
  for (const w of words) {
    const f = w.toLowerCase()
    for (const one of ['i', 'l'] as const) out.add(lettersOnly(unleet(f, one)))
    out.add(lettersOnly(f))
  }
  out.delete('')
  return [...out]
}

/** Whether every match of `re` in `s` lies inside an allowlisted word. */
function onlyInsideAllowed(s: string, re: RegExp): boolean {
  const allowed: [number, number][] = []
  for (const a of ALLOW) {
    a.lastIndex = 0
    for (const m of s.matchAll(a)) allowed.push([m.index, m.index + m[0].length])
  }
  re.lastIndex = 0
  for (const m of s.matchAll(re)) {
    const start = m.index
    const end = start + m[0].length
    if (!allowed.some(([a, b]) => a <= start && end <= b)) return false
  }
  return true
}

function hasSubstringTerm(s: string): boolean {
  for (const { re } of SUBSTRING) {
    re.lastIndex = 0
    if (re.test(s) && !onlyInsideAllowed(s, re)) return true
  }
  return false
}

const isTokenTerm = (word: string) => TOKEN.some((re) => re.test(word))

/**
 * Whether `name` contains profanity or a slur. Checks each word, the whole name with
 * separators removed when it is spelled out in short pieces ("f_u_c_k", "sh.it"), and whole
 * words against the ambiguous terms.
 */
export function isProfane(name: string): boolean {
  const segs = segments(name)
  for (const readings of segs) {
    if (readings.some(hasSubstringTerm) || readings.some(isTokenTerm)) return true
  }
  // Spelled out in short pieces: join runs of 1–2 letter segments ("f_u_c_k", "sh.it").
  const pieces = fold(name)
    .split(/[^\p{L}\p{N}@$!+]+/u)
    .filter(Boolean)
  let run: string[] = []
  const flush = () => {
    const joined = run.join('')
    run = []
    if (joined.length < 3) return false
    return (['i', 'l'] as const).some((one) => {
      const r = lettersOnly(unleet(joined, one))
      return hasSubstringTerm(r) || isTokenTerm(r)
    })
  }
  for (const piece of pieces) {
    if (piece.length <= 2) run.push(piece)
    else if (flush()) return true
  }
  if (flush()) return true
  return camelWords(name).some(isTokenTerm)
}

/** Generic words in the app name that stay usable in names ("ChessFan", "GameOn"). */
const GENERIC_APP_WORDS = new Set(['chess', 'game', 'games', 'the', 'of', 'online', 'play'])

/** Distinctive words of the display name (APP_NAME), reserved in usernames. */
export function appNameWords(appName = APP_NAME): string[] {
  const words = fold(appName)
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_APP_WORDS.has(w))
  const whole = lettersOnly(fold(appName).replace(/['’]s\b/g, ''))
  return [...new Set([...words, whole])]
}

/** Whole names that only staff or the system may show. */
const RESERVED_EXACT = new Set([
  'admin',
  'admins',
  'administrator',
  'anonymous',
  'bot',
  'deletedplayer',
  'dev',
  'developer',
  'everyone',
  'guest',
  'help',
  'mod',
  'moderator',
  'mods',
  'null',
  'official',
  'owner',
  'player',
  'removedplayer',
  'root',
  'security',
  'server',
  'staff',
  'support',
  'sysop',
  'system',
  'team',
  'undefined',
])

/** Words that pose as staff anywhere in a name ("Official_Bob", "TheModerator"). */
const RESERVED_WORDS = ['admin', 'administrator', 'moderator', 'mod', 'official', 'staff', 'sysop']
/** Of those, safe to match inside other words (longer, rarely part of innocent words). */
const RESERVED_SUBSTRINGS = ['administrator', 'moderator', 'deletedplayer', 'removedplayer']
/** "admin" inside a word, except in these. */
const ADMIN_ALLOW = ['badminton']

/**
 * Whether `name` is reserved: staff and system words ("admin", "Moderator_1", "TheOfficial"),
 * placeholders the server shows ("Guest-4821", "Player-1234", "Deleted player #7", bot names
 * such as "Bot 1500" or "Bot Max"), and the app's own name.
 */
export function isReserved(name: string, appName = APP_NAME): boolean {
  const folded = fold(name)
  // Placeholders: guests, OAuth accounts before they pick a name, bots.
  if (/^gu+e+s+t/.test(folded)) return true
  if (/^player[^a-z]*\d/.test(folded) || /^player[^a-z]*$/.test(folded)) return true
  if (/^bot[^a-z]*(\d+|max)?$/.test(folded) || /^bot[^a-z]*\d/.test(folded)) return true

  const readings = new Set<string>([lettersOnly(folded)])
  for (const one of ['i', 'l'] as const) readings.add(lettersOnly(unleet(folded, one)))
  readings.delete('')
  const words = new Set([...segments(name).flat(), ...camelWords(name)])

  for (const r of readings) {
    if (RESERVED_EXACT.has(r)) return true
    if (RESERVED_SUBSTRINGS.some((w) => r.includes(w))) return true
    if (r.includes('admin') && !ADMIN_ALLOW.some((a) => r.includes(a))) return true
    for (const w of appNameWords(appName)) if (r.includes(w)) return true
  }
  for (const w of words) if (RESERVED_WORDS.includes(w)) return true
  return false
}

export type NameVerdict = { ok: true } | { ok: false; why: 'profane' | 'reserved' }

/** Moderation verdict for a username (format rules are checked separately). */
export function moderateUsername(name: string, appName = APP_NAME): NameVerdict {
  if (isProfane(name)) return { ok: false, why: 'profane' }
  if (isReserved(name, appName)) return { ok: false, why: 'reserved' }
  return { ok: true }
}
