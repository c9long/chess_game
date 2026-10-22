import { type ReactNode, useId } from 'react'
import { cx, textLinkClass } from './ui.tsx'

/**
 * The shared frame of the sign-in, sign-up, guest, recovery and gate screens: a brass-edged
 * plate on the room's ink with the title set left like an engraving, the form, and an optional
 * foot strip under a rule for the other way through ("New here? Create account").
 *
 * Keep these screens short. In a 1280×720 window a taller page scrolls, and a click that lands
 * while the Turnstile widget finishes can then be lost (attack-auth.spec.ts, "check-email
 * resend"; every spec that uses startAsGuest). See docs/ui-libraries.md.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  below,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  /** The plate's foot strip, under a rule (e.g. "New here? Create account"). */
  below?: ReactNode
}) {
  const titleId = useId()
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-8 sm:py-14">
      <section
        aria-labelledby={titleId}
        className="relative overflow-hidden rounded-panel border border-rule-brass bg-surface-rail shadow-rim"
      >
        {/* A short engraved brass mark on the plate's top edge, above the title. */}
        <span
          aria-hidden="true"
          className="absolute top-0 left-5 h-0.5 w-10 bg-brass/80 sm:left-8"
        />
        <div className="px-5 pt-6 pb-6 sm:px-8 sm:pt-8 sm:pb-8">
          <header className="mb-6">
            <h1
              id={titleId}
              className={cx(
                'font-display font-semibold text-balance',
                // Long titles ("Welcome to <title>") step down so they stay at two lines.
                // The plate is narrow, so the scale tops out at 32px rather than text-title's 36.
                title.length > 26
                  ? 'text-[1.625rem] leading-tight tracking-tight'
                  : 'text-[1.75rem] leading-tight sm:text-[2rem]',
              )}
            >
              {title}
            </h1>
            {subtitle ? (
              <div className="mt-2 max-w-[60ch] text-body text-pretty text-muted">{subtitle}</div>
            ) : null}
          </header>
          {children}
        </div>
        {below ? (
          <div className="border-t border-rule bg-black/15 px-5 py-4 text-ui text-muted sm:px-8">
            {below}
          </div>
        ) : null}
      </section>
    </div>
  )
}

/** The link in an AuthCard's foot strip or under a form. */
export const authLinkClass = cx(textLinkClass, 'font-semibold')
