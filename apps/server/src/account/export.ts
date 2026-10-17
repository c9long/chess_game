import {
  accounts,
  civilizations,
  type Database,
  eloRatings,
  legalAcceptances,
  matches,
  matchPlayers,
  passkeys,
  ratings,
  reports,
  sessions,
  users,
} from '@game/db'
import { asc, desc, eq } from 'drizzle-orm'
import { blocksForExport } from '../social/blocks.ts'
import { rowsOf } from '../social/friends.ts'

/**
 * Everything we hold about a user, as a JSON-serializable object (PLAN §8 export).
 * Secrets (password hashes, OAuth tokens, TOTP secrets, session tokens) are never included.
 */
export async function buildAccountExport(db: Database, userId: string, now: Date = new Date()) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) return undefined

  const [linked, keys, acceptances, userRatings, userElo, history, activeSessions, social] =
    await Promise.all([
      db
        .select({ provider: accounts.providerId, createdAt: accounts.createdAt })
        .from(accounts)
        .where(eq(accounts.userId, userId)),
      db
        .select({
          name: passkeys.name,
          deviceType: passkeys.deviceType,
          createdAt: passkeys.createdAt,
        })
        .from(passkeys)
        .where(eq(passkeys.userId, userId)),
      db
        .select({
          document: legalAcceptances.document,
          version: legalAcceptances.version,
          kind: legalAcceptances.kind,
          acceptedAt: legalAcceptances.acceptedAt,
        })
        .from(legalAcceptances)
        .where(eq(legalAcceptances.userId, userId))
        .orderBy(asc(legalAcceptances.acceptedAt)),
      db
        .select({
          mode: ratings.mode,
          timeControl: ratings.timeControl,
          kind: ratings.kind,
          mu: ratings.mu,
          sigma: ratings.sigma,
          gamesPlayed: ratings.gamesPlayed,
          updatedAt: ratings.updatedAt,
        })
        .from(ratings)
        .where(eq(ratings.userId, userId)),
      db
        .select({
          mode: eloRatings.mode,
          timeControl: eloRatings.timeControl,
          rating: eloRatings.rating,
          games: eloRatings.games,
          peak: eloRatings.peak,
          updatedAt: eloRatings.updatedAt,
        })
        .from(eloRatings)
        .where(eq(eloRatings.userId, userId))
        .orderBy(asc(eloRatings.mode), asc(eloRatings.timeControl)),
      db
        .select({
          matchId: matches.id,
          status: matches.status,
          mode: matches.mode,
          timeControl: matches.timeControl,
          rated: matches.rated,
          ranked: matches.ranked,
          rulesVersion: matches.rulesVersion,
          startedAt: matches.startedAt,
          endedAt: matches.endedAt,
          endReason: matches.endReason,
          seat: matchPlayers.seat,
          team: matchPlayers.team,
          civ: civilizations.slug,
          civVersion: matchPlayers.civVersion,
          finalStatus: matchPlayers.finalStatus,
          placement: matchPlayers.placement,
          defeatReason: matchPlayers.defeatReason,
          ratingBefore: matchPlayers.ratingBefore,
          ratingAfter: matchPlayers.ratingAfter,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(civilizations, eq(civilizations.id, matchPlayers.civId))
        .where(eq(matchPlayers.userId, userId))
        .orderBy(desc(matches.startedAt)),
      db
        .select({
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
          ipAddress: sessions.ipAddress,
          userAgent: sessions.userAgent,
        })
        .from(sessions)
        .where(eq(sessions.userId, userId)),
      rowsOf(db, userId),
    ])
  const [blocked, filed] = await Promise.all([
    blocksForExport(db, userId),
    db
      .select({
        reason: reports.reason,
        note: reports.note,
        matchId: reports.matchId,
        status: reports.status,
        createdAt: reports.createdAt,
        resolvedAt: reports.resolvedAt,
      })
      .from(reports)
      .where(eq(reports.reporterId, userId))
      .orderBy(desc(reports.createdAt)),
  ])

  return {
    exportedAt: now.toISOString(),
    format: 'game-account-export/1',
    profile: {
      id: user.id,
      username: user.displayUsername ?? user.username,
      displayName: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      isGuest: user.isAnonymous,
      createdAt: user.createdAt,
      ageConfirmed: user.ageConfirmed,
      ageBand: user.ageBand,
      ageConfirmedAt: user.ageConfirmedAt,
      twoFactorEnabled: user.twoFactorEnabled,
      deletedAt: user.deletedAt,
      suspendedAt: user.suspendedAt,
    },
    linkedAccounts: linked,
    passkeys: keys,
    legalAcceptances: acceptances,
    /** OpenSkill ratings: the hidden shadow pool (bot games) and retired public ratings. */
    ratings: userRatings,
    /** Public Elo ratings from ranked games. */
    eloRatings: userElo,
    matchHistory: history,
    sessions: activeSessions,
    /** Friends and pending friend requests (the other player's username only). */
    friends: social.map((f) => ({
      username: f.username,
      status: f.status === 'accepted' ? 'friends' : f.requestedBy === userId ? 'sent' : 'received',
      requestedAt: f.createdAt,
      acceptedAt: f.acceptedAt,
    })),
    /** Players you blocked (usernames only). */
    blocked,
    /**
     * Reports you filed (who they were about is left out: that is another player's data).
     * Reports about you are kept for moderation and aren't listed, to protect reporters.
     */
    reportsFiled: filed,
  }
}

export type AccountExport = NonNullable<Awaited<ReturnType<typeof buildAccountExport>>>
