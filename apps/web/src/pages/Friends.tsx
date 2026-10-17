import { TIME_CONTROLS } from '@game/config'
import {
  type BlockedUser,
  CHALLENGE_MAX_INVITEES,
  type Challenge,
  type Friend,
} from '@game/protocol'
import { Swords, UserPlus, Users, UserX } from 'lucide-react'
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Link, useNavigate } from 'react-router'
import { MODE_LABEL, relativeTime } from '../components/match/labels.ts'
import { ConfirmDialog, Dialog, DialogClose } from '../components/overlay.tsx'
import { PlayerMenu } from '../components/social/PlayerMenu.tsx'
import { Alert, Button, cx, linkButtonClass, Spinner } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'
import { useMatchStore } from '../lib/match.ts'
import { moderationErrorMessage, unblockPlayer } from '../lib/moderation.ts'
import {
  acceptFriendRequest,
  cancelChallenge,
  cancelFriendRequest,
  challengeSummary,
  createChallenge,
  declineChallenge,
  declineFriendRequest,
  dropChallenge,
  refreshChallenges,
  refreshFriends,
  removeFriend,
  socialErrorMessage,
  useSocial,
} from '../lib/social.ts'

const AVATAR_COLORS = ['#c0392b', '#2e6fd6', '#d4a017', '#1f9d6b', '#8e5bd6', '#d6662e']

/** A round initial in a colour picked from the name (same name, same colour). */
function Avatar({ name, online }: { name: string; online?: boolean | undefined }) {
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length] as string
  return (
    <span className="relative shrink-0">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full font-display text-base font-semibold uppercase"
        style={{ backgroundColor: `${color}2e`, color, boxShadow: `inset 0 0 0 1px ${color}55` }}
      >
        {[...name][0] ?? '?'}
      </span>
      {online === undefined ? null : (
        <span
          aria-hidden="true"
          className={cx(
            'absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-panel',
            online ? 'bg-[#3ecf8e]' : 'bg-parchment/30',
          )}
        />
      )}
    </span>
  )
}

