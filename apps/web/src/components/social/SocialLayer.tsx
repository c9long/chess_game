/**
 * Keeps the `social` room open while a registered player is signed in (live presence and
 * notifications), and shows what arrives: toasts for friend requests and answers, and a
 * prompt for challenges. Loaded lazily from the Shell (it pulls in the Colyseus client and the
 * overlay library).
 */
import type { Room } from '@colyseus/sdk'
import { type Challenge, CLOSE_CODES, ROOM_NAMES, type SocialMessages } from '@game/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { gameClient, matchErrorCode } from '../../lib/match.ts'
import {
  addIncomingChallenge,
  challengeEnded,
  declineChallenge,
  dropChallenge,
  onSocialNotice,
  refreshChallenges,
  refreshFriends,
  resetSocial,
  setPresence,
  socialChanged,
  useSocial,
} from '../../lib/social.ts'
import { MODE_LABEL } from '../match/labels.ts'
import { Dialog, type ToastInput, ToastViewport, useToast } from '../overlay.tsx'
import { Button, cx, textLinkClass } from '../ui.tsx'

/** Refusals that retrying won't fix (signed out, a guest, too many tabs). */
const FINAL_CODES = new Set(['unauthorized', 'account_required', 'too_many_attempts'])

function FriendsLink({ children = 'Open Friends' }: { children?: ReactNode }) {
  return (
    <Link to="/friends" className={cx(textLinkClass, 'font-medium')}>
      {children}
    </Link>
  )
}

/** "4:05" until `iso`. */
function useCountdown(iso: string | undefined): string {
  // The state only ticks re-renders; the time is read fresh on every render, so the first
  // frame after a challenge arrives is right too.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!iso) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [iso])
  if (!iso) return ''
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const PROMPT_TEST_ID = 'challenge-prompt'

/** "Free-for-all, 10+0, casual. Also invited: Ada." */
function challengeLine(c: Challenge, viewerId: string): string {
  const others = c.invitees.filter((i) => i.user.userId !== viewerId).map((i) => i.user.username)
  const base = `${MODE_LABEL[c.mode] ?? c.mode}, ${c.timeControl}, casual.`
  return others.length > 0 ? `${base} Also invited: ${others.join(', ')}.` : base
}

/** Whether a dialog other than the challenge prompt is open (it waits until that closes). */
function useOtherDialogOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const check = () =>
      setOpen(
        [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
          (el) => el.getAttribute('data-testid') !== PROMPT_TEST_ID,
        ),
      )
    check()
    // Dialogs render in portals appended to <body>.
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true })
    return () => observer.disconnect()
  }, [])
  return open
}

