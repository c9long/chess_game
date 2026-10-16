import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { AuthCard } from '../components/AuthCard.tsx'
import { Clickwrap } from '../components/Clickwrap.tsx'
import { Turnstile } from '../components/Turnstile.tsx'
import { Alert, Button, Divider, Field } from '../components/ui.tsx'
import {
  acceptCurrentLegal,
  api,
  authErrorMessage,
  type OAuthProvider,
  oauthErrorMessage,
} from '../lib/api.ts'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { authClient, captchaHeaders } from '../lib/auth-client.ts'
import { type ReturnState, safeReturnTo } from '../lib/return-to.ts'

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  discord: 'Discord',
  github: 'GitHub',
  microsoft: 'Microsoft',
}

export function SignIn() {
  const { config, session, refreshSession } = useAppState()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo((location.state as ReturnState)?.from)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [widgetKey, setWidgetKey] = useState(0)
  const [busy, setBusy] = useState<'password' | 'passkey' | OAuthProvider>()
  const [error, setError] = useState<string | undefined>(() =>
    oauthErrorMessage(params.get('error')),
  )
  /** Passkey failures show under the passkey button, the rest above "Sign in". */
  const [passkeyError, setPasskeyError] = useState<string>()
  const [agreed, setAgreed] = useState(false)
  const guest = session && isGuest(session.user) ? session.user : undefined
  const [keepGuest, setKeepGuest] = useState(true)

  if (session && !guest) return <Navigate to={returnTo} replace />

  const resetCaptcha = () => {
    setToken(null)
    setWidgetKey((k) => k + 1)
  }

  /** A guest chose to bring its games along: tell the server before signing in. */
  async function declareGuestIntent() {
    if (!guest) return
    await api('/api/account/guest-upgrade-intent', { method: keepGuest ? 'POST' : 'DELETE' })
  }

  async function finish() {
    await refreshSession()
    navigate(returnTo, { replace: true })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy('password')
    setError(undefined)
    setPasskeyError(undefined)
    try {
      await declareGuestIntent()
    } catch {
      // Not fatal: sign-in still works, the guest just stays separate.
    }
    const fetchOptions = captchaHeaders(token)
    const { data, error: err } = identifier.includes('@')
      ? await authClient.signIn.email({ email: identifier, password, fetchOptions })
      : await authClient.signIn.username({ username: identifier, password, fetchOptions })
    setBusy(undefined)
    resetCaptcha()
    if (err) {
      setError(authErrorMessage(err))
      return
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      navigate('/two-factor', { state: { from: returnTo } })
      return
    }
    await finish()
  }

  async function passkey() {
    setBusy('passkey')
    setError(undefined)
    setPasskeyError(undefined)
    await declareGuestIntent().catch(() => {})
    const res = await authClient.signIn.passkey()
    setBusy(undefined)
    if (res?.error) {
      const code = 'code' in res.error ? res.error.code : undefined
      setPasskeyError(code ? authErrorMessage(res.error) : 'Passkey sign-in was cancelled.')
      return
    }
    await finish()
  }

  /**
   * OAuth may create a new account, so the clickwrap comes first (PLAN §8): the buttons stay
   * disabled until the box is ticked, and the acceptance is recorded before the redirect.
   */
  async function social(provider: OAuthProvider) {
    if (!config || !token || !agreed) return
    setBusy(provider)
    setError(undefined)
    setPasskeyError(undefined)
    try {
      await acceptCurrentLegal(config.legalVersions)
      await declareGuestIntent()
      const { error: err } = await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}${returnTo}`,
        errorCallbackURL: `${window.location.origin}/sign-in`,
        fetchOptions: captchaHeaders(token),
      })
      if (err) {
        setError(authErrorMessage(err))
        setBusy(undefined)
        resetCaptcha()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setBusy(undefined)
      resetCaptcha()
    }
  }

  const providers = config?.oauthProviders ?? []

  return (
    <AuthCard
      title="Sign in"
      subtitle={
        guest
          ? 'Sign in to an account you already have.'
          : 'Welcome back. Your rating, history and civs are waiting.'
      }
      below={
        <>
          New here?{' '}
          <Link to="/sign-up" className="font-semibold text-gold hover:underline">
            Create account
          </Link>
        </>
      }
    >
      {guest ? (
        <label
          className="mb-5 flex cursor-pointer items-start gap-3 rounded-lg border border-gold/30 bg-gold/5 p-4 text-sm leading-relaxed"
          data-testid="keep-guest"
        >
          <input
            type="checkbox"
            checked={keepGuest}
            onChange={(e) => setKeepGuest(e.target.checked)}
            className="checkbox mt-0.5"
          />
          <span>
            Move my games as <strong>{displayName(guest)}</strong> to the account I sign in to.
            Untick this if it isn’t your guest (for example on a shared computer).
          </span>
        </label>
      ) : null}
      {/* Passkey first: it needs no form (and no anti-bot check), and it keeps the button clear
          of the Turnstile frame below, whose hit area can lag a scroll by a frame. */}
      <div className="flex flex-col gap-3">
        <Button
          variant="secondary"
          onClick={passkey}
          busy={busy === 'passkey'}
          data-testid="passkey-sign-in"
        >
          <KeyRound aria-hidden="true" className="h-4 w-4" /> Sign in with a passkey
        </Button>
        {passkeyError ? <Alert>{passkeyError}</Alert> : null}
      </div>
      <Divider label="or" />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Email or username"
          autoComplete="username webauthn"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="-mt-2 text-right text-sm">
          <Link to="/forgot-password" className="text-parchment/60 hover:text-gold">
            Forgot password?
          </Link>
        </div>
        <Turnstile key={widgetKey} siteKey={config?.turnstileSiteKey} onToken={setToken} />
        {error ? <Alert>{error}</Alert> : null}
        <Button
          type="submit"
          disabled={!token || !identifier || !password}
          busy={busy === 'password'}
        >
          Sign in
        </Button>
      </form>

      {providers.length > 0 ? (
        <>
          <Divider label="or" />
          <div className="flex flex-col gap-3">
            <p className="mt-2 text-xs text-parchment/60">
              Signing in with another service creates an account if you don’t have one yet.
            </p>
            <Clickwrap checked={agreed} onChange={setAgreed} />
            {providers.map((p) => (
              <Button
                key={p}
                variant="secondary"
                onClick={() => social(p)}
                busy={busy === p}
                disabled={!agreed || !token}
                data-testid={`oauth-${p}`}
              >
                Continue with {PROVIDER_LABELS[p]}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </AuthCard>
  )
}
