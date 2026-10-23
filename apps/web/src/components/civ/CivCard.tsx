import { type CivAbility, civInfo, STANDARD_ARMY } from '@game/config'
import { ChevronDown } from 'lucide-react'
import { type ReactElement, type ReactNode, useId } from 'react'
import { pieceSprite } from '../../lib/piece-sprites.ts'
import { civName } from '../CivEmblem.tsx'
import { cx } from '../ui.tsx'
import { CivMedallion } from './CivMedallion.tsx'
import { OrnamentRule } from './marks.tsx'

export type CivCardVariant = 'full' | 'compact' | 'attached'

/** Which abilities start folded into a `<details>` row: none, all but the first, or all. */
export type CivCardFold = 'none' | 'rest' | 'all'

/** The ability's piece art in a small tile, drawn in the seat's light colour (decorative). */
function PieceTile({ piece, color }: { piece: string | undefined; color: string | undefined }) {
  const svg = piece ? pieceSprite(piece) : null
  if (!svg) return null
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-plate border border-rule-brass bg-black/20 shadow-well"
      style={{ color: color ?? 'var(--color-parchment)' }}
    >
      <span
        className="block h-6 w-6 [&>svg]:h-full [&>svg]:w-full"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, bundled SVG assets
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </span>
  )
}

function SectionLabel({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <p className={cx('mb-1.5 text-caption font-medium', muted ? 'text-faint' : 'text-brass')}>
      {children}
    </p>
  )
}

export type CivCardHeadingLevel = 3 | 4

const abilityTitleClass = 'font-display leading-tight font-semibold text-parchment'

function AbilityTitle({
  name,
  small,
  level,
}: {
  name: string
  small: boolean
  level: CivCardHeadingLevel
}) {
  const Tag = level === 4 ? 'h4' : 'h3'
  return <Tag className={cx(abilityTitleClass, small ? 'text-lead' : 'text-heading')}>{name}</Tag>
}

function Ability({
  ability,
  variant,
  folded,
  seatColor,
  level,
}: {
  ability: CivAbility
  variant: CivCardVariant
  folded: boolean
  seatColor: string | undefined
  level: CivCardHeadingLevel
}) {
  const details = (
    <p className="max-w-[65ch] text-ui leading-relaxed text-muted">{ability.details}</p>
  )
  if (!folded) {
    return (
      <>
        <div className="flex items-center gap-2.5">
          <PieceTile piece={ability.piece} color={seatColor} />
          <AbilityTitle name={ability.name} small={variant === 'compact'} level={level} />
        </div>
        <div className="mt-1.5">{details}</div>
      </>
    )
  }
  // A heading inside <summary> loses its role in some screen readers (the summary becomes a
  // disclosure button named by its content), so the real heading sits just before the
  // <details> for heading navigation, and the visible title in the summary is plain text.
  // Folded rows use the smaller title and clamp the summary line: the details say it all.
  const Tag = level === 4 ? 'h4' : 'h3'
  return (
    <>
      <Tag className="sr-only">{ability.name}</Tag>
      <details className="group/ability">
        <summary className="-mx-1.5 flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-control px-1.5 py-1 transition-colors hover:bg-parchment/[0.04] [&::-webkit-details-marker]:hidden">
          <PieceTile piece={ability.piece} color={seatColor} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cx(abilityTitleClass, 'text-lead')}>{ability.name}</span>
            <span className="line-clamp-2 text-ui leading-snug text-muted">{ability.summary}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-brass transition-transform duration-200 group-open/ability:rotate-180"
          />
        </summary>
        <div className="mt-1.5">{details}</div>
      </details>
    </>
  )
}

/**
 * A civilization's card: medallion and name, its emblem's identity line, and what it does
 * differently (its abilities), or the quiet standard-army note. Display copy from
 * `@game/config` (`CIV_INFO`); the rules themselves live in the engine.
 *
 * - `full`: the preview pane next to the civ list (56px medallion).
 * - `compact`: the popover or bottom sheet about a seated civ, with an optional seat `kicker`.
 * - `attached`: joined under the civ picker's trigger (which already shows the medallion and
 *   name), so only the identity line and the abilities.
 *
 * `headingId` is the id of the civ's heading (an enclosing dialog's label); `nameAs` wraps that
 * heading instead (a bottom sheet makes it the dialog's title, with its own id). `seatColor`
 * tints the ability's piece art. `headingLevel`: the level of the ability titles (3 by default;
 * 4 under a page's own h3). Only the `full` card is a named region: `attached` sits under its
 * section's heading and `compact` inside a dialog that the civ name already labels.
 *
 * An unknown civ (no `CIV_INFO` entry) shows only its name; `attached` renders nothing.
 */
