/**
 * Friends, requests and challenges on the client: a small store fed by REST and by the
 * `social` room (components/social/SocialLayer.tsx keeps that connection open while a
 * registered player is signed in). Light on purpose (no Colyseus here): the header reads the
 * badge count from it on every page.
 */
import type {
  Challenge,
  ChallengeBody,
  ChallengesResponse,
  CreateChallengeResponse,
  FriendRelation,
  FriendRequestResponse,
  FriendsResponse,
  MatchRelationsResponse,
  PlayerSearchResponse,
  PublicProfileResponse,
  SocialSettingsBody,
  SocialSettingsResponse,
} from '@game/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { ApiError, api } from './api.ts'

interface SocialStore {
  friends: FriendsResponse | null
  /** The friends list failed to load (and nothing loaded before). */
  friendsError: boolean
  /** Open challenges to you (still waiting for your answer) and from you. */
  challenges: ChallengesResponse
  /** The `social` room connection is up (live presence and notifications). */
  connected: boolean
  /** Bumped on every change, so views that cache per-match relations refetch. */
  version: number
  /** Per match: your relation to each seat (game screen, result screen). */
  matchRelations: Record<string, MatchRelationsResponse>
  /**
   * Per lobby (room id): your last challenge for it whose invitation ended (expired or
   * withdrawn) while the lobby stayed open, so the lobby can offer "Invite again".
   */
  endedChallenges: Record<string, Challenge>
}

export const useSocial = create<SocialStore>(() => ({
  friends: null,
  friendsError: false,
  challenges: { incoming: [], outgoing: [] },
  connected: false,
  version: 0,
  matchRelations: {},
  endedChallenges: {},
}))

export function resetSocial() {
  useSocial.setState({
    friends: null,
    friendsError: false,
    challenges: { incoming: [], outgoing: [] },
    connected: false,
    version: 0,
    matchRelations: {},
    endedChallenges: {},
  })
}

const bump = () => useSocial.setState((s) => ({ version: s.version + 1 }))

export async function refreshFriends(): Promise<void> {
  try {
    const friends = await api<FriendsResponse>('/api/friends')
    useSocial.setState({ friends, friendsError: false })
  } catch {
    useSocial.setState((s) => ({ friendsError: s.friends === null }))
  }
}

export async function refreshChallenges(): Promise<void> {
  try {
    const challenges = await api<ChallengesResponse>('/api/challenges')
    useSocial.setState({ challenges })
  } catch {
    // Kept as is; the next notification or visit refetches.
  }
}

/** After any change: the lists, and the per-match relations views show. */
export function socialChanged(): void {
  bump()
  void refreshFriends()
}

/** Updates a friend's online dot in place (a `presence` message). */
export function setPresence(userId: string, online: boolean): void {
  useSocial.setState((s) =>
    s.friends
      ? {
          friends: {
            ...s.friends,
            friends: s.friends.friends.map((f) => (f.userId === userId ? { ...f, online } : f)),
          },
        }
      : {},
  )
}

export function addIncomingChallenge(c: Challenge): void {
  useSocial.setState((s) => ({
    challenges: {
      ...s.challenges,
      incoming: [c, ...s.challenges.incoming.filter((x) => x.id !== c.id)],
    },
  }))
}

/** Your challenge `id` ended without its lobby closing (expired, withdrawn). */
export function challengeEnded(id: string): void {
  useSocial.setState((s) => {
    const c = s.challenges.outgoing.find((x) => x.id === id)
    return c ? { endedChallenges: { ...s.endedChallenges, [c.roomId]: c } } : {}
  })
}

export function dropChallenge(id: string): void {
  useSocial.setState((s) => ({
    challenges: {
      incoming: s.challenges.incoming.filter((x) => x.id !== id),
      outgoing: s.challenges.outgoing.filter((x) => x.id !== id),
    },
  }))
}

// ---------------------------------------------------------------------------
// Actions (REST)
// ---------------------------------------------------------------------------

async function act<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } finally {
    socialChanged()
  }
}

export const sendFriendRequest = (matchId: string, seat: number) =>
  act(() => api<FriendRequestResponse>('/api/friends/requests', { body: { matchId, seat } }))

/** Friend request by exact username (any case). */
export const sendFriendRequestByUsername = (username: string) =>
  act(() => api<FriendRequestResponse>('/api/friends/requests', { body: { username } }))

/** Player search (3+ characters; the server ranks prefix matches first). */
export const searchPlayers = (q: string) =>
  api<PlayerSearchResponse>(`/api/players?q=${encodeURIComponent(q)}`)

/** A player's public profile (404 "Player not found" for anyone without one). */
export const fetchProfile = (username: string) =>
  api<PublicProfileResponse>(`/api/players/${encodeURIComponent(username)}`)

