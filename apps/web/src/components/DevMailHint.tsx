import { Link } from 'react-router'
import { useAppState } from '../lib/app-state.tsx'
import { textLinkClass } from './ui.tsx'

/**
 * Development builds only, and only when the server stores emails in its dev mailbox instead
 * of sending them (no RESEND_API_KEY). Renders nothing in production builds.
 */
export function DevMailHint({ email }: { email?: string | undefined }) {
  const { config } = useAppState()
  if (!import.meta.env.DEV || !config?.devMailbox) return null
  const to = email ? `?to=${encodeURIComponent(email)}` : ''
  return (
    <div
      className="rounded-control border border-dashed border-rule-brass px-4 py-3 text-ui text-muted"
      data-testid="dev-mail-hint"
    >
      On this computer emails aren’t really sent. Open the{' '}
      <Link to={`/dev/mail${to}`} className={`${textLinkClass} font-medium`}>
        dev mailbox
      </Link>{' '}
      to read this one and click its link.
    </div>
  )
}
