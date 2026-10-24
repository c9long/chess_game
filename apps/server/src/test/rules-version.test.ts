import { civilizations, matchEvents, matches, matchPlayers } from '@game/db'
import type { MatchDetailResponse, MatchListResponse } from '@game/protocol'
import { initRules, isSupportedRulesVersion, RULES_VERSION } from '@game/rules'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { playReplay, resimulate, UnsupportedRulesVersionError } from '../game/persistence.ts'
import { type Harness, signUpVerified, startHarness } from './harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h.close()
})

/** A finished match from the 12×12 board (rules version 1), with one 12×12 move logged. */
async function seedV1Match(userId: string) {
  const [civ] = await h.db.select().from(civilizations).where(eq(civilizations.slug, 'canada'))
  const [match] = await h.db
    .insert(matches)
    .values({ mode: 'ffa', timeControl: '10+0', rulesVersion: 1, rated: false, status: 'finished' })
    .returning()
  if (!civ || !match) throw new Error('fixture failed')
  for (let seat = 0; seat < 4; seat++) {
    await h.db.insert(matchPlayers).values({
      matchId: match.id,
      seat,
      team: null,
      userId: seat === 0 ? userId : null,
      botLevel: seat === 0 ? null : '600',
      civId: civ.id,
      civVersion: 1,
      placement: seat + 1,
    })
  }
  // c2b3 was South's corner-pawn capture on the old board; illegal on 16×16.
  await h.db
    .insert(matchEvents)
    .values({ matchId: match.id, seq: 1, seat: 0, type: 'move', payload: { notation: 'c2b3' } })
  return match.id
}

describe('matches from rules version 1 (12×12)', () => {
  it('the engine plays rules version 3 and still replays version 2', () => {
    expect(RULES_VERSION).toBe(3)
    expect(isSupportedRulesVersion(3)).toBe(true)
    expect(isSupportedRulesVersion(2)).toBe(true)
    expect(isSupportedRulesVersion(1)).toBe(false)
  })

  it('replays a version 2 match with en passant on, and new games without it', async () => {
    await initRules()
    const civs = Array.from({ length: 4 }, () => ({ id: 'canada' as const, version: 1 }))
    const v2 = playReplay({ config: { mode: 'ffa', civs, rulesVersion: 2 }, actions: [] })
    expect(v2).toMatch(/ ep=on .* rv=2$/)
    const v3 = playReplay({ config: { mode: 'ffa', civs, rulesVersion: 3 }, actions: [] })
    expect(v3).toMatch(/ ep=off .* rv=3$/)
  })

  it('stay listed in history and their detail reports the old version', async () => {
    const a = await signUpVerified(h)
    const matchId = await seedV1Match(a.userId)
    const list = (await a.client.get('/api/matches')).body as unknown as MatchListResponse
    expect(list.matches.map((m) => m.id)).toContain(matchId)
    const detail = await a.client.get(`/api/matches/${matchId}`)
    expect(detail.status).toBe(200)
    const body = detail.body as unknown as MatchDetailResponse
    expect(body.rulesVersion).toBe(1)
    expect(body.events).toHaveLength(1)
  })

  it('are refused by re-simulation with a clear error instead of being mis-replayed', async () => {
    const a = await signUpVerified(h)
    const matchId = await seedV1Match(a.userId)
    const err = await resimulate(h.db, matchId).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedRulesVersionError)
    expect((err as UnsupportedRulesVersionError).rulesVersion).toBe(1)
    expect((err as Error).message).toMatch(/rules version 1/)
  })
})
