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
import { type FormEvent, type RefObject, useId, useRef, useState } from 'react'
import {
  blockPlayer,
  moderationErrorMessage,
  playerMenuItems,
  REPORT_NOTE_MAX,
  REPORT_REASON_OPTIONS,
  reportPlayer,
  unblockPlayer,
} from '../../lib/moderation.ts'
import { socialNotice } from '../../lib/social.ts'
import { ConfirmDialog, Dialog, DialogClose } from '../overlay.tsx'
import { Alert, Button, cx } from '../ui.tsx'

const itemClass =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium outline-none select-none data-[highlighted]:bg-parchment/[0.07] data-[disabled]:opacity-50'

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
  const items = playerMenuItems({ viewerRegistered, targetRegistered, blocked, reportable })
  if (items.length === 0) return null

  async function unblock() {
    try {
      await unblockPlayer(userId ? { userId } : target)
      socialNotice({ title: `You unblocked ${name}`, tone: 'success' })
    } catch (err) {
      socialNotice({ title: moderationErrorMessage(err), tone: 'error' })
    }
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            className={cx(
              'inline-flex shrink-0 items-center justify-center border text-parchment/65 transition-colors hover:text-parchment data-[state=open]:bg-parchment/10 data-[state=open]:text-parchment',
              compact
                ? 'h-6 w-6 rounded-md border-parchment/15 hover:border-parchment/35'
                : 'h-7 w-7 rounded-full border-parchment/15 hover:border-parchment/35',
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
            className="z-50 min-w-48 rounded-xl border border-parchment/10 bg-panel p-1.5 text-parchment shadow-xl shadow-black/50 data-[state=closed]:animate-overlay-out data-[state=open]:animate-pop-in"
            data-testid="player-menu"
          >
            <DropdownMenu.Label className="truncate px-3 pt-1.5 pb-1 text-xs text-parchment/50">
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
                <Ban aria-hidden="true" className="h-4 w-4 text-parchment/60" />
                Block
              </DropdownMenu.Item>
            ) : null}
            {items.includes('unblock') ? (
              <DropdownMenu.Item
                className={itemClass}
                onSelect={() => void unblock()}
                data-testid="menu-unblock"
              >
                <ShieldCheck aria-hidden="true" className="h-4 w-4 text-parchment/60" />
                Unblock
              </DropdownMenu.Item>
            ) : null}
            {items.includes('report') ? (
              <DropdownMenu.Item
                className={cx(itemClass, 'text-seat-south-light')}
                onSelect={() => setDialog('report')}
                data-testid="menu-report"
              >
                <Flag aria-hidden="true" className="h-4 w-4" />
                Report
              </DropdownMenu.Item>
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
          try {
            await blockPlayer(target)
            setDialog(undefined)
            socialNotice({ title: `You blocked ${name}`, tone: 'success' })
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  target: PlayerTarget
  returnFocusTo: RefObject<HTMLElement | null>
}) {
  const [reason, setReason] = useState<ReportReasonId>()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [sent, setSent] = useState(false)
  const noteId = useId()
  const groupId = useId()
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
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await reportPlayer(target, reason, note)
      setSent(true)
    } catch (err) {
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
          <fieldset aria-labelledby={groupId}>
            <legend id={groupId} className="mb-2 text-sm font-semibold">
              What’s wrong?
            </legend>
            <div className="flex flex-col gap-2">
              {REPORT_REASON_OPTIONS.map((o) => (
                <label
                  key={o.id}
                  className={cx(
                    'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                    reason === o.id
                      ? 'border-gold bg-gold/10'
                      : 'border-parchment/15 hover:border-parchment/35',
                  )}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={o.id}
                    checked={reason === o.id}
                    onChange={() => {
                      setReason(o.id)
                      setError(undefined)
                    }}
                    className="mt-1 accent-[var(--color-gold)]"
                    data-testid={`report-reason-${o.id}`}
                  />
                  <span>
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-xs text-parchment/60">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={noteId} className="mb-1.5 flex justify-between text-sm font-semibold">
              <span>
                Note <span className="font-normal text-parchment/50">(optional)</span>
              </span>
              <span className="font-normal text-parchment/50 tabular-nums">
                {note.length}/{REPORT_NOTE_MAX}
              </span>
            </label>
            <textarea
              id={noteId}
              value={note}
              maxLength={REPORT_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-xl border border-parchment/15 bg-ink/40 px-3 py-2 text-sm text-parchment placeholder:text-parchment/35 focus:border-gold focus:outline-none"
              placeholder="What happened? (Moves, times, anything that helps.)"
              data-testid="report-note"
            />
          </div>
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose>
              <Button variant="ghost">Cancel</Button>
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
