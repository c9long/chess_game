import {
  isUntimed,
  type MatchListItem,
  type MatchListResponse,
  type RatingsResponse,
} from '@game/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CivEmblem, civName } from '../components/CivEmblem.tsx'
import {
  ELO_START,
  END_REASON_LABEL,
  MODE_LABEL,
  ordinal,
  RATING_BUCKETS,
} from '../components/match/labels.ts'
import { EloDelta, RankedBadge } from '../components/match/RankedBadge.tsx'
import { Alert, Button, Spinner } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function MatchRow({ m }: { m: MatchListItem }) {
  const delta = m.ratingDelta
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-parchment/10 bg-panel/80 px-5 py-4">
      <span className="w-12 text-center font-display text-2xl font-semibold text-parchment/85">
        {m.status === 'aborted' ? '—' : m.placement ? ordinal(m.placement) : '—'}
      </span>
      <span className="text-gold">
        <CivEmblem civ={m.civ} className="h-8 w-8" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span>
            {MODE_LABEL[m.mode]} ·{' '}
            {isUntimed(m.timeControl)
              ? 'Untimed · vs bots'
              : `${m.timeControl}${m.ranked ? (m.rated ? '' : ' · Not rated') : ' · Casual'}`}
          </span>
          {m.ranked ? <RankedBadge /> : null}
        </p>
        <p className="mt-0.5 text-xs text-parchment/55">
          {when(m.startedAt)} · as {civName(m.civ)}
          {m.status === 'aborted'
            ? ` · ${END_REASON_LABEL[m.endReason ?? ''] ?? 'Cancelled'}`
            : m.endReason
              ? ` · ${END_REASON_LABEL[m.endReason] ?? ''}`
              : ''}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment/65">
          {m.opponents.map((o) => (
            <span key={o.seat} className="flex items-center gap-1">
              <CivEmblem civ={o.civ} className="h-3.5 w-3.5" />
              {o.name}
            </span>
          ))}
        </p>
      </div>
      {m.ratingAfter !== null ? (
        <span className="text-right text-sm tabular-nums" data-testid="history-elo">
          <span className="block font-semibold">
            {m.ratingAfter}
            <span className="ml-1 text-[11px] font-medium text-parchment/45">Elo</span>
          </span>
          {delta !== null ? (
            <EloDelta delta={delta} className="block text-xs font-semibold" />
          ) : null}
        </span>
      ) : null}
    </li>
  )
}

export function History() {
  const { session } = useAppState()
  const [matches, setMatches] = useState<MatchListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [ratings, setRatings] = useState<RatingsResponse['ratings']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async (before?: string) => {
    setLoading(true)
    try {
      const q = before ? `?limit=20&before=${encodeURIComponent(before)}` : '?limit=20'
      const page = await api<MatchListResponse>(`/api/matches${q}`)
      setMatches((prev) => (before ? [...prev, ...page.matches] : page.matches))
      setCursor(page.nextCursor)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    api<RatingsResponse>('/api/ratings/me')
      .then((r) => setRatings(r.ratings))
      .catch(() => {})
  }, [load])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Match history</h1>
      {isGuest(session?.user) ? (
        <p className="mt-2 text-sm text-parchment/60">
          Guest games are casual. Create an account to keep this history and play ranked games.
        </p>
      ) : null}

      {isGuest(session?.user) ? null : (
        <section className="mt-6" aria-labelledby="ratings-title">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="ratings-title" className="font-display text-lg font-semibold">
              Elo ratings
            </h2>
            <Link
              to="/leaderboard"
              className="text-xs font-semibold text-gold underline-offset-2 hover:underline"
            >
              Leaderboard →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="rating-cards">
            {RATING_BUCKETS.map(({ mode, timeControl }) => {
              const r = ratings.find((x) => x.mode === mode && x.timeControl === timeControl)
              return (
                <div
                  key={`${mode}-${timeControl}`}
                  className={`rounded-2xl border px-4 py-3 ${
                    r
                      ? 'border-gold/25 bg-panel/80'
                      : 'border-dashed border-parchment/12 bg-panel/40'
                  }`}
                  data-testid={`rating-${mode}-${timeControl}`}
                >
                  <p className="text-xs text-parchment/55">
                    {MODE_LABEL[mode]} · {timeControl}
                  </p>
                  <p
                    className={`mt-1 font-display text-2xl font-semibold tabular-nums ${r ? '' : 'text-parchment/35'}`}
                  >
                    {r ? r.rating : ELO_START}
                  </p>
                  <p className="text-xs text-parchment/45 tabular-nums">
                    {r
                      ? `${r.gamesPlayed} game${r.gamesPlayed === 1 ? '' : 's'} · peak ${r.peak}`
                      : 'No ranked games yet'}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className="mt-8">
        {error ? (
          <Alert>Could not load your games. Please try again later.</Alert>
        ) : matches.length === 0 && !loading ? (
          <div className="rounded-2xl border border-dashed border-parchment/15 px-6 py-14 text-center text-parchment/60">
            No games yet. Finished games appear here.
          </div>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="match-history">
            {matches.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </ul>
        )}
        {loading ? (
          <div className="mt-6 flex justify-center text-parchment/60">
            <Spinner />
          </div>
        ) : cursor ? (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" onClick={() => load(cursor)}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
