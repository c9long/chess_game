/**
 * A player's public profile (/u/:username): username, member since, Elo per mode and time
 * control (the numbers the leaderboard shows), games played and favourite civ, with Add friend,
 * Challenge (friends) and the Block / Report menu. Match history stays private unless the
 * player turned on "Show my recent games on my profile" (Account page): then registered viewers
 * see their last finished games, with a replay link only on games the viewer played in. Unknown,
 * deleted and suspended players all read "Player not found"; guests have no profile.
 */
import { APP_NAME, CIVILIZATIONS } from '@game/config'
import {
  LEADERBOARD_MIN_GAMES,
  type ProfileGame,
  type ProfileGamePlayer,
  type ProfileRating,
  type PublicProfileResponse,
} from '@game/protocol'
import { Lock, Swords } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { civName } from '../components/CivEmblem.tsx'
import { CivMedallion } from '../components/civ/CivMedallion.tsx'
import { Medal } from '../components/game/Medal.tsx'
import { MODE_LABEL, matchLine, ordinal, resultLabel } from '../components/match/labels.ts'
import { ReplayLink, ResultAsCiv, SeatCivEmblem } from '../components/match/MatchRowParts.tsx'
import { EloDelta, RankedBadge } from '../components/match/RankedBadge.tsx'
import { FriendButton, Monogram } from '../components/social/FriendButton.tsx'
import { PlayerMenu } from '../components/social/PlayerMenu.tsx'
import {
  Alert,
  Button,
  cx,
  EmptyState,
  linkButtonClass,
  Pill,
  RuleList,
  SectionHeading,
  Spinner,
  textLinkClass,
} from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'
import { playedOnLabel, sidesOf } from '../lib/profile-games.ts'
import {
  acceptFriendRequest,
  fetchProfile,
  profilePath,
  sendFriendRequestByUsername,
  useSocial,
} from '../lib/social.ts'