function Section({
  title,
  count,
  action,
  children,
  testId,
}: {
  title: string
  count?: number | undefined
  action?: ReactNode
  children: ReactNode
  testId?: string
}) {
  const id = useId()
  return (
    <section className="mt-8" aria-labelledby={id} data-testid={testId}>
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <h2 id={id} className="font-display text-lg font-semibold">
          {title}
          {count !== undefined ? (
            <span className="ml-2 text-sm font-normal text-parchment/50 tabular-nums">{count}</span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const rowClass =
  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-parchment/10 bg-panel/80 px-4 py-3'

function useCountdown(iso: string): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function IncomingChallenge({ c, me }: { c: Challenge; me: string }) {
  const navigate = useNavigate()
  const left = useCountdown(c.expiresAt)
  const [busy, setBusy] = useState(false)
  return (
    <li className={cx(rowClass, 'border-gold/40 bg-gradient-to-r from-gold/10 to-panel/80')}>
      <Avatar name={c.from.username} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{c.from.username} challenges you</p>
        <p className="text-xs text-parchment/60">
          {challengeSummary(c, me)} Expires in{' '}
          <span className="font-mono tabular-nums text-parchment/80">{left}</span>.
        </p>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          busy={busy}
          onClick={async () => {
            setBusy(true)
            await declineChallenge(c.id).catch(() => {})
            setBusy(false)
          }}
        >
          Decline
        </Button>
        <Button
          size="sm"
          className="flex-1 sm:flex-none"
          data-testid="friends-challenge-join"
          onClick={() => {
            dropChallenge(c.id)
            navigate(`/match/${c.roomId}`)
          }}
        >
          Join lobby
        </Button>
      </div>
    </li>
  )
}

const INVITEE_STATUS: Record<string, string> = {
  pending: 'Invited',
  declined: 'Declined',
  joined: 'Joined',
  expired: 'Expired',
}

function OutgoingChallenge({ c }: { c: Challenge }) {
  const left = useCountdown(c.expiresAt)
  return (
    <li className={cx(rowClass, 'border-seat-west/40')}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-seat-west/15 text-[#8fb4f0]">
        <Swords aria-hidden="true" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Your challenge</p>
        <p className="text-xs text-parchment/60">
          {MODE_LABEL[c.mode]} · {c.timeControl} · open for{' '}
          <span className="font-mono tabular-nums">{left}</span>
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {c.invitees.map((i) => (
            <li
              key={i.user.userId ?? i.user.username}
              className={cx(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                i.status === 'joined'
                  ? 'border-seat-east/40 text-seat-east-light'
                  : i.status === 'declined'
                    ? 'border-seat-south/40 text-seat-south-light'
                    : 'border-parchment/15 text-parchment/70',
              )}
            >
              {i.user.username} · {INVITEE_STATUS[i.status]}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={() => void cancelChallenge(c.id)}
        >
          Withdraw
        </Button>
        <Link
          to={`/match/${c.roomId}`}
          className={linkButtonClass('secondary', 'flex-1 sm:flex-none', 'sm')}
        >
          Open lobby
        </Link>
      </div>
    </li>
  )
}

/** Accept / Decline / Cancel buttons with a shared busy state and an error line. */
function RequestActions({
  actions,
}: {
  actions: {
    label: string
    variant: 'primary' | 'ghost'
    run: () => Promise<unknown>
    testId?: string
  }[]
}) {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <div className="flex gap-2">
        {actions.map((a) => (
          <Button
            key={a.label}
            variant={a.variant}
            size="sm"
            className="flex-1 sm:flex-none"
            busy={busy === a.label}
            disabled={busy !== undefined}
            data-testid={a.testId}
            onClick={async () => {
              setBusy(a.label)
              setError(undefined)
              try {
                await a.run()
              } catch (err) {
                setError(socialErrorMessage(err))
              } finally {
                setBusy(undefined)
              }
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-seat-south-light">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function FriendRow({
  f,
  busyElsewhere,
  onChallenge,
  onRemove,
}: {
  f: Friend
  /** You sit in a lobby or game: challenging has to wait. */
  busyElsewhere: boolean
  onChallenge: (f: Friend, opener: HTMLElement) => void
  onRemove: (f: Friend, opener: HTMLElement) => void
}) {
  return (
    <li className={rowClass} data-testid="friend-row" data-online={f.online || undefined}>
      <Avatar name={f.username} online={f.online} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{f.username}</p>
        <p className={cx('text-xs', f.online ? 'text-[#7fe0b5]' : 'text-parchment/50')}>
          {f.online ? 'Online' : 'Offline'}
          <span className="hidden text-parchment/45 sm:inline">
            {' '}
            · friends since {relativeTime(f.since)}
          </span>
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => onChallenge(f, e.currentTarget)}
          className="w-9 !px-0 sm:w-auto sm:!px-3"
          disabled={busyElsewhere}
          aria-label={`Challenge ${f.username}`}
          title={
            busyElsewhere
              ? 'You’re in a lobby or game. Leave it to send a new challenge.'
              : `Challenge ${f.username}`
          }
          data-testid="friend-challenge"
        >
          <Swords aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">Challenge</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-9 !px-0"
          onClick={(e) => onRemove(f, e.currentTarget)}
          aria-label={`Remove ${f.username}`}
          title={`Remove ${f.username}`}
          data-testid="friend-remove"
        >
          <UserX aria-hidden="true" className="h-4 w-4" />
        </Button>
        <PlayerMenu
          name={f.username}
          target={{ userId: f.userId }}
          userId={f.userId}
          viewerRegistered
          targetRegistered
          blocked={false}
          reportable
          className="h-9 w-9 self-center rounded-lg"
          testId="friend-menu"
        />
      </div>
    </li>
  )
}

/** A blocked player: Unblock (no confirmation needed; blocking again is one click away). */
function BlockedRow({ b }: { b: BlockedUser }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <li className={rowClass} data-testid="blocked-row">
      <Avatar name={b.username} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{b.username}</p>
        <p className="text-xs text-parchment/55">Blocked · {relativeTime(b.since)}</p>
      </div>
      <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
        <Button
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          busy={busy}
          aria-label={`Unblock ${b.username}`}
          data-testid="blocked-unblock"
          onClick={async () => {
            setBusy(true)
            setError(undefined)
            try {
              await unblockPlayer({ userId: b.userId })
            } catch (err) {
              setError(moderationErrorMessage(err))
              setBusy(false)
            }
          }}
        >
          Unblock
        </Button>
        {error ? (
          <p role="alert" className="text-xs text-seat-south-light">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  )
}

const choice = (active: boolean) =>
  cx(
    'h-10 flex-1 rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-gold',
    active
      ? 'border-gold bg-gold/15 text-parchment'
      : 'border-parchment/20 text-parchment/70 hover:border-parchment/40',
  )

/** The challenge form: mode, time control and up to three friends. */
function ChallengeDialog({
  open,
  onOpenChange,
  friends,
  preselect,
  returnFocusTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  friends: Friend[]
  preselect: string | undefined
  returnFocusTo: RefObject<HTMLElement | null>
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'ffa' | 'teams'>('ffa')
  const [timeControl, setTimeControl] = useState<keyof typeof TIME_CONTROLS>('10+0')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; roomId?: string | undefined }>()
  const current = useMatchStore((s) => (s.closed?.roomId === s.room?.roomId ? null : s.room))
  const hosting = useSocial((s) => s.challenges.outgoing[0])
  const listId = useId()

  useEffect(() => {
    if (open) {
      setPicked(preselect ? [preselect] : [])
      setError(undefined)
    }
  }, [open, preselect])

  const sorted = [...friends].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username),
  )
  const full = picked.length >= CHALLENGE_MAX_INVITEES

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (picked.length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      const c = await createChallenge({ friendIds: picked, mode, timeControl })
      onOpenChange(false)
      navigate(`/match/${c.roomId}`)
    } catch (err) {
      const inRoom = err instanceof ApiError && err.code === 'ALREADY_IN_ROOM'
      setError({
        message: socialErrorMessage(err),
        roomId: inRoom ? (current?.roomId ?? hosting?.roomId) : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Challenge friends"
      description="A casual, invite-only lobby: only the friends you pick can join. Empty seats can take bots."
      returnFocusTo={returnFocusTo}
      testId="challenge-dialog"
    >
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-parchment/85">Mode</legend>
          <div className="flex gap-2">
            {(['ffa', 'teams'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={choice(mode === m)}
                onClick={() => setMode(m)}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-parchment/85">Time control</legend>
          <div className="flex gap-2">
            {(Object.keys(TIME_CONTROLS) as (keyof typeof TIME_CONTROLS)[]).map((tc) => (
              <button
                key={tc}
                type="button"
                aria-pressed={timeControl === tc}
                className={choice(timeControl === tc)}
                onClick={() => setTimeControl(tc)}
              >
                {tc}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2" aria-describedby={`${listId}-hint`}>
          <legend className="mb-1 text-sm font-medium text-parchment/85">
            Friends to invite{' '}
            <span className="font-normal text-parchment/65 tabular-nums">
              ({picked.length}/{CHALLENGE_MAX_INVITEES})
            </span>
          </legend>
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
            {sorted.map((f) => {
              const on = picked.includes(f.userId)
              return (
                <li key={f.userId}>
                  <label
                    className={cx(
                      'flex h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm transition',
                      on
                        ? 'border-gold/60 bg-gold/10'
                        : 'border-parchment/15 hover:border-parchment/35',
                      !on && full && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#d4a017]"
                      checked={on}
                      disabled={!on && full}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, f.userId] : p.filter((x) => x !== f.userId),
                        )
                      }
                      data-testid="challenge-pick"
                    />
                    <span
                      aria-hidden="true"
                      className={cx(
                        'h-2.5 w-2.5 shrink-0 rounded-full',
                        f.online ? 'bg-[#3ecf8e]' : 'bg-parchment/30',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{f.username}</span>
                    <span className="text-xs text-parchment/70">
                      {f.online ? 'Online' : 'Offline'}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <p id={`${listId}-hint`} className="text-xs text-parchment/55">
            Offline friends see the invitation when they come back. Invitations expire after 5
            minutes or when the game starts.
          </p>
        </fieldset>
        {error ? (
          <Alert>
            {error.message}
            {error.roomId ? (
              <>
                {' '}
                <Link
                  to={`/match/${error.roomId}`}
                  className="font-semibold text-gold underline-offset-2 hover:underline"
                  onClick={() => onOpenChange(false)}
                >
                  Open your lobby
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            type="submit"
            busy={busy}
            disabled={picked.length === 0}
            data-testid="challenge-send"
          >
            <Swords aria-hidden="true" className="h-4 w-4" />
            Send challenge
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function GuestHint() {
  return (
    <div
      className="mt-8 rounded-2xl border border-dashed border-gold/30 bg-gold/5 px-6 py-12 text-center"
      data-testid="friends-guest"
    >
      <UserPlus aria-hidden="true" className="mx-auto h-9 w-9 text-gold" />
      <h2 className="mt-3 font-display text-xl font-semibold">Create an account to add friends</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-parchment/65">
        Friends see when you’re online and can challenge you to private games. Your guest games come
        with you when you sign up.
      </p>
      <Link to="/sign-up" className={linkButtonClass('primary', 'mt-6')}>
        Create account
      </Link>
    </div>
  )
}

function EmptyFriends() {
  return (
    <div
      className="rounded-2xl border border-dashed border-parchment/15 px-6 py-12 text-center"
      data-testid="friends-empty"
    >
      <Users aria-hidden="true" className="mx-auto h-9 w-9 text-parchment/40" />
      <h3 className="mt-3 font-display text-lg font-semibold">No friends yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-parchment/65">
        Play a game with someone, then choose <strong className="text-parchment">Add friend</strong>{' '}
        on their player card, on the result screen or in your match history. You can add anyone
        you’re playing or have finished a game with.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/play" className={linkButtonClass('primary')}>
          Find a game
        </Link>
        <Link to="/history" className={linkButtonClass('secondary')}>
          Match history
        </Link>
      </div>
    </div>
  )
}

export function Friends() {
  const { session } = useAppState()
  const guest = isGuest(session?.user)
  const me = session?.user.id ?? ''
  const friends = useSocial((s) => s.friends)
  const friendsError = useSocial((s) => s.friendsError)
  const challenges = useSocial((s) => s.challenges)
  const connected = useSocial((s) => s.connected)
  const [challengeFor, setChallengeFor] = useState<string>()
  const [challengeOpen, setChallengeOpen] = useState(false)
  const [removing, setRemoving] = useState<Friend>()
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string>()
  const opener = useRef<HTMLElement | null>(null)
  // A seat in a lobby or game (this tab): a new challenge has to wait until you leave it.
  const current = useMatchStore((s) => (s.closed?.roomId === s.room?.roomId ? null : s.room))
  const busyRoomId = current?.roomId

  useEffect(() => {
    if (guest) return
    void refreshFriends()
    void refreshChallenges()
  }, [guest])

  if (guest) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Friends</h1>
        <GuestHint />
      </div>
    )
  }

  const list = [...(friends?.friends ?? [])].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username),
  )
  const online = list.filter((f) => f.online).length
  const max = friends?.limits.maxFriends ?? 50

  function openChallenge(f: Friend | undefined, el: HTMLElement) {
    opener.current = el
    setChallengeFor(f?.userId)
    setChallengeOpen(true)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Friends</h1>
        {friends ? (
          <p className="text-sm text-parchment/60 tabular-nums" data-testid="friends-count">
            {list.length} of {max}
            {connected ? ` · ${online} online` : ''}
          </p>
        ) : null}
      </header>

      {friendsError ? (
        <div className="mt-6">
          <Alert>Could not load your friends. Please try again later.</Alert>
        </div>
      ) : !friends ? (
        <div className="mt-10 flex justify-center text-parchment/60">
          <Spinner />
        </div>
      ) : (
        <>
          {busyRoomId && list.length > 0 ? (
            <div
              className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-seat-west/40 bg-seat-west/10 px-4 py-3 text-sm"
              data-testid="friends-in-room"
            >
              <p>You’re in a lobby or game. Leave it to send a new challenge.</p>
              <Link to={`/match/${busyRoomId}`} className={linkButtonClass('secondary', '', 'sm')}>
                Open lobby
              </Link>
            </div>
          ) : null}
          {challenges.incoming.length > 0 || challenges.outgoing.length > 0 ? (
            <Section title="Challenges" testId="friends-challenges">
              <ul className="flex flex-col gap-2">
                {challenges.incoming.map((c) => (
                  <IncomingChallenge key={c.id} c={c} me={me} />
                ))}
                {challenges.outgoing.map((c) => (
                  <OutgoingChallenge key={c.id} c={c} />
                ))}
              </ul>
            </Section>
          ) : null}

          {friends.incoming.length > 0 || friends.outgoing.length > 0 ? (
            <Section
              title="Requests"
              count={friends.incoming.length + friends.outgoing.length}
              testId="friends-requests"
            >
              <ul className="flex flex-col gap-2">
                {friends.incoming.map((r) => (
                  <li key={r.user.userId} className={rowClass} data-testid="request-incoming">
                    <Avatar name={r.user.username} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.user.username}</p>
                      <p className="text-xs text-parchment/55">
                        Wants to be friends · {relativeTime(r.createdAt)}
                      </p>
                    </div>
                    <PlayerMenu
                      name={r.user.username}
                      target={{ userId: r.user.userId }}
                      userId={r.user.userId}
                      viewerRegistered
                      targetRegistered
                      blocked={false}
                      reportable
                      className="h-9 w-9 rounded-lg"
                      testId="request-menu"
                    />
                    <RequestActions
                      actions={[
                        {
                          label: 'Decline',
                          variant: 'ghost',
                          run: () => declineFriendRequest(r.user.userId),
                        },
                        {
                          label: 'Accept',
                          variant: 'primary',
                          run: () => acceptFriendRequest(r.user.userId),
                          testId: 'request-accept',
                        },
                      ]}
                    />
                  </li>
                ))}
                {friends.outgoing.map((r) => (
                  <li key={r.user.userId} className={rowClass} data-testid="request-outgoing">
                    <Avatar name={r.user.username} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.user.username}</p>
                      <p className="text-xs text-parchment/55">
                        Request sent · {relativeTime(r.createdAt)}
                      </p>
                    </div>
                    <PlayerMenu
                      name={r.user.username}
                      target={{ userId: r.user.userId }}
                      userId={r.user.userId}
                      viewerRegistered
                      targetRegistered
                      blocked={false}
                      reportable
                      className="h-9 w-9 rounded-lg"
                      testId="request-menu"
                    />
                    <RequestActions
                      actions={[
                        {
                          label: 'Cancel request',
                          variant: 'ghost',
                          run: () => cancelFriendRequest(r.user.userId),
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section
            title="Friends"
            count={list.length}
            action={
              list.length > 0 ? (
                <Button
                  size="sm"
                  onClick={(e) => openChallenge(undefined, e.currentTarget)}
                  disabled={Boolean(busyRoomId)}
                  title={
                    busyRoomId
                      ? 'You’re in a lobby or game. Leave it to send a new challenge.'
                      : undefined
                  }
                  data-testid="challenge-friends"
                >
                  <Swords aria-hidden="true" className="h-4 w-4" />
                  Challenge
                </Button>
              ) : null
            }
            testId="friends-list"
          >
            {list.length === 0 ? (
              <EmptyFriends />
            ) : (
              <ul className="flex flex-col gap-2">
                {list.map((f) => (
                  <FriendRow
                    key={f.userId}
                    f={f}
                    busyElsewhere={Boolean(busyRoomId)}
                    onChallenge={(fr, el) => openChallenge(fr, el)}
                    onRemove={(fr, el) => {
                      opener.current = el
                      setRemoveError(undefined)
                      setRemoving(fr)
                    }}
                  />
                ))}
              </ul>
            )}
            {list.length >= max ? (
              <p className="mt-3 text-xs text-parchment/55">
                You’ve reached the limit of {max} friends. Remove one to add someone new.
              </p>
            ) : null}
          </Section>

          {friends.blocked.length > 0 ? (
            <Section title="Blocked" count={friends.blocked.length} testId="friends-blocked">
              <p className="-mt-1 mb-3 text-sm text-parchment/60">
                Blocked players can’t send you friend requests or challenges, and you don’t see each
                other online. They aren’t told.
              </p>
              <ul className="flex flex-col gap-2">
                {friends.blocked.map((b) => (
                  <BlockedRow key={b.userId} b={b} />
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}

      <ChallengeDialog
        open={challengeOpen}
        onOpenChange={setChallengeOpen}
        friends={list}
        preselect={challengeFor}
        returnFocusTo={opener}
      />
      <ConfirmDialog
        open={removing !== undefined}
        onOpenChange={(o) => {
          if (!o) setRemoving(undefined)
        }}
        title={`Remove ${removing?.username ?? 'friend'}?`}
        description={
          removeError ??
          'They won’t be told, but you’ll disappear from each other’s friends lists. To be friends again, one of you has to send a new request after a game together.'
        }
        confirmLabel="Remove friend"
        tone="danger"
        busy={removeBusy}
        returnFocusTo={opener}
        testId="remove-dialog"
        confirmTestId="remove-confirm"
        onConfirm={async () => {
          if (!removing) return
          setRemoveBusy(true)
          try {
            await removeFriend(removing.userId)
            setRemoving(undefined)
          } catch (err) {
            setRemoveError(socialErrorMessage(err))
          } finally {
            setRemoveBusy(false)
          }
        }}
      />
    </div>
  )
}
