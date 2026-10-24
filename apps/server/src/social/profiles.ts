/**
 * Player search, public profiles and the profile privacy settings ("who can send me friend
 * requests", "show my recent games on my profile") (PLAN §3 "Friends", 2026-10-17). Postgres
 * only: exact usernames use the unique index on `users.username` (stored normalized,
 * lowercase), search-as-you-type uses a pg_trgm GIN index on `lower(username)` (migration
 * 0011), or a prefix match when the extension is missing.
 */
import {
  blocks,
  civilizations,
  type Executor,
  eloRatings,
  matches,
  matchPlayers,
  userSettings,
  users,
} from '@game/db'
import {
  botName,
  LEADERBOARD_MIN_GAMES,
  PLAYER_SEARCH_MAX_RESULTS,
  type PlayerRelation,
  type PlayerSearchResult,
  PROFILE_RECENT_GAMES,
  type ProfileGame,
  type ProfileGamePlayer,
  type ProfileRating,
  type PublicProfileResponse,
  type SocialSettingsBody,
  type SocialSettingsResponse,
} from '@game/protocol'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { isRegisteredSeat, type PlayerRow, playersOf, ratingDeltaOf } from '../game/match-rows.ts'
import {
  type Counts,
  countsOf,
  relationsOf,
  SHARED_STATUSES,
  type SocialLimits,
  usernameOf,
} from './friends.ts'

/** Live registered accounts: a username, not a guest, not deleted, not suspended. */
const listable = () =>
  and(
    isNotNull(users.username),
    eq(users.isAnonymous, false),
    isNull(users.deletedAt),
    isNull(users.suspendedAt),
  )

/**
 * The live registered, unsuspended account with this username (any case), or undefined. Uses
 * the unique index on `users.username`, which holds the lowercase username.
 */
export async function findByUsername(db: Executor, username: string) {
  const [u] = await db
    .select({
      id: users.id,
      username: users.username,
      displayUsername: users.displayUsername,
      name: users.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.username, username.trim().toLowerCase()), listable()))
  return u
}

/** Whether pg_trgm is installed (cached per database handle; checked on first search). */
const trigramCache = new WeakMap<object, Promise<boolean>>()

export function hasTrigram(db: Executor): Promise<boolean> {
  let known = trigramCache.get(db)
  if (!known) {
    known = db
      .execute(sql`select 1 as one from pg_extension where extname = 'pg_trgm'`)
      .then((rows) => rows.length > 0)
      .catch(() => false)
    trigramCache.set(db, known)
  }
  return known
}

/** `q` for a LIKE pattern: `_` (allowed in usernames) and `%`/`\` escaped. */
export function likeEscape(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * The search query itself: up to `limit` listable players other than `me`, not blocked by
 * `me`, whose lowercase username starts with `q` or (with pg_trgm) contains it or resembles it.
 * Prefix matches first (shortest first), then by trigram similarity.
 */
export function searchQuery(
  db: Executor,
  me: string,
  query: string,
  trigram: boolean,
  limit = PLAYER_SEARCH_MAX_RESULTS,
) {
  const q = query.trim().toLowerCase()
  const lname = sql`lower(${users.username})`
  const isPrefix = sql<boolean>`(${lname} like ${`${likeEscape(q)}%`})`
  const matched: SQL | undefined = trigram
    ? or(sql`${lname} like ${`%${likeEscape(q)}%`}`, sql`${lname} % ${q}`)
    : isPrefix
  const similarity = trigram ? sql<number>`similarity(${lname}, ${q})` : sql<number>`0::real`
  return db
    .select({
      id: users.id,
      username: users.username,
      displayUsername: users.displayUsername,
      name: users.name,
      prefix: isPrefix,
      similarity,
    })
    .from(users)
    .where(
      and(
        listable(),
        ne(users.id, me),
        matched,
        // Players you blocked are hidden. Players who blocked you are listed like anyone else
        // (adding them fails with the neutral NOT_ELIGIBLE): their profile and leaderboard
        // row stay public, so hiding them here would reveal the block.
        // Uncorrelated, so it runs once (a hashed subplan), not once per candidate.
        notInArray(
          users.id,
          db.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.blockerId, me)),
        ),
      ),
    )
    .orderBy(
      desc(isPrefix),
      ...(trigram ? [desc(similarity)] : []),
      sql`length(${users.username})`,
      asc(users.username),
    )
    .limit(limit)
}