/** "March 2026" from `YYYY-MM`. */
function monthYear(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** One line of the ratings ledger: the bucket, the rating, then peak and games. */
function RatingRow({ r }: { r: ProfileRating }) {
  return (
    <li className="flex items-center gap-4 py-3.5" data-testid="profile-rating">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-parchment">
          {MODE_LABEL[r.mode] ?? r.mode}{' '}
          <span className="lining-nums tabular-nums">{r.timeControl}</span>
        </p>
        <p className="text-ui text-faint lining-nums tabular-nums">
          Peak {r.peak}, {r.gamesPlayed} ranked game{r.gamesPlayed === 1 ? '' : 's'}
        </p>
      </div>
      <p className="flex shrink-0 flex-col items-end">
        <span className="font-display text-title leading-none font-semibold lining-nums tabular-nums">
          {r.rating}
        </span>
        {r.provisional ? (
          <span className="mt-1 text-caption text-faint">
            provisional
            <span className="sr-only">: fewer ranked games than the leaderboard needs</span>
          </span>
        ) : null}
      </p>
    </li>
  )
}

/** Another seat of a recent game: the civ emblem in its seat colour, then the name. */
function SeatName({ p }: { p: ProfileGamePlayer }) {
  const nameClass = 'truncate font-display font-semibold'
  return (
    <li className="inline-flex min-w-0 items-center gap-1.5">
      <SeatCivEmblem seat={p.seat} civ={p.civ} title={civName(p.civ)} />
      {p.username ? (
        <Link
          to={profilePath(p.username)}
          className={cx(textLinkClass, nameClass)}
          data-testid="profile-game-player"
        >
          {p.name}
        </Link>
      ) : (
        <span className={cx(nameClass, 'text-muted')} data-testid="profile-game-player">
          {p.name}
        </span>
      )}
    </li>
  )
}

/** "With" or "Against", then those players (`name`: the list's accessible name). */
function SeatNames({
  label,
  name,
  players,
}: {
  label: string
  name: string
  players: ProfileGamePlayer[]
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="text-faint">{label}</span>
      <ul aria-label={name} className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {players.map((p) => (
          <SeatName key={p.seat} p={p} />
        ))}
      </ul>
    </div>
  )
}

/** One of the owner's recent games: result and civ, the game line, who played. */
function RecentGameRow({ g }: { g: ProfileGame }) {
  const result = resultLabel(g.placement, g.endReason)
  const { partners, opponents } = sidesOf(g)
  const day = playedOnLabel(g.playedOn)
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
      data-testid="profile-game"
    >
      {/* The result next to it already says the placing. */}
      <span aria-hidden="true">
        <Medal place={g.placement} label={g.placement ? ordinal(g.placement) : undefined} />
      </span>
      <div className="min-w-0">
        <ResultAsCiv
          result={result.label}
          tone={result.win ? 'win' : 'plain'}
          seat={g.seat}
          civ={g.civ}
          size="body"
        />
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-faint">
          <time dateTime={g.playedOn}>{day}</time>
          <span>{matchLine(g)}</span>
          {g.ranked ? <RankedBadge /> : null}
        </p>
        <div className="mt-2 flex flex-col gap-1 text-ui">
          {partners.length > 0 ? (
            <SeatNames label="With" name="Partner" players={partners} />
          ) : null}
          <SeatNames label="Against" name="Opponents" players={opponents} />
        </div>
      </div>
      {g.ratingDelta !== null || g.id ? (
        <div className="col-start-2 flex items-center justify-between gap-4 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:justify-start sm:gap-3">
          {g.ratingDelta !== null ? (
            <span className="text-ui lining-nums tabular-nums" data-testid="profile-game-elo">
              <EloDelta delta={g.ratingDelta} className="font-semibold" />{' '}
              <span className="text-caption text-faint">Elo</span>
            </span>
          ) : (
            <span />
          )}
          {g.id ? (
            <ReplayLink
              id={g.id}
              rulesVersion={g.rulesVersion}
              label={`${result.label} as ${civName(g.civ)}, ${day}`}
              testId="profile-game-replay"
            />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** A link to the Account page's recent-games setting, in running copy. */
const settingLink = (
  <Link to="/account#profile-history" className={textLinkClass}>
    Account page
  </Link>
)

/** The owner's recent games (they turned them on), or an empty state. */
function RecentGamesSection({ games, self }: { games: ProfileGame[]; self: boolean }) {
  return (
    <section aria-labelledby="profile-games">
      <SectionHeading
        id="profile-games"
        title="Recent games"
        description={
          self ? (
            <>
              Your last finished games, as registered players see them. You can hide them from your{' '}
              {settingLink}.
            </>
          ) : (
            'Their last finished games. Replays are only open to the players in each game.'
          )
        }
      />
      {games.length > 0 ? (
        <RuleList data-testid="profile-games">
          {games.map((g, i) => (
            // One response's rows never reorder, and a viewer gets no id for most games.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <RecentGameRow key={i} g={g} />
          ))}
        </RuleList>
      ) : self ? (
        <p className="border-y border-rule py-4 text-ui text-muted">
          Your finished games will show here.{' '}
          <Link to="/play" className={textLinkClass}>
            Play a game
          </Link>
        </p>
      ) : (
        <p className="border-y border-rule py-4 text-ui text-muted">No finished games yet.</p>
      )}
    </section>
  )
}

/** Why there are no recent games on the profile: private, or shown to registered players only. */
function HistoryPrivateNote({ self, guest }: { self: boolean; guest: boolean }) {
  const text = self ? (
    <span>
      Your match history is private: only the players in a game can see it. You can show your recent
      games here from your {settingLink}.
    </span>
  ) : guest ? (
    'Match history is private. Players who share their recent games show them to registered players only.'
  ) : (
    'Match history is private: only the players in a game can see it.'
  )
  return (
    <p
      className="flex items-center gap-2 text-caption text-faint"
      data-testid="profile-history-private"
    >
      <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brass" />
      {text}
    </p>
  )
}

function NotFound() {
  return (
    <div data-testid="profile-not-found">
      <h1 className="mb-6 font-display text-title font-semibold">Player not found</h1>
      <EmptyState
        title="No player has that username"
        action={
          <div className="flex flex-wrap gap-3">
            <Link to="/friends" className={linkButtonClass('primary')}>
              Search for players
            </Link>
            <Link to="/leaderboard" className={linkButtonClass('quiet')}>
              Leaderboard
            </Link>
          </div>
        }
      >
        Check the spelling of the username, or search for the player on your Friends page.
      </EmptyState>
    </div>
  )
}

export function Profile() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useAppState()
  const guest = isGuest(session?.user)
  const version = useSocial((s) => s.version)
  // Both are tagged with the username they belong to, so moving between /u/a and /u/b (the
  // route reuses this component) never shows a's profile or error under b's URL.
  const [loaded, setLoaded] = useState<{ for: string; profile: PublicProfileResponse | null }>()
  const [failed, setFailed] = useState<{ for: string; message: string }>()
  const profile = loaded?.for === username ? loaded.profile : undefined
  const error = failed?.for === username ? failed.message : undefined

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` refetches after friend or block changes
  useEffect(() => {
    let cancelled = false
    fetchProfile(username)
      .then((p) => {
        if (cancelled) return
        setLoaded({ for: username, profile: p })
        setFailed(undefined)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setLoaded({ for: username, profile: null })
          setFailed(undefined)
        } else {
          setFailed({
            for: username,
            message:
              err instanceof ApiError && err.status === 429
                ? 'Too many profiles opened. Wait a moment and try again.'
                : 'This profile didn’t load. Check your connection and reload the page.',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [username, version])

  useEffect(() => {
    if (profile) document.title = `${profile.username} · ${APP_NAME}`
    else if (profile === null) document.title = `Player not found · ${APP_NAME}`
  }, [profile])

  const page = 'mx-auto w-full max-w-3xl px-4 py-10 sm:py-14'
  if (error && profile === undefined) {
    return (
      <div className={page}>
        <Alert>{error}</Alert>
      </div>
    )
  }
  if (profile === undefined) {
    return (
      <div className="mt-16 flex justify-center text-faint" role="status">
        <Spinner />
        <span className="sr-only">Loading profile…</span>
      </div>
    )
  }
  if (profile === null) {
    return (
      <div className={page}>
        <NotFound />
      </div>
    )
  }

  const p = profile
  const civ = p.favoriteCiv
    ? (CIVILIZATIONS.find((c) => c.slug === p.favoriteCiv?.slug) ?? {
        slug: p.favoriteCiv.slug,
        name: p.favoriteCiv.slug,
      })
    : undefined
  const relation = p.relation === 'unavailable' ? 'none' : p.relation
  const canAdd = p.relation !== 'self' && !guest && !p.blockedByYou

  return (
    <div className={cx(page, 'flex flex-col gap-10')} data-testid="profile">
      {/* The player's nameplate: monogram, name and when they joined, with the actions. */}
      <header className="relative flex flex-wrap items-center gap-x-5 gap-y-4 overflow-hidden rounded-plate border border-rule-brass bg-surface-rail py-5 pr-5 pl-6 shadow-plate sm:py-6 sm:pr-6 sm:pl-7">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brass/70" />
        <Monogram name={p.username} size="lg" />
        <div className="min-w-0 flex-1 basis-56">
          {/* Wraps rather than truncates: the profile is where the full name must show. */}
          <h1
            className="font-display text-title font-semibold wrap-anywhere"
            data-testid="profile-username"
          >
            {p.username}
          </h1>
          <p className="mt-1.5 text-ui text-muted">Member since {monthYear(p.memberSince)}</p>
          <p className="text-ui text-faint lining-nums tabular-nums">
            {p.gamesPlayed} game{p.gamesPlayed === 1 ? '' : 's'} played
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {p.relation === 'self' ? (
            <Pill tone="brass">This is you</Pill>
          ) : canAdd ? (
            <FriendButton
              name={p.username}
              relation={relation}
              capReached={p.capReached}
              outgoingFull={p.outgoingFull}
              onAdd={() => sendFriendRequestByUsername(p.username)}
              onAccept={() => (p.userId ? acceptFriendRequest(p.userId) : Promise.resolve())}
              size="md"
              testId="profile-add"
            />
          ) : null}
          {p.relation === 'friends' && p.userId ? (
            <Button
              size="sm"
              onClick={() => navigate(`/friends?challenge=${encodeURIComponent(p.userId ?? '')}`)}
              data-testid="profile-challenge"
            >
              <Swords aria-hidden="true" className="h-4 w-4" />
              Challenge
            </Button>
          ) : null}
          {p.relation !== 'self' ? (
            <span className="ml-auto sm:ml-0">
              <PlayerMenu
                name={p.username}
                target={{ username: p.username }}
                userId={p.userId}
                viewerRegistered={!guest}
                targetRegistered
                blocked={p.blockedByYou}
                reportable
                testId="profile-menu"
              />
            </span>
          ) : null}
        </div>
      </header>

      {error || p.blockedByYou || guest ? (
        <div className="-mt-4 flex flex-col gap-3">
          {error ? <Alert>{error}</Alert> : null}
          {p.blockedByYou ? (
            <Alert tone="info">
              You blocked this player. They can’t send you friend requests or challenges. To unblock
              them, open the menu beside their name or go to your{' '}
              <Link to="/friends" className={textLinkClass}>
                Friends page
              </Link>
              .
            </Alert>
          ) : null}
          {guest ? (
            <p className="text-ui text-muted">
              <Link to="/sign-up" className={cx(textLinkClass, 'font-semibold')}>
                Create an account
              </Link>{' '}
              to add friends.
            </p>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="profile-ratings">
        <SectionHeading
          id="profile-ratings"
          title="Ratings"
          description="Elo from ranked games. Each mode and time control has its own rating."
        />
        {p.ratings.length === 0 ? (
          <p className="border-y border-rule py-4 text-ui text-muted" data-testid="profile-unrated">
            No ranked games yet.
          </p>
        ) : (
          <>
            <RuleList>
              {p.ratings.map((r) => (
                <RatingRow key={`${r.mode}-${r.timeControl}`} r={r} />
              ))}
            </RuleList>
            {p.ratings.some((r) => r.provisional) ? (
              <p className="mt-3 text-caption text-faint" aria-hidden="true">
                Provisional: fewer than {LEADERBOARD_MIN_GAMES} ranked games, so not on the
                leaderboard yet.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="profile-civ">
        <SectionHeading id="profile-civ" title="Favourite civilization" />
        {civ && p.favoriteCiv ? (
          <div
            className="flex items-center gap-4 border-y border-rule py-4"
            data-testid="profile-civ"
          >
            <CivMedallion civ={civ} size="xl" />
            <div className="min-w-0">
              <p className="font-display text-heading font-semibold">{civ.name}</p>
              <p className="text-ui text-faint lining-nums tabular-nums">
                Most played, {p.favoriteCiv.games} finished game
                {p.favoriteCiv.games === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        ) : (
          <p className="border-y border-rule py-4 text-ui text-muted">No finished games yet.</p>
        )}
      </section>

      {p.recentGames ? (
        <RecentGamesSection games={p.recentGames} self={p.relation === 'self'} />
      ) : (
        <HistoryPrivateNote self={p.relation === 'self'} guest={guest} />
      )}
    </div>
  )
}
