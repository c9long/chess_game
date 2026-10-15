import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Loading } from '../components/Gates.tsx'
import { Alert, Card, CenteredPage, PageTitle } from '../components/ui.tsx'
import { useAppState } from '../lib/app-state.tsx'
import { authClient } from '../lib/auth-client.ts'

const primaryLink =
  'inline-flex h-11 w-full items-center justify-center rounded-lg bg-gold font-semibold text-ink hover:bg-gold-bright'

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
  return (
    <CenteredPage>
      <Card>
        {state === 'signed-in' ? (
          <>
            <PageTitle title="Email verified" subtitle="Your account is ready." />
            <Link to="/" className={primaryLink} data-testid="verified-continue">
              Continue
            </Link>
          </>
        ) : state === 'verified' ? (
          <>
            <PageTitle
              title="Email verified"
              subtitle="Your account is ready. Sign in to start playing."
            />
            <Link to="/sign-in" className={primaryLink} data-testid="verified-sign-in">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <PageTitle title="Link expired" />
            <Alert>This verification link is invalid or has expired.</Alert>
            <Link to="/resend-verification" className={`${primaryLink} mt-4`}>
              Get a new link
            </Link>
            <Link
              to="/sign-in"
              className="mt-4 block text-center text-sm text-gold hover:underline"
            >
              Go to sign in
            </Link>
          </>
        )}
      </Card>
    </CenteredPage>
  )
}
