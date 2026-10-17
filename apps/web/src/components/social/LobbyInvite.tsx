import type { Challenge } from '@game/protocol'
import { useEffect, useState } from 'react'
import { inviteAgain, socialErrorMessage, useSocial } from '../../lib/social.ts'
import { Button } from '../ui.tsx'

const STATUS: Record<string, string> = {
  pending: 'invited',
  declined: 'declined',
  joined: 'joined',
  expired: 'expired',
}

/** "4:05" until `iso`, ticking each second. */
function useCountdown(iso: string | undefined): string {
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

function Invitees({ c }: { c: Challenge }) {
  return (
    <span className="text-parchment/65">
      {c.invitees.map((i, n) => (
        <span key={i.user.userId ?? i.user.username}>
          {n > 0 ? ', ' : ''}
          {i.user.username} <span className="text-parchment/55">({STATUS[i.status]})</span>
        </span>
      ))}
    </span>
  )
}

/**
 * The host's view of a challenge lobby's invitation: how long it stays open, and after it ends
 * (expired or withdrawn) a way to invite the same friends again into this lobby.
 */
export function LobbyInvite({ roomId }: { roomId: string }) {
  const open = useSocial((s) => s.challenges.outgoing.find((c) => c.roomId === roomId))
  const ended = useSocial((s) => s.endedChallenges[roomId])
  const friends = useSocial((s) => s.friends)
  const left = useCountdown(open?.expiresAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (open) {
    return (
      <p className="mt-1 text-xs text-parchment/65" data-testid="lobby-invite-open">
        Invitation open for <span className="font-mono text-parchment tabular-nums">{left}</span>
        {' · '}
        <Invitees c={open} />
      </p>
    )
  }
  if (!ended) return null

  const friendIds = new Set(friends?.friends.map((f) => f.userId))
  const again = ended.invitees
    .map((i) => i.user.userId)
    .filter((id): id is string => id !== undefined && friendIds.has(id))

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs"
      data-testid="lobby-invite-ended"
    >
      <p className="text-parchment/70">
        Invitation ended: only players already seated can come back.
      </p>
      {again.length > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          busy={busy}
          data-testid="lobby-invite-again"
          onClick={async () => {
            setBusy(true)
            setError(undefined)
            try {
              await inviteAgain(ended, again)
            } catch (err) {
              setError(socialErrorMessage(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          Invite again
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-seat-south-light">
          {error}
        </p>
      ) : null}
    </div>
  )
}
