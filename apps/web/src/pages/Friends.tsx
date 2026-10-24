import { TIME_CONTROLS } from '@game/config'
import {
  type BlockedUser,
  CHALLENGE_MAX_INVITEES,
  type Challenge,
  type Friend,
} from '@game/protocol'
import { Swords, UserX } from 'lucide-react'
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { MODE_LABEL, relativeTime } from '../components/match/labels.ts'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import { RankedToggle } from '../components/match/RankedToggle.tsx'
import { ConfirmDialog, Dialog, DialogClose } from '../components/overlay.tsx'
import { FindPlayers } from '../components/social/FindPlayers.tsx'
import { Monogram } from '../components/social/FriendButton.tsx'
import { FriendsPlaying } from '../components/social/FriendsPlaying.tsx'
import { PlayerMenu } from '../components/social/PlayerMenu.tsx'
import {
  Alert,
  Button,
  cx,
  EmptyState,
  linkButtonClass,
  PageTitle,
  RuleList,
  SectionHeading,
  Spinner,
  textLinkClass,
} from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'
import {
  challengeBlocker,
  challengeLine,
  RANKED_CHALLENGE_HINT,
  rankedNeedsFriends,
} from '../lib/challenges.ts'
import { keepFocusNear } from '../lib/focus-fallback.ts'
import { useMatchStore } from '../lib/match.ts'
import { moderationErrorMessage, unblockPlayer } from '../lib/moderation.ts'
import {
  acceptFriendRequest,
  cancelChallenge,
  cancelFriendRequest,
  createChallenge,
  declineChallenge,
  declineFriendRequest,
  dropChallenge,
  profilePath,
  refreshChallenges,
  refreshFriends,
  removeFriend,
  socialErrorMessage,
  socialNotice,
  useSocial,
} from '../lib/social.ts'

/** A section of the page: a heading over a rule, then its rows. */
function Section({
  title,
  count,
  description,
  action,
  children,
  testId,
}: {
  title: string
  count?: number | undefined
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  testId?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} data-testid={testId} data-focus-fallback>
      <SectionHeading
        id={id}
        ruled
        title={
          <>
            {title}
            {count !== undefined ? (
              <span className="ml-2 font-sans text-ui font-normal text-faint lining-nums tabular-nums">
                {count}
              </span>
            ) : null}
          </>
        }
        description={description}
        actions={action}
      />
      {children}
    </section>
  )
}

/** A player's name, linking to their public profile (set like a nameplate). */
function ProfileName({ name }: { name: string }) {
  return (
    <Link
      to={profilePath(name)}
      className="block truncate rounded-[2px] font-display text-lead font-semibold text-parchment underline-offset-[3px] hover:underline hover:decoration-brass"
    >
      {name}
    </Link>
  )
}

/** A row of a list: monogram, name and detail, actions (under the name on phones). */
const rowClass = 'flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5 sm:gap-x-4'

