/** Pieces shared by the rows of your match history and of a profile's recent games. */
import { isSupportedRulesVersion } from '@game/rules'
import { Play } from 'lucide-react'
import { Link } from 'react-router'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { cx, linkButtonClass, SEAT_CLASSES, SEAT_ORDER } from '../ui.tsx'

/** A civ emblem in its seat's colour. `title=""` when the civ is named beside it. */
export function SeatCivEmblem({ seat, civ, title }: { seat: number; civ: string; title?: string }) {
  return (
    <span className={SEAT_CLASSES[SEAT_ORDER[seat] ?? 'south'].text}>
      <CivEmblem civ={civ} className="h-4 w-4" {...(title === undefined ? {} : { title })} />
    </span>
  )
}

/** "Victory as (emblem) Mali": the row's result, then the civ its player played. */
export function ResultAsCiv({
  result,
  tone,
  seat,
  civ,
  size = 'lead',
}: {
  result: string
  tone: 'win' | 'muted' | 'plain'
  seat: number
  civ: string
  size?: 'lead' | 'body'
}) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span
        className={cx(
          'font-display font-semibold',
          size === 'lead' ? 'text-lead' : 'text-body',
          tone === 'win' ? 'text-gold' : tone === 'muted' ? 'text-muted' : 'text-parchment',
        )}
      >
        {result}
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-ui text-muted">
        as
        <SeatCivEmblem seat={seat} civ={civ} title="" />
        <span className="truncate font-display font-semibold text-parchment">{civName(civ)}</span>
      </span>
    </p>
  )
}

/**
 * The link to a finished game's page: "Replay", or "Details" for a game from an old rules
 * version (no replay). `label` names the game, so a screen reader's links list can tell rows
 * apart.
 */
export function ReplayLink({
  id,
  rulesVersion,
  label,
  testId,
}: {
  id: string
  rulesVersion: number
  label?: string
  testId: string
}) {
  const replay = isSupportedRulesVersion(rulesVersion)
  const text = replay ? 'Replay' : 'Details'
  return (
    <Link
      to={`/history/${id}`}
      className={linkButtonClass(replay ? 'secondary' : 'quiet', '', 'sm')}
      aria-label={label ? `${text}, ${label}` : undefined}
      data-testid={testId}
    >
      {replay ? <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> : null}
      {text}
    </Link>
  )
}
