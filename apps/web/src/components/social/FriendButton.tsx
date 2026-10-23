import { Send, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type SeatRelation, socialErrorMessage, socialNotice } from '../../lib/social.ts'
import { cx, Spinner } from '../ui.tsx'

type Shown = 'add' | 'sent' | 'accept' | 'friends' | 'friendsFull' | 'pendingFull'

function shownState(
  relation: SeatRelation,
  capReached: boolean,
  outgoingFull: boolean,
): Shown | null {
  switch (relation) {
    case 'friends':
      return 'friends'
    case 'outgoing':
      return 'sent'
    case 'incoming':
      // Accepting doesn't add an outgoing request, so only the friends cap blocks it.
      return capReached ? 'friendsFull' : 'accept'
    case 'none':
      return capReached ? 'friendsFull' : outgoingFull ? 'pendingFull' : 'add'
    default:
      return null
  }
}

/** Full labels (text buttons from 640px, and every accessible name). */
const LABEL: Record<Shown, string> = {
  add: 'Add friend',
  sent: 'Request sent',
  accept: 'Accept request',
  friends: 'Friends',
  friendsFull: 'Friends full',
  pendingFull: 'Too many pending',
}

/** Short labels (phones, and the game screen's player cards on wide screens). */
const SHORT: Record<Shown, string> = {
  add: 'Add',
  sent: 'Sent',
  accept: 'Accept',
  friends: 'Friends',
  friendsFull: 'Full',
  pendingFull: 'Pending',
}

const ICON = {
  add: UserPlus,
  sent: Send,
  accept: UserCheck,
  friends: UserCheck,
  friendsFull: UserX,
  pendingFull: UserX,
} as const

/** Per state: border, background and text. Brass outline to act, gold when they asked you. */
const TONE: Record<Shown, string> = {
  add: 'border-rule-brass bg-parchment/[0.03] text-parchment not-aria-disabled:hover:border-brass/60 not-aria-disabled:hover:bg-parchment/[0.07]',
  // They asked you: gold text and edge (not a fill: the screen's one gold button is elsewhere).
  accept: 'border-gold/70 bg-gold/10 text-gold-bright not-aria-disabled:hover:bg-gold/20',
  sent: 'border-rule text-muted',
  friends: 'border-ok/35 text-ok',
  friendsFull: 'border-rule text-faint',
  pendingFull: 'border-rule text-faint',
}

/**
 * A player's monogram: their initial in Fraunces on an enamel disc with a brass rim, the same
 * for everyone (names, not colours, tell people apart). `online` adds a presence dot.
 */
export function Monogram({
  name,
  online,
  size = 'md',
}: {
  name: string
  online?: boolean | undefined
  size?: 'sm' | 'md' | 'lg'
}) {
  const dims = {
    sm: 'h-8 w-8 text-ui',
    md: 'h-10 w-10 text-body',
    lg: 'h-16 w-16 text-title sm:h-20 sm:w-20',
  }[size]
  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden="true"
        className={cx(
          'flex items-center justify-center rounded-full border border-rule-brass font-display font-semibold text-parchment shadow-plate',
          'bg-[radial-gradient(circle_at_35%_30%,#3a352e,#26231f_70%)]',
          dims,
        )}
      >
        {([...name][0] ?? '?').toUpperCase()}
      </span>
      {online === undefined ? null : (
        <span
          aria-hidden="true"
          className={cx(
            'absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-surface',
            online ? 'bg-ok' : 'bg-parchment/30',
          )}
        />
      )}
    </span>
  )
}

/**
 * "Add friend" for another player you are playing or have played with, and what became of it:
 * Request sent, Accept (they asked you), Friends, Friends full (your 50-friend cap), Too many
 * pending (10 requests waiting). `compact` is the small button of the game screen's player
 * cards (icon on phones, short text on wide screens); otherwise a text pill (short text on
 * phones with `shortOnPhones`).
 */
