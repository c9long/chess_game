import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'primary',
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      'bg-gold text-ink hover:bg-gold-bright shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_8px_24px_-12px_rgba(212,160,23,0.7)]',
    secondary:
      'border border-parchment/25 text-parchment hover:border-parchment/50 hover:bg-parchment/5',
    ghost: 'text-parchment/80 hover:text-parchment hover:bg-parchment/5',
    danger: 'bg-seat-south text-parchment hover:brightness-110',
  }
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold tracking-wide transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        'disabled:cursor-not-allowed disabled:opacity-45',
        styles[variant],
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

export function Field({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string | undefined
  error?: string | undefined
}) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-parchment/85">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        className={cx(
          'h-11 rounded-lg border bg-ink/60 px-3 text-parchment placeholder:text-parchment/35',
          'outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30',
          error ? 'border-seat-south' : 'border-parchment/20',
        )}
        {...rest}
      />
      {error || hint ? (
        <p
          id={`${id}-hint`}
          className={cx('text-xs', error ? 'text-seat-south-light' : 'text-parchment/55')}
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'w-full rounded-2xl border border-parchment/10 bg-panel/90 p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-8',
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
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-lg border px-4 py-3 text-sm', tones[tone])}
    >
      {children}
    </div>
  )
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm text-parchment/65">{subtitle}</p> : null}
    </header>
  )
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-parchment/40">
      <span className="h-px flex-1 bg-parchment/15" />
      {label ? <span>{label}</span> : null}
      <span className="h-px flex-1 bg-parchment/15" />
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
