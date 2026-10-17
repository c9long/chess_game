import { REPORT_REASONS } from '@game/protocol'
import { describe, expect, it } from 'vitest'
import {
  markReported,
  playerMenuItems,
  REPORT_REASON_LABEL,
  REPORT_REASON_OPTIONS,
  reportCountsText,
  reportedVersion,
  subscribeReported,
  wasReported,
} from './moderation-labels.ts'

describe('playerMenuItems', () => {
  it('offers Block and Report to registered players about registered players', () => {
    expect(
      playerMenuItems({
        viewerRegistered: true,
        targetRegistered: true,
        blocked: false,
        reportable: true,
      }),
    ).toEqual(['block', 'report'])
  })

  it('offers Unblock once blocked', () => {
    expect(
      playerMenuItems({
        viewerRegistered: true,
        targetRegistered: true,
        blocked: true,
        reportable: true,
      }),
    ).toEqual(['unblock', 'report'])
  })

  it('gives guests Report only, and nobody can block a guest', () => {
    expect(
      playerMenuItems({
        viewerRegistered: false,
        targetRegistered: true,
        blocked: false,
        reportable: true,
      }),
    ).toEqual(['report'])
    expect(
      playerMenuItems({
        viewerRegistered: true,
        targetRegistered: false,
        blocked: false,
        reportable: true,
      }),
    ).toEqual(['report'])
  })

  it('shows nothing for a deleted account', () => {
    expect(
      playerMenuItems({
        viewerRegistered: true,
        targetRegistered: false,
        blocked: false,
        reportable: false,
      }),
    ).toEqual([])
  })
})

describe('report reasons', () => {
  it('labels every protocol reason exactly once', () => {
    expect(REPORT_REASON_OPTIONS.map((o) => o.id).sort()).toEqual([...REPORT_REASONS].sort())
    for (const r of REPORT_REASONS) expect(REPORT_REASON_LABEL[r]).toBeTruthy()
  })
})

describe('reportCountsText', () => {
  it('reads naturally for one and many', () => {
    expect(reportCountsText({ openReports: 1, openReporters: 1, totalReports: 1 })).toBe(
      '1 open report from 1 player',
    )
    expect(reportCountsText({ openReports: 3, openReporters: 2, totalReports: 5 })).toBe(
      '3 open reports from 2 players · 5 in total',
    )
  })
})

describe('reports sent in this tab', () => {
  it('remembers a report per viewer, target and game, and notifies subscribers', () => {
    const target = { matchId: 'm1', seat: 2 as const }
    let calls = 0
    const unsubscribe = subscribeReported(() => calls++)
    const before = reportedVersion()
    expect(wasReported('me', target)).toBe(false)
    markReported('me', target)
    expect(wasReported('me', target)).toBe(true)
    expect(wasReported('someone-else', target)).toBe(false)
    expect(wasReported('me', { matchId: 'm1', seat: 1 })).toBe(false)
    expect(wasReported('me', { matchId: 'm2', seat: 2 })).toBe(false)
    expect(wasReported('me', { userId: 'u1' })).toBe(false)
    expect(reportedVersion()).toBe(before + 1)
    expect(calls).toBe(1)
    unsubscribe()
    markReported('me', { userId: 'u1' })
    expect(wasReported('me', { userId: 'u1' })).toBe(true)
    expect(calls).toBe(1)
  })
  it('keys profile reports by username, in any case', () => {
    expect(wasReported('me', { username: 'Ana_7' })).toBe(false)
    markReported('me', { username: 'Ana_7' })
    expect(wasReported('me', { username: 'ana_7' })).toBe(true)
    expect(wasReported('me', { username: 'ana_8' })).toBe(false)
    expect(wasReported('me', { userId: 'ana_7' })).toBe(false)
  })
})
