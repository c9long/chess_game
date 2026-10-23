/**
 * Moderation review queue (admins only: ADMIN_USER_IDS on the server, which checks every call).
 * Open reports, oldest first, with how often the player was reported; dismiss, or resolve
 * with Warn (recorded only), Reset username, or Suspend. Suspended accounts can be restored.
 */
import { APP_NAME } from '@game/config'
import type { AdminReport, AdminReportsResponse, ReportResolution } from '@game/protocol'
import { Ban, Check, Copy, Flag, RotateCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { relativeTime } from '../components/match/labels.ts'
import { ConfirmDialog } from '../components/overlay.tsx'
import {
  Alert,
  Button,
  cx,
  EmptyState,
  linkButtonClass,
  NoticePage,
  PageTitle,
  Pill,
  RuleList,
  RuleRow,
  SectionHeading,
  Spinner,
} from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { keepFocusNear } from '../lib/focus-fallback.ts'
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

/** The confirm text: `suspended` is a report about a player who is already suspended. */
type ConfirmKind = Pending['action'] | 'suspended'

const CONFIRM: Record<
  ConfirmKind,
  { title: (n: string) => string; body: string; confirm: string }
> = {
  rename: {
    title: (n) => `Reset ${n}’s username?`,
    body: 'They show as “Player-1234” until they choose a new username, which they are asked to do at their next visit. Nobody can take the old name for a year. Their games and friends stay. Their other open username reports are closed too.',
    confirm: 'Reset username',
  },
  suspend: {
    title: (n) => `Suspend ${n}?`,
    body: 'They are signed out everywhere, removed from any lobby, and can’t sign in until you lift the suspension. A game already running goes on. Their match history stays. Their other open reports are closed too.',
    confirm: 'Suspend',
  },
  suspended: {
    title: () => 'Close this report?',
    body: 'They are already suspended. The report is closed as “suspended”; nothing else changes.',
    confirm: 'Close report',
  },
}

const confirmKind = (p: Pending): ConfirmKind =>
  p.action === 'suspend' && p.report.reported.suspendedAt ? 'suspended' : p.action

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex min-h-7 items-center gap-1.5 rounded-plate border border-rule-strong px-2 py-1 text-caption text-muted [font-feature-settings:'tnum','zero','ss02'] transition-colors duration-150 hover:border-parchment/35 hover:text-parchment"
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
  onDismiss: (opener: HTMLElement) => void
  onResolve: (action: ReportResolution, opener: HTMLElement) => void
}) {
  const u = r.reported
  const renamed = u.reportedName !== null && u.reportedName !== u.name
  const locked = busy !== undefined
  return (
    <li className="flex flex-col gap-4 py-5" data-testid="admin-report" data-reported={u.name}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <p className="min-w-0 truncate font-display text-lead font-semibold">{u.name}</p>
          {u.isGuest ? <Pill>Guest</Pill> : null}
          {u.deleted ? <Pill>Deleted</Pill> : null}
          {u.suspendedAt ? <Pill tone="danger">Suspended</Pill> : null}
        </div>
        {renamed ? (
          <p className="mt-0.5 text-ui text-faint">
            Reported as <span className="font-semibold text-muted">{u.reportedName}</span>
          </p>
        ) : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui">
          <span className="inline-flex items-center gap-1.5 font-semibold text-parchment">
            <Flag aria-hidden="true" className="h-3.5 w-3.5 text-brass" />
            {REPORT_REASON_LABEL[r.reason]}
          </span>
          <span className="text-faint">
            by {r.reporter.name},{' '}
            <time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>
              {relativeTime(r.createdAt)}
            </time>
          </span>
        </p>
        <p
          className={cx(
            'mt-0.5 text-ui',
            u.openReporters > 1 ? 'font-semibold text-warn' : 'text-faint',
          )}
        >
          {reportCountsText(u)}
        </p>
        {r.note ? (
          <blockquote className="mt-3 max-w-[65ch] border-l-2 border-brass/60 py-0.5 pl-3 text-body break-words whitespace-pre-wrap text-muted">
            {r.note}
          </blockquote>
        ) : null}
        {r.matchId ? (
          <p className="mt-3 flex items-center gap-2 text-ui text-faint">
            Game <CopyId id={r.matchId} />
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="quiet"
          size="sm"
          busy={busy === 'dismiss'}
          disabled={locked}
          onClick={(e) => onDismiss(e.currentTarget)}
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
        {u.suspendedAt ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={locked}
            onClick={(e) => onResolve('suspend', e.currentTarget)}
            data-testid="admin-suspend"
          >
            <Ban aria-hidden="true" className="h-4 w-4" />
            Close, already suspended
          </Button>
        ) : (
          <Button
            variant="danger"
            size="sm"
            disabled={locked || u.deleted || u.isGuest}
            title={
              u.isGuest
                ? 'Guests can start a new guest session, so they can’t be suspended'
                : undefined
            }
            onClick={(e) => onResolve('suspend', e.currentTarget)}
            data-testid="admin-suspend"
          >
            <Ban aria-hidden="true" className="h-4 w-4" />
            Suspend
          </Button>
        )}
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

  // The tab title follows the heading when access is refused (App sets "Review queue").
  useEffect(() => {
    if (denied) document.title = `Moderators only · ${APP_NAME}`
  }, [denied])

  /**
   * Runs an action. `from` is the control it came from: when the action removes that row,
   * focus moves to the report now in its place (or the next one up), else the heading.
   */
  async function run(id: string, what: string, fn: () => Promise<unknown>, from?: HTMLElement) {
    setBusy({ id, what })
    setError(undefined)
    const index = data?.reports.findIndex((r) => r.id === id) ?? -1
    const restoreFocus = keepFocusNear(from, () => {
      const cards = document.querySelectorAll<HTMLElement>('[data-testid="admin-report"]')
      if (index >= 0) return cards[Math.min(index, cards.length - 1)]
      return document.getElementById('suspended-title')
    })
    try {
      await fn()
      await load()
      restoreFocus()
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
      <NoticePage
        testId="admin-denied"
        title="Moderators only"
        action={
          <Link to="/play" className={linkButtonClass('primary')}>
            Back to Play
          </Link>
        }
      >
        This page is for the moderation team. Ask the server owner if you need access.
      </NoticePage>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:py-14 [&>header]:mb-0">
      <PageTitle
        title="Review queue"
        subtitle="Open reports, oldest first. Reporters are never shown to the reported player."
        actions={
          data ? (
            <p
              className="text-ui text-muted lining-nums tabular-nums"
              data-testid="admin-open-count"
            >
              {data.reports.length} open
            </p>
          ) : null
        }
      />

      {error ? <Alert>{error}</Alert> : null}

      {loadError ? (
        <Alert>The queue didn’t load. Check your connection and reload the page.</Alert>
      ) : !data ? (
        <div className="flex justify-center py-10 text-faint" role="status">
          <Spinner />
          <span className="sr-only">Loading the queue…</span>
        </div>
      ) : (
        <>
          <section aria-labelledby="reports-title">
            <SectionHeading id="reports-title" title="Reports" />
            {data.reports.length === 0 ? (
              <div data-testid="admin-empty">
                <EmptyState title="No open reports">
                  New reports from players show up here, oldest first.
                </EmptyState>
              </div>
            ) : (
              <RuleList>
                {data.reports.map((r) => (
                  <ReportCard
                    key={r.id}
                    r={r}
                    busy={busy?.id === r.id ? busy.what : undefined}
                    onDismiss={(el) => void run(r.id, 'dismiss', () => dismissReport(r.id), el)}
                    onResolve={(action, el) => {
                      if (action === 'warn') {
                        void run(r.id, 'warn', () => resolveReport(r.id, 'warn'), el)
                        return
                      }
                      opener.current = el
                      setPending({ report: r, action })
                    }}
                  />
                ))}
              </RuleList>
            )}
          </section>

          <section aria-labelledby="suspended-title">
            <SectionHeading
              id="suspended-title"
              title={
                <>
                  Suspended accounts
                  <span className="ml-2 font-sans text-ui font-normal text-faint lining-nums tabular-nums">
                    {data.suspended.length}
                  </span>
                </>
              }
            />
            {data.suspended.length === 0 ? (
              <p className="border-y border-rule py-4 text-ui text-muted">Nobody is suspended.</p>
            ) : (
              <RuleList>
                {data.suspended.map((s) => (
                  <RuleRow
                    key={s.userId}
                    data-testid="suspended-row"
                    name
                    title={s.name}
                    detail={`Suspended ${relativeTime(s.suspendedAt)}`}
                    trailing={
                      <Button
                        variant="secondary"
                        size="sm"
                        busy={busy?.id === s.userId}
                        disabled={busy !== undefined}
                        onClick={(e) =>
                          void run(
                            s.userId,
                            'unsuspend',
                            () => unsuspendUser(s.userId),
                            e.currentTarget,
                          )
                        }
                        data-testid="admin-unsuspend"
                      >
                        Lift suspension
                      </Button>
                    }
                  />
                ))}
              </RuleList>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={pending !== undefined}
        onOpenChange={(o) => {
          if (!o) setPending(undefined)
        }}
        title={pending ? CONFIRM[confirmKind(pending)].title(pending.report.reported.name) : ''}
        description={pending ? (error ?? CONFIRM[confirmKind(pending)].body) : undefined}
        confirmLabel={pending ? CONFIRM[confirmKind(pending)].confirm : ''}
        tone={pending && confirmKind(pending) === 'suspended' ? 'default' : 'danger'}
        busy={busy !== undefined}
        returnFocusTo={opener}
        testId="admin-confirm-dialog"
        confirmTestId="admin-confirm"
        onConfirm={async () => {
          if (!pending) return
          const { report, action } = pending
          const from = opener.current ?? undefined
          if (await run(report.id, action, () => resolveReport(report.id, action), from)) {
            setPending(undefined)
          }
        }}
      />
    </div>
  )
}
