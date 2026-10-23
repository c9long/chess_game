import { pieceName } from '../../lib/civ-info.ts'
import { LOST_ORDER, type SeatMaterial } from '../../lib/material.ts'
import { PIECE_SPRITES } from '../../lib/piece-sprites.ts'

export function describeLost(m: SeatMaterial): string {
  const parts = LOST_ORDER.filter((k) => m.lost[k] > 0).map(
    (k) => `${m.lost[k]} ${pieceName(k, m.lost[k])}`,
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
      className="inline-flex min-w-0 shrink items-center gap-1"
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
              className="-mr-1 inline-block h-3.5 w-3.5 shrink-0 opacity-85 last:mr-0 [&>svg]:h-full [&>svg]:w-full"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, bundled SVG assets
              dangerouslySetInnerHTML={{ __html: PIECE_SPRITES[k] }}
            />
          ))}
        </span>
      )}
      <span
        aria-hidden="true"
        className="shrink-0 text-caption font-semibold tabular-nums text-faint"
      >
        −{material.points}
      </span>
    </span>
  )
}
