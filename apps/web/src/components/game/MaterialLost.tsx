import bishop from '@game/assets/pieces/bishop.svg?raw'
import knight from '@game/assets/pieces/knight.svg?raw'
import pawn from '@game/assets/pieces/pawn.svg?raw'
import queen from '@game/assets/pieces/queen.svg?raw'
import rook from '@game/assets/pieces/rook.svg?raw'
import { LOST_ORDER, type LostKind, type SeatMaterial } from '../../lib/material.ts'

// Decorative copies of the piece art: no <title> (the row says it in words), and the
// near-black outline is dropped so the small glyph reads as a clean silhouette on the panel.
const strip = (svg: string) =>
  svg.replace(/<title>[^<]*<\/title>/, '').replace(/<g id="detail"[\s\S]*?<\/g>/, '')

const GLYPHS: Record<LostKind, string> = {
  queen: strip(queen),
  rook: strip(rook),
  bishop: strip(bishop),
  knight: strip(knight),
  pawn: strip(pawn),
}

const NAMES: Record<LostKind, [string, string]> = {
  queen: ['queen', 'queens'],
  rook: ['rook', 'rooks'],
  bishop: ['bishop', 'bishops'],
  knight: ['knight', 'knights'],
  pawn: ['pawn', 'pawns'],
}

export function describeLost(m: SeatMaterial): string {
  const parts = LOST_ORDER.filter((k) => m.lost[k] > 0).map(
    (k) => `${m.lost[k]} ${NAMES[k][m.lost[k] === 1 ? 0 : 1]}`,
  )
  return parts.length ? `Pieces lost: ${parts.join(', ')}` : 'No pieces lost'
}

/**
 * The pieces a seat has lost, as small glyphs in its colour, plus the material figure.
 * `compact` shows only the figure (phone chips).
 */
export function MaterialLost({
  material,
  color,
  compact = false,
}: {
  material: SeatMaterial
  color: string
  compact?: boolean
}) {
  if (material.points === 0) return null
  const label = describeLost(material)
  const glyphs = LOST_ORDER.flatMap((k) =>
    Array.from({ length: material.lost[k] }, (_, i) => ({ k, key: `${k}${i}` })),
  )
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      title={label}
      role="img"
      aria-label={label}
      data-testid="material-lost"
    >
      {compact ? null : (
        <span className="flex min-w-0 items-center overflow-hidden" style={{ color }}>
          {glyphs.map(({ k, key }) => (
            <span
              key={key}
              aria-hidden="true"
              className="-mr-1 inline-block h-4 w-4 shrink-0 opacity-80 last:mr-0 [&>svg]:h-full [&>svg]:w-full"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, bundled SVG assets
              dangerouslySetInnerHTML={{ __html: GLYPHS[k] }}
            />
          ))}
        </span>
      )}
      <span
        aria-hidden="true"
        className="shrink-0 text-[11px] font-semibold tabular-nums text-parchment/70"
      >
        −{material.points}
      </span>
    </span>
  )
}
