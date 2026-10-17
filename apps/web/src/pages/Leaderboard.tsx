import type { LeaderboardEntry, LeaderboardResponse } from '@game/protocol'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Medal } from '../components/game/Medal.tsx'
import { MODE_LABEL, PODIUM, RATING_BUCKETS } from '../components/match/labels.ts'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import { Alert, Spinner } from '../components/ui.tsx'
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
      className="underline-offset-2 hover:text-gold hover:underline"
      data-testid="leaderboard-name"
    >
      {name}
    </Link>
  )
}

function YouChip() {
  return (
    <span className="ml-2 inline-block shrink-0 rounded border border-gold/50 bg-gold/15 px-1 align-middle text-[10px] leading-4 font-bold tracking-wider text-gold uppercase">
      <span className="sr-only">(</span>you<span className="sr-only">)</span>
    </span>
  )
}

/**
 * The top three: podium cards (2nd, 1st, 3rd) from 640px, compact medal rows on phones. Each
 * card is a leaderboard row (same test id and content as the table rows).
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
  // the middle). Heights step down from the middle.
  const order = [
    'sm:col-start-2 sm:row-start-1',
    'sm:col-start-1 sm:row-start-1',
    'sm:col-start-3 sm:row-start-1',
  ]
  const height = ['sm:min-h-[188px]', 'sm:min-h-[164px]', 'sm:min-h-[150px]']
  return (
    <ol className="mb-4 flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-end sm:gap-3">
      {entries.map((e, i) => {
        const mine = me !== null && e.username === me
        const color = PODIUM[e.rank - 1] ?? PODIUM[2]
        return (
          <li
            key={e.username}
            className={`relative flex items-center gap-3 overflow-hidden rounded-2xl border bg-panel/85 px-4 py-3 sm:flex-col sm:justify-end sm:gap-1.5 sm:px-3 sm:pt-5 sm:pb-4 sm:text-center ${order[i]} ${height[i]} ${
              mine ? 'ring-2 ring-gold/60' : ''
            }`}
            style={{
              borderColor: `${color}66`,
              backgroundImage: `linear-gradient(to top, ${color}1f, transparent 70%)`,
            }}
            data-testid="leaderboard-row"
          >
            <Medal place={e.rank} size={e.rank === 1 ? 'lg' : 'md'} />
            <p className="min-w-0 flex-1 truncate font-semibold sm:max-w-full sm:flex-none">
              <PlayerName name={e.username} link={link} />
              {mine ? <YouChip /> : null}
            </p>
            <p className="text-right sm:text-center">
              <span className="block font-display text-2xl leading-none font-semibold tabular-nums sm:text-[28px]">
                {e.rating}
              </span>
              <span className="text-[11px] text-parchment/65 tabular-nums">
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
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
            Ranked play <RankedBadge />
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 max-w-xl text-sm text-parchment/60">
            Elo from ranked lobbies. Each mode and time control has its own rating. Players appear
            after {shown?.minGames ?? 5} ranked games.
          </p>
        </div>
        {session ? (
          <Link
            to="/play?lobbies=ranked"
            className="inline-flex h-10 items-center rounded-lg border border-parchment/25 px-4 text-sm font-semibold text-parchment hover:border-parchment/50 hover:bg-parchment/5"
          >
            Find a ranked lobby
          </Link>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label="Rating"
        className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-parchment/15 bg-ink/40 p-1 sm:grid-cols-4"
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
              className={`flex h-11 flex-col items-center justify-center rounded-lg px-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-gold sm:text-sm ${
                active
                  ? 'bg-gold/15 text-parchment ring-1 ring-gold/60'
                  : 'text-parchment/60 hover:bg-parchment/5 hover:text-parchment'
              }`}
              data-testid={`leaderboard-tab-${b.mode}-${b.timeControl}`}
            >
              <span>{MODE_LABEL[b.mode]}</span>
              <span className="text-[11px] font-medium text-parchment/70 tabular-nums">
                {b.timeControl}
              </span>
            </button>
          )
        })}
      </div>

      <section className="mt-5" role="tabpanel" aria-busy={loading} data-testid="leaderboard">
        {error ? (
          <Alert>Could not load the leaderboard. Please try again later.</Alert>
        ) : !shown ? (
          <div className="flex justify-center py-16 text-parchment/60">
            <Spinner />
          </div>
        ) : shown.entries.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed border-parchment/15 px-6 py-14 text-center text-parchment/60"
            data-testid="leaderboard-empty"
          >
            Nobody has played {shown.minGames} ranked {MODE_LABEL[shown.mode]} {shown.timeControl}{' '}
            games yet. Create a ranked lobby to get on the board.
          </div>
        ) : (
          <>
            <Podium entries={shown.entries.slice(0, 3)} me={me} link={Boolean(session)} />
            {shown.entries.length > 3 ? (
              <div className="overflow-hidden rounded-2xl border border-parchment/10 bg-panel/80">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-parchment/10 text-left text-xs uppercase tracking-wider text-parchment/50">
                      <th scope="col" className="w-10 py-3 pl-4 font-semibold sm:w-14">
                        #
                      </th>
                      <th scope="col" className="px-2 py-3 font-semibold">
                        Player
                      </th>
                      <th scope="col" className="px-2 py-3 text-right font-semibold">
                        Elo
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2 py-3 text-right font-semibold sm:table-cell"
                      >
                        Peak
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">
                        <span className="sm:hidden" title="Games">
                          G
                        </span>
                        <span className="hidden sm:inline">Games</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.entries.slice(3).map((e) => {
                      const mine = me !== null && e.username === me
                      return (
                        <tr
                          key={e.username}
                          className={`border-b border-parchment/5 transition-colors last:border-0 hover:bg-parchment/[0.03] ${mine ? 'bg-gold/10 shadow-[inset_3px_0_0_var(--color-gold)]' : ''}`}
                          data-testid="leaderboard-row"
                        >
                          <td className="py-2.5 pl-4">
                            <span className="inline-flex w-7 justify-center tabular-nums text-parchment/60">
                              {e.rank}
                            </span>
                          </td>
                          <td className="max-w-0 truncate px-2 py-2.5 font-semibold">
                            <PlayerName name={e.username} link={Boolean(session)} />
                            {mine ? <YouChip /> : null}
                          </td>
                          <td className="px-2 py-2.5 text-right font-display text-base font-semibold tabular-nums">
                            {e.rating}
                          </td>
                          <td className="hidden px-2 py-2.5 text-right tabular-nums text-parchment/55 sm:table-cell">
                            {e.peak}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-parchment/65">
                            {e.gamesPlayed}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
        {loading && shown ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-parchment/50">
            <Spinner /> Updating…
          </p>
        ) : null}
      </section>
    </div>
  )
}
