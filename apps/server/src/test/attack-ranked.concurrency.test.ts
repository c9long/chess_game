/**
 * Review attack: two ranked games finishing at the same time for the same player.
 * A player knocked out of ranked game A may leave (seat released) and play ranked game B
 * while A continues, so both results can be recorded concurrently.
 */
import { randomUUID } from 'node:crypto'
import { createDb, eloRatings, users } from '@game/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rateFfa } from '../game/elo.ts'
import { applyElo, type RatedSeat } from '../game/ratings.ts'
import { TEST_DATABASE_URL } from './env.ts'

const { db, close } = createDb(TEST_DATABASE_URL, { max: 8 })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function makeUsers(n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => randomUUID())
  await db.insert(users).values(
    ids.map((id) => ({
      id,
      name: id.slice(0, 8),
      email: `${id}@example.test`,
      username: `u${id.replace(/-/g, '').slice(0, 16)}`,
      displayUsername: `U${id.slice(0, 8)}`,
    })),
  )
  return ids
}

const seats = (ids: string[], placements: number[]): RatedSeat[] =>
  ids.map((userId, seat) => ({
    seat,
    team: seat % 2,
    placement: placements[seat] as number,
    userId,
    isGuest: false,
    botLevel: null,
  }))

const game = { mode: 'ffa' as const, timeControl: '3+2' }

beforeAll(async () => {
  await db.select().from(users).limit(1)
})
afterAll(async () => {
  await close()
})

describe('attack: concurrent Elo updates', () => {
  it('a first-ever ranked game finishing concurrently with another loses no update', async () => {
    const [p, a1, a2, a3, b1, b2, b3] = (await makeUsers(7)) as string[]
    // Game A: p wins. Game B: p comes last. Both commits overlap.
    const txA = db.transaction(async (tx) => {
      const r = await applyElo(tx, game, seats([p, a1, a2, a3] as string[], [1, 2, 3, 4]))
      await sleep(300)
      return r
    })
    await sleep(50)
    const txB = db.transaction(async (tx) =>
      applyElo(tx, game, seats([p, b1, b2, b3] as string[], [4, 1, 2, 3])),
    )
    await Promise.all([txA, txB])
    const [row] = await db
      .select()
      .from(eloRatings)
      .where(eq(eloRatings.userId, p as string))
    // Sequential application (A then B), as a serialised update would give.
    const afterA = rateFfa(
      [1, 2, 3, 4].map((pl, seat) => ({
        seat,
        team: 0,
        placement: pl,
        rating: 1200,
        games: 0,
        peak: 1200,
      })),
    )[0]?.after as number
    const expected = rateFfa([
      { seat: 0, team: 0, placement: 4, rating: afterA, games: 1, peak: afterA },
      ...[1, 2, 3].map((pl, i) => ({
        seat: i + 1,
        team: 0,
        placement: pl,
        rating: 1200,
        games: 0,
        peak: 1200,
      })),
    ])[0]?.after as number
    expect(row?.games).toBe(2)
    expect(row?.rating).toBe(expected)
  })

  it('two players finishing two games at once in opposite seat order do not deadlock', async () => {
    const [p, q, a1, a2, b1, b2] = (await makeUsers(6)) as string[]
    const results = await Promise.allSettled([
      db.transaction(async (tx) => {
        const r = await applyElo(tx, game, seats([p, q, a1, a2] as string[], [1, 2, 3, 4]))
        await sleep(200)
        return r
      }),
      db.transaction(async (tx) => {
        const r = await applyElo(tx, game, seats([q, p, b1, b2] as string[], [1, 2, 3, 4]))
        await sleep(200)
        return r
      }),
    ])
    const failures = results.filter((r) => r.status === 'rejected')
    expect(
      failures.map((f) => String(((f as PromiseRejectedResult).reason as Error).cause)),
    ).toEqual([])
    const rows = await db
      .select()
      .from(eloRatings)
      .where(inArray(eloRatings.userId, [p, q] as string[]))
    expect(rows.map((r) => r.games)).toEqual([2, 2])
  })
})
