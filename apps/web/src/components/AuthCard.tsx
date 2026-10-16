import type { ReactNode } from 'react'
import { BrandMark } from './BrandMark.tsx'
import { Card, CenteredPage, PageTitle } from './ui.tsx'

/**
 * The shared frame of the sign-in, sign-up, guest and recovery screens: brand mark, centred
 * title and subtitle, the form, and an optional line under the card.
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
  /** Shown under the card (e.g. "New here? Create account"). */
  below?: ReactNode
}) {
  return (
    <CenteredPage>
      {/* The mark straddles the card's top edge and reaches 24px into it; the extra top padding
          keeps it clear of the title. From sm the card moves up by the same 8px it grew, so the
          page keeps its height: in a 1280×720 window a taller page scrolls, and a click that
          lands while the Turnstile widget finishes can then be lost (attack-auth.spec.ts,
          "check-email resend"). See docs/ui-libraries.md. */}
      <Card className="relative pt-9 sm:-mt-2 sm:pt-10">
        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
          <span className="block rounded-2xl bg-panel p-1 shadow-[0_10px_30px_-10px_rgba(212,160,23,0.55)] ring-1 ring-parchment/10">
            <BrandMark className="h-10 w-10" />
          </span>
        </div>
        <PageTitle title={title} subtitle={subtitle} align="center" />
        {children}
      </Card>
      {below ? <div className="mt-6 text-center text-sm text-parchment/60">{below}</div> : null}
    </CenteredPage>
  )
}
