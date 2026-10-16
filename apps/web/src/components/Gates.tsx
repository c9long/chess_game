import { APP_NAME } from '@game/config'
import { type FormEvent, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { ApiError, acceptCurrentLegal, api, authErrorMessage, tooManyAttempts } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'
import { authClient } from '../lib/auth-client.ts'
import { AuthCard } from './AuthCard.tsx'
import { Clickwrap } from './Clickwrap.tsx'
import { Alert, Button, Card, CenteredPage, Field, Spinner } from './ui.tsx'

export function Loading() {
  return (
    <div
      className="flex min-h-[50vh] items-center justify-center text-parchment/60"
      aria-live="polite"
    >
      <Spinner />
      <span className="sr-only">Loading</span>
    </div>
  )
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const inputClass =
  'h-11 w-full rounded-lg border border-parchment/20 bg-ink/60 px-3 text-parchment outline-none transition-[border-color,box-shadow] duration-150 hover:border-parchment/35 focus:border-gold focus:ring-2 focus:ring-gold/30'
const selectClass = `select cursor-pointer ${inputClass}`

/** Neutral date-of-birth screen (PLAN §8): nothing pre-selected, no cutoff mentioned. */
function DateOfBirthScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [year, setYear] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const complete = month !== '' && day !== '' && /^\d{4}$/.test(year)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!complete) return
    setBusy(true)
    setError(undefined)
    const dateOfBirth = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    try {
      await api('/api/legal/age-confirmation', { body: { dateOfBirth } })
      await onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        await onDone()
      } else if (err instanceof ApiError && err.status === 400) {
        setError('Please enter a valid date.')
      } else if (err instanceof ApiError && err.status === 429) {
        setError(tooManyAttempts(err.retryAfter))
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title={`Welcome to ${APP_NAME}`} subtitle="Please enter your date of birth.">
      <form onSubmit={submit} className="flex flex-col gap-5" data-testid="dob-form">
        <fieldset className="grid grid-cols-[1.6fr_1fr_1.2fr] gap-3">
          <legend className="sr-only">Date of birth</legend>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-parchment/85">
            Month
            <select
              className={selectClass}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Month"
              data-testid="dob-month"
            >
              <option value="" disabled>
                Month
              </option>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-parchment/85">
            Day
            <select
              className={selectClass}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              aria-label="Day"
              data-testid="dob-day"
            >
              <option value="" disabled>
                Day
              </option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-parchment/85">
            Year
            <input
              className={inputClass}
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              placeholder="YYYY"
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
              aria-label="Year"
              data-testid="dob-year"
            />
          </label>
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={!complete} busy={busy}>
          Continue
        </Button>
      </form>
    </AuthCard>
  )
}

function Refusal() {
  return (
    <CenteredPage>
      <Card className="text-center">
        <p className="text-lg" data-testid="age-refusal">
          Sorry, we can&apos;t create an account right now.
        </p>
      </Card>
    </CenteredPage>
  )
}

/** Shows the DOB screen before anything else on a first visit. */
export function AgeGate() {
  const { legal, configError, refreshLegal } = useAppState()
  if (configError) {
    return (
      <CenteredPage>
        <Alert>We can&apos;t reach the server right now. Please try again shortly.</Alert>
      </CenteredPage>
    )
  }
  if (!legal) return <Loading />
  if (legal.blocked) return <Refusal />
  if (!legal.ageConfirmed) return <DateOfBirthScreen onDone={refreshLegal} />
  return <Outlet />
}

/** Signed-in users must accept the current Terms/Privacy versions before continuing. */
export function AcceptanceGate() {
  const { legal, session, config, refreshLegal } = useAppState()
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  if (!session || !legal?.needsAcceptance || !config) return <Outlet />
  return (
    <AuthCard
      title="Before you continue"
      subtitle="Please review and accept our current Terms of Service and Privacy Policy."
    >
      <div className="flex flex-col gap-5">
        <Clickwrap checked={checked} onChange={setChecked} />
        {error ? <Alert>{error}</Alert> : null}
        <Button
          disabled={!checked}
          busy={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await acceptCurrentLegal(config.legalVersions)
              await refreshLegal()
            } catch {
              setError('Something went wrong. Please try again.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Continue
        </Button>
      </div>
    </AuthCard>
  )
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, sessionPending, signingOut, leaveState } = useAppState()
  const location = useLocation()
  if (sessionPending) return <Loading />
  if (!session) {
    // Signing out goes to the landing page; don't race it with a redirect to sign-in. Navigate
    // there (rather than wait) so a route opened mid-sign-out can't leave a spinner behind.
    if (signingOut) return <Navigate to="/" replace state={leaveState} />
    return (
      <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />
    )
  }
  return <>{children}</>
}

/**
 * Accounts created through OAuth start with a placeholder name ("Player-1234"): the
 * provider's name is never shown. The player picks a username before continuing.
 */
export function UsernameGate() {
  const { session, config, refreshSession } = useAppState()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const user = session?.user as { username?: string | null } | undefined
  if (!session || isGuest(session.user) || user?.username || !config) return <Outlet />
  const rule = config.username
  const invalid =
    name.length < rule.minLength || name.length > rule.maxLength || !/^[A-Za-z0-9_]+$/.test(name)
  return (
    <AuthCard
      title="Choose a username"
      subtitle="This is the name other players see. It can’t be changed later."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault()
          setTouched(true)
          if (invalid) return
          setBusy(true)
          setError(undefined)
          const { error: err } = await authClient.updateUser({ username: name } as never)
          setBusy(false)
          if (err) setError(authErrorMessage(err))
          else await refreshSession()
        }}
      >
        <Field
          label="Username"
          autoComplete="username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          hint={rule.description}
          error={touched && name && invalid ? rule.description : undefined}
          data-testid="choose-username"
        />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" busy={busy} disabled={!name}>
          Continue
        </Button>
      </form>
    </AuthCard>
  )
}
