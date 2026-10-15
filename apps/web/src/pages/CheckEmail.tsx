import { type FormEvent, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Turnstile } from '../components/Turnstile.tsx'
import { Alert, Button, Card, CenteredPage, Field, PageTitle } from '../components/ui.tsx'
import { authErrorMessage } from '../lib/api.ts'
import { useAppState } from '../lib/app-state.tsx'
import { authClient, captchaHeaders } from '../lib/auth-client.ts'

/**
 * "Check your email" after signup, and the place to get a new verification link (also at
 * /resend-verification, linked from an expired link). Works after a reload too: the address
 * can be typed when it isn't carried over from the signup form.
 */
export function CheckEmail() {
  const { config } = useAppState()
  const location = useLocation()
  const fromSignup = (location.state as { email?: string } | null)?.email
  const resendOnly = location.pathname === '/resend-verification'
  const [email, setEmail] = useState(fromSignup ?? '')
  const [token, setToken] = useState<string | null>(null)
  const [widgetKey, setWidgetKey] = useState(0)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function resend(e: FormEvent) {
    e.preventDefault()
    if (!token || !email) return
    setBusy(true)
    setError(undefined)
    const { error: err } = await authClient.sendVerificationEmail({
      email,
      fetchOptions: captchaHeaders(token),
    })
    setBusy(false)
    setToken(null)
    setWidgetKey((k) => k + 1)
    if (err) setError(authErrorMessage(err))
    else setSent(true)
  }

  return (
    <CenteredPage>
      <Card>
        <PageTitle
          title={resendOnly ? 'Get a new verification link' : 'Check your email'}
          subtitle={
            resendOnly ? (
              'Enter the address you signed up with and we’ll send a new link.'
            ) : fromSignup ? (
              <>
                We sent a verification link to{' '}
                <strong className="text-parchment">{fromSignup}</strong>. Open it to finish creating
                your account. If you already had an account with this address, we sent sign-in help
                there instead.
              </>
            ) : (
              'We sent you a verification link. Open it to finish creating your account.'
            )
          }
        />
        <form onSubmit={resend} className="flex flex-col gap-4">
          {sent ? (
            <Alert tone="success">
              If that address has an unverified account, a new link is on its way. It can take a
              minute to arrive.
            </Alert>
          ) : null}
          {fromSignup ? null : (
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          {config ? (
            <Turnstile key={widgetKey} siteKey={config.turnstileSiteKey} onToken={setToken} />
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" variant="secondary" busy={busy} disabled={!token || !email}>
            {resendOnly ? 'Send link' : 'Resend email'}
          </Button>
          <Link to="/sign-in" className="text-center text-sm text-gold hover:underline">
            Back to sign in
          </Link>
        </form>
      </Card>
    </CenteredPage>
  )
}
