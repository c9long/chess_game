import { Check, CircleAlert, CircleCheck, Eye, EyeOff, Info } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId, useState } from 'react'

// This module is imported by eagerly loaded pages, so it stays light: no overlay library
// here (dialogs, tooltips and toasts live in overlay.tsx, used only from lazy code).

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

/**
 * Height and padding per size. Use `size` rather than `h-*`/`px-*` in `className` to make a
 * button smaller: without a class merger, a smaller utility in `className` loses to these by
 * CSS order (larger ones like `h-14` happen to win).
 */
export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3',
  md: 'h-11 px-5',
}

/** Shared button look (size not included, see `buttonSizes`), also used by button-like links. */
export const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold tracking-wide select-none ' +
  'transition-[color,background-color,border-color,box-shadow,transform,filter] duration-150 ease-out ' +
  'enabled:active:translate-y-px'

export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-gold text-ink shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_8px_24px_-12px_rgba(212,160,23,0.7)] ' +
    'enabled:hover:bg-gold-bright enabled:hover:shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_10px_28px_-10px_rgba(230,180,42,0.8)] ' +
    'disabled:bg-parchment/10 disabled:text-parchment/40 disabled:shadow-none',
  secondary:
    'border border-parchment/25 text-parchment enabled:hover:border-parchment/50 enabled:hover:bg-parchment/5 ' +
    'disabled:border-parchment/10 disabled:text-parchment/40',
  ghost:
    'text-parchment/80 enabled:hover:bg-parchment/5 enabled:hover:text-parchment disabled:text-parchment/35',
  danger:
    'bg-seat-south text-parchment shadow-[0_8px_24px_-14px_rgba(192,57,43,0.9)] enabled:hover:brightness-110 ' +
    'disabled:bg-parchment/10 disabled:text-parchment/40 disabled:shadow-none',
}

/** Hover and press for links styled as buttons (`enabled:` only matches form controls). */
const linkStates: Record<ButtonVariant, string> = {
  primary: 'hover:bg-gold-bright active:translate-y-px',
  secondary: 'hover:border-parchment/50 hover:bg-parchment/5 active:translate-y-px',
  ghost: 'hover:bg-parchment/5 hover:text-parchment',
  danger: 'hover:brightness-110 active:translate-y-px',
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

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

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
      <label htmlFor={id} className="text-sm font-medium text-parchment/85">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
          className={cx(
            'h-11 w-full rounded-lg border bg-ink/60 px-3 text-parchment placeholder:text-parchment/35',
            'outline-none transition-[border-color,box-shadow,background-color] duration-150',
            'hover:border-parchment/35 focus:border-gold focus:bg-ink/80 focus:ring-2 focus:ring-gold/30',
            'disabled:cursor-not-allowed disabled:opacity-60',
            error
              ? 'border-seat-south hover:border-seat-south focus:border-seat-south focus:ring-seat-south/30'
              : 'border-parchment/20',
            isPassword && showValid ? 'pr-20' : isPassword || showValid ? 'pr-11' : null,
          )}
          {...rest}
        />
        {showValid ? (
          <Check
            aria-hidden="true"
            className={cx(
              'pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-seat-east-light',
              isPassword ? 'right-12' : 'right-3.5',
            )}
            strokeWidth={2.5}
          />
        ) : null}
        {isPassword ? (
          <button
            type="button"
            className="absolute top-1/2 right-1.5 flex h-8 w-9 -translate-y-1/2 items-center justify-center rounded-md text-parchment/55 transition-colors duration-150 hover:bg-parchment/5 hover:text-parchment"
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
            'flex items-start gap-1.5 text-xs leading-relaxed',
            error ? 'text-seat-south-light' : 'text-parchment/55',
          )}
        >
          {error ? <CircleAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" /> : null}
          <span>{error ?? hint}</span>
        </p>
      ) : null}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'w-full rounded-2xl border border-parchment/10 bg-panel/90 p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-8',
        'ring-1 ring-black/20 ring-inset',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info' | 'success'
  children: ReactNode
}) {
  const tones = {
    error: 'border-seat-south/50 bg-seat-south/10 text-parchment',
    info: 'border-seat-west/50 bg-seat-west/10 text-parchment',
    success: 'border-seat-east/50 bg-seat-east/10 text-parchment',
  }
  const Icon = tone === 'error' ? CircleAlert : tone === 'success' ? CircleCheck : Info
  const iconColor = {
    error: 'text-seat-south-light',
    info: 'text-[#8fb4f0]',
    success: 'text-seat-east-light',
  }
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex animate-fade-in items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed',
        tones[tone],
      )}
    >
      <Icon aria-hidden="true" className={cx('mt-0.5 h-4 w-4 shrink-0', iconColor[tone])} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function PageTitle({
  title,
  subtitle,
  align = 'start',
}: {
  title: string
  subtitle?: ReactNode
  align?: 'start' | 'center'
}) {
  return (
    <header className={cx('mb-6', align === 'center' && 'text-center')}>
      <h1
        className={cx(
          'font-display font-semibold tracking-tight',
          // Long titles (e.g. "Welcome to <title>") step down a size so they stay at two lines.
          title.length > 26 ? 'text-2xl leading-tight sm:text-[1.75rem]' : 'text-title',
        )}
      >
        {title}
      </h1>
      {subtitle ? (
        <p
          className={cx(
            'mt-2 text-sm leading-relaxed text-pretty text-parchment/65',
            align === 'center' && 'mx-auto max-w-sm',
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </header>
  )
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-parchment/60">
      <span className="h-px flex-1 bg-linear-to-r from-transparent to-parchment/15" />
      {label ? <span>{label}</span> : null}
      <span className="h-px flex-1 bg-linear-to-l from-transparent to-parchment/15" />
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

/** A small rounded tag ("Guest", "On", "Primary"). */
export function Pill({
  tone = 'muted',
  children,
  className,
}: {
  tone?: 'muted' | 'success' | 'gold' | 'danger'
  children: ReactNode
  className?: string
}) {
  const tones = {
    muted: 'border-parchment/15 bg-parchment/5 text-parchment/65',
    success: 'border-seat-east/40 bg-seat-east/15 text-seat-east-light',
    gold: 'border-gold/40 bg-gold/10 text-gold',
    danger: 'border-seat-south/40 bg-seat-south/10 text-seat-south-light',
  }
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