/** Finished games per user (any mode). */
async function finishedGames(db: Executor, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const rows = await db
    .select({ userId: matchPlayers.userId, n: count() })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(and(inArray(matchPlayers.userId, ids), eq(matches.status, 'finished')))
    .groupBy(matchPlayers.userId)
  for (const r of rows) if (r.userId) out.set(r.userId, r.n)
  return out
}

/** "Can't add": you can't send a new request yourself (your caps). */
function shownRelation(
  relation: PlayerRelation,
  counts: Counts | undefined,
  limits: SocialLimits,
): PlayerRelation {
  if (relation !== 'none' || !counts) return relation
  return counts.friends >= limits.maxFriends || counts.outgoing >= limits.maxOutgoing
    ? 'unavailable'
    : 'none'
}

export interface SearchOutcome {
  results: PlayerSearchResult[]
  capReached: boolean
  outgoingFull: boolean
}

/** `GET /api/players?q=`: see PlayerSearchResponse in @game/protocol. */
export async function searchPlayers(
  db: Executor,
  limits: SocialLimits,
  me: string,
  query: string,
  options: { trigram?: boolean | undefined } = {},
): Promise<SearchOutcome> {
  const trigram = options.trigram ?? (await hasTrigram(db))
  const rows = await searchQuery(db, me, query, trigram)
  const ids = rows.map((r) => r.id)
  const [games, relations, counts, elo] = await Promise.all([
    finishedGames(db, ids),
    relationsOf(db, me, ids),
    countsOf(db, me),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            userId: eloRatings.userId,
            rating: eloRatings.rating,
            mode: eloRatings.mode,
            timeControl: eloRatings.timeControl,
            games: eloRatings.games,
          })
          .from(eloRatings)
          .where(and(inArray(eloRatings.userId, ids), gt(eloRatings.games, 0)))
          .orderBy(desc(eloRatings.games), desc(eloRatings.rating)),
  ])
  const topRating = new Map<string, PlayerSearchResult['rating']>()
  for (const e of elo) {
    if (!topRating.has(e.userId)) {
      topRating.set(e.userId, { rating: e.rating, mode: e.mode, timeControl: e.timeControl })
    }
  }
  return {
    capReached: counts.friends >= limits.maxFriends,
    outgoingFull: counts.outgoing >= limits.maxOutgoing,
    results: rows.map((r) => {
      const relation = relations.get(r.id) ?? 'none'
      const result: PlayerSearchResult = {
        username: usernameOf(r),
        rating: topRating.get(r.id) ?? null,
        gamesPlayed: games.get(r.id) ?? 0,
        relation: shownRelation(relation, counts, limits),
      }
      if (relation !== 'none') result.userId = r.id
      return result
    }),
  }
}

/**
 * `GET /api/players/:username`: a live registered player's public profile, or undefined
 * (unknown, guest, deleted, suspended: all "Player not found"). `viewer` is undefined for
 * guests (no relation).
 */
