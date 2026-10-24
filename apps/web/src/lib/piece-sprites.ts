import bishop from '@game/assets/pieces/bishop.svg?raw'
import king from '@game/assets/pieces/king.svg?raw'
import knight from '@game/assets/pieces/knight.svg?raw'
import pawn from '@game/assets/pieces/pawn.svg?raw'
import primeMinister from '@game/assets/pieces/prime-minister.svg?raw'
import queen from '@game/assets/pieces/queen.svg?raw'
import rook from '@game/assets/pieces/rook.svg?raw'
import { pieceSilhouetteSvg as strip } from '@game/board/svg'
import type { PieceKind } from '@game/rules'

// Decorative one-colour silhouettes of the piece art: nearby text says what each piece is.

/** Piece art (trusted, bundled SVG) by engine piece kind, drawn in `currentColor`. */
export const PIECE_SPRITES: Readonly<Record<PieceKind, string>> = {
  king: strip(king),
  queen: strip(queen),
  prime_minister: strip(primeMinister),
  rook: strip(rook),
  bishop: strip(bishop),
  knight: strip(knight),
  pawn: strip(pawn),
}

/** The art for a piece kind, or null for a kind without art. */
export function pieceSprite(kind: string): string | null {
  return Object.hasOwn(PIECE_SPRITES, kind) ? (PIECE_SPRITES[kind as PieceKind] ?? null) : null
}
