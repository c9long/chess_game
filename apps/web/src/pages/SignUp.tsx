import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthCard } from '../components/AuthCard.tsx'
import { Clickwrap } from '../components/Clickwrap.tsx'
import { Turnstile } from '../components/Turnstile.tsx'
import { Alert, Button, Field } from '../components/ui.tsx'
import { acceptCurrentLegal, authErrorMessage } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'
import { authClient, captchaHeaders } from '../lib/auth-client.ts'

const USERNAME_CHARS = /^[A-Za-z0-9_]+$/
/** Only for the inline hint; the browser and the server do the real validation. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function SignUp() {
  const { config, session } = useAppState()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [checked, setChecked] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [widgetKey, setWidgetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // Field errors appear once a field is left (or on submit), not on the first keystroke.
  const [touched, setTouched] = useState<{
    email?: boolean
    username?: boolean
    password?: boolean
  }>({})

  const minPw = config?.passwordMinLength ?? 10
  const nameRule = config?.username
  const usernameError =
    username && nameRule
      ? username.length < nameRule.minLength ||
        username.length > nameRule.maxLength ||
        !USERNAME_CHARS.test(username)
        ? nameRule.description
        : undefined
      : undefined
  const passwordError =
    password && password.length < minPw ? `At least ${minPw} characters.` : undefined
  const emailError =
    email && !EMAIL_SHAPE.test(email) ? 'Enter an address like name@example.com.' : undefined
  const ready =
    checked && token && email && username && password && !usernameError && !passwordError

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched({ email: true, username: true, password: true })
    if (!ready || !config || !token) return
    setBusy(true)
    setError(undefined)
    try {
      await acceptCurrentLegal(config.legalVersions)
      const { error: err } = await authClient.signUp.email({
        email,
        password,
        name: username,
        username,
        displayUsername: username,
        fetchOptions: captchaHeaders(token),
      })
      if (err) {
        setError(authErrorMessage(err))
        setToken(null)
        setWidgetKey((k) => k + 1)
        return
      }
      navigate('/check-email', { state: { email } })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Create account"
      subtitle={
        isGuest(session?.user)
          ? 'Your guest games will move to your new account once you verify your email.'
          : 'Keep your rating, history and civs across devices.'
      }
      below={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-semibold text-gold hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          error={touched.email ? emailError : undefined}
          valid={Boolean(touched.email && email && !emailError)}
        />
        <Field
          label="Username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, username: true }))}
          hint={nameRule?.description}
          error={touched.username ? usernameError : undefined}
          valid={Boolean(touched.username && username && nameRule && !usernameError)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          hint={`At least ${minPw} characters.`}
          error={touched.password ? passwordError : undefined}
          valid={Boolean(touched.password && password && !passwordError)}
        />
        <Clickwrap checked={checked} onChange={setChecked} />
        <Turnstile key={widgetKey} siteKey={config?.turnstileSiteKey} onToken={setToken} />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={!ready} busy={busy}>
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
