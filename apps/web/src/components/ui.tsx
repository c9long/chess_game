import { Check, CircleAlert, CircleCheck, Eye, EyeOff, Info, TriangleAlert } from 'lucide-react'
import type {
  ButtonHTMLAttributes,
  ElementType,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
} from 'react'
import { useId, useState } from 'react'

// This module is imported by eagerly loaded pages, so it stays light: no overlay library
// here (dialogs, tooltips and toasts live in overlay.tsx, used only from lazy code).
// Which primitive to use when: docs/DESIGN.md.

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

/**
 * `primary` is the one gold action on a screen. `secondary` is a brass-edged outline for the
 * other real choices, `quiet` is text-only (cancel, back, minor tools) and `danger` is for
 * destructive actions (delete, resign). `ghost` is the old name of `quiet`.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

/**
 * Height and padding per size. Use `size` rather than `h-*`/`px-*` in `className` to make a
 * button smaller: without a class merger, a smaller utility in `className` loses to these by
 * CSS order (larger ones like `h-14` happen to win).
 */
export const buttonSizes: Record<ButtonSize, string> = {
  // text-sm/text-base (same sizes as text-ui/text-body): kept so a page's `text-base` or
  // `text-lg` in className still wins by CSS order, as it always has.
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-7 text-base',
}

/** Shared button look (size not included, see `buttonSizes`), also used by button-like links. */
export const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap select-none ' +
  'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out ' +
  'enabled:active:translate-y-px [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0'

const quiet =
  'text-muted enabled:hover:bg-parchment/[0.06] enabled:hover:text-parchment disabled:text-parchment/35'

export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-gold text-ink shadow-gold enabled:hover:bg-gold-bright ' +
    'disabled:bg-parchment/10 disabled:text-parchment/45 disabled:shadow-none',
  secondary:
    'border border-rule-brass bg-parchment/[0.03] text-parchment shadow-rim ' +
    'enabled:hover:border-brass/60 enabled:hover:bg-parchment/[0.07] ' +
    'disabled:border-rule disabled:text-parchment/45',
  quiet,
  ghost: quiet,
  danger:
    'border border-destructive-light/45 bg-destructive/25 text-destructive-light ' +
    'enabled:hover:border-destructive-light/70 enabled:hover:bg-destructive/40 enabled:hover:text-parchment ' +
    'disabled:border-rule disabled:bg-transparent disabled:text-parchment/45',
}

/** Hover and press for links styled as buttons (`enabled:` only matches form controls). */
const linkStates: Record<ButtonVariant, string> = {
  primary: 'hover:bg-gold-bright active:translate-y-px',
  secondary: 'hover:border-brass/60 hover:bg-parchment/[0.07] active:translate-y-px',
  quiet: 'hover:bg-parchment/[0.06] hover:text-parchment',
  ghost: 'hover:bg-parchment/[0.06] hover:text-parchment',
  danger: 'hover:border-destructive-light/70 hover:bg-destructive/40 hover:text-parchment',
}

/** Classes for a router `<Link>` that looks like a `Button`. */
export function linkButtonClass(
  variant: ButtonVariant = 'primary',
  className?: string,
  size: ButtonSize = 'md',
): string {
  return cx(buttonBase, buttonSizes[size], buttonVariants[variant], linkStates[variant], className)
}

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  busy?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        buttonBase,
        buttonSizes[size],
        'disabled:cursor-not-allowed',
        busy && 'disabled:cursor-progress',
        buttonVariants[variant],
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  )
}

/** An inline text link in running copy: brass underline that firms up on hover. */
export const textLinkClass =
  'rounded-[2px] text-parchment underline decoration-brass/50 decoration-1 underline-offset-[3px] ' +
  'transition-colors duration-150 hover:decoration-brass'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  )
}

/**
 * The look of a text input, select or textarea (a recessed well). `Field` uses it; use it
 * directly on a bare `<input>`, `<select className={cx(inputClass, 'select')}>` or `<textarea>`.
 */
