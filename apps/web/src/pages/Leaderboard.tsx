import type { LeaderboardResponse } from '@game/protocol'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { MODE_LABEL, RATING_BUCKETS } from '../components/match/labels.ts'
import { RankedBadge } from '../components/match/RankedBadge.tsx'
import { Alert, Spinner } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'

type Bucket = (typeof RATING_BUCKETS)[number]

const bucketKey = (b: { mode: string; timeControl: string }) => `${b.mode}-${b.timeControl}`

/** Medal colours for the top three rows. */
const PODIUM = ['#d4a017', '#c9ccd1', '#c7834a'] as const

function RankCell({ rank }: { rank: number }) {
  const color = PODIUM[rank - 1]
  return color ? (
    <span
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold tabular-nums"
      style={{ borderColor: `${color}aa`, color, background: `${color}1f` }}
    >
      {rank}
    </span>
  ) : (
    <span className="inline-flex w-7 justify-center tabular-nums text-parchment/60">{rank}</span>
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
          <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-gold/80">
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
              <span className="text-[11px] font-medium text-parchment/50 tabular-nums">
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
          <div className="overflow-hidden rounded-2xl border border-parchment/10 bg-panel/80">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-parchment/10 text-left text-xs uppercase tracking-wider text-parchment/50">
                  <th scope="col" className="w-14 px-4 py-3 font-semibold">
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
                    Games
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.entries.map((e) => {
                  const mine = me !== null && e.username === me
                  return (
                    <tr
                      key={e.username}
                      className={`border-b border-parchment/5 last:border-0 ${mine ? 'bg-gold/10' : ''}`}
                      data-testid="leaderboard-row"
                    >
                      <td className="px-4 py-2.5">
                        <RankCell rank={e.rank} />
                      </td>
                      <td className="max-w-0 truncate px-2 py-2.5 font-semibold">
                        {e.username}
                        {mine ? (
                          <span className="ml-2 text-xs font-medium text-gold">(you)</span>
                        ) : null}
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
