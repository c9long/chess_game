import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { AuthCard } from '../components/AuthCard.tsx'
import { Clickwrap } from '../components/Clickwrap.tsx'
import { Turnstile } from '../components/Turnstile.tsx'
import { Alert, Button } from '../components/ui.tsx'
import { acceptCurrentLegal, authErrorMessage } from '../lib/api.ts'
import { useAppState } from '../lib/app-state.tsx'
import { authClient, captchaHeaders } from '../lib/auth-client.ts'

export function GuestStart() {
  const { config, session, refreshSession } = useAppState()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [widgetKey, setWidgetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (session) return <Navigate to="/" replace />

  async function start() {
    if (!config || !token) return
    setBusy(true)
    setError(undefined)
    try {
      await acceptCurrentLegal(config.legalVersions)
      const { error: err } = await authClient.signIn.anonymous({
        fetchOptions: captchaHeaders(token),
      })
      if (err) {
        setError(authErrorMessage(err))
        setToken(null)
        setWidgetKey((k) => k + 1)
        return
      }
      await refreshSession()
      navigate('/')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Play as Guest"
      subtitle="You’ll get a temporary account. Create a full account later and your game history comes with you."
    >
      <div className="flex flex-col gap-5">
        <Clickwrap checked={checked} onChange={setChecked} />
        <Turnstile key={widgetKey} siteKey={config?.turnstileSiteKey} onToken={setToken} />
        {error ? <Alert>{error}</Alert> : null}
        <Button
          disabled={!checked || !token}
          busy={busy}
          onClick={start}
          data-testid="guest-continue"
        >
          Continue
        </Button>
      </div>
    </AuthCard>
  )
}
