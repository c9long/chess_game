/**
 * The "⋮" menu beside another player (live player cards, the result screen, history rows, the
 * Friends page): Block / Unblock and Report. Blocking asks first; reporting opens a short form
 * (reason + optional note).
 *
 * Bundle rule: this imports Radix (DropdownMenu, and overlay.tsx), so like `overlay.tsx` it may
 * only be used from lazily loaded code.
 */
import type { PlayerTarget, ReportReasonId } from '@game/protocol'
import { Ban, EllipsisVertical, Flag, ShieldCheck } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import {
  type FormEvent,
  type RefObject,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { ApiError } from '../../lib/api.ts'
import { useAppState } from '../../lib/app-state.tsx'
import { keepFocusNear } from '../../lib/focus-fallback.ts'
import {
  blockPlayer,
  markReported,
  moderationErrorMessage,
  playerMenuItems,
  REPORT_NOTE_MAX,
  REPORT_REASON_OPTIONS,
  reportedVersion,
  reportPlayer,
  subscribeReported,
  unblockPlayer,
  wasReported,
} from '../../lib/moderation.ts'
import { socialNotice } from '../../lib/social.ts'
import { ConfirmDialog, Dialog, DialogClose } from '../overlay.tsx'
import { Alert, Button, cx, inputClass } from '../ui.tsx'

const itemClass =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 text-ui font-medium outline-none select-none data-[highlighted]:bg-parchment/[0.07] data-[disabled]:cursor-default data-[disabled]:text-faint'

export function PlayerMenu({
  name,
  target,
  userId,
  viewerRegistered,
  targetRegistered,
  blocked,
  reportable,
  compact = false,
  testId,
  className,
}: {
  /** The player's shown name. */
  name: string
  /** Who the block or report is about (match + seat, or a user id from the Friends page). */
  target: PlayerTarget
  /** Their user id when known (needed to unblock). */
  userId?: string | undefined
  viewerRegistered: boolean
  targetRegistered: boolean
  /** You blocked this player. */
  blocked: boolean
  reportable: boolean
  /** The small square button of the game screen's player cards. */
  compact?: boolean
  testId?: string
  className?: string
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [dialog, setDialog] = useState<'block' | 'report'>()
  const [busy, setBusy] = useState(false)
  const [blockError, setBlockError] = useState<string>()
  const viewerId = useAppState().session?.user.id ?? ''
  useSyncExternalStore(subscribeReported, reportedVersion, reportedVersion)
  // Already reported in this tab: the server allows one open report per player and game.
  const reported = Boolean(viewerId) && wasReported(viewerId, target)
  const items = playerMenuItems({ viewerRegistered, targetRegistered, blocked, reportable })
  if (items.length === 0) return null

  async function unblock() {
    const restoreFocus = keepFocusNear(trigger.current)
    try {
      await unblockPlayer(userId ? { userId } : target)
      socialNotice({ title: `You unblocked ${name}`, tone: 'success' })
      restoreFocus()
    } catch (err) {
      socialNotice({ title: moderationErrorMessage(err), tone: 'error' })
    }
  }

  return (
    <>
      {/* Not modal: a modal menu hides the rest of the page from screen readers while it
          still holds focusable controls (axe aria-hidden-focus). */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            className={cx(
              // The hit area reaches about 44px tall (and a little wider) for touch, beyond
              // the small visible button.
              'relative inline-flex shrink-0 items-center justify-center border border-rule text-muted transition-colors duration-150 before:absolute before:-inset-x-0.5 hover:border-rule-strong hover:text-parchment data-[state=open]:border-rule-brass data-[state=open]:bg-parchment/[0.07] data-[state=open]:text-parchment',
              compact
                ? 'h-6 w-6 rounded-plate before:-inset-y-2.5'
                : 'h-8 w-8 rounded-control before:-inset-y-1.5',
              className,
            )}
            aria-label={`More for ${name}`}
            title={`More for ${name}`}
            data-testid={testId}
          >
            <EllipsisVertical aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 min-w-52 rounded-panel border border-rule-brass bg-panel p-1.5 text-parchment shadow-lift data-[state=closed]:animate-overlay-out data-[state=open]:animate-pop-in"
            data-testid="player-menu"
          >
            <DropdownMenu.Label className="mb-1 truncate border-b border-rule px-3 pt-1.5 pb-2 font-display text-ui font-semibold text-parchment">
              {name}
            </DropdownMenu.Label>
            {items.includes('block') ? (
              <DropdownMenu.Item
                className={itemClass}
                onSelect={() => {
                  setBlockError(undefined)
                  setDialog('block')
                }}
                data-testid="menu-block"
              >
                <Ban aria-hidden="true" className="h-4 w-4 text-faint" />
                Block
              </DropdownMenu.Item>
            ) : null}
            {items.includes('unblock') ? (
              <DropdownMenu.Item
                className={itemClass}
                onSelect={() => void unblock()}
                data-testid="menu-unblock"
              >
                <ShieldCheck aria-hidden="true" className="h-4 w-4 text-faint" />
                Unblock
              </DropdownMenu.Item>
            ) : null}
            {items.includes('report') ? (
              reported ? (
                <DropdownMenu.Item className={itemClass} disabled data-testid="menu-reported">
                  <Flag aria-hidden="true" className="h-4 w-4" />
                  Reported
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item
                  className={cx(itemClass, 'text-destructive-light')}
                  onSelect={() => setDialog('report')}
                  data-testid="menu-report"
                >
                  <Flag aria-hidden="true" className="h-4 w-4" />
                  Report
                </DropdownMenu.Item>
              )
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <ConfirmDialog
        open={dialog === 'block'}
        onOpenChange={(o) => {
          if (!o) setDialog(undefined)
        }}
        title={`Block ${name}?`}
        description={
          blockError ??
          `You won’t see each other online, and ${name} can’t send you friend requests or challenges. Any friendship or request between you is removed. They aren’t told. Blocking doesn’t remove anyone from a game that is already running.`
        }
        confirmLabel="Block"
        tone="danger"
        busy={busy}
        returnFocusTo={trigger}
        testId="block-dialog"
        confirmTestId="block-confirm"
        onConfirm={async () => {
          setBusy(true)
          // Blocking from a Friends row removes the row and this menu with it.
          const restoreFocus = keepFocusNear(trigger.current)
          try {
            await blockPlayer(target)
            setDialog(undefined)
            socialNotice({ title: `You blocked ${name}`, tone: 'success' })
            restoreFocus()
          } catch (err) {
            setBlockError(moderationErrorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      />
      <ReportDialog
        open={dialog === 'report'}
        onOpenChange={(o) => {
          if (!o) setDialog(undefined)
        }}
        name={name}
        target={target}
        returnFocusTo={trigger}
        onSent={() => {
          if (viewerId) markReported(viewerId, target)
        }}
      />
    </>
  )
}

/** The report form: a reason, an optional note, then a thank-you. */
export function ReportDialog({
  open,
  onOpenChange,
  name,
  target,
  returnFocusTo,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  target: PlayerTarget
  returnFocusTo: RefObject<HTMLElement | null>
  /** The report was accepted (or one was already open): the menu then shows "Reported". */
  onSent?: () => void
}) {
  const [reason, setReason] = useState<ReportReasonId>()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [sent, setSent] = useState(false)
  const noteId = useId()
  const groupId = useId()
  const errorId = useId()
  const firstReason = useRef<HTMLInputElement>(null)
  const reasonMissing = error !== undefined && !reason
  const inGame = 'matchId' in target

  function reset() {
    setReason(undefined)
    setNote('')
    setError(undefined)
    setSent(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!reason) {
      setError('Choose a reason.')
      firstReason.current?.focus()
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await reportPlayer(target, reason, note)
      setSent(true)
      onSent?.()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_REPORTED') onSent?.()
      setError(moderationErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={sent ? 'Report sent' : `Report ${name}`}
      description={
        sent
          ? `Thanks. A moderator will review it. ${name} won’t know who reported them.`
          : `Reports go to the moderators${inGame ? ', with this game attached' : ''}. ${name} won’t know who reported them.`
      }
      returnFocusTo={returnFocusTo}
      onClosed={reset}
      testId={sent ? 'report-sent' : 'report-dialog'}
      actions={
        sent ? (
          <DialogClose>
            <Button data-testid="report-done">Done</Button>
          </DialogClose>
        ) : undefined
      }
    >
      {sent ? null : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <fieldset
            aria-labelledby={groupId}
            {...(reasonMissing ? { 'aria-describedby': errorId } : {})}
          >
            <legend id={groupId} className="mb-2 text-ui font-semibold">
              What’s wrong?
            </legend>
            <div className="flex flex-col gap-2">
              {REPORT_REASON_OPTIONS.map((o, i) => (
                <label
                  key={o.id}
                  className={cx(
                    'flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 transition-colors duration-150',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold',
                    reason === o.id
                      ? 'border-brass/70 bg-brass/10'
                      : 'border-rule-strong hover:border-parchment/35',
                  )}
                >
                  <input
                    ref={i === 0 ? firstReason : undefined}
                    type="radio"
                    name="report-reason"
                    value={o.id}
                    checked={reason === o.id}
                    onChange={() => {
                      setReason(o.id)
                      setError(undefined)
                    }}
                    aria-invalid={reasonMissing || undefined}
                    {...(reasonMissing ? { 'aria-describedby': errorId } : {})}
                    className="mt-1 h-4 w-4 accent-[var(--color-brass)]"
                    data-testid={`report-reason-${o.id}`}
                  />
                  <span>
                    <span className="block text-ui font-semibold">{o.label}</span>
                    <span className="block text-caption text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={noteId} className="mb-1.5 flex justify-between text-ui font-semibold">
              <span>
                Note <span className="font-normal text-faint">(optional)</span>
              </span>
              <span className="font-normal text-faint lining-nums tabular-nums">
                {note.length}/{REPORT_NOTE_MAX}
              </span>
            </label>
            <textarea
              id={noteId}
              value={note}
              maxLength={REPORT_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className={cx(inputClass, 'h-auto resize-y py-2 text-ui')}
              placeholder="What happened? (Moves, times, anything that helps.)"
              data-testid="report-note"
            />
          </div>
          {error ? (
            <div id={errorId}>
              <Alert>{error}</Alert>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose>
              <Button variant="quiet">Cancel</Button>
            </DialogClose>
            <Button type="submit" busy={busy} data-testid="report-send">
              <Flag aria-hidden="true" className="h-4 w-4" />
              Send report
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