/** Your profile privacy settings: who can send you friend requests, and your recent games. */
export const fetchSocialSettings = () => api<SocialSettingsResponse>('/api/friends/settings')

export const saveSocialSettings = (body: SocialSettingsBody) =>
  api<SocialSettingsResponse>('/api/friends/settings', { method: 'PUT', body })

/** Where a player's public profile lives. */
export const profilePath = (username: string) => `/u/${encodeURIComponent(username)}`

export const acceptFriendRequest = (userId: string) =>
  act(() =>
    api<FriendRequestResponse>(`/api/friends/requests/${encodeURIComponent(userId)}/accept`, {
      method: 'POST',
    }),
  )

export const declineFriendRequest = (userId: string) =>
  act(() => api(`/api/friends/requests/${encodeURIComponent(userId)}/decline`, { method: 'POST' }))

export const cancelFriendRequest = (userId: string) =>
  act(() => api(`/api/friends/requests/${encodeURIComponent(userId)}`, { method: 'DELETE' }))

export const removeFriend = (userId: string) =>
  act(() => api(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }))

export async function createChallenge(body: ChallengeBody): Promise<Challenge> {
  const res = await api<CreateChallengeResponse>('/api/challenges', { body })
  const c = res.challenge
  useSocial.setState((s) => {
    const { [c.roomId]: _, ...ended } = s.endedChallenges
    return {
      endedChallenges: ended,
      challenges: {
        ...s.challenges,
        outgoing: [c, ...s.challenges.outgoing.filter((x) => x.roomId !== c.roomId)],
      },
    }
  })
  void refreshChallenges()
  return c
}

/** Invites `c`'s friends who haven't joined to its lobby again (you host it, before the game). */
export function inviteAgain(c: Challenge, friendIds: string[]): Promise<Challenge> {
  return createChallenge({
    friendIds,
    mode: c.mode,
    timeControl: c.timeControl,
    ranked: c.ranked,
    roomId: c.roomId,
  })
}

export async function declineChallenge(id: string): Promise<void> {
  dropChallenge(id)
  try {
    await api(`/api/challenges/${encodeURIComponent(id)}/decline`, { method: 'POST' })
  } catch (err) {
    // Already over (expired, started): nothing left to decline.
    if (!(err instanceof ApiError && err.status === 409)) throw err
  }
}

export async function cancelChallenge(id: string): Promise<void> {
  dropChallenge(id)
  await api(`/api/challenges/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
}

/** A short message for the social toasts (the toast host lives in SocialLayer). */
export interface SocialNotice {
  title: string
  tone?: 'info' | 'success' | 'error'
}

const noticeListeners = new Set<(n: SocialNotice) => void>()

/** Shows `n` as a toast; false when no toast host is mounted. */
export function socialNotice(n: SocialNotice): boolean {
  for (const fn of noticeListeners) fn(n)
  return noticeListeners.size > 0
}

export function onSocialNotice(fn: (n: SocialNotice) => void): () => void {
  noticeListeners.add(fn)
  return () => {
    noticeListeners.delete(fn)
  }
}

/** Readable text for a refused social request. */
export function socialErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Too many friend requests. Try again later.'
    if (err.message && !err.message.startsWith('Request failed')) return err.message
  }
  return 'That didn’t work. Check your connection and try again.'
}

// ---------------------------------------------------------------------------
// Per-match relations (game screen and result screen)
// ---------------------------------------------------------------------------

export type SeatRelation = FriendRelation | 'self' | 'ineligible'

/**
 * Your relation to each seat of `matchId` (empty: no match yet), kept fresh across friend
 * changes. Null until loaded, or when `enabled` is false (guests, solo games).
 */
export function useMatchRelations(matchId: string, enabled: boolean) {
  const version = useSocial((s) => s.version)
  const data = useSocial((s) => (matchId ? s.matchRelations[matchId] : undefined))
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` refetches after friend changes
  useEffect(() => {
    if (!enabled || !matchId) return
    let cancelled = false
    api<MatchRelationsResponse>(`/api/friends/match/${encodeURIComponent(matchId)}`)
      .then((r) => {
        if (!cancelled) {
          useSocial.setState((s) => ({ matchRelations: { ...s.matchRelations, [matchId]: r } }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [matchId, enabled, version])
  return enabled ? (data ?? null) : null
}

/** Whether you are at the friends cap, or have too many requests waiting (from the list). */
export function capsFrom(friends: FriendsResponse | null) {
  if (!friends) return { capReached: false, outgoingFull: false }
  return {
    capReached: friends.friends.length >= friends.limits.maxFriends,
    outgoingFull: friends.outgoing.length >= friends.limits.maxOutgoing,
  }
}
