import {
  Check,
  Download,
  KeyRound,
  Link2,
  Mail,
  Plus,
  ShieldCheck,
  TicketCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Alert, Button, cx, Field, linkButtonClass, Pill } from '../components/ui.tsx'
import { ApiError, api, authErrorMessage, type OAuthProvider } from '../lib/api.ts'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { API_ORIGIN, authClient } from '../lib/auth-client.ts'
import { endMatchSession } from '../lib/match.ts'
import { authHeaders, endBearerSession, fetchCredentials } from '../lib/native-auth.ts'
import { normalizeTotpUri, totpSecret } from '../lib/totp.ts'
import { PROVIDER_LABELS } from './SignIn.tsx'

// This page is in the entry chunk; the passkey dialogs (and the dialog library) load on demand.
const PasskeyRenameDialog = lazy(() => import('../components/PasskeyRenameDialog.tsx'))
const PasskeyRemoveDialog = lazy(() => import('../components/PasskeyRemoveDialog.tsx'))

interface LinkedAccount {
  id: string
  accountId: string
  providerId: string
  createdAt: Date | string
}

const iconClass = 'h-5 w-5'

/**
 * A settings card: icon, heading and description on the left, actions on the right, and an
 * optional body below a divider.
 */
function Section({
  id,
  icon,
  title,
  description,
  actions,
  children,
  tone = 'default',
  testId,
  level = 2,
}: {
  id: string
  icon: ReactNode
  title: string
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  tone?: 'default' | 'danger'
  testId?: string
  level?: 2 | 3
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  const danger = tone === 'danger'
  return (
    <section
      id={id}
      data-testid={testId}
      aria-labelledby={`${id}-title`}
      className={cx(
        'scroll-mt-6 rounded-2xl border shadow-lg shadow-black/20',
        danger ? 'border-seat-south/40 bg-seat-south/[0.06]' : 'border-parchment/10 bg-panel/80',
      )}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-6">
        <div className="flex min-w-0 gap-4">
          <span
            aria-hidden="true"
            className={cx(
              'grid h-10 w-10 shrink-0 place-items-center rounded-xl border',
              danger
                ? 'border-seat-south/40 bg-seat-south/10 text-seat-south-light'
                : 'border-brass/30 bg-brass/10 text-brass',
            )}
          >
            {icon}
          </span>
          <div className="min-w-0 pt-0.5">
            <Heading
              id={`${id}-title`}
              className="font-display text-lg leading-tight font-semibold tracking-tight"
            >
              {title}
            </Heading>
            {description ? (
              <p className="mt-1 text-sm leading-relaxed text-pretty text-parchment/60">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:pl-14 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? (
        <div
          className={cx(
            'border-t px-5 py-5 sm:px-6',
            danger ? 'border-seat-south/25' : 'border-parchment/10',
          )}
        >
          {children}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Which section is in view, for the side navigation: the last section whose top has passed a
 * line a quarter down the viewport. At the bottom of the page the last sections can't reach
 * that line, so there a section picked from the navigation (the URL hash) wins while it is on
 * screen, and otherwise the last one.
 */
function useActiveSection(ids: string[]): string | undefined {
  const [active, setActive] = useState<string>()
  const key = ids.join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const els = ids
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null)
      if (els.length === 0) return
      const vh = window.innerHeight
      const root = document.documentElement
      const atBottom = window.scrollY + vh >= root.scrollHeight - 2
      let current = els[0] as HTMLElement
      for (const el of els) if (el.getBoundingClientRect().top <= vh * 0.25) current = el
      if (atBottom) {
        current = els[els.length - 1] as HTMLElement
        const picked = document.getElementById(decodeURIComponent(location.hash.slice(1)))
        if (picked && els.includes(picked)) {
          const r = picked.getBoundingClientRect()
          if (r.top >= -1 && r.top < vh) current = picked
        }
      }
      setActive(current.id)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('hashchange', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('hashchange', schedule)
    }
  }, [key])
  return active
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

  const user = session?.user
  const guest = isGuest(user)
  const nav: { id: string; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    ...(guest
      ? [{ id: 'reference', label: 'Reference code' }]
      : [
          { id: 'passkeys-section', label: 'Passkeys' },
          { id: 'two-step', label: 'Two-step verification' },
          { id: 'linked', label: 'Linked accounts' },
        ]),
    { id: 'your-data', label: 'Your data' },
    { id: 'danger-zone', label: 'Danger zone' },
  ]
  const active = useActiveSection(nav.map((n) => n.id))

  if (!session || !user) return null
  const hasPassword = accounts?.some((a) => a.providerId === 'credential') ?? false

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <header className="mb-6 lg:mb-8">
        <h1 className="font-display text-title font-semibold tracking-tight">Account</h1>
        <p className="mt-2 text-sm text-parchment/65">
          {guest
            ? 'You’re playing as a guest.'
            : 'How you sign in, how we protect your account, and the data we keep.'}
        </p>
      </header>

      {/* Phones and tablets: a scrollable row of section links. */}
      <nav aria-label="Account sections" className="-mx-4 mb-5 overflow-x-auto px-4 lg:hidden">
        <ul className="flex w-max gap-2 pb-1">
          {nav.map((n) => (
            <li key={n.id}>
              <a
                href={`#${n.id}`}
                className="inline-flex h-9 items-center rounded-full border border-parchment/15 bg-panel/70 px-3.5 text-xs font-semibold whitespace-nowrap text-parchment/75 transition-colors hover:border-parchment/35 hover:text-parchment"
              >
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Account sections" className="hidden lg:block">
          <ul className="sticky top-6 flex flex-col gap-0.5 border-l border-parchment/10">
            {nav.map((n) => (
              <li key={n.id}>
                <a
                  href={`#${n.id}`}
                  aria-current={active === n.id ? 'location' : undefined}
                  className={cx(
                    '-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors duration-150',
                    active === n.id
                      ? 'border-gold font-semibold text-parchment'
                      : 'border-transparent text-parchment/60 hover:border-parchment/30 hover:text-parchment',
                    n.id === 'danger-zone' && active !== n.id && 'text-seat-south-light',
                  )}
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          <ProfileCard
            name={displayName(user)}
            email={guest ? undefined : user.email}
            guest={guest}
            verified={Boolean((user as { emailVerified?: boolean }).emailVerified)}
          />

          {guest ? <GuestReference /> : null}

          {guest ? null : (
            <>
              <Passkeys />
              <TwoFactorSettings
                enabled={Boolean(user.twoFactorEnabled)}
                hasPassword={hasPassword}
              />
              <LinkedAccounts accounts={accounts} reload={loadAccounts} />
            </>
          )}
          <DataExport />

          <div id="danger-zone" className="mt-4 flex scroll-mt-6 flex-col gap-3">
            <h2 className="flex items-center gap-3 text-xs font-semibold tracking-[0.3em] text-seat-south-light uppercase">
              <TriangleAlert aria-hidden="true" className="h-4 w-4" />
              Danger zone
              <span aria-hidden="true" className="h-px flex-1 bg-seat-south/25" />
            </h2>
            <DeleteAccount guest={guest} hasPassword={hasPassword} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ProfileCard({
  name,
  email,
  guest,
  verified,
}: {
  name: string
  email: string | undefined
  guest: boolean
  verified: boolean
}) {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <section
      id="profile"
      aria-labelledby="profile-title"
      className="relative scroll-mt-6 overflow-hidden rounded-2xl border border-parchment/10 bg-panel/80 shadow-lg shadow-black/20"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-gold/10 to-transparent"
      />
      <h2 id="profile-title" className="sr-only">
        Profile
      </h2>
      <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[conic-gradient(from_210deg,#e6b42a,#8a6a1c,#e6b42a,#c9a55a,#e6b42a)] p-[2px] shadow-[0_10px_30px_-12px_rgba(212,160,23,0.6)]"
          >
            <span className="grid h-full w-full place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#3a332b,#1d1b19_75%)] font-display text-2xl font-semibold text-gold">
              {initial}
            </span>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="truncate font-display text-xl font-semibold tracking-tight sm:text-2xl"
                data-testid="account-name"
              >
                {name}
              </span>
              {guest ? (
                <Pill tone="gold">Guest</Pill>
              ) : verified ? (
                <Pill tone="success">
                  <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
                  Verified
                </Pill>
              ) : null}
            </div>
            <p className="mt-1 text-sm break-all text-parchment/60">
              {guest ? 'Temporary account in this browser' : email}
            </p>
          </div>
        </div>
        {guest ? (
          <Link to="/sign-up" className={linkButtonClass('primary')}>
            Create account and keep your history
          </Link>
        ) : null}
      </div>
    </section>
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
      id="reference"
      icon={<TicketCheck className={iconClass} />}
      title="Reference code"
      description="Guest accounts have no email address. If you write to us about your data (for example to request a copy or deletion), include this code and send the request from this browser session."
      testId="guest-reference"
    >
      <code
        className="inline-block rounded-lg border border-gold/20 bg-ink/70 px-4 py-2 font-mono text-lg tracking-widest text-gold"
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

const listClass =
  'divide-y divide-parchment/10 overflow-hidden rounded-xl border border-parchment/10'
const rowClass = 'flex items-center justify-between gap-3 bg-ink/30 px-4 py-3 text-sm'

function Passkeys() {
  const [keys, setKeys] = useState<PasskeyRow[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [renaming, setRenaming] = useState<PasskeyRow | null>(null)
  /** The Rename button that opened the dialog, to get focus back when it closes. */
  const renameOpener = useRef<HTMLButtonElement | null>(null)
  const [removing, setRemoving] = useState<PasskeyRow | null>(null)
  const removeOpener = useRef<HTMLButtonElement | null>(null)

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
    setError(undefined)
    const { error: err } = await authClient.passkey.deletePasskey({ id: k.id })
    if (err) setError(authErrorMessage(err))
    await load()
  }

  async function rename(k: PasskeyRow, name: string) {
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
      id="passkeys-section"
      icon={<KeyRound className={iconClass} />}
      title="Passkeys"
      description="Sign in with your device’s fingerprint, face or screen lock instead of a password."
      testId="passkeys"
      actions={
        <Button variant="secondary" busy={busy} onClick={add} data-testid="add-passkey">
          {busy ? null : <Plus aria-hidden="true" className="h-4 w-4" />}
          Add a passkey
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {keys && keys.length > 0 ? (
          <ul className={listClass}>
            {keys.map((k) => (
              <li key={k.id} className={cx(rowClass, 'flex-wrap')} data-testid="passkey-row">
                <span className="flex min-w-[9rem] flex-1 items-center gap-3">
                  <KeyRound aria-hidden="true" className="h-4 w-4 shrink-0 text-parchment/45" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{k.name || 'Passkey'}</span>
                    {k.createdAt ? (
                      <span className="block text-xs text-parchment/60">
                        added {new Date(k.createdAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      renameOpener.current = e.currentTarget
                      setRenaming(k)
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="enabled:hover:text-seat-south-light"
                    onClick={(e) => {
                      removeOpener.current = e.currentTarget
                      setRemoving(k)
                    }}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-parchment/15 px-4 py-5 text-center text-sm text-parchment/55">
            {keys ? 'No passkeys yet.' : 'Loading…'}
          </p>
        )}
        {error ? <Alert>{error}</Alert> : null}
      </div>
      {renaming ? (
        <Suspense fallback={null}>
          <PasskeyRenameDialog
            initialName={renaming.name ?? ''}
            onSave={(name) => rename(renaming, name)}
            onClose={() => setRenaming(null)}
            returnFocusTo={renameOpener}
          />
        </Suspense>
      ) : null}
      {removing ? (
        <Suspense fallback={null}>
          <PasskeyRemoveDialog
            name={removing.name || 'Passkey'}
            onRemove={() => remove(removing)}
            onClose={() => setRemoving(null)}
            returnFocusTo={removeOpener}
          />
        </Suspense>
      ) : null}
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
      id="two-step"
      icon={<ShieldCheck className={iconClass} />}
      title="Two-step verification"
      description="Ask for a code from an authenticator app when you sign in with a password."
      testId="two-factor"
      actions={
        <span data-testid="two-factor-status">
          <Pill tone={enabled ? 'success' : 'muted'}>
            <span className="sr-only">Status: </span>
            <span
              aria-hidden="true"
              className={cx(
                'h-1.5 w-1.5 rounded-full',
                enabled ? 'bg-seat-east-light' : 'bg-parchment/40',
              )}
            />
            {enabled ? 'On' : 'Off'}
          </Pill>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {setup ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-start gap-5 sm:flex-row">
              <div className="rounded-xl bg-parchment p-3 shadow-lg shadow-black/30">
                <QRCodeSVG value={normalizeTotpUri(setup.uri)} size={168} level="M" />
              </div>
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <p>Scan this code with your authenticator app.</p>
                <p className="text-parchment/60">Can’t scan it? Enter this key instead:</p>
                <code
                  className="rounded-lg border border-gold/20 bg-ink/70 px-2.5 py-1.5 font-mono break-all text-gold"
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
            {hasPassword ? (
              <Field
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint={
                  enabled
                    ? 'Needed to turn it off or create new backup codes.'
                    : 'Needed to set up an authenticator app.'
                }
                data-testid="two-factor-password"
                className="sm:max-w-sm"
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
        <li
          key={c}
          className="rounded-md border border-parchment/10 bg-ink/70 px-2 py-1.5 text-center tracking-wide"
        >
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
  const unlinked = providers.filter((p) => !linked.has(p))
  const label = (id: string) =>
    id === 'credential' ? 'Email and password' : (PROVIDER_LABELS[id as OAuthProvider] ?? id)
  // The sign-in method the account was created with: email and password if it has one,
  // otherwise the oldest linked service.
  const primary =
    accounts?.find((a) => a.providerId === 'credential') ??
    [...(accounts ?? [])].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0]

  return (
    <Section
      id="linked"
      icon={<Link2 className={iconClass} />}
      title="Linked accounts"
      description="Ways you can sign in to this account."
      testId="linked-accounts"
    >
      <div className="flex flex-col gap-4">
        <ul className={listClass}>
          {accounts?.map((a) => (
            <li key={a.id} className={rowClass}>
              <span className="flex min-w-0 items-center gap-3">
                {a.providerId === 'credential' ? (
                  <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-parchment/45" />
                ) : (
                  <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-parchment/45" />
                )}
                <span className="truncate font-medium">{label(a.providerId)}</span>
                {primary?.id === a.id ? <Pill>Primary</Pill> : null}
              </span>
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
        {unlinked.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {unlinked.map((p) => (
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
                <Plus aria-hidden="true" className="h-4 w-4" />
                Link {PROVIDER_LABELS[p]}
              </Button>
            ))}
          </div>
        ) : providers.length === 0 ? (
          <p className="text-sm text-parchment/50">
            No sign-in providers are configured on this server.
          </p>
        ) : null}
      </div>
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
      const res = await fetch(`${API_ORIGIN}/api/account/export`, {
        credentials: fetchCredentials(),
        headers: authHeaders(),
      })
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
      id="your-data"
      icon={<Download className={iconClass} />}
      title="Your data"
      description="Download a copy of your profile, legal acceptances, ratings and match history (JSON)."
      actions={
        <Button variant="secondary" busy={busy} onClick={download} data-testid="export-data">
          Download my data
        </Button>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
    </Section>
  )
}

function DeleteAccount({ guest, hasPassword }: { guest: boolean; hasPassword: boolean }) {
  const { refreshSession, leaveSession } = useAppState()
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
      // The apps' stored token died with the account: forget it (no-op in the browser).
      endBearerSession()
      await endMatchSession()
      await leaveSession(refreshSession, { deleted: true })
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
      id="delete"
      level={3}
      icon={<Trash2 className={iconClass} />}
      title={guest ? 'Delete guest account' : 'Delete account'}
      tone="danger"
      description={
        guest
          ? 'Your guest account and this browser’s sign-in are removed right away. Past games stay in other players’ history as “Deleted player”. This can’t be undone.'
          : 'Your email, username, sign-in methods and sessions are removed right away. Past games stay in other players’ history as “Deleted player”. This can’t be undone.'
      }
      testId="delete-account"
      actions={
        open ? null : (
          <Button variant="danger" onClick={() => setOpen(true)} data-testid="delete-open">
            {guest ? 'Delete guest account…' : 'Delete account…'}
          </Button>
        )
      }
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <Field
            label="Type DELETE to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            data-testid="delete-confirm"
            className="sm:max-w-sm"
          />
          {needPassword ? (
            <Field
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="delete-password"
              className="sm:max-w-sm"
            />
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-wrap gap-3">
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
      ) : null}
    </Section>
  )
}
