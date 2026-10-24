/**
 * Name moderation (PLAN §3 "Moderation"): a small profanity/slur filter and reserved or
 * impersonating names, used by the NamePolicy for usernames (sign-up, choosing a username,
 * guest upgrade) and, for profanity only, lobby names.
 *
 * Matching works on normalized forms: lower case, accents stripped, leetspeak undone
 * (0→o, 1→i or l, 3→e, 4→a, 5→s, 7→t, 8→b, 9→g, @→a, $→s, !→i, +→t), letters repeated any
 * number of times (`fuuuck`), separators (`f_u_c_k`, `f.u.c.k`, `Fuc_k`) and Cyrillic or Greek
 * letters that look Latin (`fuсk` with a Cyrillic `с`). To avoid the Scunthorpe
 * problem, ambiguous words are matched only as whole words (`ass` blocks "ass" and "Big_Ass"
 * but not "Class" or "Assassin"), and words that contain a blocked term (`Scunthorpe`,
 * `Therapist`) are on an allowlist. Word lists: name-terms.json.
 */
import { readFileSync } from 'node:fs'
import { APP_NAME } from '@game/config'

interface Terms {
  substring: string[]
  token: string[]
  /** Refused only as the whole name (digits and separators aside): "Dyke", not "Van_Dyke". */
  whole: string[]
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

/**
 * Cyrillic and Greek letters that look like Latin ones (NFKD leaves them alone). Lobby names
 * allow any script, so "fuсk" with a Cyrillic "с" would otherwise pass. Case is kept, for the
 * camelCase split.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  з: '3',
  і: 'i',
  ї: 'i',
  ј: 'j',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ү: 'y',
  А: 'A',
  В: 'B',
  Е: 'E',
  Ё: 'E',
  З: '3',
  І: 'I',
  Ї: 'I',
  Ј: 'J',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
  Ѕ: 'S',
  Ү: 'Y',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  Ζ: 'Z',
  Η: 'H',
}

/** Accents and other marks stripped, look-alike letters mapped to Latin; case kept. */
function plain(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFKD').replace(/\p{M}+/gu, '')) out += CONFUSABLES[ch] ?? ch
  return out
}

/** Lower case without accents or other marks ("Émile" → "emile"). */
export function fold(s: string): string {
  return plain(s).toLowerCase()
}

/**
 * Leetspeak undone; `1` is read as `i` in one variant and `l` in the other. A run of six or
 * more digits alone is a number, not a word ("Fan_88800828" stays usable). A digit with no
 * letter reading (2, 6) becomes a word break (`|`), not nothing: dropping it would glue its
 * neighbours into words that aren't there ("b0208b66" read as "boobgg").
 */
function unleet(s: string, one: 'i' | 'l'): string {
  if (/^[0-9]{6,}$/.test(s)) return s
  let out = ''
  for (const ch of s) {
    if (ch === '1') out += one
    else if (LEET_COMMON[ch]) out += LEET_COMMON[ch]
    else out += /[0-9]/.test(ch) ? '|' : ch
  }
  return out
}

/** Letters only, plus the `|` word breaks from `unleet` (no term contains one). */
const lettersOnly = (s: string) => s.replace(/[^a-z|]/g, '')

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
const WHOLE = TERMS.whole.map((t) => new RegExp(`^${termPattern(t)}$`))
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
  const words = plain(name)
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

/** Allowlisted spans of `s`, for hits that cross word boundaries. */
function allowedSpans(s: string): [number, number][] {
  const spans: [number, number][] = []
  for (const a of ALLOW) {
    a.lastIndex = 0
    for (const m of s.matchAll(a)) spans.push([m.index, m.index + m[0].length])
  }
  return spans
}

/**
 * Word pieces that a split term may start inside ("Bulls_Hit") or end inside ("Fuc_ker",
 * "fuc_kyou"). Any other partial piece is left alone, so "Push_It", "Is_Hit" and "BitChess"
 * stay usable.
 */
const SPLIT_PREFIXES = new Set(['bull', 'dip', 'horse', 'holy', 'mother', 'big', 'my', 'ur'])
const SPLIT_SUFFIXES = new Set([
  's',
  'es',
  'er',
  'ers',
  'ed',
  'ing',
  'y',
  'ie',
  'ies',
  'head',
  'face',
  'you',
  'u',
  'off',
])

/**
 * A term split across words ("Fuc_k", "Nig_ger", "Cun_t_face", "fuc k night"): the words
 * (separators and camelCase) are joined, and a term that crosses a word boundary counts when
 * it starts at the start of a word and ends at the end of one, give or take a short common
 * prefix or suffix. Consecutive words that together spell a whole-word term ("Naz_i") count
 * too.
 */
function splitTermHit(name: string): boolean {
  const words = plain(name)
    .split(/[^\p{L}\p{N}@$!+]+/u)
    .flatMap((seg) => seg.split(/(?<=\p{Ll})(?=\p{Lu})/u))
    .map((w) => w.toLowerCase())
    .filter(Boolean)
  if (words.length < 2) return false
  for (const one of ['i', 'l'] as const) {
    const parts = words.map((w) => lettersOnly(unleet(w, one))).filter(Boolean)
    const starts: number[] = []
    let joined = ''
    for (const p of parts) {
      starts.push(joined.length)
      joined += p
    }
    const ends = parts.map((p, i) => (starts[i] as number) + p.length)
    const wordAt = (pos: number) => {
      let i = 0
      while (i + 1 < starts.length && (starts[i + 1] as number) <= pos) i++
      return i
    }
    const allowed = allowedSpans(joined)
    for (const { re } of SUBSTRING) {
      re.lastIndex = 0
      for (const m of joined.matchAll(re)) {
        const start = m.index
        const end = start + m[0].length
        const a = wordAt(start)
        const b = wordAt(end - 1)
        if (a === b) continue // inside one word: the per-word check decides
        if (allowed.some(([x, y]) => x <= start && end <= y)) continue
        const head = joined.slice(starts[a], start)
        const tail = joined.slice(end, ends[b])
        if (
          (head === '' || SPLIT_PREFIXES.has(head)) &&
          (tail === '' || SPLIT_SUFFIXES.has(tail))
        ) {
          return true
        }
      }
    }
    for (let i = 0; i < parts.length; i++) {
      let run = parts[i] as string
      for (let k = i + 1; k < parts.length && run.length < 12; k++) {
        run += parts[k]
        if (isTokenTerm(run)) return true
      }
    }
  }
  return false
}

/** The whole name, digits and separators aside, is one of the `whole` terms ("Dyke_99"). */
function isWholeTerm(name: string): boolean {
  const f = fold(name)
  const readings = new Set([
    lettersOnly(f),
    ...(['i', 'l'] as const).map((o) => lettersOnly(unleet(f, o))),
  ])
  for (const r of readings) if (WHOLE.some((re) => re.test(r))) return true
  return false
}

/**
 * Whether `name` contains profanity or a slur. Checks each word, the whole name with
 * separators removed when it is spelled out in short pieces ("f_u_c_k", "sh.it"), terms split
 * across words ("Fuc_k"), whole words against the ambiguous terms, and the whole name against
 * the standalone-only terms.
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
  if (splitTermHit(name)) return true
  if (isWholeTerm(name)) return true
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
  // Singular and plural too ("LinkedList" → "linkedlists", and back).
  const singular = words.filter((w) => w.length >= 5 && w.endsWith('s')).map((w) => w.slice(0, -1))
  const plural = words.filter((w) => w.length >= 5 && !w.endsWith('s')).map((w) => `${w}s`)
  return [...new Set([...words, ...singular, ...plural, whole])]
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
const RESERVED_WORDS = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'official',
  'staff',
  'support',
  'sysop',
  'system',
]
/** Of those, safe to match inside other words (longer, rarely part of innocent words). */
const RESERVED_SUBSTRINGS = ['administrator', 'moderator', 'deletedplayer', 'removedplayer']
/** A word as a regex that also accepts its leetspeak spellings ("b0t", "gu3st", "p1ayer"). */
function leetWord(word: string): string {
  const cls: Record<string, string> = {
    a: '[a4@]',
    b: '[b8]',
    e: '[e3]',
    g: '[g9]',
    i: '[i1!]',
    l: '[l1]',
    o: '[o0]',
    s: '[s5$]',
    t: '[t7+]',
  }
  return [...word].map((c) => `${cls[c] ?? c}+`).join('')
}

/** Names the server generates: "Guest-4821", "Player-1234", "Bot 1500", "Bot Max". */
const PLACEHOLDERS = [
  new RegExp(`^${leetWord('guest')}[^a-z]*(\\d|$)`),
  new RegExp(`^${leetWord('player')}[^a-z]*(\\d|$)`),
  new RegExp(`^${leetWord('bot')}[^a-z]*(\\d|max$|$)`),
]

/** "admin" inside a word, except in these. */
const ADMIN_ALLOW = ['badminton']

/**
 * Whether `name` is reserved: staff and system words ("admin", "Moderator_1", "TheOfficial"),
 * placeholders the server shows ("Guest-4821", "Player-1234", "Deleted player #7", bot names
 * such as "Bot 1500" or "Bot Max"), and the app's own name.
 */
export function isReserved(name: string, appName = APP_NAME): boolean {
  const folded = fold(name)
  // A capital I reads as a lower-case l too ("PIayer_1234").
  const variants = [folded, fold(name.replace(/I/g, 'l'))]
  // Placeholders (guests, OAuth accounts before they pick a name, bots), leetspeak included.
  if (variants.some((v) => PLACEHOLDERS.some((re) => re.test(v)))) return true

  const readings = new Set<string>()
  for (const v of variants) {
    readings.add(lettersOnly(v))
    for (const one of ['i', 'l'] as const) readings.add(lettersOnly(unleet(v, one)))
  }
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
