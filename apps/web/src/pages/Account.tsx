import type { FriendRequestPolicy } from '@game/protocol'
import { startAuthentication } from '@simplewebauthn/browser'
import {
  Check,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  Plus,
  Smartphone,
  TicketCheck,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Link, useLocation } from 'react-router'
import { Monogram } from '../components/social/FriendButton.tsx'
import {
  Alert,
  Button,
  cx,
  Field,
  linkButtonClass,
  PageTitle,
  Pill,
  textLinkClass,
} from '../components/ui.tsx'
import {
  ApiError,
  api,
  authErrorMessage,
  type BackupCodesStatus,
  type OAuthProvider,
  type StepUpMethod,
  tooManyAttempts,
} from '../lib/api.ts'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { API_ORIGIN, authClient } from '../lib/auth-client.ts'
import { endMatchSession } from '../lib/match.ts'
import { authHeaders, endBearerSession, fetchCredentials } from '../lib/native-auth.ts'
import { fetchSocialSettings, saveSocialSettings } from '../lib/social.ts'
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

/**
 * A settings section: heading and description with actions at the right (under them on
 * phones), then an optional body. Sections are separated by a rule, not boxed. `danger` draws
 * the section as a panel with a brick edge (deleting the account).
 */
function Section({
  id,
  title,
  description,
  actions,
  children,
  tone = 'default',
  testId,
}: {
  id: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  tone?: 'default' | 'danger'
  testId?: string
}) {
  const danger = tone === 'danger'
  return (
    <section
      id={id}
      data-testid={testId}
      aria-labelledby={`${id}-title`}
      className={cx(
        'scroll-mt-6',
        danger
          ? 'relative overflow-hidden rounded-panel border border-destructive-light/30 bg-destructive/[0.08] p-5 shadow-rim before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-destructive-light/70 sm:p-6'
          : 'border-t border-rule pt-7',
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-display text-heading font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 max-w-[60ch] text-ui text-pretty text-faint">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
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

  // A link to a section (e.g. /account#two-step from a security email, also after signing in
  // first): scroll to it once the sections that depend on the linked accounts are laid out.
  const { hash } = useLocation()
  const ready = Boolean(session) && accounts !== undefined
  useEffect(() => {
    if (!ready || !hash) return
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
    } catch {
      // A malformed hash: stay at the top.
    }
  }, [ready, hash])

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
          { id: 'privacy', label: 'Friend requests' },
        ]),
    { id: 'your-data', label: 'Your data' },
    { id: 'danger-zone', label: guest ? 'Delete guest account' : 'Delete account' },
  ]
  const active = useActiveSection(nav.map((n) => n.id))

  if (!session || !user) return null
  const hasPassword = accounts?.some((a) => a.providerId === 'credential') ?? false

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <PageTitle
        title="Account"
        subtitle={
          guest
            ? 'You’re playing as a guest. Create an account to keep your games and play ranked.'
            : 'How you sign in, how your account is protected, and the data we keep.'
        }
      />

      {/* Phones and tablets: the section links wrap onto as many lines as they need (nothing
          hides off the edge), the current one marked with the brass bar. */}
      <nav aria-label="Account sections" className="mb-6 border-b border-rule pb-2 lg:hidden">
        <ul className="flex flex-wrap gap-x-1 gap-y-0.5">
          {nav.map((n) => (
            <li key={n.id}>
              <a
                href={`#${n.id}`}
                aria-current={active === n.id ? 'location' : undefined}
                className={cx(
                  'relative inline-flex h-9 items-center rounded-control px-2 text-ui font-medium whitespace-nowrap text-muted transition-colors duration-150 hover:text-parchment',
                  'after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:rounded-full after:bg-brass after:opacity-0 aria-[current]:text-parchment aria-[current]:after:opacity-100',
                  n.id === 'danger-zone' && active !== n.id && 'text-destructive-light',
                )}
              >
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Account sections" className="hidden lg:block">
          <ul className="sticky top-6 flex flex-col gap-0.5 border-l border-rule">
            {nav.map((n) => (
              <li key={n.id}>
                <a
                  href={`#${n.id}`}
                  aria-current={active === n.id ? 'location' : undefined}
                  className={cx(
                    '-ml-px block border-l-2 py-1.5 pl-4 text-ui transition-colors duration-150',
                    active === n.id
                      ? 'border-brass font-semibold text-parchment'
                      : 'border-transparent text-faint hover:border-parchment/30 hover:text-parchment',
                    n.id === 'danger-zone' && active !== n.id && 'text-destructive-light',
                  )}
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-8">
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
              <FriendRequestPrivacy />
            </>
          )}
          <DataExport />

          <div id="danger-zone" className="mt-2 scroll-mt-6">
            <DeleteAccount guest={guest} />
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
  return (
    <section
      id="profile"
      aria-labelledby="profile-title"
      className="relative flex scroll-mt-6 flex-col gap-5 overflow-hidden rounded-plate border border-rule-brass bg-surface-rail py-5 pr-5 pl-6 shadow-plate sm:flex-row sm:items-center sm:justify-between sm:py-6 sm:pr-6 sm:pl-7"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brass/70" />
      <h2 id="profile-title" className="sr-only">
        Profile
      </h2>
      <div className="flex min-w-0 items-center gap-4">
        <Monogram name={name} size="lg" />
        <div className="min-w-0">
          <p
            className="truncate font-display text-title leading-tight font-semibold"
            data-testid="account-name"
          >
            {name}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-ui text-muted">
            <span className="break-all">{guest ? 'Guest account in this browser' : email}</span>
            {guest ? null : verified ? (
              <Pill tone="success">
                <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
                Verified
              </Pill>
            ) : null}
          </p>
        </div>
      </div>
      {guest ? (
        <Link to="/sign-up" className={linkButtonClass('primary')}>
          Create account and keep your history
        </Link>
      ) : null}
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
      title="Reference code"
      description="Guest accounts have no email address. If you write to us about your data (for example to request a copy or deletion), include this code and send the request from this browser session."
      testId="guest-reference"
    >
      <code
        className="inline-block rounded-control border border-rule-strong bg-black/25 px-4 py-2 text-lead font-medium tracking-[0.06em] text-parchment shadow-well [font-feature-settings:'tnum','zero','ss02']"
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

const listClass = 'divide-y divide-rule border-y border-rule'
const rowClass = 'flex min-h-14 items-center justify-between gap-3 py-3 text-ui'

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
                  <KeyRound aria-hidden="true" className="h-4 w-4 shrink-0 text-brass" />
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium">
                      {k.name || 'Passkey'}
                    </span>
                    {k.createdAt ? (
                      <span className="block text-caption text-faint">
                        Added {new Date(k.createdAt).toLocaleDateString()}
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
                    variant="quiet"
                    size="sm"
                    className="enabled:hover:text-destructive-light"
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
          <p className="rounded-panel border border-dashed border-rule-strong px-4 py-5 text-ui text-muted">
            {keys
              ? 'No passkeys yet. Add one to sign in without typing your password.'
              : 'Loading…'}
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
  const [codesLeft, setCodesLeft] = useState<BackupCodesStatus>()
  const passwordBox = useRef<HTMLDivElement>(null)
  const pw = hasPassword ? { password } : {}

  const loadCodesLeft = useCallback(async () => {
    try {
      setCodesLeft(await api<BackupCodesStatus>('/api/account/two-factor/backup-codes'))
    } catch {
      setCodesLeft(undefined)
    }
  }, [])
  useEffect(() => {
    if (enabled) void loadCodesLeft()
    else setCodesLeft(undefined)
  }, [enabled, loadCodesLeft])

  /** The low-codes prompt: create new codes now, or ask for the password first. */
  function promptRegenerate() {
    if (hasPassword && !password) {
      passwordBox.current?.querySelector('input')?.focus()
      setError(undefined)
      setNotice(undefined)
      return
    }
    void regenerate()
  }

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
    await loadCodesLeft()
  }

  const secret = setup ? totpSecret(setup.uri) : undefined

  return (
    <Section
      id="two-step"
      title="Two-step verification"
      description="Ask for a code from an authenticator app when you sign in with a password."
      testId="two-factor"
      actions={
        <span data-testid="two-factor-status">
          <Pill tone={enabled ? 'success' : 'muted'}>
            <span className="sr-only">Status: </span>
            <span
              aria-hidden="true"
              className={cx('h-1.5 w-1.5 rounded-full', enabled ? 'bg-ok' : 'bg-parchment/40')}
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
              <div className="rounded-control bg-parchment p-3 shadow-plate">
                <QRCodeSVG
                  value={normalizeTotpUri(setup.uri)}
                  size={168}
                  level="M"
                  title="QR code for your authenticator app"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2 text-ui">
                <p className="text-body">Scan this code with your authenticator app.</p>
                <p className="text-faint">Can’t scan it? Enter this key instead:</p>
                <code
                  className="rounded-control border border-rule-strong bg-black/25 px-2.5 py-1.5 break-all text-parchment shadow-well [font-feature-settings:'tnum','zero','ss02']"
                  data-testid="totp-secret"
                >
                  {secret}
                </code>
              </div>
            </div>
            <div>
              <p className="mb-1 text-ui font-semibold">Backup codes</p>
              <p className="mb-3 text-ui text-faint">
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
              <Button variant="quiet" onClick={() => setSetup(undefined)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {enabled && codesLeft?.enabled ? (
              <BackupCodesLeft
                status={codesLeft}
                onRegenerate={promptRegenerate}
                needsPassword={hasPassword && !password}
                busy={busy}
              />
            ) : null}
            {hasPassword ? (
              <div ref={passwordBox}>
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
              </div>
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

/** At or below this many unused backup codes, the page asks for a new set. */
const LOW_BACKUP_CODES = 3

/** "7 of 10 backup codes left", with a warning and a prompt for new codes when few are left. */
function BackupCodesLeft({
  status,
  onRegenerate,
  needsPassword,
  busy,
}: {
  status: BackupCodesStatus
  onRegenerate: () => void
  needsPassword: boolean
  busy: boolean
}) {
  const { remaining, total } = status
  if (remaining === null) {
    // The server couldn't read the stored codes: the count is unknown, not zero.
    return (
      <div
        className="flex items-start gap-2.5 border-y border-rule py-3 text-ui text-muted"
        data-testid="backup-codes-left"
        data-unknown="true"
      >
        <TicketCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brass" />
        <span>
          We couldn’t check how many backup codes you have left. If you’re not sure you still have
          some, create a new set.
        </span>
      </div>
    )
  }
  const low = remaining <= LOW_BACKUP_CODES
  const label = `${remaining} of ${total} backup code${total === 1 ? '' : 's'} left`
  const meter = (
    <span aria-hidden="true" className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length meter
          key={i}
          className={cx(
            'h-1.5 w-3 rounded-full',
            i < remaining ? (low ? 'bg-warn' : 'bg-brass') : 'bg-parchment/15',
          )}
        />
      ))}
    </span>
  )
  if (!low) {
    return (
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-rule py-3 text-ui"
        data-testid="backup-codes-left"
      >
        <span className="flex items-center gap-2.5 font-medium">
          <TicketCheck aria-hidden="true" className="h-4 w-4 text-brass" />
          {label}
        </span>
        {meter}
      </div>
    )
  }
  return (
    <div data-testid="backup-codes-left" data-low="true">
      <Alert tone="warning">
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-semibold">{remaining === 0 ? 'No backup codes left' : label}</p>
            <p className="mt-1 text-muted">
              Each code signs you in once if you lose your authenticator app. Create a new set so
              you don’t get locked out
              {needsPassword ? ': enter your current password, then choose Create new codes.' : '.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {meter}
            <Button
              variant="secondary"
              size="sm"
              busy={busy}
              onClick={onRegenerate}
              data-testid="backup-codes-low-regenerate"
            >
              {needsPassword ? 'Enter password' : 'Create new codes'}
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  )
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <ul
      className="grid grid-cols-2 gap-2 text-ui font-medium sm:grid-cols-3 [font-feature-settings:'tnum','zero','ss02']"
      data-testid="backup-codes"
    >
      {codes.map((c) => (
        <li
          key={c}
          className="rounded-plate border border-rule bg-black/25 px-2 py-1.5 text-center tracking-[0.04em] shadow-well"
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
                  <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-brass" />
                ) : (
                  <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-brass" />
                )}
                <span className="truncate text-body font-medium">{label(a.providerId)}</span>
                {primary?.id === a.id ? <Pill>Primary</Pill> : null}
              </span>
              {a.providerId !== 'credential' && (accounts?.length ?? 0) > 1 ? (
                <Button
                  variant="quiet"
                  size="sm"
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
          <p className="text-ui text-faint">No other sign-in services are set up on this server.</p>
        ) : null}
      </div>
    </Section>
  )
}

const FRIEND_REQUEST_OPTIONS: { value: FriendRequestPolicy; label: string; hint: string }[] = [
  {
    value: 'anyone',
    label: 'Anyone',
    hint: 'Any registered player can send you a request, for example by your username.',
  },
  {
    value: 'played_with',
    label: 'Only players I’ve played with',
    hint: 'Players you are playing or have finished a game with.',
  },
]

/** "Who can send me friend requests" (saved as soon as it changes). */
function FriendRequestPrivacy() {
  const [policy, setPolicy] = useState<FriendRequestPolicy>()
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; text: string }>()

  useEffect(() => {
    fetchSocialSettings()
      .then((s) => setPolicy(s.friendRequests))
      .catch(() =>
        setStatus({
          tone: 'error',
          text: 'This setting didn’t load. Reload the page to try again.',
        }),
      )
  }, [])

  async function choose(next: FriendRequestPolicy) {
    if (next === policy || saving) return
    const before = policy
    setPolicy(next)
    setSaving(true)
    setStatus(undefined)
    try {
      await saveSocialSettings({ friendRequests: next })
      setStatus({ tone: 'success', text: 'Saved.' })
    } catch {
      setPolicy(before)
      setStatus({ tone: 'error', text: 'That didn’t save. Check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      id="privacy"
      title="Who can send me friend requests"
      description="If someone isn’t allowed to send you a request, they see the same message as for an unknown username, so they can’t tell which option you chose. Your public profile stays visible either way."
      testId="friend-request-privacy"
    >
      {/* Not disabled while saving: that would drop keyboard focus off the chosen radio. */}
      <fieldset
        disabled={policy === undefined}
        aria-busy={saving || undefined}
        className="flex flex-col gap-2"
      >
        <legend className="sr-only">Who can send me friend requests</legend>
        {FRIEND_REQUEST_OPTIONS.map((o) => (
          <label
            key={o.value}
            className={cx(
              'flex cursor-pointer items-start gap-3 rounded-control border px-4 py-3 transition-colors duration-150',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold',
              policy === o.value
                ? 'border-brass/70 bg-brass/10'
                : 'border-rule-strong hover:border-parchment/35',
            )}
          >
            <input
              type="radio"
              name="friend-requests"
              value={o.value}
              checked={policy === o.value}
              onChange={() => void choose(o.value)}
              className="mt-1 h-4 w-4 accent-[var(--color-brass)]"
              data-testid={`friend-requests-${o.value}`}
            />
            <span className="min-w-0">
              <span className="block text-ui font-semibold">{o.label}</span>
              <span className="block text-caption text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p
        role="status"
        className={cx(
          'mt-2 min-h-5 text-caption',
          status?.tone === 'error' ? 'text-destructive-light' : 'text-ok',
        )}
      >
        {status?.text ?? ''}
      </p>
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
      setError('Your download didn’t start. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      id="your-data"
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

const STEP_UP_LABELS: Record<StepUpMethod, { label: string; icon: ReactNode }> = {
  password: { label: 'Password', icon: <LockKeyhole aria-hidden="true" className="h-4 w-4" /> },
  passkey: { label: 'Passkey', icon: <KeyRound aria-hidden="true" className="h-4 w-4" /> },
  totp: { label: 'Authenticator app', icon: <Smartphone aria-hidden="true" className="h-4 w-4" /> },
}

/** A passkey assertion for the step-up: Better Auth's challenge, signed by this device. */
async function passkeyProof() {
  const { data, error } = await authClient.$fetch<
    Parameters<typeof startAuthentication>[0]['optionsJSON']
  >('/passkey/generate-authenticate-options', { method: 'GET' })
  if (error || !data) throw new Error('options')
  return startAuthentication({ optionsJSON: data })
}

function DeleteAccount({ guest }: { guest: boolean }) {
  const { refreshSession, leaveSession } = useAppState()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  /** Ways to confirm it's you, once the server said the session is too old; else null. */
  const [methods, setMethods] = useState<StepUpMethod[] | null>(null)
  const [method, setMethod] = useState<StepUpMethod>()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /** Read out by screen readers (the step-up appears without a page change). */
  const [announcement, setAnnouncement] = useState('')
  /** Where keyboard focus goes after a reply: into the new step-up, or back to the proof. */
  const [focusRequest, setFocusRequest] = useState<{ n: number; to: 'step-up' | 'retry' }>()
  const formRef = useRef<HTMLFormElement>(null)
  const openerRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)
  const hintId = useId()

  const proofReady =
    !methods ||
    methods.length === 0 ||
    method === 'passkey' ||
    (method === 'password' && password.length > 0) ||
    (method === 'totp' &&
      (useBackup ? code.trim().length >= 10 : code.replace(/\s/g, '').length >= 6))
  const canSubmit = typed === 'DELETE' && proofReady && methods?.length !== 0
  const stepUp = methods && methods.length > 0 && method ? method : undefined

  // The submit button is disabled while busy, which drops focus to <body>: put it where the
  // next step is (the method choice or the proof field, else the button itself).
  useEffect(() => {
    if (!focusRequest) return
    const form = formRef.current
    if (!form) return
    const box = form.querySelector('[data-testid="delete-step-up"]')
    const input = box?.querySelector<HTMLInputElement>('input:not([type="radio"])')
    const radio = box?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
    const submit = form.querySelector<HTMLButtonElement>('[data-testid="delete-submit"]')
    const cancel = form.querySelector<HTMLButtonElement>('[data-testid="delete-cancel"]')
    const target =
      (focusRequest.to === 'step-up' ? radio : null) ??
      input ??
      (submit && !submit.disabled ? submit : null) ??
      cancel
    target?.focus()
    if (focusRequest.to === 'retry' && target === input) input?.select()
  }, [focusRequest])

  // Closing the dialog removes the button that had focus: return it to "Delete account…".
  useEffect(() => {
    if (wasOpen.current && !open) openerRef.current?.querySelector('button')?.focus()
    wasOpen.current = open
  }, [open])

  const requestFocus = (to: 'step-up' | 'retry') =>
    setFocusRequest((r) => ({ n: (r?.n ?? 0) + 1, to }))

  /** A fresh dialog each time: nothing typed, no proof or old error kept. */
  function reset() {
    setTyped('')
    setPassword('')
    setCode('')
    setUseBackup(false)
    setError(undefined)
    setAnnouncement('')
  }

  async function proof(): Promise<Record<string, unknown> | null> {
    if (!stepUp) return {}
    if (stepUp === 'password') return { password }
    if (stepUp === 'totp')
      return useBackup ? { backupCode: code } : { totpCode: code.replace(/\s/g, '') }
    try {
      return { passkey: await passkeyProof() }
    } catch {
      setError('The passkey check was cancelled or didn’t finish. Try again.')
      requestFocus('retry')
      return null
    }
  }

  async function remove() {
    setBusy(true)
    setError(undefined)
    setAnnouncement('')
    const extra = await proof()
    if (!extra) {
      setBusy(false)
      return
    }
    try {
      await api('/api/account', { method: 'DELETE', body: { confirm: 'DELETE', ...extra } })
      // The apps' stored token died with the account: forget it (no-op in the browser).
      endBearerSession()
      await endMatchSession()
      await leaveSession(refreshSession, { deleted: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SESSION_NOT_FRESH') {
        const offered = ((err.body as { methods?: StepUpMethod[] } | null)?.methods ?? []).filter(
          (m) => m in STEP_UP_LABELS,
        )
        setMethods(offered)
        setMethod(offered[0])
        if (offered.length === 0) {
          setError('For your security, sign out and sign in again before deleting your account.')
        } else {
          setAnnouncement(
            'Confirm it’s you: you signed in more than a day ago, so deleting your account needs one more check.',
          )
        }
        requestFocus('step-up')
      } else {
        if (err instanceof ApiError && err.status === 429) {
          setError(tooManyAttempts(err.retryAfter))
        } else {
          setError(
            err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
          )
        }
        requestFocus('retry')
      }
      setBusy(false)
    }
  }

  function choose(m: StepUpMethod) {
    setMethod(m)
    setCode('')
    setUseBackup(false)
    setError(undefined)
  }

  return (
    <Section
      id="delete"
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
          <div ref={openerRef}>
            <Button
              variant="danger"
              onClick={() => {
                reset()
                setOpen(true)
              }}
              data-testid="delete-open"
            >
              {guest ? 'Delete guest account…' : 'Delete account…'}
            </Button>
          </div>
        )
      }
    >
      {open ? (
        <form
          ref={formRef}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit && !busy) void remove()
          }}
        >
          <p className="sr-only" role="status" data-testid="delete-announcement">
            {announcement}
          </p>
          <Field
            label="Type DELETE to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            data-testid="delete-confirm"
            className="sm:max-w-sm"
          />
          {stepUp ? (
            <fieldset
              className="flex flex-col gap-3"
              aria-describedby={hintId}
              data-testid="delete-step-up"
            >
              <legend className="mb-2 text-ui font-semibold">Confirm it’s you</legend>
              <p id={hintId} className="-mt-1 text-ui text-faint" data-testid="delete-step-up-hint">
                You signed in more than a day ago, so we need to check it’s really you before
                deleting your account.
              </p>
              {methods && methods.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {methods.map((m) => (
                    <label
                      key={m}
                      className={cx(
                        'inline-flex h-9 cursor-pointer items-center gap-2 rounded-control border px-3.5 text-ui font-medium transition-colors duration-150',
                        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold',
                        method === m
                          ? 'border-brass/70 bg-brass/10 text-parchment'
                          : 'border-rule-strong text-muted hover:border-parchment/35 hover:text-parchment',
                      )}
                    >
                      <input
                        type="radio"
                        name="delete-step-up"
                        value={m}
                        checked={method === m}
                        onChange={() => choose(m)}
                        className="sr-only"
                        data-testid={`delete-method-${m}`}
                      />
                      {STEP_UP_LABELS[m].icon}
                      {STEP_UP_LABELS[m].label}
                    </label>
                  ))}
                </div>
              ) : null}
              {method === 'password' ? (
                <Field
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="delete-password"
                  className="sm:max-w-sm"
                />
              ) : method === 'passkey' ? (
                <p className="flex items-start gap-2.5 text-ui text-muted">
                  <KeyRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brass" />
                  Your browser will ask for one of this account’s passkeys.
                </p>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <Field
                    key={useBackup ? 'backup' : 'totp'}
                    label={useBackup ? 'Backup code' : 'Code from your authenticator app'}
                    inputMode={useBackup ? 'text' : 'numeric'}
                    autoComplete={useBackup ? 'off' : 'one-time-code'}
                    autoCapitalize={useBackup ? 'characters' : undefined}
                    spellCheck={false}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    hint={useBackup ? 'A backup code works once.' : undefined}
                    data-testid="delete-code"
                    className="w-full sm:max-w-sm"
                  />
                  <button
                    type="button"
                    className={cx(
                      textLinkClass,
                      '-my-1 inline-flex min-h-8 items-center py-1 text-ui',
                    )}
                    onClick={() => {
                      setUseBackup((b) => !b)
                      setCode('')
                    }}
                    data-testid="delete-use-backup"
                  >
                    {useBackup ? 'Use your authenticator app instead' : 'Use a backup code instead'}
                  </button>
                </div>
              )}
            </fieldset>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              variant="danger"
              disabled={!canSubmit}
              busy={busy}
              data-testid="delete-submit"
            >
              {guest
                ? 'Delete guest account'
                : stepUp === 'passkey'
                  ? 'Confirm with passkey and delete'
                  : 'Delete my account'}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                reset()
                setOpen(false)
              }}
              data-testid="delete-cancel"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  )
}
