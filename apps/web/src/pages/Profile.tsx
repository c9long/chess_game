/**
 * A player's public profile (/u/:username): username, member since, Elo per mode and time
 * control (the numbers the leaderboard shows), games played and favourite civ, with Add friend,
 * Challenge (friends) and the Block / Report menu. Match history stays private. Unknown,
 * deleted and suspended players all read "Player not found"; guests have no profile.
 */
import { APP_NAME, CIVILIZATIONS } from '@game/config'
import {
  LEADERBOARD_MIN_GAMES,
  type ProfileRating,
  type PublicProfileResponse,
} from '@game/protocol'
import { CalendarDays, Lock, Swords, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CivMedallion } from '../components/civ/CivMedallion.tsx'
import { MODE_LABEL } from '../components/match/labels.ts'
import { FriendButton } from '../components/social/FriendButton.tsx'
import { PlayerMenu } from '../components/social/PlayerMenu.tsx'
import { Alert, Button, linkButtonClass, Pill, Spinner } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { isGuest, useAppState } from '../lib/app-state.tsx'
import {
  acceptFriendRequest,
  fetchProfile,
  sendFriendRequestByUsername,
  useSocial,
} from '../lib/social.ts'

const AVATAR_COLORS = ['#c0392b', '#2e6fd6', '#d4a017', '#1f9d6b', '#8e5bd6', '#d6662e']

function BigAvatar({ name }: { name: string }) {
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length] as string
  return (
    <span
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-display text-2xl font-semibold uppercase sm:h-20 sm:w-20 sm:text-3xl"
      style={{ backgroundColor: `${color}2e`, color, boxShadow: `inset 0 0 0 1px ${color}55` }}
    >
      {[...name][0] ?? '?'}
    </span>
  )
}

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

function RatingCard({ r }: { r: ProfileRating }) {
  return (
    <li
      className="rounded-2xl border border-parchment/10 bg-panel/80 px-4 py-3"
      data-testid="profile-rating"
    >
      <p className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">
        {MODE_LABEL[r.mode] ?? r.mode} · {r.timeControl}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-3xl leading-none font-semibold tabular-nums">
          {r.rating}
        </span>
        {r.provisional ? (
          <span className="text-xs text-parchment/55">
            provisional
            <span className="sr-only">: fewer ranked games than the leaderboard needs</span>
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-xs text-parchment/55 tabular-nums">
        Peak {r.peak} · {r.gamesPlayed} ranked game{r.gamesPlayed === 1 ? '' : 's'}
      </p>
    </li>
  )
}

function NotFound() {
  return (
    <div
      className="mt-8 rounded-2xl border border-dashed border-parchment/15 px-6 py-12 text-center"
      data-testid="profile-not-found"
    >
      <h1 className="font-display text-2xl font-semibold">Player not found</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-parchment/65">
        Check the spelling of the username, or search for players on your Friends page.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/friends" className={linkButtonClass('primary')}>
          Find players
        </Link>
        <Link to="/leaderboard" className={linkButtonClass('secondary')}>
          Leaderboard
        </Link>
      </div>
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
                : 'Could not load this profile. Please try again later.',
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

  if (error && profile === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <Alert>{error}</Alert>
      </div>
    )
  }
  if (profile === undefined) {
    return (
      <div className="mt-16 flex justify-center text-parchment/60" role="status">
        <Spinner />
        <span className="sr-only">Loading profile…</span>
      </div>
    )
  }
  if (profile === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
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
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12" data-testid="profile">
      <header className="flex flex-wrap items-center gap-4 sm:gap-5">
        <BigAvatar name={p.username} />
        <div className="min-w-0 flex-1">
          {/* Wraps rather than truncates: the profile is where the full name must show. */}
          <h1
            className="font-display text-2xl font-semibold tracking-tight break-all sm:text-3xl"
            data-testid="profile-username"
          >
            {p.username}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-parchment/65">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="h-4 w-4 text-parchment/45" />
              Member since {monthYear(p.memberSince)}
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Trophy aria-hidden="true" className="h-4 w-4 text-parchment/45" />
              {p.gamesPlayed} game{p.gamesPlayed === 1 ? '' : 's'} played
            </span>
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {p.relation === 'self' ? (
            <Pill tone="gold">This is you</Pill>
          ) : canAdd ? (
            <FriendButton
              name={p.username}
              relation={relation}
              capReached={p.capReached}
              outgoingFull={p.outgoingFull}
              onAdd={() => sendFriendRequestByUsername(p.username)}
              onAccept={() => (p.userId ? acceptFriendRequest(p.userId) : Promise.resolve())}
              testId="profile-add"
            />
          ) : null}
          {p.relation === 'friends' && p.userId ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate(`/friends?challenge=${encodeURIComponent(p.userId ?? '')}`)}
              data-testid="profile-challenge"
            >
              <Swords aria-hidden="true" className="h-4 w-4" />
              Challenge
            </Button>
          ) : null}
          {p.relation !== 'self' ? (
            <PlayerMenu
              name={p.username}
              target={{ username: p.username }}
              userId={p.userId}
              viewerRegistered={!guest}
              targetRegistered
              blocked={p.blockedByYou}
              reportable
              className="ml-auto h-9 w-9 rounded-lg sm:ml-0"
              testId="profile-menu"
            />
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="mt-6">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {p.blockedByYou ? (
        <div className="mt-6">
          <Alert tone="info">
            You blocked this player. They can’t send you friend requests or challenges. Unblock them
            from the ⋮ menu or your Friends page.
          </Alert>
        </div>
      ) : null}
      {guest ? (
        <p className="mt-4 text-sm text-parchment/65">
          <Link
            to="/sign-up"
            className="font-semibold text-gold underline-offset-2 hover:underline"
          >
            Create an account
          </Link>{' '}
          to add friends.
        </p>
      ) : null}

      <section className="mt-8" aria-labelledby="profile-ratings">
        <h2 id="profile-ratings" className="mb-3 font-display text-lg font-semibold">
          Ratings
        </h2>
        {p.ratings.length === 0 ? (
          <p className="text-sm text-parchment/60" data-testid="profile-unrated">
            No ranked games yet.
          </p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {p.ratings.map((r) => (
                <RatingCard key={`${r.mode}-${r.timeControl}`} r={r} />
              ))}
            </ul>
            {p.ratings.some((r) => r.provisional) ? (
              <p className="mt-2 text-xs text-parchment/55" aria-hidden="true">
                Provisional: fewer than {LEADERBOARD_MIN_GAMES} ranked games, so not on the
                leaderboard yet.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="mt-8" aria-labelledby="profile-civ">
        <h2 id="profile-civ" className="mb-3 font-display text-lg font-semibold">
          Favourite civilization
        </h2>
        {civ && p.favoriteCiv ? (
          <div
            className="flex items-center gap-4 rounded-2xl border border-parchment/10 bg-panel/80 px-4 py-3"
            data-testid="profile-civ"
          >
            <CivMedallion civ={civ} size="xl" />
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold">{civ.name}</p>
              <p className="text-xs text-parchment/60 tabular-nums">
                Most played · {p.favoriteCiv.games} finished game
                {p.favoriteCiv.games === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-parchment/60">No finished games yet.</p>
        )}
      </section>

      <p className="mt-8 flex items-center gap-2 border-t border-parchment/10 pt-4 text-xs text-parchment/55">
        <Lock aria-hidden="true" className="h-3.5 w-3.5" />
        Match history is private: only the players in a game can see it.
      </p>
    </div>
  )
}
