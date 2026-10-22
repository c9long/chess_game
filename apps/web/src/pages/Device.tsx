import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AuthCard } from '../components/AuthCard.tsx'
import { Alert, Button, Field } from '../components/ui.tsx'
import { authErrorMessage } from '../lib/api.ts'
import { displayName, useAppState } from '../lib/app-state.tsx'
import { authClient } from '../lib/auth-client.ts'
import { deviceClientName } from '../lib/device-clients.ts'

interface Pending {
  userCode: string
  clientId: string | undefined
  status: string
}

/**
 * Approves a device-authorization sign-in (e.g. the desktop client) by its user code. Two
 * steps, so a link with a code in it can't be approved in one click: look the request up,
 * then confirm it after seeing which app is asking and a warning to only approve your own.
 */
export function Device() {
  const { session } = useAppState()
  const [params] = useSearchParams()
  const [code, setCode] = useState(params.get('user_code') ?? '')
  const [pending, setPending] = useState<Pending>()
  const [mine, setMine] = useState(false)
  const [busy, setBusy] = useState<'lookup' | 'approve' | 'deny'>()
  const [result, setResult] = useState<'approved' | 'denied'>()
  const [error, setError] = useState<string>()
  const userCode = code.replace(/[\s-]/g, '').toUpperCase()

  async function lookup(e: FormEvent) {
    e.preventDefault()
    setBusy('lookup')
    setError(undefined)
    const { data, error: err } = await authClient.device({ query: { user_code: userCode } })
    setBusy(undefined)
    if (err || !data) {
      setError(
        err?.status === 400
          ? 'That code is invalid or has expired. Start again on your device.'
          : authErrorMessage(err),
      )
      return
    }
    const d = data as { status: string; client_id?: string }
    if (d.status !== 'pending') {
      setError('This request has already been handled. Start again on your device.')
      return
    }
    setPending({ userCode, clientId: d.client_id, status: d.status })
  }

  async function act(kind: 'approve' | 'deny') {
    if (!pending) return
    setBusy(kind)
    setError(undefined)
    const { error: err } =
      kind === 'approve'
        ? await authClient.device.approve({ userCode: pending.userCode })
        : await authClient.device.deny({ userCode: pending.userCode })
    setBusy(undefined)
    if (err) setError(authErrorMessage(err))
    else setResult(kind === 'approve' ? 'approved' : 'denied')
  }

  // Sentence start: "The desktop game app", "An app" (an unknown client id stays as it is).
  const clientName = (pending?.clientId ? deviceClientName(pending.clientId) : 'an app').replace(
    /^(the|an) /,
    (m) => m.charAt(0).toUpperCase() + m.slice(1),
  )

  return (
    <AuthCard
      title="Connect a device"
      subtitle={
        result
          ? undefined
          : pending
            ? 'Check the request before you approve it.'
            : 'Enter the code shown on your other device.'
      }
    >
      {result ? (
        <Alert tone={result === 'approved' ? 'success' : 'info'}>
          {result === 'approved'
            ? 'Device connected. You can return to it now.'
            : 'Request denied. Nothing was connected.'}
        </Alert>
      ) : pending ? (
        <div className="flex flex-col gap-5" data-testid="device-confirm">
          <p className="text-body text-pretty">
            <strong className="font-semibold">{clientName}</strong> wants to sign in to your
            account.
          </p>
          <dl className="divide-y divide-rule border-y border-rule text-ui">
            {session ? (
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-faint">Account</dt>
                <dd className="min-w-0 truncate font-display text-body font-semibold">
                  {displayName(session.user)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-faint">Code</dt>
              <dd className="text-body font-semibold tracking-[0.08em] tabular-nums">
                {pending.userCode}
              </dd>
            </div>
          </dl>
          <Alert tone="warning">
            Only approve this if you started signing in on your own device just now. If someone sent
            you this link or code, deny it: approving gives them access to your account.
          </Alert>
          <label className="flex cursor-pointer items-start gap-3 text-ui text-parchment">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
              className="checkbox mt-0.5"
              data-testid="device-mine"
            />
            I started this sign-in on my own device.
          </label>
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
            <Button
              size="lg"
              className="sm:flex-1"
              busy={busy === 'approve'}
              disabled={!mine}
              onClick={() => act('approve')}
            >
              Approve
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="sm:flex-1"
              busy={busy === 'deny'}
              onClick={() => act('deny')}
            >
              Deny
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={lookup} className="flex flex-col gap-4">
          <Field
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            hint="It looks like ABCD-EFGH."
            required
          />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" size="lg" busy={busy === 'lookup'} disabled={!userCode}>
            Continue
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
