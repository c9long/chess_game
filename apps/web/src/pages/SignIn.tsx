import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { AuthCard, authLinkClass } from '../components/AuthCard.tsx'
import { Clickwrap } from '../components/Clickwrap.tsx'
import { Turnstile } from '../components/Turnstile.tsx'
import { Alert, Button, Divider, Field, textLinkClass } from '../components/ui.tsx'
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

/** Under a "This account has been suspended." error: where to appeal (Terms §8.2). */
function SuspendedHelp() {
  return (
    <p className="text-ui text-muted" data-testid="suspended-help">
      If you think this is a mistake, see “Appeals” (section 8.2) in the{' '}
      <Link to="/terms" className={textLinkClass}>
        Terms of Service
      </Link>
      .
    </p>
  )
}

export function SignIn() {
  const { config, session, refreshSession, ageGate } = useAppState()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo((location.state as ReturnState)?.from)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [widgetKey, setWidgetKey] = useState(0)
  const [busy, setBusy] = useState<'password' | 'passkey' | OAuthProvider>()
  const [suspended, setSuspended] = useState(false)
  const [error, setError] = useState<string | undefined>(() =>
    oauthErrorMessage(params.get('error'), ageGate(true) === 'ok'),
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
    setSuspended(false)
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
      setSuspended(err.code === 'ACCOUNT_SUSPENDED')
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
    setSuspended(false)
    await declareGuestIntent().catch(() => {})
    const res = await authClient.signIn.passkey()
    setBusy(undefined)
    if (res?.error) {
      const code = 'code' in res.error ? res.error.code : undefined
      setPasskeyError(code ? authErrorMessage(res.error) : 'Passkey sign-in was cancelled.')
      setSuspended(code === 'ACCOUNT_SUSPENDED')
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
          <Link to="/sign-up" className={authLinkClass}>
            Create account
          </Link>
        </>
      }
    >
      {guest ? (
        <label
          className="mb-6 flex cursor-pointer items-start gap-3 rounded-control border border-rule-brass bg-black/15 px-4 py-3.5 text-ui leading-relaxed text-parchment"
          data-testid="keep-guest"
        >
          <input
            type="checkbox"
            checked={keepGuest}
            onChange={(e) => setKeepGuest(e.target.checked)}
            className="checkbox mt-0.5"
          />
          <span>
            Move my games as{' '}
            <strong className="font-display font-semibold">{displayName(guest)}</strong> to the
            account I sign in to.{' '}
            <span className="text-muted">
              Untick this if it isn’t your guest (for example on a shared computer).
            </span>
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
        {passkeyError && suspended ? <SuspendedHelp /> : null}
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
        <div className="-mt-1.5 text-right text-ui">
          <Link
            to="/forgot-password"
            className="rounded-[2px] text-muted underline decoration-transparent underline-offset-[3px] transition-colors duration-150 hover:text-parchment hover:decoration-brass/60"
          >
            Forgot password?
          </Link>
        </div>
        <Turnstile key={widgetKey} siteKey={config?.turnstileSiteKey} onToken={setToken} />
        {error ? <Alert>{error}</Alert> : null}
        {error && suspended ? <SuspendedHelp /> : null}
        <Button
          type="submit"
          size="lg"
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
            <p className="text-caption text-faint">
              {ageGate(true) === 'ok'
                ? 'Signing in with another service creates an account if you don’t have one yet.'
                : 'Signing in with another service works for an account you already have. New here? Choose Create account.'}
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
