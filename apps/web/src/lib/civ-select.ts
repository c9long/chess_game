/**
 * Pure helpers behind `CivSelect` (the civilization dropdown): name and ability matching for
 * the search box, the matched text to highlight, list navigation for the keyboard, and the
 * typeahead target. Kept free of React and the DOM so they are unit-tested against long
 * synthetic rosters (the roster will grow past 100).
 */
import type { CivInfo } from '@game/config'

export interface CivOption {
  readonly slug: string
  readonly name: string
}

/** Lower-case, accents stripped ("Côte d'Ivoire" -> "cote d'ivoire"), whitespace collapsed. */
export function foldName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** A civ as the search box sees it: its folded name and any extra folded keywords. */
export interface CivSearchEntry<T extends CivOption = CivOption> {
  readonly civ: T
  readonly folded: string
  /** Extra text the search also matches (a civ's emblem, ability names and summaries), folded. */
  readonly keywords: string
}

/**
 * Fold every name once, so filtering on each keystroke is just substring checks. `keywords`
 * gives extra text a civ is also found by (see `civKeywords`; England: "Tudor rose", "Magna
 * Carta", "Four Prime Ministers replace…").
 */
export function buildSearchIndex<T extends CivOption>(
  civs: readonly T[],
  keywords?: (civ: T) => string,
): CivSearchEntry<T>[] {
  return civs.map((civ) => ({
    civ,
    folded: foldName(civ.name),
    keywords: keywords ? foldName(keywords(civ)) : '',
  }))
}

/**
 * The civs whose name (or, for a query of three letters or more, keywords) contains the query
 * (case- and accent-insensitive), in roster order. An empty or blank query keeps every civ.
 */
export function filterCivs<T extends CivOption>(
  index: readonly CivSearchEntry<T>[],
  query: string,
): T[] {
  const q = foldName(query)
  if (!q) return index.map((e) => e.civ)
  const out: T[] = []
  // Keywords only from three letters on, so a typeahead letter still means a name.
  const kw = q.length >= 3
  for (const e of index) if (e.folded.includes(q) || (kw && e.keywords.includes(q))) out.push(e.civ)
  return out
}

/** Between keyword fields, so a query never matches across the end of one field. */
const FIELD_SEP = ' | '

/** The extra search text for a civ: its emblem, ability names and ability summaries. */
export function civKeywords(info: CivInfo | null): string {
  if (!info) return ''
  return [
    info.emblem,
    ...info.abilities.map((a) => a.name),
    ...info.abilities.map((a) => a.summary),
  ].join(FIELD_SEP)
}

/** Ability names on one line, as rows and seats show them ("Magna Carta, Other"). */
export function abilityNames(info: CivInfo | null): string {
  return info ? info.abilities.map((a) => a.name).join(', ') : ''
}

/** A [start, end) range of UTF-16 offsets in the original text. */
export type TextRange = readonly [number, number]

/**
 * Where the query first occurs in `text`, compared as `foldName` compares (case, accents and
 * runs of spaces ignored), as offsets into the original text so the match can be highlighted.
 * Null for an empty query or no match.
 */
export function matchRange(text: string, query: string): TextRange | null {
  const q = foldName(query)
  if (!q) return null
  let folded = ''
  // For each code unit of `folded`: where its source character starts and ends in `text`.
  const starts: number[] = []
  const ends: number[] = []
  let lastSpace = true
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0)
    const end = i + ch.length
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        folded += ' '
        starts.push(i)
        ends.push(end)
      }
      lastSpace = true
    } else {
      const f = ch
        .normalize('NFD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
      for (let k = 0; k < f.length; k++) {
        starts.push(i)
        ends.push(end)
      }
      folded += f
      if (f) lastSpace = false
    }
    i = end
  }
  const at = folded.indexOf(q)
  if (at < 0) return null
  return [starts[at] ?? 0, ends[at + q.length - 1] ?? text.length]
}

/** Which of a civ's texts a search query matched, with the range to highlight in it. */
export type SearchHit =
  | { readonly field: 'name'; readonly range: TextRange }
  /** In `abilityNames(info)`. */
  | { readonly field: 'ability'; readonly range: TextRange }
  /** In the summary of ability `index`. */
  | { readonly field: 'summary'; readonly index: number; readonly range: TextRange }
  | { readonly field: 'emblem'; readonly range: TextRange }

/**
 * What a search query matched for one civ, in the order `filterCivs` looks: the name, then
 * (from three letters on) the ability names, the ability summaries and the emblem. Null when
 * nothing matched or the query is blank.
 */
export function searchHit(name: string, info: CivInfo | null, query: string): SearchHit | null {
  const q = foldName(query)
  if (!q) return null
  const inName = matchRange(name, q)
  if (inName) return { field: 'name', range: inName }
  if (q.length < 3 || !info) return null
  const inAbility = matchRange(abilityNames(info), q)
  if (inAbility) return { field: 'ability', range: inAbility }
  for (const [index, a] of info.abilities.entries()) {
    const r = matchRange(a.summary, q)
    if (r) return { field: 'summary', index, range: r }
  }
  const inEmblem = matchRange(info.emblem, q)
  return inEmblem ? { field: 'emblem', range: inEmblem } : null
}

/** True when the folded name, or one of its words, starts with the folded query. */
function startsWord(folded: string, q: string): boolean {
  if (folded.startsWith(q)) return true
  for (let i = folded.indexOf(' '); i !== -1; i = folded.indexOf(' ', i + 1)) {
    if (folded.startsWith(q, i + 1)) return true
  }
  return false
}

/**
 * Which option to highlight after the query changes: the first whose name starts with the
 * query, else the first whose name has a word starting with it, else the first match. -1 when
 * the list is empty.
 */
export function bestMatchIndex(options: readonly CivOption[], query: string): number {
  if (options.length === 0) return -1
  const q = foldName(query)
  if (!q) return 0
  const folded = options.map((o) => foldName(o.name))
  const prefix = folded.findIndex((f) => f.startsWith(q))
  if (prefix !== -1) return prefix
  const word = folded.findIndex((f) => startsWord(f, q))
  return word === -1 ? 0 : word
}

/** Rows moved by Page Up / Page Down. */
export const PAGE_STEP = 5

/**
 * The option to highlight after a navigation key in a list of `count` options, or null for keys
 * that aren't navigation. Arrows step one row and stop at the ends (no wrapping, as in a native
 * select); Page Up/Down step `PAGE_STEP` rows; Home/End jump to the ends. From "nothing
 * highlighted" (-1), Down and Page Down go to the first row and Up and Page Up to the last.
 */
export function listNavIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  const last = count - 1
  switch (key) {
    case 'ArrowDown':
      return index < 0 ? 0 : Math.min(index + 1, last)
    case 'ArrowUp':
      return index < 0 ? last : Math.max(index - 1, 0)
    case 'PageDown':
      return index < 0 ? 0 : Math.min(index + PAGE_STEP, last)
    case 'PageUp':
      return index < 0 ? last : Math.max(index - PAGE_STEP, 0)
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}

/** A key that types a character (typeahead), not a shortcut or a control key. */
export function isTypeaheadKey(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey
}
