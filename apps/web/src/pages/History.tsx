import {
  isUntimed,
  type MatchListItem,
  type MatchListResponse,
  type RatingsResponse,
} from '@game/protocol'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CivEmblem, civName } from '../components/CivEmblem.tsx'
import { ClockIcon } from '../components/game/icons.tsx'
import { Medal } from '../components/game/Medal.tsx'
import {
  ELO_START,
  END_REASON_LABEL,
  MODE_LABEL,
  ordinal,
  RATING_BUCKETS,
  relativeTime,
} from '../components/match/labels.ts'
import { EloDelta, RankedBadge } from '../components/match/RankedBadge.tsx'
import { seatHex } from '../components/match/seats.ts'
import { FriendButton } from '../components/social/FriendButton.tsx'
import { PlayerMenu } from '../components/social/PlayerMenu.tsx'
import { Alert, Button, Spinner } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'
import { capsFrom, sendFriendRequest, useSocial } from '../lib/social.ts'

const pageQuery = (before?: string) =>
  before ? `?limit=20&before=${encodeURIComponent(before)}` : '?limit=20'

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const DRAW_REASONS = new Set(['agreed_draw', 'move_limit'])

function HistoryChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-parchment/15 bg-ink/40 px-2 text-[11px] font-medium text-parchment/70">
      {children}
    </span>
  )
}

function MatchRow({ m, viewerRegistered }: { m: MatchListItem; viewerRegistered: boolean }) {
  const caps = capsFrom(useSocial((s) => s.friends))
  const delta = m.ratingDelta
  const aborted = m.status === 'aborted'
  const place = aborted ? null : m.placement
  const draw = place === 1 && DRAW_REASONS.has(m.endReason ?? '')
  const win = place === 1 && !draw
  const bar = win ? '#7fd8b7' : draw ? 'rgba(244,239,230,0.3)' : 'transparent'
  const untimed = isUntimed(m.timeControl)
  return (
    <li className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 overflow-hidden rounded-2xl border border-parchment/10 bg-panel/80 py-3.5 pr-4 pl-4 sm:items-center sm:gap-x-4 sm:py-4 sm:pr-5 sm:pl-5">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: bar }}
      />
      <span className="flex flex-col items-center gap-1.5">
        <Medal place={place} size="lg" label={place ? ordinal(place) : undefined} />
      </span>
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: `${seatHex(m.seat)}26`, color: seatHex(m.seat) }}
          >
            <CivEmblem civ={m.civ} className="h-5 w-5" />
          </span>
          <span className="truncate">
            {aborted
              ? 'Cancelled'
              : win
                ? 'Victory'
                : draw
                  ? 'Draw'
                  : place
                    ? `${ordinal(place)} place`
                    : m.status === 'in_progress'
                      ? 'In progress'
                      : 'Finished'}
            <span className="font-normal text-parchment/50"> · as {civName(m.civ)}</span>
          </span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <HistoryChip>{MODE_LABEL[m.mode]}</HistoryChip>
          <HistoryChip>
            {untimed ? (
              'Untimed · vs bots'
            ) : (
              <>
                <ClockIcon /> {m.timeControl}
              </>
            )}
          </HistoryChip>
          {m.ranked ? <RankedBadge /> : untimed ? null : <HistoryChip>Casual</HistoryChip>}
          {m.ranked && !m.rated ? <HistoryChip>Not rated</HistoryChip> : null}
        </div>
        <p className="mt-2 text-xs text-parchment/55">
          <time dateTime={m.startedAt} title={when(m.startedAt)}>
            {relativeTime(m.startedAt)}
          </time>
          {aborted
            ? ` · ${END_REASON_LABEL[m.endReason ?? ''] ?? 'Cancelled'}`
            : m.endReason
              ? ` · ${END_REASON_LABEL[m.endReason] ?? ''}`
              : ''}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment/65">
          {m.opponents.map((o) => (
            <span key={o.seat} className="inline-flex min-w-0 items-center gap-1">
              <span style={{ color: seatHex(o.seat) }}>
                <CivEmblem civ={o.civ} className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">{o.name}</span>
              {o.friend ? (
                <FriendButton
                  name={o.name}
                  relation={o.friend}
                  capReached={caps.capReached}
                  outgoingFull={caps.outgoingFull}
                  onAdd={() => sendFriendRequest(m.id, o.seat)}
                  onAccept={() => sendFriendRequest(m.id, o.seat)}
                  className="ml-1"
                  testId="history-friend"
                />
              ) : null}
              {o.reportable || o.blocked !== null ? (
                <PlayerMenu
                  name={o.name}
                  target={{ matchId: m.id, seat: o.seat as 0 | 1 | 2 | 3 }}
                  viewerRegistered={viewerRegistered}
                  targetRegistered={o.blocked !== null}
                  blocked={o.blocked === true}
                  reportable={o.reportable}
                  className="ml-0.5"
                  testId="history-menu"
                />
              ) : null}
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
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                delta > 0 ? 'bg-[#7fd8b7]/12' : delta < 0 ? 'bg-seat-south/15' : 'bg-parchment/10'
              }`}
            >
              <EloDelta delta={delta} />
            </span>
          ) : null}
        </span>
      ) : (
        <span />
      )}
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

  // The cursor of every loaded page, so friend buttons can be refreshed in place.
  const pages = useRef<(string | undefined)[]>([])
  const socialVersion = useSocial((s) => s.version)

  const load = useCallback(async (before?: string) => {
    setLoading(true)
    try {
      const page = await api<MatchListResponse>(`/api/matches${pageQuery(before)}`)
      pages.current = before ? [...pages.current, before] : [undefined]
      setMatches((prev) => (before ? [...prev, ...page.matches] : page.matches))
      setCursor(page.nextCursor)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // A friend change anywhere (a request from another row or device, an answer, a removal):
  // refresh every opponent's friend state, since the same player can appear in many rows.
  useEffect(() => {
    if (socialVersion === 0 || pages.current.length === 0) return
    let cancelled = false
    Promise.all(pages.current.map((b) => api<MatchListResponse>(`/api/matches${pageQuery(b)}`)))
      .then((fresh) => {
        if (cancelled) return
        const byMatch = new Map(fresh.flatMap((p) => p.matches).map((m) => [m.id, m]))
        setMatches((prev) =>
          prev.map((m) => {
            const f = byMatch.get(m.id)
            if (!f) return m
            return {
              ...m,
              opponents: m.opponents.map((o) => {
                const x = f.opponents.find((y) => y.seat === o.seat)
                // `friend` and `blocked` may legitimately turn null (a block hides Add friend).
                return x ? { ...o, friend: x.friend, blocked: x.blocked } : o
              }),
            }
          }),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [socialVersion])

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
                    className={`mt-1 font-display text-2xl font-semibold tabular-nums ${r ? '' : 'text-parchment/60'}`}
                  >
                    {r ? r.rating : ELO_START}
                  </p>
                  <p className="text-xs text-parchment/65 tabular-nums">
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
              <MatchRow key={m.id} m={m} viewerRegistered={!isGuest(session?.user)} />
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
