import {
  isUntimed,
  type MatchListItem,
  type MatchListResponse,
  type RatingsResponse,
} from '@game/protocol'
import { useCallback, useEffect, useState } from 'react'
import { CivEmblem, civName } from '../components/CivEmblem.tsx'
import { END_REASON_LABEL, MODE_LABEL, ordinal } from '../components/match/labels.ts'
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
        <p className="text-sm font-semibold">
          {MODE_LABEL[m.mode]} ·{' '}
          {isUntimed(m.timeControl)
            ? 'Untimed · vs bots'
            : `${m.timeControl} · ${m.rated ? 'Rated' : 'Casual'}`}
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
        <span className="text-right text-sm tabular-nums">
          <span className="block font-semibold">{m.ratingAfter}</span>
          <span
            className={`block text-xs ${delta && delta > 0 ? 'text-[#7fd8b7]' : delta && delta < 0 ? 'text-seat-south-light' : 'text-parchment/50'}`}
          >
            {delta && delta > 0 ? `+${delta}` : (delta ?? '')}
          </span>
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
          Guest games are casual. Create an account to keep this history and earn ratings.
        </p>
      ) : null}

      {ratings.length > 0 ? (
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Ratings">
          {ratings.map((r) => (
            <div
              key={`${r.mode}-${r.timeControl}`}
              className="rounded-2xl border border-parchment/10 bg-panel/80 px-4 py-3"
            >
              <p className="text-xs text-parchment/55">
                {MODE_LABEL[r.mode]} · {r.timeControl}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold">{r.rating}</p>
              <p className="text-xs text-parchment/45">
                {r.gamesPlayed} game{r.gamesPlayed === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </section>
      ) : null}

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