export const inputClass =
  'h-11 w-full rounded-control border border-rule-strong bg-black/20 px-3 text-body text-parchment shadow-well ' +
  'placeholder:text-faint outline-none transition-[border-color,box-shadow,background-color] duration-150 ' +
  'hover:border-parchment/35 focus:border-gold focus:ring-2 focus:ring-gold/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive-light/70 aria-invalid:focus:ring-destructive-light/25'

/**
 * A labelled text input. `type="password"` adds a show/hide toggle. `valid` (optional) shows a
 * check mark once the caller has decided the value is acceptable (e.g. after the field is left).
 */
export function Field({
  label,
  hint,
  error,
  valid,
  className,
  type,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  /** Passed to the <input> (React 19 ref as a prop). */
  ref?: Ref<HTMLInputElement> | undefined
  label: string
  hint?: string | undefined
  error?: string | undefined
  valid?: boolean | undefined
}) {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const showValid = Boolean(valid) && !error
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-ui font-medium text-parchment">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
          className={cx(
            inputClass,
            isPassword && showValid ? 'pr-20' : isPassword || showValid ? 'pr-11' : null,
          )}
          {...rest}
        />
        {showValid ? (
          <Check
            aria-hidden="true"
            className={cx(
              'pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-ok',
              isPassword ? 'right-12' : 'right-3.5',
            )}
            strokeWidth={2.5}
          />
        ) : null}
        {isPassword ? (
          <button
            type="button"
            className="absolute top-1/2 right-1.5 flex h-8 w-9 -translate-y-1/2 items-center justify-center rounded-plate text-faint transition-colors duration-150 hover:bg-parchment/[0.06] hover:text-parchment"
            aria-controls={id}
            aria-pressed={revealed}
            onClick={() => setRevealed((r) => !r)}
          >
            {/* Button text, not aria-label: e2e specs find the input with getByLabel('Password'). */}
            <span className="sr-only">Show</span>
            {revealed ? (
              <EyeOff aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Eye aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        ) : null}
      </div>
      {error || hint ? (
        <p
          id={`${id}-hint`}
          className={cx(
            'flex items-start gap-1.5 text-caption',
            error ? 'text-destructive-light' : 'text-faint',
          )}
        >
          {error ? <CircleAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" /> : null}
          <span>{error ?? hint}</span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * An on/off setting: a bordered row with its name (and a caption) and a switch at the end, plus
 * an optional hint under the row that says what the choice means or why it is unavailable.
 */
export function SwitchRow({
  label,
  caption,
  hint,
  checked,
  disabled = false,
  busy = false,
  onChange,
  testId,
  hintTestId,
}: {
  label: string
  caption?: ReactNode
  hint?: ReactNode
  checked: boolean
  disabled?: boolean
  /** Saving: announced as busy, never disabled (that would drop keyboard focus off it). */
  busy?: boolean
  onChange: (checked: boolean) => void
  testId?: string
  hintTestId?: string
}) {
  const id = useId()
  const described = [caption ? `${id}-caption` : '', hint ? `${id}-hint` : ''].join(' ').trim()
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className={cx(
          'flex items-center justify-between gap-4 rounded-control border px-3 py-2.5 transition-colors duration-150',
          checked ? 'border-brass/60 bg-brass/[0.07]' : 'border-rule-strong',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-parchment/35',
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span id={`${id}-label`} className="text-ui font-semibold text-parchment">
            {label}
          </span>
          {caption ? (
            <span id={`${id}-caption`} className="text-caption text-faint">
              {caption}
            </span>
          ) : null}
        </span>
        <span className="relative inline-flex shrink-0">
          <input
            type="checkbox"
            role="switch"
            aria-checked={checked}
            aria-labelledby={`${id}-label`}
            aria-describedby={described || undefined}
            aria-busy={busy || undefined}
            className="peer sr-only"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            data-testid={testId}
          />
          <span className="h-6 w-11 rounded-full bg-parchment/20 shadow-well transition-colors duration-150 peer-checked:bg-brass peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold" />
          <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-parchment shadow-plate transition-transform duration-150 peer-checked:translate-x-5" />
        </span>
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-faint" data-testid={hintTestId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A standalone block on the room's ink (sign-in, a form, a notice): panel, brass hairline,
 * panel radius. For a group of actions inside a page use `Panel`; for lists use `RuleList`.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'w-full rounded-panel border border-rule-brass bg-surface-rail p-5 shadow-rim sm:p-8',
        className,
      )}
    >
      {children}
    </section>
  )
}

/**
 * A group of related controls on either surface. `rail` (default) is a raised strip in the
 * surface's rail colour (panel on ink, baize-rail on baize); `well` is recessed (move lists,
 * chat, logs); `plain` only spaces and rules the group.
 */
export function Panel({
  tone = 'rail',
  title,
  titleId,
  actions,
  as: As = 'section',
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  tone?: 'rail' | 'well' | 'plain'
  /** Optional heading (an h2 in Fraunces); `titleId` lets the panel be `aria-labelledby` it. */
  title?: ReactNode
  titleId?: string
  /** Small controls at the heading's right (a quiet button, a count). */
  actions?: ReactNode
  as?: ElementType
}) {
  const tones = {
    rail: 'rounded-panel border border-rule bg-surface-rail p-4 shadow-rim sm:p-5',
    well: 'rounded-panel border border-black/30 bg-black/20 p-3 shadow-well',
    plain: 'border-t border-rule pt-4',
  }
  return (
    <As
      className={cx(tones[tone], className)}
      {...(title && titleId ? { 'aria-labelledby': titleId } : {})}
      {...rest}
    >
      {title ? (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id={titleId} className="font-display text-lead font-semibold">
            {title}
          </h2>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </As>
  )
}

const ALERT_TONES = {
  error: { bar: 'before:bg-destructive-light', icon: 'text-destructive-light', Icon: CircleAlert },
  info: { bar: 'before:bg-brass', icon: 'text-brass', Icon: Info },
  success: { bar: 'before:bg-ok', icon: 'text-ok', Icon: CircleCheck },
  warning: { bar: 'before:bg-warn', icon: 'text-warn', Icon: TriangleAlert },
} as const

/**
 * A message in the flow of the page: a rail with a coloured edge and icon. Errors are
 * `role="alert"`, the rest `role="status"`. Say what went wrong and how to fix it.
 */
export function Alert({
  tone = 'error',
  children,
  className,
}: {
  tone?: 'error' | 'info' | 'success' | 'warning'
  children: ReactNode
  className?: string
}) {
  const t = ALERT_TONES[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'relative flex animate-fade-in items-start gap-3 overflow-hidden rounded-control border border-rule bg-surface-rail py-3 pr-4 pl-5 text-ui text-parchment',
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
        t.bar,
        className,
      )}
    >
      <t.Icon aria-hidden="true" className={cx('mt-0.5 h-4 w-4 shrink-0', t.icon)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** A page's h1 with an optional line under it. One per page. */
export function PageTitle({
  title,
  subtitle,
  align = 'start',
  actions,
}: {
  title: string
  subtitle?: ReactNode
  align?: 'start' | 'center'
  /** Controls at the right of the title on wide screens (stacked under it on phones). */
  actions?: ReactNode
}) {
  return (
    <header
      className={cx(
        'mb-6',
        align === 'center' && 'text-center',
        actions ? 'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between' : null,
      )}
    >
      <div className="min-w-0">
        <h1
          className={cx(
            'font-display font-semibold',
            // Long titles (e.g. "Welcome to <title>") step down a size so they stay at two lines.
            title.length > 26 ? 'text-[1.625rem] leading-tight tracking-tight' : 'text-title',
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            className={cx(
              'mt-2 max-w-[60ch] text-body text-pretty text-muted',
              align === 'center' && 'mx-auto max-w-sm',
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/**
 * A section's heading inside a page (h2 by default) with an optional description and actions.
 * Sections are separated by a rule above (`ruled`), not by boxing each one.
 */
export function SectionHeading({
  title,
  description,
  actions,
  as: As = 'h2',
  id,
  ruled = false,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  as?: 'h2' | 'h3'
  id?: string
  ruled?: boolean
  className?: string
}) {
  return (
    <div
      className={cx(
        'mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2',
        ruled && 'border-t border-rule pt-6',
        className,
      )}
    >
      <div className="min-w-0">
        <As
          id={id}
          className={cx(
            'font-display font-semibold',
            As === 'h2' ? 'text-heading' : 'text-lead leading-snug',
          )}
        >
          {title}
        </As>
        {description ? (
          <p className="mt-1 max-w-[65ch] text-ui text-pretty text-faint">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** A list of rows separated by hairline rules (history, friends, sessions, standings). */
export function RuleList({
  children,
  className,
  as: As = 'ul',
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: 'ul' | 'ol' | 'div' }) {
  return (
    <As className={cx('divide-y divide-rule border-y border-rule', className)} {...rest}>
      {children}
    </As>
  )
}

/**
 * One row of a `RuleList`: optional leading mark (medallion, medal, avatar), a title (set
 * `name` to show it in Fraunces, for people and civs), a detail line, and trailing actions.
 */
export function RuleRow({
  leading,
  title,
  detail,
  trailing,
  name = false,
  as: As = 'li',
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  leading?: ReactNode
  title: ReactNode
  detail?: ReactNode
  trailing?: ReactNode
  name?: boolean
  as?: 'li' | 'div'
}) {
  return (
    <As className={cx('flex min-h-14 items-center gap-3 py-3 sm:gap-4', className)} {...rest}>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div
          className={cx(
            'truncate text-parchment',
            name ? 'font-display text-lead font-medium' : 'text-body font-medium',
          )}
        >
          {title}
        </div>
        {detail ? <div className="mt-0.5 text-ui text-faint">{detail}</div> : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </As>
  )
}

/** An empty state: say what is missing and offer the action that fills it. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title?: string | undefined
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-start gap-3 rounded-panel border border-dashed border-rule-strong px-5 py-8 sm:px-8',
        className,
      )}
    >
      {title ? <p className="font-display text-heading font-semibold">{title}</p> : null}
      {children ? <div className="max-w-[60ch] text-body text-muted">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/**
 * A whole page that stands in for one that can't be shown (not found, closed, no access): the
 * page's h1, then an empty state that says why and offers one way out (a gold action).
 */
export function NoticePage({
  title,
  emptyTitle,
  children,
  action,
  before,
  testId,
}: {
  title: string
  emptyTitle?: string
  children?: ReactNode
  action: ReactNode
  /** Above the title (e.g. a back link). */
  before?: ReactNode
  testId?: string | undefined
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14" data-testid={testId}>
      {before}
      <PageTitle title={title} />
      <EmptyState title={emptyTitle} action={action}>
        {children}
      </EmptyState>
    </div>
  )
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-ui text-faint">
      <span className="h-px flex-1 bg-rule" />
      {label ? <span>{label}</span> : null}
      <span className="h-px flex-1 bg-rule" />
    </div>
  )
}

export function CenteredPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={cx(
        'mx-auto flex w-full flex-col items-stretch px-4 py-10 sm:py-16',
        wide ? 'max-w-3xl' : 'max-w-md',
      )}
    >
      {children}
    </div>
  )
}

/** A small rounded tag ("Guest", "On", "Primary"). Sentence case, never all caps. */
export function Pill({
  tone = 'muted',
  children,
  className,
}: {
  /** `brass` for marks such as "You" or "Watching"; `gold` only for "to move" or a winner. */
  tone?: 'muted' | 'success' | 'brass' | 'gold' | 'danger'
  children: ReactNode
  className?: string
}) {
  const tones = {
    muted: 'border-rule-strong text-muted',
    brass: 'border-brass/50 text-brass',
    success: 'border-ok/40 text-ok',
    gold: 'border-gold/45 text-gold',
    danger: 'border-destructive-light/45 text-destructive-light',
  }
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1 rounded-full border bg-black/15 px-2.5 text-caption font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// Seats: nameplates and the four-sided table

export type Seat = 'south' | 'west' | 'north' | 'east'
/** Seat order by index (0-3), as the server numbers seats; also the turn order. */
export const SEAT_ORDER: readonly Seat[] = ['south', 'west', 'north', 'east']

/** Tailwind classes per seat. Use these only where the colour identifies the seat. */
export const SEAT_CLASSES: Record<
  Seat,
  { bg: string; text: string; border: string; fill: string; label: string }
> = {
  south: {
    bg: 'bg-seat-south',
    text: 'text-seat-south-light',
    border: 'border-seat-south',
    fill: 'fill-seat-south',
    label: 'South',
  },
  west: {
    bg: 'bg-seat-west',
    text: 'text-seat-west-light',
    border: 'border-seat-west',
    fill: 'fill-seat-west',
    label: 'West',
  },
  north: {
    bg: 'bg-seat-north',
    text: 'text-seat-north-light',
    border: 'border-seat-north',
    fill: 'fill-seat-north',
    label: 'North',
  },
  east: {
    bg: 'bg-seat-east',
    text: 'text-seat-east-light',
    border: 'border-seat-east',
    fill: 'fill-seat-east',
    label: 'East',
  },
}

const toSeat = (seat: Seat | number): Seat =>
  typeof seat === 'number' ? (SEAT_ORDER[seat] ?? 'south') : seat

/** A seat-coloured enamel dot (10px by default). Decorative; pair it with text. */
export function SeatDot({ seat, className }: { seat: Seat | number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/40',
        SEAT_CLASSES[toSeat(seat)].bg,
        className,
      )}
    />
  )
}

export type NameplateState = 'idle' | 'to-move' | 'out' | 'won'

/**
 * A seat's engraved nameplate: a brass-edged plate with the seat's colour along its inner edge,
 * the name in Fraunces, and a detail line (civ, rating, clock, status). `state` marks who is to
 * move (gold edge), who is out (struck through) and who won. `emblem` takes a small medallion;
 * `trailing` takes a clock or a menu. Plates are inline-flex: give them a width from the layout.
 */
export function Nameplate({
  seat,
  name,
  detail,
  emblem,
  trailing,
  state = 'idle',
  size = 'md',
  orient = 'row',
  edge = orient === 'column' ? 'right' : 'left',
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  seat: Seat | number
  name: ReactNode
  detail?: ReactNode
  emblem?: ReactNode
  trailing?: ReactNode
  state?: NameplateState
  size?: 'sm' | 'md'
  /** `column`: an upright plate for the sides of a board (emblem above, centred text). */
  orient?: 'row' | 'column'
  /** The side the seat colour runs along: the one facing the board or table. */
  edge?: 'left' | 'right' | 'top' | 'bottom'
}) {
  const s = toSeat(seat)
  const out = state === 'out'
  const lit = state === 'to-move' || state === 'won'
  const column = orient === 'column'
  const bar = {
    left: 'inset-y-0 left-0 w-1',
    right: 'inset-y-0 right-0 w-1',
    top: 'inset-x-0 top-0 h-1',
    bottom: 'inset-x-0 bottom-0 h-1',
  }[edge]
  // Room for the colour bar on its side.
  const pad = column
    ? 'px-2.5 pt-3 pb-2.5'
    : size === 'sm'
      ? edge === 'left'
        ? 'py-1.5 pr-2.5 pl-3.5'
        : 'px-2.5 py-1.5'
      : edge === 'left'
        ? 'py-2 pr-3 pl-4'
        : 'px-3 py-2'
  return (
    <div
      data-seat={s}
      data-state={state}
      className={cx(
        'relative inline-flex min-w-0 overflow-hidden rounded-plate border bg-surface-rail shadow-plate',
        'transition-[border-color,box-shadow,opacity] duration-200',
        column
          ? 'flex-col items-center gap-1.5 text-center'
          : cx('items-center', size === 'sm' ? 'gap-2' : 'gap-3'),
        pad,
        // Out: a plain rule edge and a struck-through name. The text keeps its contrast (no
        // opacity on the plate), only the colour bar fades.
        lit
          ? 'border-gold/80 shadow-[0_0_0_1px_rgb(212_160_23/0.35)]'
          : out
            ? 'border-rule'
            : 'border-rule-brass',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cx('absolute', bar, SEAT_CLASSES[s].bg, out && 'opacity-40 saturate-50')}
      />
      {emblem ? <span className="shrink-0">{emblem}</span> : null}
      <span className={cx('min-w-0', column ? 'w-full' : 'flex-1')}>
        <span
          className={cx(
            'block truncate font-display font-semibold',
            size === 'sm' ? 'text-ui' : 'text-body',
            out ? 'text-muted line-through decoration-parchment/60 decoration-1' : 'text-parchment',
          )}
        >
          {name}
        </span>
        {detail ? (
          <span
            className={cx(
              'block truncate tabular-nums',
              size === 'sm' ? 'text-caption' : 'text-ui leading-snug',
              lit ? 'text-gold' : 'text-faint',
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0 tabular-nums">{trailing}</span> : null}
    </div>
  )
}

/**
 * Four seats around a table: North above the centre, West and East beside it, South below,
 * from the viewer's side. `children` is the centre (the board, a table graphic, a lobby
 * summary); give it an explicit width (e.g. `w-[var(--board)]`), as its column sizes to it.
 * Below `stackBelow` (default `lg`) the plates sit in two pairs, as on the game screen: West
 * and North above the centre, South and East below it (clockwise from the bottom left, the
 * turn order), so nothing is squeezed beside a phone-width board.
 */
export function SeatTable({
  north,
  west,
  east,
  south,
  children,
  stackBelow = 'lg',
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  north?: ReactNode
  west?: ReactNode
  east?: ReactNode
  south?: ReactNode
  children: ReactNode
  stackBelow?: 'sm' | 'md' | 'lg' | 'never'
}) {
  // Literal class strings per breakpoint, so Tailwind can see them. Around the table the side
  // columns share the spare width and the plates hug the centre, which sizes itself.
  const grid = {
    sm: 'grid-cols-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:[grid-template-areas:"._n_."_"w_c_e"_"._s_."]',
    md: 'grid-cols-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:[grid-template-areas:"._n_."_"w_c_e"_"._s_."]',
    lg: 'grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:[grid-template-areas:"._n_."_"w_c_e"_"._s_."]',
    never:
      'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] [grid-template-areas:"._n_."_"w_c_e"_"._s_."]',
  }[stackBelow]
  // Stacked, West and North pair up above the centre, South and East below it.
  const toward = {
    sm: ['sm:justify-end', 'sm:justify-start'],
    md: ['md:justify-end', 'md:justify-start'],
    lg: ['lg:justify-end', 'lg:justify-start'],
    never: ['justify-end', 'justify-start'],
  }[stackBelow]
  const stacked = '[grid-template-areas:"w_n"_"c_c"_"s_e"]'
  return (
    <div
      className={cx(
        'grid items-center gap-3',
        stackBelow === 'never' ? null : stacked,
        grid,
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 justify-center [grid-area:n]">{north}</div>
      <div className={cx('flex min-w-0 [grid-area:w]', toward[0])}>{west}</div>
      <div className="min-w-0 [grid-area:c]">{children}</div>
      <div className={cx('flex min-w-0 [grid-area:e]', toward[1])}>{east}</div>
      <div className="flex min-w-0 justify-center [grid-area:s]">{south}</div>
    </div>
  )
}