export function CivCard({
  civ,
  variant,
  kicker,
  kickerColor,
  fold = 'none',
  seatColor,
  headingId,
  nameAs,
  headingLevel = 3,
  className,
}: {
  civ: string
  variant: CivCardVariant
  kicker?: ReactNode | undefined
  kickerColor?: string | undefined
  fold?: CivCardFold | undefined
  seatColor?: string | undefined
  headingId?: string | undefined
  nameAs?: ((heading: ReactElement) => ReactNode) | undefined
  headingLevel?: CivCardHeadingLevel | undefined
  className?: string | undefined
}) {
  const ownId = useId()
  const nameId = headingId ?? `${ownId}-name`
  const info = civInfo(civ)
  const name = civName(civ)
  const abilities = info?.abilities ?? []
  const showName = variant !== 'attached'
  const StandardTitle = headingLevel === 4 ? 'h4' : 'h3'

  const heading = (
    <h2
      // A `nameAs` wrapper (a bottom sheet's title) gives the heading its own id.
      {...(nameAs ? {} : { id: nameId })}
      className={cx(
        'min-w-0 font-display leading-tight font-semibold text-parchment',
        variant === 'full' ? 'text-[1.5rem]' : 'text-heading',
      )}
    >
      {name}
    </h2>
  )

  const identity = info ? (
    <p
      className={cx(
        'line-clamp-3 font-display leading-snug text-muted italic',
        variant === 'full' ? 'text-body' : 'text-ui',
      )}
    >
      {info.identity}
    </p>
  ) : null

  const abilitySection = !info ? null : abilities.length === 0 ? (
    <div>
      <SectionLabel muted>Army</SectionLabel>
      <StandardTitle className="font-display text-body leading-tight font-semibold text-parchment">
        {STANDARD_ARMY.title}
      </StandardTitle>
      <p className="mt-1 max-w-[65ch] text-ui leading-relaxed text-muted">{STANDARD_ARMY.text}</p>
    </div>
  ) : (
    <div>
      <SectionLabel>
        {abilities.length === 1 ? 'Civilization ability' : 'Civilization abilities'}
      </SectionLabel>
      {abilities.map((a, i) => (
        <div
          key={a.id}
          className={cx(i > 0 && 'mt-3 border-t border-rule pt-3')}
          data-testid={`civ-ability-${a.id}`}
        >
          <Ability
            ability={a}
            variant={variant}
            folded={fold === 'all' || (fold === 'rest' && i > 0)}
            seatColor={seatColor}
            level={headingLevel}
          />
        </div>
      ))}
    </div>
  )

  if (variant === 'attached' && !info) return null
  const Root = variant === 'full' ? 'section' : 'div'

  return (
    <Root
      aria-labelledby={variant === 'full' && !nameAs ? nameId : undefined}
      className={cx(
        'min-w-0 text-parchment',
        variant === 'attached' &&
          'rounded-b-control border border-t-0 border-rule-strong bg-black/10 px-4 py-3',
        className,
      )}
      data-testid="civ-card"
      data-civ={civ}
    >
      {showName ? (
        <>
          {kicker ? (
            <p
              className="mb-2 flex min-w-0 items-center gap-1.5 pr-10 text-caption font-medium"
              style={{ color: kickerColor }}
              data-testid="civ-card-kicker"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: kickerColor ?? 'currentColor' }}
              />
              <span className="truncate">{kicker}</span>
            </p>
          ) : null}
          <div className={cx('flex items-center', variant === 'full' ? 'gap-3.5' : 'gap-3')}>
            <CivMedallion civ={{ slug: civ, name }} size={variant === 'full' ? 'xl' : 'base'} />
            <div className={cx('min-w-0 flex-1', variant === 'compact' && 'pr-8')}>
              {nameAs ? nameAs(heading) : heading}
            </div>
          </div>
          {identity ? <div className="mt-3">{identity}</div> : null}
        </>
      ) : (
        identity
      )}
      {abilitySection ? (
        <>
          <OrnamentRule className="my-3" />
          {abilitySection}
        </>
      ) : null}
    </Root>
  )
}
