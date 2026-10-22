import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AuthCard, authLinkClass } from '../components/AuthCard.tsx'
import { Loading } from '../components/Gates.tsx'
import { Alert, linkButtonClass } from '../components/ui.tsx'
import { useAppState } from '../lib/app-state.tsx'
import { authClient } from '../lib/auth-client.ts'

const primaryLink = linkButtonClass('primary', 'w-full', 'lg')

/**
 * Confirms an email address. Opening the link only verifies the address: the server signs
 * in only the browser that submitted the signup form, so a link opened elsewhere (another
 * device, or someone it was forwarded to) never switches that browser's account.
 */
export function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const { refreshSession } = useAppState()
  const [state, setState] = useState<'working' | 'signed-in' | 'verified' | 'error'>(
    token ? 'working' : 'error',
  )
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    authClient
      .verifyEmail({ query: { token } })
      .then(async ({ error }) => {
        if (error) {
          setState('error')
          return
        }
        const { data } = await authClient.getSession()
        await refreshSession()
        const user = data?.user as { emailVerified?: boolean; isAnonymous?: boolean } | undefined
        setState(user?.emailVerified && !user.isAnonymous ? 'signed-in' : 'verified')
      })
      .catch(() => setState('error'))
  }, [token, refreshSession])

  if (state === 'working') return <Loading />
  const title = state === 'error' ? 'Link expired' : 'Email verified'
  const subtitle =
    state === 'signed-in'
      ? 'Your account is ready.'
      : state === 'verified'
        ? 'Your account is ready. Sign in to start playing.'
        : undefined
  return (
    <AuthCard
      title={title}
      subtitle={subtitle}
      below={
        state === 'error' ? (
          <Link to="/sign-in" className={authLinkClass}>
            Go to sign in
          </Link>
        ) : undefined
      }
    >
      {state === 'signed-in' ? (
        <Link to="/" className={primaryLink} data-testid="verified-continue">
          Continue
        </Link>
      ) : state === 'verified' ? (
        <Link to="/sign-in" className={primaryLink} data-testid="verified-sign-in">
          Sign in
        </Link>
      ) : (
        <div className="flex flex-col gap-4">
          <Alert>This verification link is invalid or has expired. Ask for a new one below.</Alert>
          <Link to="/resend-verification" className={primaryLink}>
            Get a new link
          </Link>
        </div>
      )}
    </AuthCard>
  )
}
