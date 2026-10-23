import {
  isUntimed,
  type MatchListItem,
  type MatchListResponse,
  type RatingsResponse,
} from '@game/protocol'
import { RULES_VERSION } from '@game/rules'
import { Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CivEmblem, civName } from '../components/CivEmblem.tsx'
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
import { FriendButton } from '../components/social/FriendButton.tsx'
import { PlayerMenu } from '../components/social/PlayerMenu.tsx'
import {
  Alert,
  Button,
  cx,
  EmptyState,
  linkButtonClass,
  PageTitle,
  RuleList,
  SEAT_CLASSES,
  SEAT_ORDER,
  SectionHeading,
  Spinner,
} from '../components/ui.tsx'
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

/** "Free-for-all, 10+0, casual" (ranked games add the Ranked tag beside it). */
function matchLine(m: MatchListItem): string {
  const untimed = isUntimed(m.timeControl)
  return [
    MODE_LABEL[m.mode] ?? m.mode,
    untimed ? 'untimed, against bots' : m.timeControl,
    !m.ranked && !untimed ? 'casual' : null,
    m.ranked && !m.rated ? 'not rated' : null,
  ]
    .filter(Boolean)
    .join(', ')
}

function MatchRow({ m, viewerRegistered }: { m: MatchListItem; viewerRegistered: boolean }) {
  const caps = capsFrom(useSocial((s) => s.friends))
  const delta = m.ratingDelta
  const aborted = m.status === 'aborted'
  const place = aborted ? null : m.placement
  const draw = place === 1 && DRAW_REASONS.has(m.endReason ?? '')
  const win = place === 1 && !draw
  const reason = aborted
    ? (END_REASON_LABEL[m.endReason ?? ''] ?? 'Cancelled')
    : m.endReason
      ? (END_REASON_LABEL[m.endReason] ?? '')
      : ''
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5">
      <Medal place={place} size="lg" label={place ? ordinal(place) : undefined} />
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span
            className={cx(
              'font-display text-lead font-semibold',
              win ? 'text-gold' : aborted ? 'text-muted' : 'text-parchment',
            )}
          >
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
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-ui text-muted">
            as
            <span className={SEAT_CLASSES[SEAT_ORDER[m.seat] ?? 'south'].text}>
              <CivEmblem civ={m.civ} className="h-4 w-4" />
            </span>
            <span className="truncate font-display font-semibold text-parchment">
              {civName(m.civ)}
            </span>
          </span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-faint">
          <span>{matchLine(m)}</span>
          {m.ranked ? <RankedBadge /> : null}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-ui text-faint">
          <time dateTime={m.startedAt} title={when(m.startedAt)}>
            {relativeTime(m.startedAt)}
          </time>
          {reason ? <span>{reason}</span> : null}
        </p>
        {m.opponents.length > 0 ? (
          <ul aria-label="Opponents" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {m.opponents.map((o) => (
              <li key={o.seat} className="inline-flex min-w-0 items-center gap-1.5 text-ui">
                <span className={SEAT_CLASSES[SEAT_ORDER[o.seat] ?? 'south'].text}>
                  <CivEmblem civ={o.civ} className="h-4 w-4" />
                </span>
                <span className="truncate font-display font-semibold text-muted">{o.name}</span>
                {o.friend ? (
                  <FriendButton
                    name={o.name}
                    relation={o.friend}
                    capReached={caps.capReached}
                    outgoingFull={caps.outgoingFull}
                    onAdd={() => sendFriendRequest(m.id, o.seat)}
                    onAccept={() => sendFriendRequest(m.id, o.seat)}
                    shortOnPhones
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
                    compact
                    testId="history-menu"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="col-start-2 flex items-center justify-between gap-4 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:justify-start sm:gap-3">
        {m.ratingAfter !== null ? (
          <span
            className="flex items-baseline gap-2 lining-nums tabular-nums"
            data-testid="history-elo"
          >
            <span className="font-display text-lead font-semibold">{m.ratingAfter}</span>
            <span className="text-caption text-faint">Elo</span>
            {delta !== null ? <EloDelta delta={delta} className="text-ui font-semibold" /> : null}
          </span>
        ) : (
          <span />
        )}
        {m.status === 'finished' ? (
          m.rulesVersion === RULES_VERSION ? (
            <Link
              to={`/history/${m.id}`}
              className={linkButtonClass('secondary', '', 'sm')}
              data-testid="history-replay"
            >
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              Replay
            </Link>
          ) : (
            <Link
              to={`/history/${m.id}`}
              className={linkButtonClass('quiet', '', 'sm')}
              data-testid="history-replay"
            >
              Details
            </Link>
          )
        ) : null}
      </div>
    </li>
  )
}

/** Your Elo in each mode and time control: one strip, cells divided by rules. */
function RatingsStrip({ ratings }: { ratings: RatingsResponse['ratings'] }) {
  return (
    <div
      className="grid grid-cols-2 overflow-hidden rounded-panel border border-rule bg-surface-rail shadow-rim sm:grid-cols-4"
      data-testid="rating-cards"
    >
      {RATING_BUCKETS.map(({ mode, timeControl }, i) => {
        const r = ratings.find((x) => x.mode === mode && x.timeControl === timeControl)
        return (
          <div
            key={`${mode}-${timeControl}`}
            className={cx(
              'px-4 py-4 sm:px-5',
              i % 2 === 1 && 'border-l border-rule',
              i >= 2 && 'border-t border-rule sm:border-t-0',
              i === 2 && 'sm:border-l',
            )}
            data-testid={`rating-${mode}-${timeControl}`}
          >
            <p className="text-ui text-muted">
              {MODE_LABEL[mode]}{' '}
              <span className="text-faint lining-nums tabular-nums">{timeControl}</span>
            </p>
            <p
              className={cx(
                'mt-1 font-display text-title leading-tight font-semibold lining-nums tabular-nums',
                r ? 'text-parchment' : 'text-faint',
              )}
            >
              {r ? r.rating : ELO_START}
            </p>
            <p className="text-caption text-faint lining-nums tabular-nums">
              {r
                ? `${r.gamesPlayed} game${r.gamesPlayed === 1 ? '' : 's'}, peak ${r.peak}`
                : 'No ranked games yet'}
            </p>
          </div>
        )
      })}
    </div>
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

  const guest = isGuest(session?.user)
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:py-14 [&>header]:mb-0">
      <PageTitle
        title="Match history"
        subtitle={
          guest
            ? 'Guest games are casual. Create an account to keep this history and play ranked games.'
            : 'Your finished games, newest first, with a replay of each one.'
        }
      />

      {guest ? null : (
        <section aria-labelledby="ratings-title">
          <SectionHeading
            id="ratings-title"
            title="Elo ratings"
            actions={
              <Link to="/leaderboard" className={linkButtonClass('quiet', '', 'sm')}>
                Leaderboard
              </Link>
            }
          />
          <RatingsStrip ratings={ratings} />
        </section>
      )}

      <section aria-labelledby="games-title">
        <SectionHeading id="games-title" title="Games" />
        {error ? (
          <Alert>Your games didn’t load. Check your connection and reload the page.</Alert>
        ) : matches.length === 0 && !loading ? (
          <EmptyState
            title="No games yet"
            action={
              <Link to="/play" className={linkButtonClass('primary')}>
                Find a game
              </Link>
            }
          >
            Finished games show up here, with a replay of every move.
          </EmptyState>
        ) : (
          <RuleList data-testid="match-history">
            {matches.map((m) => (
              <MatchRow key={m.id} m={m} viewerRegistered={!guest} />
            ))}
          </RuleList>
        )}
        {loading ? (
          <div className="mt-6 flex justify-center text-faint" role="status">
            <Spinner />
            <span className="sr-only">Loading your games…</span>
          </div>
        ) : cursor ? (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" onClick={() => load(cursor)}>
              Show older games
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