export async function profileOf(
  db: Executor,
  limits: SocialLimits,
  viewer: string | undefined,
  username: string,
): Promise<PublicProfileResponse | undefined> {
  const u = await findByUsername(db, username)
  if (!u) return undefined
  const self = viewer === u.id
  const other = viewer && !self ? viewer : undefined
  const [ratingRows, games, civRows, relations, counts, blockers, settings] = await Promise.all([
    db
      .select({
        mode: eloRatings.mode,
        timeControl: eloRatings.timeControl,
        rating: eloRatings.rating,
        gamesPlayed: eloRatings.games,
        peak: eloRatings.peak,
      })
      .from(eloRatings)
      .where(and(eq(eloRatings.userId, u.id), gt(eloRatings.games, 0)))
      .orderBy(asc(eloRatings.mode), asc(eloRatings.timeControl)),
    finishedGames(db, [u.id]),
    db
      .select({ slug: civilizations.slug, games: count(), last: max(matches.startedAt) })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .innerJoin(civilizations, eq(civilizations.id, matchPlayers.civId))
      .where(and(eq(matchPlayers.userId, u.id), eq(matches.status, 'finished')))
      .groupBy(civilizations.slug)
      .orderBy(desc(count()), desc(max(matches.startedAt)), asc(civilizations.slug))
      .limit(1),
    other ? relationsOf(db, other, [u.id]) : Promise.resolve(undefined),
    other ? countsOf(db, other) : Promise.resolve(undefined),
    other ? blockersBetween(db, other, u.id) : Promise.resolve([]),
    viewer ? socialSettingsOf(db, u.id) : Promise.resolve(undefined),
  ])
  const blockedByYou = blockers.includes(viewer ?? '')
  // Guests (no `viewer`) never see recent games: a guest session would get around a block. A
  // block either way gives the same null as a private history, so it isn't revealed.
  const recentGames =
    viewer && settings?.publicHistory && blockers.length === 0
      ? await recentGamesOf(db, u.id, viewer)
      : null
  const relation = relations?.get(u.id) ?? 'none'
  const ratings: ProfileRating[] = ratingRows.map((r) => ({
    ...r,
    provisional: r.gamesPlayed < LEADERBOARD_MIN_GAMES,
  }))
  const civ = civRows[0]
  const profile: PublicProfileResponse = {
    username: usernameOf(u),
    memberSince: u.createdAt.toISOString().slice(0, 7),
    gamesPlayed: games.get(u.id) ?? 0,
    ratings,
    favoriteCiv: civ ? { slug: civ.slug, games: civ.games } : null,
    relation: self ? 'self' : viewer ? shownRelation(relation, counts, limits) : 'unavailable',
    blockedByYou,
    capReached: counts ? counts.friends >= limits.maxFriends : false,
    outgoingFull: counts ? counts.outgoing >= limits.maxOutgoing : false,
    recentGames,
  }
  if (!self && viewer && (relation !== 'none' || blockedByYou)) profile.userId = u.id
  return profile
}

// ---------------------------------------------------------------------------
// Recent games on the profile (opt-in public match history)
// ---------------------------------------------------------------------------

