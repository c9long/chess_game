/**
 * Spoken piece names for the web app. Civilization copy (emblems, abilities) lives in
 * `@game/config` (`CIV_INFO`), shared with every client.
 */

/** Spoken names of the piece kinds (singular, plural), as the engine names the kinds. */
const PIECE_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  king: ['king', 'kings'],
  queen: ['queen', 'queens'],
  rook: ['rook', 'rooks'],
  bishop: ['bishop', 'bishops'],
  knight: ['knight', 'knights'],
  pawn: ['pawn', 'pawns'],
  prime_minister: ['Prime Minister', 'Prime Ministers'],
}

/**
 * The name of a piece kind for text and screen readers (`prime_minister` -> "Prime
 * Minister"; `count` other than 1 gives the plural). The one source for spoken piece names.
 */
export function pieceName(kind: string, count = 1): string {
  const names = Object.hasOwn(PIECE_NAMES, kind) ? PIECE_NAMES[kind] : undefined
  const fallback = kind.replaceAll('_', ' ')
  if (!names) return count === 1 ? fallback : `${fallback}s`
  return names[count === 1 ? 0 : 1]
}
