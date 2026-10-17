/**
 * Pure helpers behind `CivSelect` (the civilization dropdown): name matching for the search
 * box, list navigation for the keyboard, and the typeahead target. Kept free of React and the
 * DOM so they are unit-tested against long synthetic rosters (the roster will grow past 100).
 */

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
  /** Extra text the search also matches (e.g. a special army's tag and summary), folded. */
  readonly keywords: string
}

/**
 * Fold every name once, so filtering on each keystroke is just substring checks. `keywords`
 * gives extra text a civ is also found by (England: "Special army", "Prime Ministers").
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