/** Which of `a` and `b` blocked the other (none, one or both of them). */
async function blockersBetween(db: Executor, a: string, b: string): Promise<string[]> {
  const rows = await db
    .select({ id: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
  return rows.map((r) => r.id)
}

/**
 * How another seat is named on a public profile: no guest names or deletion numbers.
 * Suspended accounts read like any other registered player (name and link), as in search and
 * friend requests. Their link answers 404, so a careful viewer can still tell; a name without
 * a link would tell every viewer at a glance.
 */
function profilePlayer(p: PlayerRow): ProfileGamePlayer {
  const base = { seat: p.seat, team: p.team, civ: p.civ, placement: p.placement }
  if (p.botLevel || !p.userId) return { ...base, kind: 'bot', name: botName(p.botLevel ?? '') }
  if (isRegisteredSeat(p)) {
    const name = usernameOf({ ...p, name: p.name ?? '' })
    return { ...base, kind: 'player', name, username: name }
  }
  return p.deletedAt
    ? { ...base, kind: 'deleted', name: 'Deleted player' }
    : { ...base, kind: 'guest', name: 'Guest' }
}

/**
 * `owner`'s last PROFILE_RECENT_GAMES finished games, newest (by end) first. `viewer` gets a
 * game's id only if they played in it too, for the link to their own replay.
 */
export async function recentGamesOf(
  db: Executor,
  owner: string,
  viewer: string,
): Promise<ProfileGame[]> {
  const rows = await db
    .select({
      id: matches.id,
      // Set together with status 'finished' (persistence.ts), so never null here.
      endedAt: sql<Date>`${matches.endedAt}`.mapWith(matches.endedAt),
      mode: matches.mode,
      timeControl: matches.timeControl,
      ranked: matches.ranked,
      rated: matches.rated,
      rulesVersion: matches.rulesVersion,
      endReason: matches.endReason,
      seat: matchPlayers.seat,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(and(eq(matchPlayers.userId, owner), eq(matches.status, 'finished')))
    // Sorted on an expression, not the column, so the planner reads this player's own seats
    // instead of walking every finished game's ended_at looking for theirs (slow when their
    // last game is old).
    .orderBy(desc(sql`${matches.endedAt} + interval '0 seconds'`), desc(matches.id))
    .limit(PROFILE_RECENT_GAMES)
  const seats = new Map<string, PlayerRow[]>()
  for (const p of await playersOf(
    db,
    rows.map((r) => r.id),
  )) {
    seats.set(p.matchId, [...(seats.get(p.matchId) ?? []), p])
  }
  return rows.map((m) => {
    const all = seats.get(m.id) ?? []
    const mine = all.find((p) => p.seat === m.seat)
    const game: ProfileGame = {
      // The UTC day only: an exact time would show when the other players were online.
      playedOn: m.endedAt.toISOString().slice(0, 10),
      mode: m.mode,
      timeControl: m.timeControl,
      ranked: m.ranked,
      rated: m.rated,
      rulesVersion: m.rulesVersion,
      endReason: m.endReason,
      seat: m.seat,
      team: mine?.team ?? null,
      civ: mine?.civ ?? '',
      placement: mine?.placement ?? null,
      ratingDelta: ratingDeltaOf(m.rated, mine),
      others: all.filter((p) => p !== mine).map(profilePlayer),
    }
    if (all.some((p) => p.userId === viewer)) game.id = m.id
    return game
  })
}

// ---------------------------------------------------------------------------
// Profile privacy settings (Account page)
// ---------------------------------------------------------------------------

/** Every default: anyone may send requests, recent games stay private (opt-in). */
const DEFAULT_SETTINGS: SocialSettingsResponse = { friendRequests: 'anyone', publicHistory: false }

export async function socialSettingsOf(
  db: Executor,
  userId: string,
): Promise<SocialSettingsResponse> {
  const [row] = await db
    .select({
      friendRequests: userSettings.friendRequests,
      publicHistory: userSettings.publicHistory,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return row ?? { ...DEFAULT_SETTINGS }
}

/** Changes the settings in `body` (the others keep their value); returns them all. */
export async function updateSocialSettings(
  db: Executor,
  userId: string,
  body: SocialSettingsBody,
): Promise<SocialSettingsResponse> {
  const now = new Date()
  const set = {
    ...(body.friendRequests !== undefined ? { friendRequests: body.friendRequests } : {}),
    ...(body.publicHistory !== undefined ? { publicHistory: body.publicHistory } : {}),
    updatedAt: now,
  }
  const [row] = await db
    .insert(userSettings)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: userSettings.userId, set })
    .returning({
      friendRequests: userSettings.friendRequests,
      publicHistory: userSettings.publicHistory,
    })
  return row as SocialSettingsResponse
}

/** Whether `a` and `b` sat in the same running or finished match. */
export async function playedTogether(db: Executor, a: string, b: string): Promise<boolean> {
  const other = alias(matchPlayers, 'other_player')
  const [row] = await db
    .select({ one: sql`1` })
    .from(matchPlayers)
    .innerJoin(other, eq(other.matchId, matchPlayers.matchId))
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(
      and(
        eq(matchPlayers.userId, a),
        eq(other.userId, b),
        inArray(matches.status, [...SHARED_STATUSES]),
      ),
    )
    .limit(1)
  return Boolean(row)
}
