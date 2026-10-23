import type { LeaderboardEntry, LeaderboardResponse } from '@game/protocol'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Medal } from '../components/game/Medal.tsx'
import { MODE_LABEL, RATING_BUCKETS } from '../components/match/labels.ts'
import { Alert, cx, EmptyState, linkButtonClass, PageTitle, Spinner } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { profilePath } from '../lib/social.ts'

type Bucket = (typeof RATING_BUCKETS)[number]

const bucketKey = (b: { mode: string; timeControl: string }) => `${b.mode}-${b.timeControl}`

/** A leaderboard name: a link to the player's profile for signed-in viewers. */
function PlayerName({ name, link }: { name: string; link: boolean }) {
  if (!link) return <>{name}</>
  return (
    <Link
      to={profilePath(name)}
      className="rounded-[2px] underline-offset-[3px] hover:underline hover:decoration-brass"
      data-testid="leaderboard-name"
    >
      {name}
    </Link>
  )
}

function You() {
  return <span className="ml-1.5 font-sans text-ui font-normal text-gold">(you)</span>
}

/**
 * The top three as placings: 2nd, 1st, 3rd side by side from 640px, the middle one raised; a
 * row each on phones. Each is a leaderboard row (same test id and content as the table rows).
 */
function Podium({
  entries,
  me,
  link,
}: {
  entries: LeaderboardEntry[]
  me: string | null
  link: boolean
}) {
  // Wide screens: 2nd, 1st, 3rd, each in a fixed column (so a lone leader still stands in
  // the middle). The plinths step down from the middle.
  const order = [
    'sm:col-start-2 sm:row-start-1',
    'sm:col-start-1 sm:row-start-1',
    'sm:col-start-3 sm:row-start-1',
  ]
  const plinth = ['sm:pb-10', 'sm:pb-6', 'sm:pb-4']
  return (
    <ol className="mb-8 flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-end sm:gap-4">
      {entries.map((e, i) => {
        const mine = me !== null && e.username === me
        return (
          <li
            key={e.username}
            className={cx(
              'relative flex items-center gap-3 overflow-hidden rounded-plate border bg-surface-rail px-4 py-3 shadow-plate',
              'sm:flex-col sm:justify-end sm:gap-2 sm:px-3 sm:pt-5 sm:text-center',
              e.rank === 1 ? 'border-gold/70' : 'border-rule-brass',
              mine && 'bg-gold/[0.06]',
              order[i],
              plinth[i],
            )}
            data-testid="leaderboard-row"
          >
            <Medal place={e.rank} size={e.rank === 1 ? 'lg' : 'md'} />
            <p className="min-w-0 flex-1 truncate font-display text-lead font-semibold sm:max-w-full sm:flex-none">
              <PlayerName name={e.username} link={link} />
              {mine ? <You /> : null}
            </p>
            <p className="text-right sm:text-center">
              <span className="block font-display text-title leading-none font-semibold lining-nums tabular-nums">
                {e.rating}
              </span>
              <span className="text-caption text-faint lining-nums tabular-nums">
                {e.gamesPlayed} game{e.gamesPlayed === 1 ? '' : 's'}
              </span>
            </p>
          </li>
        )
      })}
    </ol>
  )
}

