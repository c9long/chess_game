import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AuthCard, authLinkClass } from '../components/AuthCard.tsx'
import { DevMailHint } from '../components/DevMailHint.tsx'
import { Turnstile } from '../components/Turnstile.tsx'
import { Alert, Button, Field, linkButtonClass } from '../components/ui.tsx'
import { authErrorMessage } from '../lib/api.ts'
import { useAppState } from '../lib/app-state.tsx'
import { authClient, captchaHeaders } from '../lib/auth-client.ts'

export function ForgotPassword() {
  const { config } = useAppState()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [widgetKey, setWidgetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setError(undefined)
    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
      fetchOptions: captchaHeaders(token),
    })
    setBusy(false)
    setToken(null)
    setWidgetKey((k) => k + 1)
    if (err) setError(authErrorMessage(err))
    else setSent(true)
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We’ll email you a link to choose a new one."
      below={
        <Link to="/sign-in" className={authLinkClass}>
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">If an account uses that address, a reset link is on its way.</Alert>
          <DevMailHint email={email} />
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Turnstile key={widgetKey} siteKey={config?.turnstileSiteKey} onToken={setToken} />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" size="lg" busy={busy} disabled={!token || !email}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  )
}

export function ResetPassword() {
  const { config } = useAppState()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string>()
  const minPw = config?.passwordMinLength ?? 10

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    if (password !== confirm) {
      setError('The passwords don’t match.')
      return
    }
    setBusy(true)
    setError(undefined)
    const { error: err } = await authClient.resetPassword({ newPassword: password, token })
    setBusy(false)
    if (err)
      setError(
        err.code === 'INVALID_TOKEN'
          ? 'This reset link is invalid or has expired.'
          : authErrorMessage(err),
      )
    else setDone(true)
  }

  return (
    <AuthCard
      title="Choose a new password"
      below={
        !token || params.get('error') ? (
          <Link to="/sign-in" className={authLinkClass}>
            Back to sign in
          </Link>
        ) : undefined
      }
    >
      {!token || params.get('error') ? (
        <div className="flex flex-col gap-4">
          <Alert>This reset link is invalid or has expired. Ask for a new one below.</Alert>
          <Link to="/forgot-password" className={linkButtonClass('primary', undefined, 'lg')}>
            Get a new reset link
          </Link>
        </div>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">
            Your password has been changed. You’ve been signed out everywhere.
          </Alert>
          <Link to="/sign-in" className={linkButtonClass('primary', undefined, 'lg')}>
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={minPw}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={`At least ${minPw} characters.`}
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error ? <Alert>{error}</Alert> : null}
          <Button
            type="submit"
            size="lg"
            busy={busy}
            disabled={password.length < minPw || !confirm}
          >
            Save password
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
