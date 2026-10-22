import { type FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { AuthCard } from '../components/AuthCard.tsx'
import { Alert, Button, Field, linkButtonClass } from '../components/ui.tsx'
import { authErrorMessage, tooManyAttempts } from '../lib/api.ts'
import { useAppState } from '../lib/app-state.tsx'
import { authClient, retryAfterSeconds } from '../lib/auth-client.ts'
import { type ReturnState, safeReturnTo } from '../lib/return-to.ts'

/** Typed backup code → stored form (the server normalizes the same way). */
function normalizeBackupCode(code: string) {
  const compact = code.replace(/[\s-]/g, '').toUpperCase()
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : code.trim()
}

export function TwoFactor() {
  const { refreshSession } = useAppState()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = safeReturnTo((location.state as ReturnState)?.from)
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /** The challenge is over (too many tries, or it expired): only a new sign-in helps. */
  const [expired, setExpired] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const { error: err } =
      mode === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ''), trustDevice })
        : await authClient.twoFactor.verifyBackupCode({
            code: normalizeBackupCode(code),
            trustDevice,
          })
    setBusy(false)
    if (err) {
      switch (err.code) {
        case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
        case 'INVALID_TWO_FACTOR_COOKIE':
          setExpired(true)
          setError(
            err.code === 'INVALID_TWO_FACTOR_COOKIE'
              ? 'This sign-in attempt has expired. Please sign in again.'
              : 'Too many wrong codes. Please sign in again.',
          )
          return
        case 'ACCOUNT_TEMPORARILY_LOCKED':
          setExpired(true)
          setError(
            'Too many wrong codes for this account. Two-step sign-in is paused for about 15 minutes.',
          )
          return
      }
      if (err.status === 429) setError(tooManyAttempts(retryAfterSeconds()))
      else if (err.status === 401) setError('That code didn’t work. Try again.')
      else setError(authErrorMessage(err))
      return
    }
    await refreshSession()
    navigate(returnTo, { replace: true })
  }

  return (
    <AuthCard
      title="Two-step verification"
      subtitle={
        expired
          ? undefined
          : mode === 'totp'
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Enter one of your backup codes. Each code works once.'
      }
    >
      {expired ? (
        <div className="flex flex-col gap-4">
          {error ? <Alert>{error}</Alert> : null}
          <Link
            to="/sign-in"
            state={{ from: returnTo }}
            className={linkButtonClass('primary', undefined, 'lg')}
            data-testid="two-factor-restart"
          >
            Sign in again
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label={mode === 'totp' ? 'Authentication code' : 'Backup code'}
            autoComplete="one-time-code"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="two-factor-code"
          />
          <label className="flex cursor-pointer items-center gap-3 text-ui text-parchment">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="checkbox"
            />
            Trust this device for 30 days
          </label>
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" size="lg" busy={busy} disabled={!code}>
            Verify
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setMode(mode === 'totp' ? 'backup' : 'totp')
              setCode('')
              setError(undefined)
            }}
          >
            {mode === 'totp' ? 'Use a backup code instead' : 'Use your authenticator app instead'}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
