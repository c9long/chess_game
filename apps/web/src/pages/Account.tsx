import { QRCodeSVG } from 'qrcode.react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Button, CenteredPage, Field, PageTitle } from '../components/ui.tsx'
import { ApiError, api, authErrorMessage, type OAuthProvider } from '../lib/api.ts'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { API_ORIGIN, authClient } from '../lib/auth-client.ts'
import { normalizeTotpUri, totpSecret } from '../lib/totp.ts'
import { PROVIDER_LABELS } from './SignIn.tsx'

interface LinkedAccount {
  id: string
  accountId: string
  providerId: string
  createdAt: Date | string
}

function Section({
  title,
  description,
  children,
  tone = 'default',
  testId,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  tone?: 'default' | 'danger'
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className={`rounded-2xl border p-6 ${tone === 'danger' ? 'border-seat-south/40 bg-seat-south/5' : 'border-parchment/10 bg-panel/80'}`}
    >
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-parchment/60">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Account() {
  const { session } = useAppState()
  const [accounts, setAccounts] = useState<LinkedAccount[]>()

  const loadAccounts = useCallback(async () => {
    const { data } = await authClient.listAccounts()
    setAccounts((data as LinkedAccount[] | null) ?? [])
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  if (!session) return null
  const user = session.user
  const guest = isGuest(user)
  const hasPassword = accounts?.some((a) => a.providerId === 'credential') ?? false

  return (
    <CenteredPage wide>
      <PageTitle title="Account" subtitle={guest ? 'You’re playing as a guest.' : undefined} />
      <div className="flex flex-col gap-6">
        <Section title="Profile">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-parchment/55">Name</dt>
            <dd data-testid="account-name">{displayName(user)}</dd>
            {guest ? null : (
              <>
                <dt className="text-parchment/55">Email</dt>
                <dd className="break-all">{user.email}</dd>
              </>
            )}
          </dl>
          {guest ? (
            <Link
              to="/sign-up"
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-gold px-4 text-sm font-semibold text-ink hover:bg-gold-bright"
            >
              Create account and keep your history
            </Link>
          ) : null}
        </Section>

        {guest ? <GuestReference /> : null}

        {guest ? null : (
          <>
            <Passkeys />
            <TwoFactorSettings enabled={Boolean(user.twoFactorEnabled)} hasPassword={hasPassword} />
            <LinkedAccounts accounts={accounts} reload={loadAccounts} />
          </>
        )}
        <DataExport />
        <DeleteAccount guest={guest} hasPassword={hasPassword} />
      </div>
    </CenteredPage>
  )
}

/** Reference code a guest can quote when emailing us (PLAN §8); guests have no email. */
function GuestReference() {
  const [code, setCode] = useState<string>()
  useEffect(() => {
    api<{ code: string }>('/api/account/reference')
      .then((r) => setCode(r.code))
      .catch(() => setCode(undefined))
  }, [])
  return (
    <Section
      title="Reference code"
      description="Guest accounts have no email address. If you write to us about your data (for example to request a copy or deletion), include this code and send the request from this browser session."
      testId="guest-reference"
    >
      <code
        className="inline-block rounded bg-ink/70 px-3 py-2 font-mono text-lg tracking-widest text-gold"
        data-testid="reference-code"
      >
        {code ?? '…'}
      </code>
    </Section>
  )
}

/** "Chrome on Windows"-style default passkey name, so several keys can be told apart. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'this device'
  return `${browser} on ${os}`
}

interface PasskeyRow {
  id: string
  name?: string | null
  createdAt?: Date | string | null
}

function Passkeys() {
  const [keys, setKeys] = useState<PasskeyRow[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const { data } = await authClient.passkey.listUserPasskeys()
    setKeys((data as PasskeyRow[] | null) ?? [])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    setBusy(true)
    setError(undefined)
    const res = await authClient.passkey.addPasskey({ name: deviceLabel() })
    setBusy(false)
    if (res?.error) {
      const code = (res.error as { code?: string }).code
      setError(
        code === 'SESSION_NOT_FRESH'
          ? 'For your security, sign in again before adding a passkey.'
          : code
            ? authErrorMessage(res.error)
            : 'Passkey registration was cancelled.',
      )
      return
    }
    await load()
  }

  async function remove(k: PasskeyRow) {
    if (
      !window.confirm(
        `Remove the passkey “${k.name || 'Passkey'}”? You won’t be able to sign in with it any more.`,
      )
    ) {
      return
    }
    setError(undefined)
    const { error: err } = await authClient.passkey.deletePasskey({ id: k.id })
    if (err) setError(authErrorMessage(err))
    await load()
  }

  async function rename(k: PasskeyRow) {
    const name = window.prompt('Name this passkey', k.name ?? '')?.trim()
    if (!name || name === k.name) return
    setError(undefined)
    const { error: err } = await authClient.passkey.updatePasskey({
      id: k.id,
      name: name.slice(0, 64),
    })
    if (err) setError(authErrorMessage(err))
    await load()
  }

  return (
    <Section
      title="Passkeys"
      description="Sign in with your device’s fingerprint, face or screen lock instead of a password."
      testId="passkeys"
    >
      {keys && keys.length > 0 ? (
        <ul className="mb-4 divide-y divide-parchment/10 rounded-lg border border-parchment/10">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              data-testid="passkey-row"
            >
              <span>
                {k.name || 'Passkey'}
                {k.createdAt ? (
                  <span className="ml-2 text-parchment/45">
                    added {new Date(k.createdAt).toLocaleDateString()}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 gap-1">
                <Button variant="ghost" className="h-8 px-3" onClick={() => rename(k)}>
                  Rename
                </Button>
                <Button variant="ghost" className="h-8 px-3" onClick={() => remove(k)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-parchment/55">No passkeys yet.</p>
      )}
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <Button variant="secondary" busy={busy} onClick={add} data-testid="add-passkey">
        Add a passkey
      </Button>
    </Section>
  )
}

function TwoFactorSettings({ enabled, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
  const { refreshSession } = useAppState()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<{ uri: string; backupCodes: string[] }>()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [newCodes, setNewCodes] = useState<string[]>()
  const pw = hasPassword ? { password } : {}

  async function start() {
    setBusy(true)
    setError(undefined)
    const { data, error: err } = await authClient.twoFactor.enable(pw as { password: string })
    setBusy(false)
    if (err || !data || !('totpURI' in data)) {
      setError(
        err?.status === 400 || err?.status === 401
          ? 'That password is incorrect.'
          : authErrorMessage(err),
      )
      return
    }
    setPassword('')
    setSetup({ uri: data.totpURI, backupCodes: data.backupCodes })
  }

  async function confirm() {
    setBusy(true)
    setError(undefined)
    const { error: err } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') })
    setBusy(false)
    if (err) {
      setError('That code didn’t work. Check your authenticator app and try again.')
      return
    }
    setSetup(undefined)
    setCode('')
    setNotice('Two-step verification is on.')
    await refreshSession()
  }

  async function turnOff() {
    setBusy(true)
    setError(undefined)
    const { error: err } = await authClient.twoFactor.disable(pw as { password: string })
    setBusy(false)
    if (err) {
      setError(
        err.status === 400 || err.status === 401
          ? 'That password is incorrect.'
          : authErrorMessage(err),
      )
      return
    }
    setPassword('')
    setNotice('Two-step verification is off.')
    await refreshSession()
  }

  async function regenerate() {
    setBusy(true)
    setError(undefined)
    const { data, error: err } = await authClient.twoFactor.generateBackupCodes(
      pw as { password: string },
    )
    setBusy(false)
    if (err || !data) {
      setError(
        err?.status === 400 || err?.status === 401
          ? 'That password is incorrect.'
          : authErrorMessage(err),
      )
      return
    }
    setPassword('')
    setNewCodes(data.backupCodes)
    setNotice('New backup codes created. Your old codes no longer work.')
  }

  const secret = setup ? totpSecret(setup.uri) : undefined

  return (
    <Section
      title="Two-step verification"
      description="Ask for a code from an authenticator app when you sign in with a password."
      testId="two-factor"
    >
      <div className="flex flex-col gap-4">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {setup ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-start gap-5 sm:flex-row">
              <div className="rounded-xl bg-parchment p-3">
                <QRCodeSVG value={normalizeTotpUri(setup.uri)} size={168} level="M" />
              </div>
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <p>Scan this code with your authenticator app.</p>
                <p className="text-parchment/60">Can’t scan it? Enter this key instead:</p>
                <code
                  className="break-all rounded bg-ink/70 px-2 py-1 font-mono text-gold"
                  data-testid="totp-secret"
                >
                  {secret}
                </code>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Backup codes</p>
              <p className="mb-3 text-sm text-parchment/60">
                Save these somewhere safe. Each one signs you in once if you lose your device.
              </p>
              <BackupCodes codes={setup.backupCodes} />
            </div>
            <Field
              label="Code from your app"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              data-testid="totp-confirm-code"
            />
            {error ? <Alert>{error}</Alert> : null}
            <div className="flex gap-3">
              <Button busy={busy} disabled={code.length < 6} onClick={confirm}>
                Turn on
              </Button>
              <Button variant="ghost" onClick={() => setSetup(undefined)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm" data-testid="two-factor-status">
              Status: <strong>{enabled ? 'On' : 'Off'}</strong>
            </p>
            {hasPassword ? (
              <Field
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="two-factor-password"
              />
            ) : null}
            {newCodes ? <BackupCodes codes={newCodes} /> : null}
            {error ? <Alert>{error}</Alert> : null}
            <div>
              {enabled ? (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    busy={busy}
                    disabled={hasPassword && !password}
                    onClick={regenerate}
                    data-testid="regenerate-backup-codes"
                  >
                    New backup codes
                  </Button>
                  <Button
                    variant="secondary"
                    busy={busy}
                    disabled={hasPassword && !password}
                    onClick={turnOff}
                  >
                    Turn off
                  </Button>
                </div>
              ) : (
                <Button
                  busy={busy}
                  disabled={hasPassword && !password}
                  onClick={start}
                  data-testid="two-factor-start"
                >
                  Set up authenticator app
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  )
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <ul
      className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3"
      data-testid="backup-codes"
    >
      {codes.map((c) => (
        <li key={c} className="rounded bg-ink/70 px-2 py-1 text-center">
          {c}
        </li>
      ))}
    </ul>
  )
}

function LinkedAccounts({
  accounts,
  reload,
}: {
  accounts: LinkedAccount[] | undefined
  reload: () => Promise<void>
}) {
  const { config } = useAppState()
  const [error, setError] = useState<string>()
  const linked = new Set(accounts?.map((a) => a.providerId))
  const providers = config?.oauthProviders ?? []
  const label = (id: string) =>
    id === 'credential' ? 'Email and password' : (PROVIDER_LABELS[id as OAuthProvider] ?? id)

  return (
    <Section
      title="Linked accounts"
      description="Ways you can sign in to this account."
      testId="linked-accounts"
    >
      <ul className="mb-4 divide-y divide-parchment/10 rounded-lg border border-parchment/10">
        {accounts?.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>{label(a.providerId)}</span>
            {a.providerId !== 'credential' && (accounts?.length ?? 0) > 1 ? (
              <Button
                variant="ghost"
                className="h-8 px-3"
                onClick={async () => {
                  const { error: err } = await authClient.unlinkAccount({ accountId: a.id })
                  if (err) setError(authErrorMessage(err))
                  await reload()
                }}
              >
                Unlink
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <Alert>{error}</Alert> : null}
      {providers.filter((p) => !linked.has(p)).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {providers
            .filter((p) => !linked.has(p))
            .map((p) => (
              <Button
                key={p}
                variant="secondary"
                onClick={() =>
                  authClient.linkSocial({
                    provider: p,
                    callbackURL: `${window.location.origin}/account`,
                  })
                }
              >
                Link {PROVIDER_LABELS[p]}
              </Button>
            ))}
        </div>
      ) : providers.length === 0 ? (
        <p className="text-sm text-parchment/50">
          No sign-in providers are configured on this server.
        </p>
      ) : null}
    </Section>
  )
}

function DataExport() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  async function download() {
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch(`${API_ORIGIN}/api/account/export`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
        'account-export.json'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError('We couldn’t prepare your download. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title="Your data"
      description="Download a copy of your profile, legal acceptances, ratings and match history (JSON)."
    >
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <Button variant="secondary" busy={busy} onClick={download} data-testid="export-data">
        Download my data
      </Button>
    </Section>
  )
}

function DeleteAccount({ guest, hasPassword }: { guest: boolean; hasPassword: boolean }) {
  const { refreshSession } = useAppState()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [needPassword, setNeedPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function remove() {
    setBusy(true)
    setError(undefined)
    try {
      await api('/api/account', {
        method: 'DELETE',
        body: needPassword ? { confirm: 'DELETE', password } : { confirm: 'DELETE' },
      })
      await refreshSession()
      navigate('/', { replace: true, state: { deleted: true } })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SESSION_NOT_FRESH' && hasPassword) {
        setNeedPassword(true)
        setError('For your security, enter your password to confirm.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      }
      setBusy(false)
    }
  }

  return (
    <Section
      title={guest ? 'Delete guest account' : 'Delete account'}
      tone="danger"
      description={
        guest
          ? 'Your guest account and this browser’s sign-in are removed right away. Past games stay in other players’ history as “Deleted player”. This can’t be undone.'
          : 'Your email, username, sign-in methods and sessions are removed right away. Past games stay in other players’ history as “Deleted player”. This can’t be undone.'
      }
      testId="delete-account"
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <Field
            label="Type DELETE to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            data-testid="delete-confirm"
          />
          {needPassword ? (
            <Field
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="delete-password"
            />
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex gap-3">
            <Button
              variant="danger"
              disabled={typed !== 'DELETE' || (needPassword && !password)}
              busy={busy}
              onClick={remove}
              data-testid="delete-submit"
            >
              {guest ? 'Delete guest account' : 'Delete my account'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" onClick={() => setOpen(true)} data-testid="delete-open">
          {guest ? 'Delete guest account…' : 'Delete account…'}
        </Button>
      )}
    </Section>
  )
}
