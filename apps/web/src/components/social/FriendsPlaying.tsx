/**
 * Friends page: games your friends are playing right now, with a "Watch" link each
 * (`GET /api/live/friends`, refreshed every few seconds while the page is open). Renders
 * nothing while there are none.
 */
import type { FriendGamesResponse } from '@game/protocol'
import { Eye } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../lib/api.ts'
import { MODE_LABEL } from '../match/labels.ts'
import { RankedBadge } from '../match/RankedBadge.tsx'
import { linkButtonClass } from '../ui.tsx'

const REFRESH_MS = 15_000

function useFriendGames(): FriendGamesResponse['games'] {
  const [games, setGames] = useState<FriendGamesResponse['games']>([])
  useEffect(() => {
    let cancelled = false
    const load = () =>
      api<FriendGamesResponse>('/api/live/friends')
        .then((r) => {
          if (!cancelled) setGames(r.games)
        })
        .catch(() => {})
    void load()
    const id = window.setInterval(() => {
      if (!document.hidden) void load()
    }, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])
  return games
}

export function FriendsPlaying() {
  const games = useFriendGames()
  const id = useId()
  if (games.length === 0) return null
  return (
    <section className="mt-8" aria-labelledby={id} data-testid="friends-playing">
      <h2 id={id} className="mb-3 font-display text-lg font-semibold">
        Playing now
        <span className="ml-2 text-sm font-normal text-parchment/50 tabular-nums">
          {games.length}
        </span>
      </h2>
      <ul className="flex flex-col gap-2">
        {games.map((g) => (
          <li
            key={g.roomId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-parchment/10 bg-panel/80 px-4 py-3"
            data-testid="friend-game"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-seat-west/20 text-parchment"
            >
              <Eye className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{g.friends.join(', ')}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-parchment/60">
                <span className="truncate">
                  {g.solo ? 'Playing against bots' : g.name} · {MODE_LABEL[g.mode] ?? g.mode}
                  {g.solo ? '' : ` · ${g.timeControl}`}
                  {g.locked ? ' · Password' : ''}
                  {g.spectators > 0 ? ` · ${g.spectators} watching` : ''}
                </span>
                {g.ranked ? <RankedBadge /> : null}
              </p>
            </div>
            <Link
              to={`/watch/${g.roomId}`}
              className={linkButtonClass('secondary', '', 'sm')}
              aria-label={`Watch ${g.friends.join(', ')}`}
              data-testid="friend-game-watch"
            >
              Watch
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
