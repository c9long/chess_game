/**
 * Reports and the admin review queue (PLAN §3 "Moderation"). Players (registered or guest)
 * report another player from a game or their Friends page; admins (ADMIN_USER_IDS) dismiss a
 * report or resolve it with an action: `warn` (recorded only), `rename` (the username is reset
 * and held for a year; the player picks a new one at their next visit) or `suspend` (sign-in
 * refused, sessions revoked, removed from pre-game lobbies; reversible; registered accounts
 * only). Suspending also resolves the player's other open reports, and renaming their other
 * username reports. Match history is never touched.
 */
import { matchMaker } from '@colyseus/core'
import { type Database, type ReportAction, reports, sessions, users } from '@game/db'
import {
  type AdminReport,
  type AdminReportsResponse,
  type PlayerTarget,
  REPORTS_PER_DAY,
  type ReportReasonId,
} from '@game/protocol'
import { aliasedTable, and, asc, count, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { generatePlayerName } from '../auth/name-policy.ts'
import { MatchRoom } from '../game/match-room.ts'
import type { GameService } from '../game/service.ts'
import type { Logger } from '../logger.ts'
import { SocialError, usernameOf } from '../social/friends.ts'
import type { SocialService } from '../social/service.ts'
import { holdName } from './reserved-names.ts'
import { resolveTarget } from './targets.ts'

export interface ModerationOptions {
  reportsPerDay: number
}

const DAY_MS = 24 * 60 * 60_000

/** Postgres unique_violation. */
const isUniqueViolation = (err: unknown) =>
  (err as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (err as { cause?: { code?: string } })?.cause?.code === '23505'

export class ModerationService {
  readonly db: Database
  readonly game: GameService
  readonly social: SocialService
  readonly logger: Logger
  readonly admins: ReadonlySet<string>
  readonly options: ModerationOptions

  constructor(deps: {
    db: Database
    game: GameService
    social: SocialService
    logger: Logger
    adminUserIds: string[]
    options?: Partial<ModerationOptions>
  }) {
    this.db = deps.db
    this.game = deps.game
    this.social = deps.social
    this.logger = deps.logger.child({ component: 'moderation' })
    this.admins = new Set(deps.adminUserIds)
    this.options = { reportsPerDay: REPORTS_PER_DAY, ...deps.options }
  }

  isAdmin(userId: string): boolean {
    return this.admins.has(userId)
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  /**
   * Files a report by `reporterId` about `target`. At most `reportsPerDay` per reporter per 24
   * hours, and one open report per reporter, player and game. Nothing is sent to the reported
   * player.
   */
  async report(
    reporterId: string,
    body: PlayerTarget & { reason: ReportReasonId; note?: string | undefined },
  ): Promise<{ id: string }> {
    const target = await resolveTarget(this.db, reporterId, body)
    const note = body.note?.trim() ? body.note.trim() : null
    try {
      return await this.db.transaction(async (tx) => {
        // One reporter's reports are counted one at a time (no burst past the limit).
        await tx.select({ id: users.id }).from(users).where(eq(users.id, reporterId)).for('update')
        const [recent] = await tx
          .select({ n: count() })
          .from(reports)
          .where(
            and(
              eq(reports.reporterId, reporterId),
              gte(reports.createdAt, new Date(Date.now() - DAY_MS)),
            ),
          )
        if ((recent?.n ?? 0) >= this.options.reportsPerDay) {
          throw new SocialError(
            'RATE_LIMITED',
            429,
            'You’ve sent a lot of reports today. Please try again tomorrow.',
          )
        }
        const [row] = await tx
          .insert(reports)
          .values({
            reporterId,
            reportedUserId: target.userId,
            reportedName: target.name,
            matchId: target.matchId,
            reason: body.reason,
            note,
          })
          .returning({ id: reports.id })
        if (!row) throw new Error('report insert failed')
        return { id: row.id }
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new SocialError(
          'ALREADY_REPORTED',
          409,
          'You already reported this player. A moderator will review it.',
        )
      }
      throw err
    }
  }

  // -------------------------------------------------------------------------
  // Review queue
  // -------------------------------------------------------------------------

  async queue(limit = 200): Promise<AdminReportsResponse> {
    const reported = aliasedTable(users, 'reported')
    const reporter = aliasedTable(users, 'reporter')
    const rows = await this.db
      .select({
        id: reports.id,
        reason: reports.reason,
        note: reports.note,
        matchId: reports.matchId,
        createdAt: reports.createdAt,
        reportedName: reports.reportedName,
        reportedId: reported.id,
        reportedUsername: reported.username,
        reportedDisplay: reported.displayUsername,
        reportedNameNow: reported.name,
        reportedGuest: reported.isAnonymous,
        reportedDeleted: reported.deletedAt,
        reportedSuspended: reported.suspendedAt,
        reporterId: reporter.id,
        reporterUsername: reporter.username,
        reporterDisplay: reporter.displayUsername,
        reporterName: reporter.name,
      })
      .from(reports)
      .innerJoin(reported, eq(reported.id, reports.reportedUserId))
      .innerJoin(reporter, eq(reporter.id, reports.reporterId))
      .where(eq(reports.status, 'open'))
      .orderBy(asc(reports.createdAt))
      .limit(limit)

    const ids = [...new Set(rows.map((r) => r.reportedId))]
    const counts =
      ids.length === 0
        ? []
        : await this.db
            .select({
              userId: reports.reportedUserId,
              total: count(),
              open: sql<number>`count(*) filter (where ${reports.status} = 'open')`.mapWith(Number),
              openReporters:
                sql<number>`count(distinct ${reports.reporterId}) filter (where ${reports.status} = 'open')`.mapWith(
                  Number,
                ),
            })
            .from(reports)
            .where(inArray(reports.reportedUserId, ids))
            .groupBy(reports.reportedUserId)
    const byUser = new Map(counts.map((c) => [c.userId, c]))

    const list: AdminReport[] = rows.map((r) => {
      const c = byUser.get(r.reportedId)
      return {
        id: r.id,
        reason: r.reason,
        note: r.note,
        matchId: r.matchId,
        createdAt: r.createdAt.toISOString(),
        reported: {
          userId: r.reportedId,
          name: r.reportedGuest
            ? r.reportedNameNow
            : usernameOf({
                displayUsername: r.reportedDisplay,
                username: r.reportedUsername,
                name: r.reportedNameNow,
              }),
          reportedName: r.reportedName,
          isGuest: r.reportedGuest,
          deleted: r.reportedDeleted !== null,
          suspendedAt: r.reportedSuspended?.toISOString() ?? null,
          openReports: c?.open ?? 0,
          totalReports: c?.total ?? 0,
          openReporters: c?.openReporters ?? 0,
        },
        reporter: {
          userId: r.reporterId,
          name: r.reporterUsername
            ? usernameOf({
                displayUsername: r.reporterDisplay,
                username: r.reporterUsername,
                name: r.reporterName,
              })
            : r.reporterName,
        },
      }
    })

    const suspended = await this.db
      .select({
        userId: users.id,
        username: users.username,
        displayUsername: users.displayUsername,
        name: users.name,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(isNotNull(users.suspendedAt))
      .orderBy(asc(users.suspendedAt))
      .limit(500)
    return {
      reports: list,
      suspended: suspended.map((u) => ({
        userId: u.userId,
        name: usernameOf(u),
        suspendedAt: (u.suspendedAt as Date).toISOString(),
      })),
    }
  }

  /** Closes an open report without action. */
  async dismiss(reportId: string, adminId: string): Promise<void> {
    const rows = await this.db
      .update(reports)
      .set({ status: 'dismissed', resolvedBy: adminId, resolvedAt: new Date() })
      .where(and(eq(reports.id, reportId), eq(reports.status, 'open')))
      .returning({ id: reports.id })
    if (rows.length === 0) throw reportGone()
    this.logger.info({ event: 'report_dismissed', reportId, adminId }, 'report dismissed')
  }

  /** Resolves an open report with `action`, applied to the reported player. */
  async resolve(reportId: string, adminId: string, action: ReportAction): Promise<void> {
    const suspendedUser = await this.db.transaction(async (tx) => {
      const [report] = await tx
        .select({ reportedUserId: reports.reportedUserId })
        .from(reports)
        .where(and(eq(reports.id, reportId), eq(reports.status, 'open')))
        .for('update')
      if (!report) throw reportGone()
      const userId = report.reportedUserId
      const [user] = await tx
        .select({
          id: users.id,
          username: users.username,
          isGuest: users.isAnonymous,
          deletedAt: users.deletedAt,
          suspendedAt: users.suspendedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
      if (!user) throw reportGone()
      if (action !== 'warn' && user.deletedAt) {
        throw new SocialError('BAD_REQUEST', 400, 'That account was deleted. Dismiss the report.')
      }
      let suspended: string | undefined
      // Other open reports this action settles: every report about a suspended player, and
      // the username reports about a renamed one.
      let settles: ReturnType<typeof and> | undefined
      if (action === 'rename') {
        if (user.isGuest) {
          throw new SocialError(
            'BAD_REQUEST',
            400,
            'Guests have generated names. Dismiss or warn instead.',
          )
        }
        // The player chooses a new username at their next visit (the web asks, like after an
        // OAuth sign-up); until then they show as "Player-1234". The old name is held, so
        // neither they nor anyone else can take it straight back.
        if (user.username) {
          await holdName(tx, user.username)
          await tx
            .update(users)
            .set({
              username: null,
              displayUsername: null,
              name: generatePlayerName(),
              updatedAt: new Date(),
            })
            .where(eq(users.id, userId))
        }
        settles = and(eq(reports.reportedUserId, userId), eq(reports.reason, 'offensive_username'))
      } else if (action === 'suspend') {
        if (this.isAdmin(userId)) {
          throw new SocialError('BAD_REQUEST', 400, 'Admins can’t be suspended here.')
        }
        // A guest can start a new guest session at once, so suspending one means nothing.
        if (user.isGuest) {
          throw new SocialError(
            'BAD_REQUEST',
            400,
            'Guests can’t be suspended: they can start a new guest session. Dismiss or warn instead.',
          )
        }
        if (!user.suspendedAt) {
          await tx
            .update(users)
            .set({ suspendedAt: new Date(), suspendedBy: adminId })
            .where(eq(users.id, userId))
        }
        suspended = userId
        settles = eq(reports.reportedUserId, userId)
      }
      const resolution = {
        status: 'resolved',
        action,
        resolvedBy: adminId,
        resolvedAt: new Date(),
      } as const
      await tx.update(reports).set(resolution).where(eq(reports.id, reportId))
      if (settles) {
        await tx
          .update(reports)
          .set(resolution)
          .where(and(settles, eq(reports.status, 'open')))
      }
      return suspended
    })
    this.logger.info({ event: 'report_resolved', reportId, adminId, action }, 'report resolved')
    if (suspendedUser) await this.#enforceSuspension(suspendedUser)
  }

  /** Signs a suspended user out everywhere and takes them out of lobbies. */
  async #enforceSuspension(userId: string) {
    const ended = await this.db
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id })
    for (const s of ended) this.social.sessionEnded(s.id)
    this.social.userSuspended(userId)
    const roomIds = new Set<string>()
    const seated = this.game.seats.get(userId)
    if (seated) roomIds.add(seated)
    const claim = this.game.liveClaim(userId)
    if (claim?.roomId) roomIds.add(claim.roomId)
    this.game.claims.delete(userId)
    for (const id of roomIds) {
      const room = matchMaker.getLocalRoomById(id)
      if (room instanceof MatchRoom) room.removeSuspended(userId)
    }
    // Games they were only watching.
    for (const room of this.game.rooms) {
      if (room instanceof MatchRoom) room.dropSpectator(userId)
    }
  }

  /** Lifts a suspension; the player can sign in again. */
  async unsuspend(userId: string, adminId: string): Promise<void> {
    const rows = await this.db
      .update(users)
      .set({ suspendedAt: null, suspendedBy: null })
      .where(and(eq(users.id, userId), isNotNull(users.suspendedAt)))
      .returning({ id: users.id })
    if (rows.length === 0) {
      throw new SocialError('NOT_FOUND', 404, 'That account is not suspended.')
    }
    this.logger.info({ event: 'user_unsuspended', userId, adminId }, 'suspension lifted')
  }
}

function reportGone() {
  return new SocialError('NOT_FOUND', 404, 'That report is no longer open.')
}
