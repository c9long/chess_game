import { Link } from 'react-router'
import { useAppState } from '../lib/app-state.tsx'

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
      className="rounded-lg border border-dashed border-gold/50 bg-gold/5 px-4 py-3 text-sm text-parchment/85"
      data-testid="dev-mail-hint"
    >
      <strong className="text-gold">Local development:</strong> emails aren’t really sent. Open the{' '}
      <Link
        to={`/dev/mail${to}`}
        className="font-semibold text-gold underline-offset-2 hover:underline"
      >
        dev mailbox
      </Link>{' '}
      to read this one and click its link.
    </div>
  )
}
