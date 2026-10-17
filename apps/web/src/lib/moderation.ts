/**
 * Blocking and reporting players, and the admin review queue, on the client (REST only).
 * Block changes refresh the friends store, so every Add friend button and menu updates.
 */
import {
  type AdminReportsResponse,
  type BlockResponse,
  type PlayerTarget,
  REPORT_NOTE_MAX,
  type ReportReasonId,
  type ReportResolution,
} from '@game/protocol'
import { ApiError, api } from './api.ts'
import { socialChanged } from './social.ts'

export {
  markReported,
  playerMenuItems,
  REPORT_REASON_LABEL,
  REPORT_REASON_OPTIONS,
  reportCountsText,
  reportedVersion,
  subscribeReported,
  wasReported,
} from './moderation-labels.ts'
export { REPORT_NOTE_MAX }

export async function blockPlayer(target: PlayerTarget): Promise<BlockResponse> {
  try {
    return await api<BlockResponse>('/api/blocks', { body: target })
  } finally {
    socialChanged()
  }
}

export async function unblockPlayer(target: PlayerTarget): Promise<void> {
  const path =
    'userId' in target
      ? `/api/blocks/${encodeURIComponent(target.userId)}`
      : `/api/blocks/match/${encodeURIComponent(target.matchId)}/${target.seat}`
  try {
    await api(path, { method: 'DELETE' })
  } finally {
    socialChanged()
  }
}

export async function reportPlayer(
  target: PlayerTarget,
  reason: ReportReasonId,
  note: string,
): Promise<void> {
  const trimmed = note.trim()
  await api('/api/reports', {
    body: { ...target, reason, ...(trimmed ? { note: trimmed.slice(0, REPORT_NOTE_MAX) } : {}) },
  })
}

/** Readable text for a refused block or report. */
export function moderationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429 && (!err.message || err.message.startsWith('Request failed'))) {
      return 'Too many requests. Try again later.'
    }
    if (err.message && !err.message.startsWith('Request failed')) return err.message
  }
  return 'That didn’t work. Check your connection and try again.'
}

// ---------------------------------------------------------------------------
// Admin review queue
// ---------------------------------------------------------------------------

export const fetchReportQueue = () => api<AdminReportsResponse>('/api/admin/reports')

export const dismissReport = (id: string) =>
  api(`/api/admin/reports/${encodeURIComponent(id)}/dismiss`, { method: 'POST' })

export const resolveReport = (id: string, action: ReportResolution) =>
  api(`/api/admin/reports/${encodeURIComponent(id)}/resolve`, { body: { action } })

export const unsuspendUser = (userId: string) =>
  api(`/api/admin/users/${encodeURIComponent(userId)}/unsuspend`, { method: 'POST' })
