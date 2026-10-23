import { Eye, Link2 } from 'lucide-react'
import { watchLinkNote, watchUrl } from '../../lib/watch-link.ts'

/**
 * "3 watching": the spectator count of a room, shown to players and spectators alike.
 * `className` sets the display too (default `inline-flex`; e.g. `hidden wide:inline-flex`).
 */
export function SpectatorCount({
  count,
  className = 'inline-flex',
}: {
  count: number
  className?: string
}) {
  if (count <= 0) return null
  return (
    <span
      className={`items-center gap-1 text-caption text-faint tabular-nums ${className}`}
      data-testid="spectator-count"
    >
      <Eye aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {count} watching
    </span>
  )
}

/**
 * "Watch link": copies the game's `/watch/…` link to share (the watch page enforces who may
 * watch; the toast says who that is). Falls back to the share sheet where copying fails.
 */
export function WatchLinkButton({
  roomId,
  state,
  notify,
  className = '',
  label = true,
}: {
  roomId: string
  state: { inviteOnly: boolean; hasPassword: boolean; ranked: boolean }
  notify: (text: string, tone?: 'error' | 'info' | 'success') => void
  className?: string
  /** Show "Watch link" beside the icon from 640px (false: the icon alone). */
  label?: boolean
}) {
  async function share() {
    const url = watchUrl(window.location.origin, roomId)
    const note = watchLinkNote(state)
    try {
      await navigator.clipboard.writeText(url)
      notify(`Watch link copied. ${note}`, 'success')
      return
    } catch {}
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Watch this game', url })
        return
      }
    } catch (err) {
      // The viewer closed the share sheet.
      if ((err as Error).name === 'AbortError') return
    }
    notify(`Couldn’t copy the link. Share this address: ${url}`, 'error')
  }
  return (
    <button
      type="button"
      onClick={() => void share()}
      className={`-my-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-1.5 text-caption font-semibold text-muted transition-colors hover:bg-parchment/[0.07] hover:text-parchment ${className}`}
      aria-label="Copy watch link"
      title="Copy a link to watch this game"
      data-testid="watch-link"
    >
      <Link2 aria-hidden="true" className="h-4 w-4 shrink-0" />
      {label ? <span className="hidden sm:inline">Watch link</span> : null}
    </button>
  )
}
