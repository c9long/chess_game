/**
 * Moderation labels and menu rules (no network code, so unit tests and any page can use them).
 */
import type { PlayerTarget, ReportReasonId } from '@game/protocol'

/** Report reasons in the order the dialog lists them, with their labels. */
export const REPORT_REASON_OPTIONS: { id: ReportReasonId; label: string; hint: string }[] = [
  {
    id: 'offensive_username',
    label: 'Offensive username',
    hint: 'A rude, hateful or impersonating name',
  },
  { id: 'cheating', label: 'Cheating', hint: 'Engine help, or another unfair advantage' },
  { id: 'harassment', label: 'Harassment', hint: 'Abuse or threats' },
  { id: 'other', label: 'Something else', hint: 'Tell us in the note' },
]

export const REPORT_REASON_LABEL: Record<ReportReasonId, string> = Object.fromEntries(
  REPORT_REASON_OPTIONS.map((o) => [o.id, o.label]),
) as Record<ReportReasonId, string>

/** "3 open reports from 2 players · 5 in total" */
export function reportCountsText(r: {
  openReports: number
  openReporters: number
  totalReports: number
}): string {
  const open = `${r.openReports} open report${r.openReports === 1 ? '' : 's'}`
  const from = `from ${r.openReporters} player${r.openReporters === 1 ? '' : 's'}`
  const total = r.totalReports > r.openReports ? ` · ${r.totalReports} in total` : ''
  return `${open} ${from}${total}`
}

/**
 * What a player's menu offers. Blocking is for registered viewers about registered players;
 * anyone can report a person (not a bot, not themselves).
 */
export function playerMenuItems(p: {
  viewerRegistered: boolean
  targetRegistered: boolean
  blocked: boolean
  reportable: boolean
}): ('block' | 'unblock' | 'report')[] {
  const items: ('block' | 'unblock' | 'report')[] = []
  if (p.viewerRegistered && (p.targetRegistered || p.blocked)) {
    items.push(p.blocked ? 'unblock' : 'block')
  }
  if (p.reportable) items.push('report')
  return items
}

/**
 * Reports sent in this tab, keyed by viewer and target, so the menu can show "Reported"
 * instead of a form the server would refuse (one open report per player and game).
 */
const sentReports = new Set<string>()
const sentListeners = new Set<() => void>()
let sentVersion = 0

export function reportKey(viewerId: string, target: PlayerTarget): string {
  return 'matchId' in target
    ? `${viewerId}|m:${target.matchId}:${target.seat}`
    : `${viewerId}|u:${target.userId}`
}

export function markReported(viewerId: string, target: PlayerTarget): void {
  sentReports.add(reportKey(viewerId, target))
  sentVersion++
  for (const l of sentListeners) l()
}

export function wasReported(viewerId: string, target: PlayerTarget): boolean {
  return sentReports.has(reportKey(viewerId, target))
}

/** For useSyncExternalStore: changes whenever a report is marked as sent. */
export function subscribeReported(listener: () => void): () => void {
  sentListeners.add(listener)
  return () => sentListeners.delete(listener)
}
export const reportedVersion = () => sentVersion
