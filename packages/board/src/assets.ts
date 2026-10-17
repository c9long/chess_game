import canada from '@game/assets/emblems/canada.svg?raw'
import china from '@game/assets/emblems/china.svg?raw'
import england from '@game/assets/emblems/england.svg?raw'
import france from '@game/assets/emblems/france.svg?raw'
import germany from '@game/assets/emblems/germany.svg?raw'
import japan from '@game/assets/emblems/japan.svg?raw'
import mali from '@game/assets/emblems/mali.svg?raw'
import russia from '@game/assets/emblems/russia.svg?raw'
import usa from '@game/assets/emblems/usa.svg?raw'
import bishop from '@game/assets/pieces/bishop.svg?raw'
import king from '@game/assets/pieces/king.svg?raw'
import knight from '@game/assets/pieces/knight.svg?raw'
import pawn from '@game/assets/pieces/pawn.svg?raw'
import primeMinister from '@game/assets/pieces/prime-minister.svg?raw'
import queen from '@game/assets/pieces/queen.svg?raw'
import rook from '@game/assets/pieces/rook.svg?raw'
import type { CivId, PieceKind } from '@game/rules'

/**
 * Original piece and emblem art from packages/assets, inlined as strings by
 * the bundler (Vite `?raw`). Requires a Vite-compatible bundler.
 */
export const PIECE_SVGS: Readonly<Record<PieceKind, string>> = {
  king,
  queen,
  rook,
  bishop,
  knight,
  pawn,
  prime_minister: primeMinister,
}

export const EMBLEM_SVGS: Readonly<Record<CivId, string>> = {
  canada,
  usa,
  china,
  japan,
  germany,
  russia,
  england,
  france,
  mali,
}
