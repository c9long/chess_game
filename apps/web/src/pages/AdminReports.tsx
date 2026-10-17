/**
 * Moderation review queue (admins only: ADMIN_USER_IDS on the server, which checks every call).
 * Open reports, oldest first, with how often the player was reported; dismiss, or resolve
 * with Warn (recorded only), Reset username, or Suspend. Suspended accounts can be restored.
 */
import type { AdminReport, AdminReportsResponse, ReportResolution } from '@game/protocol'
import { Ban, Check, Copy, Flag, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { relativeTime } from '../components/match/labels.ts'
import { ConfirmDialog } from '../components/overlay.tsx'
import { Alert, Button, CenteredPage, cx, PageTitle, Pill, Spinner } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import {
  dismissReport,
  fetchReportQueue,
  moderationErrorMessage,
  REPORT_REASON_LABEL,
  reportCountsText,
  resolveReport,
  unsuspendUser,
} from '../lib/moderation.ts'

type Pending = { report: AdminReport; action: 'rename' | 'suspend' }

const CONFIRM: Record<Pending['action'], { title: (n: string) => string; body: string }> = {
  rename: {
    title: (n) => `Reset ${n}’s username?`,
    body: 'They show as “Player-1234” until they choose a new username, which they are asked to do at their next visit. Their games and friends stay.',
  },
  suspend: {
    title: (n) => `Suspend ${n}?`,
    body: 'They are signed out everywhere, removed from any lobby, and can’t sign in until you lift the suspension. A game already running goes on. Their match history stays.',
  },
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md border border-parchment/15 px-1.5 py-0.5 font-mono text-[11px] text-parchment/70 hover:border-parchment/35 hover:text-parchment"
      title="Copy the match id"
      onClick={() => {
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {id.slice(0, 8)}
      {copied ? (
        <Check aria-hidden="true" className="h-3 w-3" />
      ) : (
        <Copy aria-hidden="true" className="h-3 w-3" />
      )}
      <span className="sr-only">{copied ? 'Copied' : 'Copy match id'}</span>
    </button>
  )
}

function ReportCard({
  r,
  busy,
  onDismiss,
  onResolve,
}: {
  r: AdminReport
  busy: string | undefined
  onDismiss: () => void
  onResolve: (action: ReportResolution, opener: HTMLElement) => void
}) {
  const u = r.reported
  const renamed = u.reportedName !== null && u.reportedName !== u.name
  const locked = busy !== undefined
  return (
    <li
      className="rounded-2xl border border-parchment/10 bg-panel/80 px-4 py-4 sm:px-5"
      data-testid="admin-report"
      data-reported={u.name}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p className="min-w-0 truncate font-display text-lg font-semibold">{u.name}</p>
        {u.isGuest ? <Pill>Guest</Pill> : null}
        {u.deleted ? <Pill>Deleted</Pill> : null}
        {u.suspendedAt ? <Pill tone="danger">Suspended</Pill> : null}
        <Pill tone="gold" className="ml-auto">
          <Flag aria-hidden="true" className="h-3 w-3" />
          {REPORT_REASON_LABEL[r.reason]}
        </Pill>
      </div>
      {renamed ? (
        <p className="mt-0.5 text-xs text-parchment/60">
          Reported as <span className="font-semibold text-parchment/85">{u.reportedName}</span>
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-parchment/60">
        <time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>
          {relativeTime(r.createdAt)}
        </time>{' '}
        · by {r.reporter.name} ·{' '}
        <span className={cx(u.openReporters > 1 && 'font-semibold text-seat-south-light')}>
          {reportCountsText(u)}
        </span>
      </p>
      {r.note ? (
        <blockquote className="mt-3 rounded-lg border-l-2 border-gold/50 bg-ink/40 px-3 py-2 text-sm break-words whitespace-pre-wrap text-parchment/85">
          {r.note}
        </blockquote>
      ) : null}
      {r.matchId ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-parchment/60">
          Game <CopyId id={r.matchId} />
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          busy={busy === 'dismiss'}
          disabled={locked}
          onClick={onDismiss}
          data-testid="admin-dismiss"
        >
          Dismiss
        </Button>
        <Button
          variant="secondary"
          size="sm"
          busy={busy === 'warn'}
          disabled={locked}
          onClick={(e) => onResolve('warn', e.currentTarget)}
          data-testid="admin-warn"
        >
          <TriangleAlert aria-hidden="true" className="h-4 w-4" />
          Warn
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={locked || u.isGuest || u.deleted}
          title={u.isGuest ? 'Guests have generated names' : undefined}
          onClick={(e) => onResolve('rename', e.currentTarget)}
          data-testid="admin-rename"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset username
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={locked || u.deleted}
          onClick={(e) => onResolve('suspend', e.currentTarget)}
          data-testid="admin-suspend"
        >
          <Ban aria-hidden="true" className="h-4 w-4" />
          {u.suspendedAt ? 'Resolve (suspended)' : 'Suspend'}
        </Button>
      </div>
    </li>
  )
}

export function AdminReports() {
  const [data, setData] = useState<AdminReportsResponse>()
  const [denied, setDenied] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<{ id: string; what: string }>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<Pending>()
  const opener = useRef<HTMLElement | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await fetchReportQueue())
      setLoadError(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setDenied(true)
      else setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(id: string, what: string, fn: () => Promise<unknown>) {
    setBusy({ id, what })
    setError(undefined)
    try {
      await fn()
      await load()
      return true
    } catch (err) {
      setError(moderationErrorMessage(err))
      return false
    } finally {
      setBusy(undefined)
    }
  }

  if (denied) {
    return (
      <CenteredPage>
        <div className="py-10 text-center" data-testid="admin-denied">
          <PageTitle
            title="Moderators only"
            subtitle="This page is for the moderation team. Ask the server owner if you need access."
          />
        </div>
      </CenteredPage>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Review queue</h1>
        {data ? (
          <p className="text-sm text-parchment/60 tabular-nums" data-testid="admin-open-count">
            {data.reports.length} open
          </p>
        ) : null}
      </header>
      <p className="mt-2 text-sm text-parchment/60">
        Open reports, oldest first. Reporters are never shown to the reported player.
      </p>

      {error ? (
        <div className="mt-6">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-6">
          <Alert>Could not load the queue. Please try again later.</Alert>
        </div>
      ) : !data ? (
        <div className="mt-10 flex justify-center text-parchment/60">
          <Spinner />
        </div>
      ) : (
        <>
          {data.reports.length === 0 ? (
            <div
              className="mt-8 rounded-2xl border border-dashed border-parchment/15 px-6 py-12 text-center text-parchment/60"
              data-testid="admin-empty"
            >
              <ShieldCheck aria-hidden="true" className="mx-auto mb-3 h-9 w-9 text-parchment/40" />
              No open reports.
            </div>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {data.reports.map((r) => (
                <ReportCard
                  key={r.id}
                  r={r}
                  busy={busy?.id === r.id ? busy.what : undefined}
                  onDismiss={() => void run(r.id, 'dismiss', () => dismissReport(r.id))}
                  onResolve={(action, el) => {
                    if (action === 'warn') {
                      void run(r.id, 'warn', () => resolveReport(r.id, 'warn'))
                      return
                    }
                    opener.current = el
                    setPending({ report: r, action })
                  }}
                />
              ))}
            </ul>
          )}

          <section className="mt-10" aria-labelledby="suspended-title">
            <h2 id="suspended-title" className="mb-3 font-display text-lg font-semibold">
              Suspended accounts
              <span className="ml-2 text-sm font-normal text-parchment/50 tabular-nums">
                {data.suspended.length}
              </span>
            </h2>
            {data.suspended.length === 0 ? (
              <p className="text-sm text-parchment/55">Nobody is suspended.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.suspended.map((s) => (
                  <li
                    key={s.userId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-seat-south/30 bg-panel/80 px-4 py-3"
                    data-testid="suspended-row"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{s.name}</p>
                      <p className="text-xs text-parchment/55">
                        Suspended {relativeTime(s.suspendedAt)}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      busy={busy?.id === s.userId}
                      disabled={busy !== undefined}
                      onClick={() => void run(s.userId, 'unsuspend', () => unsuspendUser(s.userId))}
                      data-testid="admin-unsuspend"
                    >
                      Lift suspension
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={pending !== undefined}
        onOpenChange={(o) => {
          if (!o) setPending(undefined)
        }}
        title={pending ? CONFIRM[pending.action].title(pending.report.reported.name) : ''}
        description={pending ? (error ?? CONFIRM[pending.action].body) : undefined}
        confirmLabel={pending?.action === 'suspend' ? 'Suspend' : 'Reset username'}
        tone="danger"
        busy={busy !== undefined}
        returnFocusTo={opener}
        testId="admin-confirm-dialog"
        confirmTestId="admin-confirm"
        onConfirm={async () => {
          if (!pending) return
          const { report, action } = pending
          if (await run(report.id, action, () => resolveReport(report.id, action))) {
            setPending(undefined)
          }
        }}
      />
    </div>
  )
}