export function Leaderboard() {
  const { session } = useAppState()
  const [params, setParams] = useSearchParams()
  const selected: Bucket =
    RATING_BUCKETS.find(
      (b) => b.mode === params.get('mode') && b.timeControl === params.get('tc'),
    ) ?? (RATING_BUCKETS[0] as Bucket)
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const me = session?.user && !isGuest(session.user) ? displayName(session.user) : null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    const q = `mode=${selected.mode}&tc=${encodeURIComponent(selected.timeControl)}&limit=100`
    api<LeaderboardResponse>(`/api/leaderboard?${q}`)
      .then((body) => {
        if (!cancelled) setData(body)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected.mode, selected.timeControl])

  const shown = data && bucketKey(data) === bucketKey(selected) ? data : null

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <PageTitle
        title="Leaderboard"
        subtitle={`Elo from ranked lobbies. Each mode and time control has its own rating, and players appear after ${shown?.minGames ?? 5} ranked games.`}
        actions={
          session ? (
            <Link to="/play?lobbies=ranked" className={linkButtonClass('primary')}>
              Find a ranked lobby
            </Link>
          ) : null
        }
      />

      <div
        role="tablist"
        aria-label="Rating"
        className="grid grid-cols-2 gap-1 rounded-control border border-rule-strong bg-black/20 p-1 shadow-well sm:grid-cols-4"
      >
        {RATING_BUCKETS.map((b) => {
          const active = bucketKey(b) === bucketKey(selected)
          return (
            <button
              key={bucketKey(b)}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams({ mode: b.mode, tc: b.timeControl }, { replace: true })}
              className={cx(
                'flex h-12 flex-col items-center justify-center rounded-plate px-2 text-ui leading-tight font-semibold transition-colors duration-150',
                active
                  ? 'bg-panel-raised text-parchment shadow-plate ring-1 ring-brass/60'
                  : 'text-muted hover:bg-parchment/[0.04] hover:text-parchment',
              )}
              data-testid={`leaderboard-tab-${b.mode}-${b.timeControl}`}
            >
              <span>{MODE_LABEL[b.mode]}</span>
              <span
                className={cx(
                  'text-caption font-medium lining-nums tabular-nums',
                  active ? 'text-brass' : 'text-faint',
                )}
              >
                {b.timeControl}
              </span>
            </button>
          )
        })}
      </div>

      <section className="mt-8" role="tabpanel" aria-busy={loading} data-testid="leaderboard">
        {error ? (
          <Alert>The leaderboard didn’t load. Check your connection and reload the page.</Alert>
        ) : !shown ? (
          <div className="flex justify-center py-16 text-faint" role="status">
            <Spinner />
            <span className="sr-only">Loading the leaderboard…</span>
          </div>
        ) : shown.entries.length === 0 ? (
          <div data-testid="leaderboard-empty">
            {/* The page's one action (Find a ranked lobby) sits by the title. */}
            <EmptyState title="Nobody on this board yet">
              Nobody has played {shown.minGames} ranked {MODE_LABEL[shown.mode]} {shown.timeControl}{' '}
              games yet. Play in a ranked lobby to be the first.
            </EmptyState>
          </div>
        ) : (
          <>
            <Podium entries={shown.entries.slice(0, 3)} me={me} link={Boolean(session)} />
            {shown.entries.length > 3 ? (
              <table className="w-full text-ui">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-caption text-faint">
                    <th scope="col" className="w-11 py-2 pl-2 font-medium sm:w-16">
                      Rank
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      Player
                    </th>
                    <th scope="col" className="w-16 px-2 py-2 text-right font-medium sm:w-24">
                      Elo
                    </th>
                    <th
                      scope="col"
                      className="hidden px-2 py-2 text-right font-medium sm:table-cell"
                    >
                      Peak
                    </th>
                    <th scope="col" className="w-16 py-2 pr-2 pl-2 text-right font-medium sm:w-24">
                      Games
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.entries.slice(3).map((e) => {
                    const mine = me !== null && e.username === me
                    return (
                      <tr
                        key={e.username}
                        className={cx(
                          'border-b border-rule transition-colors duration-150 hover:bg-parchment/[0.03]',
                          mine && 'bg-gold/[0.07] shadow-[inset_3px_0_0_var(--color-gold)]',
                        )}
                        data-testid="leaderboard-row"
                      >
                        <td className="py-3 pl-2 text-faint lining-nums tabular-nums">{e.rank}</td>
                        <td className="max-w-0 truncate px-2 py-3 font-display text-body font-semibold">
                          <PlayerName name={e.username} link={Boolean(session)} />
                          {mine ? <You /> : null}
                        </td>
                        <td className="px-2 py-3 text-right font-display text-body font-semibold lining-nums tabular-nums">
                          {e.rating}
                        </td>
                        <td className="hidden px-2 py-3 text-right text-faint lining-nums tabular-nums sm:table-cell">
                          {e.peak}
                        </td>
                        <td className="py-3 pr-2 pl-2 text-right text-muted lining-nums tabular-nums">
                          {e.gamesPlayed}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : null}
          </>
        )}
        {loading && shown ? (
          <p className="mt-3 flex items-center gap-2 text-caption text-faint">
            <Spinner /> Updating…
          </p>
        ) : null}
      </section>
    </div>
  )
}