/** The challenge prompt: Join (go to the lobby) or Decline. */
function ChallengePrompt({
  challenge,
  viewerId,
  onClose,
}: {
  challenge: Challenge | undefined
  viewerId: string
  onClose: (id: string) => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const left = useCountdown(challenge?.expiresAt)
  const toast = useToast()
  // Keep showing the last challenge while the dialog animates out.
  const shown = useRef<Challenge | undefined>(challenge)
  if (challenge) shown.current = challenge
  const c = shown.current
  if (!c) return null
  return (
    <Dialog
      open={Boolean(challenge)}
      onOpenChange={(open) => {
        if (!open) onClose(c.id)
      }}
      title={`${c.from.username} challenges you`}
      description={challengeLine(c, viewerId)}
      testId={PROMPT_TEST_ID}
      actions={
        <>
          <Button
            variant="quiet"
            busy={busy}
            data-testid="challenge-decline"
            onClick={async () => {
              setBusy(true)
              try {
                await declineChallenge(c.id)
              } catch {
                toast({ title: 'Could not decline the challenge', tone: 'error' })
              } finally {
                setBusy(false)
                onClose(c.id)
              }
            }}
          >
            Decline
          </Button>
          <Button
            data-testid="challenge-join"
            onClick={() => {
              dropChallenge(c.id)
              onClose(c.id)
              navigate(`/match/${c.roomId}`)
            }}
          >
            Join lobby
          </Button>
        </>
      }
    >
      <p className="text-ui text-muted" aria-live="off">
        Expires in{' '}
        <span className="font-semibold text-parchment lining-nums tabular-nums">{left}</span>. You
        can also answer from the <FriendsLink>Friends page</FriendsLink>.
      </p>
    </Dialog>
  )
}

const onFriendsPage = () => window.location.pathname === '/friends'

function SocialEvents({ userId }: { userId: string }) {
  const toast = useToast()
  const { pathname } = useLocation()
  const incoming = useSocial((s) => s.challenges.incoming)
  const [later, setLater] = useState<Set<string>>(() => new Set())
  // During a game (or a lobby), challenges arrive as a toast instead of a dialog over the
  // board; on the Friends page the challenge row itself has Join and Decline.
  const inMatch = pathname.startsWith('/match/')
  const onFriends = pathname === '/friends'
  const toastOnly = inMatch || onFriends
  const toastOnlyRef = useRef(toastOnly)
  toastOnlyRef.current = toastOnly
  const otherDialog = useOtherDialogOpen()
  const toastRef = useRef<(t: ToastInput) => void>(toast)
  toastRef.current = toast

  // biome-ignore lint/correctness/useExhaustiveDependencies: one connection per signed-in user
  useEffect(() => {
    let cancelled = false
    let room: Room | undefined
    let timer: number | undefined
    let attempt = 0
    const notify = (t: ToastInput) => toastRef.current(t)

    const handlers: { [K in keyof SocialMessages]: (p: SocialMessages[K]) => void } = {
      presence: (p) => setPresence(p.userId, p.online),
      friendRequest: (p) => {
        socialChanged()
        notify({
          title: `${p.user.username} sent you a friend request`,
          description: <FriendsLink>Answer on the Friends page</FriendsLink>,
        })
      },
      friendAccepted: (p) => {
        socialChanged()
        notify({ title: `You and ${p.user.username} are now friends`, tone: 'success' })
      },
      friendsChanged: () => socialChanged(),
      challenge: (c) => {
        addIncomingChallenge(c)
        if (toastOnlyRef.current) {
          notify({
            title: `${c.from.username} challenges you`,
            description: onFriendsPage() ? (
              'Answer under Challenges.'
            ) : (
              <FriendsLink>Answer on the Friends page</FriendsLink>
            ),
            duration: 10_000,
          })
        }
      },
      challengeUpdate: (u) => {
        void refreshChallenges()
        notify(
          u.status === 'declined'
            ? { title: `${u.user.username} declined your challenge` }
            : u.status === 'joined'
              ? { title: `${u.user.username} joined your lobby`, tone: 'success' }
              : { title: `${u.user.username}’s invitation expired` },
        )
      },
      challengeClosed: (p) => {
        const mine = useSocial.getState().challenges.outgoing.some((c) => c.id === p.challengeId)
        const wasPending = useSocial
          .getState()
          .challenges.incoming.some((c) => c.id === p.challengeId)
        if (mine && (p.reason === 'expired' || p.reason === 'cancelled')) {
          challengeEnded(p.challengeId)
        }
        dropChallenge(p.challengeId)
        if (wasPending && p.reason !== 'answered') {
          notify({
            title:
              p.reason === 'expired'
                ? 'A challenge expired'
                : p.reason === 'started'
                  ? 'A challenge started without you'
                  : 'A challenge was withdrawn',
          })
        } else if (mine && p.reason === 'expired') {
          notify({ title: 'Your challenge invitation expired' })
        }
      },
    }

    const schedule = () => {
      if (cancelled) return
      const delay = Math.min(30_000, 1_000 * 2 ** attempt) + Math.random() * 500
      attempt++
      timer = window.setTimeout(connect, delay)
    }

    async function connect() {
      try {
        const r = (await gameClient().joinOrCreate(ROOM_NAMES.social)) as Room
        if (cancelled) {
          void r.leave(true).catch(() => {})
          return
        }
        room = r
        attempt = 0
        // We rejoin ourselves (a fresh seat), rather than the SDK's token reconnect.
        r.reconnection.enabled = false
        for (const [type, fn] of Object.entries(handlers)) {
          r.onMessage(type, fn as (p: unknown) => void)
        }
        r.onLeave((code) => {
          room = undefined
          useSocial.setState({ connected: false })
          // The session ended (signed out elsewhere, revoked): rejoining can't work.
          if (code === CLOSE_CODES.sessionEnded) return
          schedule()
        })
        useSocial.setState({ connected: true })
        void refreshFriends()
        void refreshChallenges()
      } catch (err) {
        const code = matchErrorCode(err)
        if (code && FINAL_CODES.has(code)) return
        schedule()
      }
    }

    void refreshFriends()
    void refreshChallenges()
    void connect()
    const stopNotices = onSocialNotice((n) => notify(n))
    return () => {
      cancelled = true
      stopNotices()
      window.clearTimeout(timer)
      const r = room
      room = undefined
      if (r) {
        r.onLeave.clear()
        void r.leave(true).catch(() => {})
      }
      resetSocial()
    }
  }, [userId])

  // Challenges already listed on the Friends page don't pop up again when you leave it.
  useEffect(() => {
    if (!onFriends || incoming.length === 0) return
    setLater((s) => {
      const fresh = incoming.filter((c) => !s.has(c.id))
      return fresh.length === 0 ? s : new Set([...s, ...fresh.map((c) => c.id)])
    })
  }, [onFriends, incoming])

  const next = toastOnly || otherDialog ? undefined : incoming.find((c) => !later.has(c.id))
  return (
    <ChallengePrompt
      challenge={next}
      viewerId={userId}
      onClose={(id) => setLater((s) => new Set(s).add(id))}
    />
  )
}

export function SocialLayer({ userId }: { userId: string }) {
  return (
    <ToastViewport>
      <SocialEvents userId={userId} />
    </ToastViewport>
  )
}

export default SocialLayer