function useCountdown(iso: string): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function IncomingChallenge({ c, me, primary }: { c: Challenge; me: string; primary: boolean }) {
  const navigate = useNavigate()
  const left = useCountdown(c.expiresAt)
  const [busy, setBusy] = useState(false)
  return (
    <li
      className={cx(
        rowClass,
        'relative -mx-3 rounded-plate px-3 sm:-mx-4 sm:px-4',
        'bg-gold/[0.06] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gold',
      )}
    >
      <Monogram name={c.from.username} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body text-parchment">
          <span className="min-w-0 truncate">
            <span className="font-display text-lead font-semibold">{c.from.username}</span>{' '}
            challenges you
          </span>
          {c.ranked ? <RankedBadge /> : null}
        </p>
        <p className="text-ui text-faint">
          {challengeLine(c, me)} Expires in{' '}
          <span className="font-semibold text-parchment lining-nums tabular-nums">{left}</span>.
        </p>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button
          variant="quiet"
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
          variant={primary ? 'primary' : 'secondary'}
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
  pending: 'invited',
  declined: 'declined',
  joined: 'joined',
  expired: 'expired',
}

function OutgoingChallenge({ c }: { c: Challenge }) {
  const left = useCountdown(c.expiresAt)
  return (
    <li className={rowClass}>
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rule-brass bg-baize text-brass shadow-plate"
      >
        <Swords className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="font-display text-lead font-semibold">Your challenge</span>
          {c.ranked ? <RankedBadge /> : null}
        </p>
        <p className="text-ui text-faint">
          {challengeLine(c)} Open for{' '}
          <span className="font-semibold text-parchment lining-nums tabular-nums">{left}</span>.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {c.invitees.map((i) => (
            <li
              key={i.user.userId ?? i.user.username}
              className={cx(
                'inline-flex h-6 items-center gap-1.5 rounded-full border bg-black/15 px-2.5 text-caption',
                i.status === 'joined'
                  ? 'border-ok/40 text-ok'
                  : i.status === 'declined'
                    ? 'border-destructive-light/40 text-destructive-light'
                    : 'border-rule-strong text-muted',
              )}
            >
              <span className="font-semibold text-parchment">{i.user.username}</span>
              {INVITEE_STATUS[i.status]}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button
          variant="quiet"
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
    variant: 'secondary' | 'quiet'
    run: () => Promise<unknown>
    testId?: string
  }[]
}) {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <div className="flex gap-2">
        {actions.map((a) => (
          <Button
            key={a.label}
            variant={a.variant}
            size="sm"
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
        <p role="alert" className="text-caption text-destructive-light">
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
    <li
      className="flex items-center gap-3 py-3 sm:gap-4"
      data-testid="friend-row"
      data-online={f.online || undefined}
    >
      <Monogram name={f.username} online={f.online} />
      <div className="min-w-0 flex-1">
        <ProfileName name={f.username} />
        <p className="truncate text-ui text-faint">
          <span className={f.online ? 'text-ok' : undefined}>
            {f.online ? 'Online' : 'Offline'}
          </span>
          <span className="hidden sm:inline">, friends since {relativeTime(f.since)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
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
          variant="quiet"
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
      <Monogram name={b.username} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-body font-semibold text-muted">{b.username}</p>
        <p className="text-caption text-faint">Blocked {relativeTime(b.since)}</p>
      </div>
      <div className="flex flex-col gap-1 sm:items-end">
        <Button
          variant="quiet"
          size="sm"
          busy={busy}
          aria-label={`Unblock ${b.username}`}
          data-testid="blocked-unblock"
          onClick={async (e) => {
            setBusy(true)
            setError(undefined)
            // The row (and maybe the whole Blocked section) goes away: keep focus nearby.
            const restoreFocus = keepFocusNear(e.currentTarget)
            try {
              await unblockPlayer({ userId: b.userId })
              socialNotice({ title: `You unblocked ${b.username}`, tone: 'success' })
              restoreFocus()
            } catch (err) {
              setError(moderationErrorMessage(err))
              setBusy(false)
            }
          }}
        >
          Unblock
        </Button>
        {error ? (
          <p role="alert" className="text-caption text-destructive-light">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/** A choice in a segmented control (mode, time control). */
const choice = (active: boolean) =>
  cx(
    'h-10 flex-1 rounded-plate px-3 text-ui font-semibold transition-colors duration-150',
    active
      ? 'bg-panel-raised text-parchment shadow-plate ring-1 ring-brass/60'
      : 'text-muted hover:text-parchment',
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
  const [ranked, setRanked] = useState(false)
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
  const tooFew = rankedNeedsFriends(sorted.length)
  // Too few friends for a full table: off and locked (switching it off stays possible).
  const locked = tooFew !== null && !ranked
  const blocker = challengeBlocker(picked.length, ranked, sorted.length)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (blocker) return
    setBusy(true)
    setError(undefined)
    try {
      const c = await createChallenge({ friendIds: picked, mode, timeControl, ranked })
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
      description={
        ranked
          ? 'A ranked, invite-only lobby: only the friends you pick can join.'
          : 'A casual, invite-only lobby: only the friends you pick can join. Empty seats can take bots.'
      }
      returnFocusTo={returnFocusTo}
      testId="challenge-dialog"
    >
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-ui font-medium">Mode</legend>
          <div className="flex gap-1 rounded-control border border-rule-strong bg-black/20 p-1 shadow-well">
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
          <legend className="mb-1.5 text-ui font-medium">Time control</legend>
          <div className="flex gap-1 rounded-control border border-rule-strong bg-black/20 p-1 shadow-well">
            {(Object.keys(TIME_CONTROLS) as (keyof typeof TIME_CONTROLS)[]).map((tc) => (
              <button
                key={tc}
                type="button"
                aria-pressed={timeControl === tc}
                className={cx(choice(timeControl === tc), 'lining-nums tabular-nums')}
                onClick={() => setTimeControl(tc)}
              >
                {tc}
              </button>
            ))}
          </div>
        </fieldset>
        <RankedToggle
          ranked={ranked}
          disabled={locked}
          onChange={setRanked}
          caption="Elo-rated, for you and 3 friends"
          hint={
            locked
              ? tooFew
              : ranked
                ? RANKED_CHALLENGE_HINT
                : 'Casual: no rating changes. You can fill empty seats with bots.'
          }
        />
        <fieldset className="flex flex-col gap-2" aria-describedby={`${listId}-hint`}>
          <legend className="mb-1 text-ui font-medium">
            Friends to invite{' '}
            <span className="font-normal text-faint lining-nums tabular-nums">
              ({picked.length}/{CHALLENGE_MAX_INVITEES})
            </span>
          </legend>
          <ul className="max-h-56 divide-y divide-rule overflow-y-auto border-y border-rule">
            {sorted.map((f) => {
              const on = picked.includes(f.userId)
              return (
                <li key={f.userId}>
                  <label
                    className={cx(
                      'flex h-12 cursor-pointer items-center gap-3 px-1 text-ui transition-colors duration-150 hover:bg-parchment/[0.03]',
                      !on && full && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={on}
                      disabled={!on && full}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, f.userId] : p.filter((x) => x !== f.userId),
                        )
                      }
                      data-testid="challenge-pick"
                    />
                    <span className="min-w-0 flex-1 truncate font-display text-body font-semibold">
                      {f.username}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cx(
                        'h-2 w-2 shrink-0 rounded-full',
                        f.online ? 'bg-ok' : 'bg-parchment/30',
                      )}
                    />
                    <span className={cx('w-12 text-caption', f.online ? 'text-ok' : 'text-faint')}>
                      {f.online ? 'Online' : 'Offline'}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <p id={`${listId}-hint`} className="text-caption text-faint">
            {/* Announced as it changes: Send is disabled meanwhile, so focus never reaches it. */}
            <span aria-live="polite" className="text-parchment">
              {blocker ? <span data-testid="challenge-blocker">{blocker} </span> : null}
            </span>
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
                  className={cx(textLinkClass, 'font-semibold')}
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
            <Button variant="quiet">Cancel</Button>
          </DialogClose>
          <Button
            type="submit"
            busy={busy}
            disabled={blocker !== null}
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
    <div data-testid="friends-guest">
      <EmptyState
        title="Create an account to add friends"
        action={
          <Link to="/sign-up" className={linkButtonClass('primary')}>
            Create account
          </Link>
        }
      >
        Friends see when you’re online and can challenge you to private games. Your guest games come
        with you when you sign up.
      </EmptyState>
    </div>
  )
}

function EmptyFriends() {
  return (
    <div data-testid="friends-empty">
      <EmptyState title="No friends yet">
        Send a request by username, or search for a player above. You can also choose{' '}
        <strong className="font-semibold text-parchment">Add friend</strong> beside a player during
        a game, on the result screen or in your{' '}
        <Link to="/history" className={textLinkClass}>
          match history
        </Link>
        .
      </EmptyState>
    </div>
  )
}

const pageClass = 'mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:py-14 [&>header]:mb-0'

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

  // A profile's "Challenge" button lands here with ?challenge=<friend's user id>.
  const [params, setParams] = useSearchParams()
  const challengeParam = params.get('challenge')
  const friendIds = friends?.friends.map((f) => f.userId).join(',')
  useEffect(() => {
    if (!challengeParam || friendIds === undefined) return
    if (friendIds.split(',').includes(challengeParam)) {
      setChallengeFor(challengeParam)
      setChallengeOpen(true)
    }
    setParams(
      (p) => {
        p.delete('challenge')
        return p
      },
      { replace: true },
    )
  }, [challengeParam, friendIds, setParams])

  if (guest) {
    return (
      <div className={pageClass}>
        <PageTitle
          title="Friends"
          subtitle="See who’s online and challenge them to private games."
        />
        <GuestHint />
      </div>
    )
  }

  const list = [...(friends?.friends ?? [])].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username),
  )
  const online = list.filter((f) => f.online).length
  const max = friends?.limits.maxFriends ?? 50
  // One gold button: Join on the first challenge waiting for you, else Challenge friends, else
  // (nobody on your list yet) Send request.
  const joinIsPrimary = challenges.incoming.length > 0
  const challengeIsPrimary = !joinIsPrimary && list.length > 0

  function openChallenge(f: Friend | undefined, el: HTMLElement) {
    opener.current = el
    setChallengeFor(f?.userId)
    setChallengeOpen(true)
  }

  return (
    <div className={pageClass}>
      <PageTitle
        title="Friends"
        subtitle={
          friends ? (
            <span className="lining-nums tabular-nums" data-testid="friends-count">
              {list.length} of {max} friends
              {connected ? `, ${online} online now` : ''}
            </span>
          ) : undefined
        }
        actions={
          friends && list.length > 0 ? (
            <Button
              variant={challengeIsPrimary ? 'primary' : 'secondary'}
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
              Challenge friends
            </Button>
          ) : undefined
        }
      />

      {friendsError ? (
        <Alert>Your friends list didn’t load. Check your connection and reload the page.</Alert>
      ) : !friends ? (
        <div className="flex justify-center py-10 text-faint" role="status">
          <Spinner />
          <span className="sr-only">Loading your friends…</span>
        </div>
      ) : (
        <>
          {busyRoomId && list.length > 0 ? (
            <div data-testid="friends-in-room">
              <Alert tone="info">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p>You’re in a lobby or game. Leave it to send a new challenge.</p>
                  <Link
                    to={`/match/${busyRoomId}`}
                    className={linkButtonClass('secondary', '', 'sm')}
                  >
                    Open lobby
                  </Link>
                </div>
              </Alert>
            </div>
          ) : null}
          {challenges.incoming.length > 0 || challenges.outgoing.length > 0 ? (
            <Section title="Challenges" testId="friends-challenges">
              <ul className="divide-y divide-rule">
                {challenges.incoming.map((c, i) => (
                  <IncomingChallenge key={c.id} c={c} me={me} primary={i === 0} />
                ))}
                {challenges.outgoing.map((c) => (
                  <OutgoingChallenge key={c.id} c={c} />
                ))}
              </ul>
            </Section>
          ) : null}

          {list.length > 0 ? <FriendsPlaying /> : null}

          {friends.incoming.length > 0 || friends.outgoing.length > 0 ? (
            <Section
              title="Requests"
              count={friends.incoming.length + friends.outgoing.length}
              testId="friends-requests"
            >
              <RuleList className="border-t-0">
                {friends.incoming.map((r) => (
                  <li key={r.user.userId} className={rowClass} data-testid="request-incoming">
                    <Monogram name={r.user.username} />
                    <div className="min-w-0 flex-1">
                      <ProfileName name={r.user.username} />
                      <p className="text-ui text-faint">
                        Wants to be friends, {relativeTime(r.createdAt)}
                      </p>
                    </div>
                    <div className="flex w-full items-center gap-2 pl-[3.25rem] sm:w-auto sm:pl-0">
                      <RequestActions
                        actions={[
                          {
                            label: 'Decline',
                            variant: 'quiet',
                            run: () => declineFriendRequest(r.user.userId),
                          },
                          {
                            label: 'Accept',
                            variant: 'secondary',
                            run: () => acceptFriendRequest(r.user.userId),
                            testId: 'request-accept',
                          },
                        ]}
                      />
                      <PlayerMenu
                        name={r.user.username}
                        target={{ userId: r.user.userId }}
                        userId={r.user.userId}
                        viewerRegistered
                        targetRegistered
                        blocked={false}
                        reportable
                        className="ml-auto sm:ml-0"
                        testId="request-menu"
                      />
                    </div>
                  </li>
                ))}
                {friends.outgoing.map((r) => (
                  <li key={r.user.userId} className={rowClass} data-testid="request-outgoing">
                    <Monogram name={r.user.username} />
                    <div className="min-w-0 flex-1">
                      <ProfileName name={r.user.username} />
                      <p className="text-ui text-faint">Request sent {relativeTime(r.createdAt)}</p>
                    </div>
                    <div className="flex w-full items-center gap-2 pl-[3.25rem] sm:w-auto sm:pl-0">
                      <RequestActions
                        actions={[
                          {
                            label: 'Cancel request',
                            variant: 'quiet',
                            run: () => cancelFriendRequest(r.user.userId),
                          },
                        ]}
                      />
                      <PlayerMenu
                        name={r.user.username}
                        target={{ userId: r.user.userId }}
                        userId={r.user.userId}
                        viewerRegistered
                        targetRegistered
                        blocked={false}
                        reportable
                        className="ml-auto sm:ml-0"
                        testId="request-menu"
                      />
                    </div>
                  </li>
                ))}
              </RuleList>
            </Section>
          ) : null}

          {/*
            "Add friends" sits above the list only while it is empty; once you have friends the
            list comes first, so a phone doesn't scroll past both add fields to reach them.
            Keyed siblings, so React moves them without remounting (the search keeps its text).
          */}
          {(() => {
            const addSection = (
              <Section key="add" title="Add friends" testId="friends-add">
                <FindPlayers primary={list.length === 0 && !joinIsPrimary} />
              </Section>
            )
            const friendsSection = (
              <Section key="friends" title="Friends" count={list.length} testId="friends-list">
                {list.length === 0 ? (
                  <EmptyFriends />
                ) : (
                  <RuleList className="border-t-0">
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
                  </RuleList>
                )}
                {list.length >= max ? (
                  <p className="mt-3 text-caption text-faint">
                    You’ve reached the limit of {max} friends. Remove one to add someone new.
                  </p>
                ) : null}
              </Section>
            )
            return list.length > 0 ? [friendsSection, addSection] : [addSection, friendsSection]
          })()}

          {friends.blocked.length > 0 ? (
            <Section
              title="Blocked"
              count={friends.blocked.length}
              testId="friends-blocked"
              description="Blocked players can’t send you friend requests or challenges, and you don’t see each other online. They aren’t told."
            >
              <RuleList className="border-t-0">
                {friends.blocked.map((b) => (
                  <BlockedRow key={b.userId} b={b} />
                ))}
              </RuleList>
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
          'They won’t be told, but you’ll disappear from each other’s friends lists. To be friends again, one of you has to send a new request.'
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
