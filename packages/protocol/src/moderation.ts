/**
 * Moderation (PLAN §3 "Moderation"): blocking players, reporting players, and the admin
 * review queue. REST only; see README.md "Blocking and reporting" and "Admin review queue".
 */
import { z } from 'zod'
import { seatSchema } from './messages.ts'

/** Players one account may block. */
export const BLOCKS_MAX = 500
/** Reports one player (registered or guest) may file per 24 hours. */
export const REPORTS_PER_DAY = 10
/** Longest optional note on a report. */
export const REPORT_NOTE_MAX = 500

/** Why a player is reported. `harassment` is for chat once it exists. */
export const REPORT_REASONS = ['offensive_username', 'harassment', 'cheating', 'other'] as const
export type ReportReasonId = (typeof REPORT_REASONS)[number]

/** What a moderator does when resolving a report. */
export const REPORT_RESOLUTIONS = ['warn', 'rename', 'suspend'] as const
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number]

const userIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/**
 * Who an action is about: the player in `seat` of match `matchId` (a game you played in: live
 * card, result screen, history row), or `userId` of someone on your Friends page (a friend, a
 * request either way, or a player you blocked).
 */
export const playerTargetSchema = z.union([
  z.strictObject({ matchId: z.uuid(), seat: seatSchema }),
  z.strictObject({ userId: userIdSchema }),
])
export type PlayerTarget = z.input<typeof playerTargetSchema>

/** `POST /api/blocks` */
export const blockBodySchema = playerTargetSchema
export type BlockBody = PlayerTarget

/** `POST /api/reports`: the target, a reason and an optional note. */
export const reportBodySchema = z.union([
  z.strictObject({
    matchId: z.uuid(),
    seat: seatSchema,
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(REPORT_NOTE_MAX).optional(),
  }),
  z.strictObject({
    userId: userIdSchema,
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(REPORT_NOTE_MAX).optional(),
  }),
])
export type ReportBody = z.input<typeof reportBodySchema>

/** `POST /api/admin/reports/:id/resolve` */
export const resolveReportBodySchema = z.strictObject({ action: z.enum(REPORT_RESOLUTIONS) })
export type ResolveReportBody = z.input<typeof resolveReportBodySchema>

/** A player you blocked (`GET /api/friends` → `blocked`). */
export interface BlockedUser {
  userId: string
  username: string
  /** When you blocked them (ISO). */
  since: string
}

/** `POST /api/blocks` */
export interface BlockResponse {
  user: { userId: string; username: string }
}

// ---------------------------------------------------------------------------
// Admin review queue (ADMIN_USER_IDS only; everyone else gets 403 FORBIDDEN)
// ---------------------------------------------------------------------------

export interface AdminReportedUser {
  userId: string
  /** The name shown now ("Deleted player #…" for a deleted account). */
  name: string
  /** The name shown when the report was made (null once the account is deleted). */
  reportedName: string | null
  isGuest: boolean
  deleted: boolean
  /** Suspended since (ISO), or null. */
  suspendedAt: string | null
  /** Open reports about this player, and all reports ever kept. */
  openReports: number
  totalReports: number
  /** Distinct players with an open report about this player. */
  openReporters: number
}

export interface AdminReport {
  id: string
  reason: ReportReasonId
  note: string | null
  /** The game it came from, or null. */
  matchId: string | null
  createdAt: string
  reported: AdminReportedUser
  /** For the admin only (never shown to the reported player). */
  reporter: { userId: string; name: string }
}

export interface AdminSuspendedUser {
  userId: string
  name: string
  suspendedAt: string
}

/** `GET /api/admin/reports`: open reports, oldest first, and suspended accounts. */
export interface AdminReportsResponse {
  reports: AdminReport[]
  suspended: AdminSuspendedUser[]
}
