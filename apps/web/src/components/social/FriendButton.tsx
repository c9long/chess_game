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

/** Per state: border, background and text. */
const TONE: Record<Shown, string> = {
  add: 'border-gold/45 text-gold enabled:hover:bg-gold/10',
  // They asked you: the one filled button, so it stands apart from "Add".
  accept: 'border-gold bg-gold text-ink enabled:hover:bg-gold-bright',
  sent: 'border-parchment/20 text-parchment/70',
  friends: 'border-seat-east/40 text-seat-east-light',
  friendsFull: 'border-parchment/15 text-parchment/60',
  pendingFull: 'border-parchment/15 text-parchment/60',
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
  className?: string
  testId?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [optimistic, setOptimistic] = useState<Shown>()
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
    try {
      const res = (await (shown === 'accept' ? onAccept() : onAdd())) as
        | { relation?: string }
        | undefined
      setOptimistic(shown === 'accept' || res?.relation === 'friends' ? 'friends' : 'sent')
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
      <button
        type="button"
        className={cx(
          'inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 rounded-md border text-[11px] font-semibold whitespace-nowrap transition-colors lg:px-1.5',
          'disabled:cursor-default',
          TONE[shown],
          className,
        )}
        onClick={click}
        disabled={!actionable || busy}
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
    )
  }

  return (
    <span className={cx('inline-flex flex-col items-end gap-0.5', className)}>
      <button
        type="button"
        className={cx(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors',
          'disabled:cursor-default',
          TONE[shown],
        )}
        onClick={click}
        disabled={!actionable || busy}
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
      {error ? (
        <span role="alert" className="max-w-48 text-right text-[11px] text-seat-south-light">
          {error}
        </span>
      ) : null}
    </span>
  )
}
