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
import { linkButtonClass, RuleList, RuleRow, SectionHeading } from '../ui.tsx'

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

/** "Playing against bots, Free-for-all" or "Friday table, Teams 2v2, 3+2, password, 2 watching". */
function gameLine(g: FriendGamesResponse['games'][number]): string {
  const parts = [
    g.solo ? 'Playing against bots' : g.name,
    MODE_LABEL[g.mode] ?? g.mode,
    g.solo ? null : g.timeControl,
    g.locked ? 'password' : null,
    g.spectators > 0 ? `${g.spectators} watching` : null,
  ]
  return parts.filter(Boolean).join(', ')
}

export function FriendsPlaying() {
  const games = useFriendGames()
  const id = useId()
  if (games.length === 0) return null
  return (
    <section aria-labelledby={id} data-testid="friends-playing">
      <SectionHeading
        id={id}
        ruled
        title={
          <>
            Playing now
            <span className="ml-2 font-sans text-ui font-normal text-faint lining-nums tabular-nums">
              {games.length}
            </span>
          </>
        }
      />
      <RuleList>
        {games.map((g) => (
          <RuleRow
            key={g.roomId}
            data-testid="friend-game"
            name
            leading={
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-rule-brass bg-baize text-brass shadow-plate"
              >
                <Eye className="h-4 w-4" />
              </span>
            }
            title={g.friends.join(', ')}
            detail={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{gameLine(g)}</span>
                {g.ranked ? <RankedBadge /> : null}
              </span>
            }
            trailing={
              <Link
                to={`/watch/${g.roomId}`}
                className={linkButtonClass('secondary', '', 'sm')}
                aria-label={`Watch ${g.friends.join(', ')}`}
                data-testid="friend-game-watch"
              >
                Watch
              </Link>
            }
          />
        ))}
      </RuleList>
    </section>
  )
}