export function FriendButton({
  name,
  relation,
  capReached,
  outgoingFull,
  onAdd,
  onAccept,
  compact = false,
  shortOnPhones = false,
  size = 'sm',
  className,
  testId,
}: {
  /** The other player's name (for the accessible label). */
  name: string
  relation: SeatRelation
  capReached: boolean
  outgoingFull: boolean
  onAdd: () => Promise<unknown>
  onAccept: () => Promise<unknown>
  compact?: boolean
  /** Short text below 640px (tight rows such as the result screen). */
  shortOnPhones?: boolean
  /** `sm` sits in a line of text (history, search results); `md` matches a small Button. */
  size?: 'sm' | 'md'
  className?: string
  testId?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [optimistic, setOptimistic] = useState<Shown>()
  /** Said once by a polite live region after a click works (the button keeps focus). */
  const [announced, setAnnounced] = useState('')
  const base = shownState(relation, capReached, outgoingFull)
  // A fresh answer from the server replaces the optimistic one (e.g. a request declined).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the server state changes
  useEffect(() => {
    setOptimistic(undefined)
    setError(undefined)
  }, [base])
  if (!base) return null
  // Show the answer right away; the next relations refresh confirms it.
  const shown = optimistic && base !== 'friends' ? optimistic : base
  const actionable = shown === 'add' || shown === 'accept'
  const title =
    error ??
    (shown === 'friendsFull'
      ? 'You have reached the friends limit. Remove a friend to add another.'
      : shown === 'pendingFull'
        ? 'Too many of your friend requests are waiting. Cancel one on the Friends page.'
        : shown === 'sent'
          ? `Friend request sent to ${name}`
          : shown === 'friends'
            ? `You and ${name} are friends`
            : shown === 'accept'
              ? `${name} asked to be friends`
              : `Send ${name} a friend request`)

  async function click() {
    if (!actionable || busy) return
    setBusy(true)
    setError(undefined)
    setAnnounced('')
    try {
      const res = (await (shown === 'accept' ? onAccept() : onAdd())) as
        | { relation?: string }
        | undefined
      const next = shown === 'accept' || res?.relation === 'friends' ? 'friends' : 'sent'
      setOptimistic(next)
      setAnnounced(
        next === 'friends' ? `You and ${name} are now friends.` : `Friend request sent to ${name}.`,
      )
    } catch (err) {
      const message = socialErrorMessage(err)
      setError(message)
      // The card button has no room for the message: say it in a toast.
      if (compact) socialNotice({ title: message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const Icon = ICON[shown]
  const icon = busy ? (
    <Spinner />
  ) : (
    <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
  )

  if (compact) {
    return (
      <>
        <button
          type="button"
          className={cx(
            'inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 rounded-plate border text-caption font-semibold whitespace-nowrap transition-colors lg:px-1.5',
            'aria-disabled:cursor-default',
            TONE[shown],
            className,
          )}
          onClick={click}
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the page
          // when a click turns it into "Request sent" or "Friends".
          aria-disabled={!actionable || busy || undefined}
          aria-label={`${LABEL[shown]}: ${name}`}
          title={title}
          data-testid={testId}
          data-state={shown}
        >
          {icon}
          <span aria-hidden="true" className="hidden lg:inline">
            {SHORT[shown]}
          </span>
        </button>
        <span role="status" className="sr-only">
          {announced}
        </span>
      </>
    )
  }

  return (
    <span className={cx('inline-flex flex-col items-end gap-0.5', className)}>
      <button
        type="button"
        className={cx(
          'inline-flex shrink-0 items-center gap-1.5 rounded-control border font-semibold whitespace-nowrap transition-colors duration-150',
          size === 'md' ? 'h-9 px-3 text-ui' : 'h-7 px-2.5 text-caption',
          'aria-disabled:cursor-default',
          TONE[shown],
        )}
        onClick={click}
        // aria-disabled, not disabled: a disabled button drops keyboard focus to the page
        // when a click turns it into "Request sent" or "Friends".
        aria-disabled={!actionable || busy || undefined}
        aria-label={`${LABEL[shown]}: ${name}`}
        title={title}
        data-testid={testId}
        data-state={shown}
      >
        {icon}
        {shortOnPhones ? (
          <>
            <span aria-hidden="true" className="sm:hidden">
              {SHORT[shown]}
            </span>
            <span aria-hidden="true" className="hidden sm:inline">
              {LABEL[shown]}
            </span>
          </>
        ) : (
          <span aria-hidden="true">{LABEL[shown]}</span>
        )}
      </button>
      <span role="status" className="sr-only">
        {announced}
      </span>
      {error ? (
        <span role="alert" className="max-w-56 text-right text-caption text-destructive-light">
          {error}
        </span>
      ) : null}
    </span>
  )
}
