import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Alert, Button, Card, CenteredPage, Field, PageTitle } from '../components/ui.tsx'
import { authErrorMessage } from '../lib/api.ts'
import { displayName, useAppState } from '../lib/app-state.tsx'
import { authClient } from '../lib/auth-client.ts'

/** Friendly names for the device-authorization client ids the server accepts. */
const CLIENT_NAMES: Record<string, string> = {
  'game-unity-client': 'the desktop game app',
}

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

  const clientName = pending?.clientId
    ? (CLIENT_NAMES[pending.clientId] ?? pending.clientId)
    : 'an app'

  return (
    <CenteredPage>
      <Card>
        <PageTitle title="Connect a device" subtitle="Enter the code shown on your other device." />
        {result ? (
          <Alert tone={result === 'approved' ? 'success' : 'info'}>
            {result === 'approved'
              ? 'Device connected. You can return to it now.'
              : 'Request denied. Nothing was connected.'}
          </Alert>
        ) : pending ? (
          <div className="flex flex-col gap-4" data-testid="device-confirm">
            <p className="text-sm leading-relaxed">
              <strong>{clientName}</strong> wants to sign in to your account
              {session ? (
                <>
                  {' '}
                  <strong>{displayName(session.user)}</strong>
                </>
              ) : null}{' '}
              with code <code className="font-mono text-gold">{pending.userCode}</code>.
            </p>
            <Alert tone="info">
              Only approve this if you started signing in on your own device just now. If someone
              sent you this link or code, deny it: approving gives them access to your account.
            </Alert>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-gold"
                data-testid="device-mine"
              />
              I started this sign-in on my own device.
            </label>
            {error ? <Alert>{error}</Alert> : null}
            <div className="flex gap-3">
              <Button busy={busy === 'approve'} disabled={!mine} onClick={() => act('approve')}>
                Approve
              </Button>
              <Button variant="ghost" busy={busy === 'deny'} onClick={() => act('deny')}>
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
              required
            />
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" busy={busy === 'lookup'} disabled={!userCode}>
              Continue
            </Button>
          </form>
        )}
      </Card>
    </CenteredPage>
  )
}
