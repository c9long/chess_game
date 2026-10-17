/**
 * Adversarial review of player search, public profiles and add-by-username (2026-10-17):
 * LIKE wildcard and SQL injection attempts, over-long input, guests and signed-out callers,
 * the per-user rate limit, and what a stranger's profile or search row may contain (no
 * email, no user id). These pass today; they guard the behavior.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { users } from '@game/db'
import {
  PLAYER_SEARCHES_PER_MIN,
  type PlayerSearchResponse,
  type PublicProfileResponse,
} from '@game/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Browser,
  FakeBotClient,
  type GameHarness,
  guest,
  registered,
  startGameHarness,
} from './game-harness.ts'

let h: GameHarness

beforeAll(async () => {
  h = await startGameHarness({}, { botClient: new FakeBotClient() })
})

afterAll(async () => {
  await h.close()
})

const db = () => h.server.ctx.db
const tag = () => `w${randomBytes(3).toString('hex')}`

async function fakeUser(username: string): Promise<string> {
  const id = randomUUID()
  await db()
    .insert(users)
    .values({
      id,
      name: username,
      username: username.toLowerCase(),
      displayUsername: username,
      email: `${username.toLowerCase()}_${id.slice(0, 6)}@example.test`,
      emailVerified: true,
    })
  return id
}

const search = async (b: Browser, q: string) => {
  const res = await b.get(`/api/players?q=${encodeURIComponent(q)}`)
  return { status: res.status, body: res.body as unknown as PlayerSearchResponse }
}

describe('query input', () => {
  it('refuses LIKE wildcards, escapes, quotes and SQL fragments with 400', async () => {
    const me = await registered(h)
    for (const q of ['%%%', 'a%b', '\\\\\\', "abc'--", 'abc;drop', 'a b c', 'abc%', '***', 'ab.']) {
      const res = await search(me, q)
      expect(res.status, q).toBe(400)
    }
  })

  it('treats "_" literally: "x___" matches only names with x and three underscores', async () => {
    const me = await registered(h)
    const t = tag()
    await fakeUser(`${t}___x`)
    await fakeUser(`${t}abcx`)
    // A query of `_` alone is refused (no trigrams, so it would scan every user), so the
    // literal-underscore check anchors on the tag.
    expect((await search(me, '___')).status).toBe(400)
    const res = await search(me, `${t}___`)
    expect(res.status).toBe(200)
    const names = res.body.results.map((r) => r.username)
    expect(names).toContain(`${t}___x`)
    // The prefix (literal) group holds only the underscore name; `abcx` can only appear as a
    // fuzzy match, after it.
    expect(names[0]).toBe(`${t}___x`)
  })

  it('refuses over-long, array and extra query parameters', async () => {
    const me = await registered(h)
    expect((await search(me, 'a'.repeat(21))).status).toBe(400)
    expect((await search(me, 'a'.repeat(5000))).status).toBe(400)
    expect((await me.get('/api/players?q=abc&q=def')).status).toBe(400)
    expect((await me.get('/api/players?q[]=abc')).status).toBe(400)
    expect((await me.get('/api/players?q=abc&limit=1000')).status).toBe(400)
    expect((await search(me, 'ab')).status).toBe(400)
  })

  it('add-by-username refuses wildcards and does not match by pattern', async () => {
    const me = await registered(h)
    const t = tag()
    await fakeUser(`${t}_target`)
    for (const username of [`${t}%`, `${t}_targe_`, `${t}_TARGET%`]) {
      const res = await me.post('/api/friends/requests', { username })
      expect(res.status, username).not.toBe(200)
    }
    // "_" is a literal character in an exact lookup, never a wildcard.
    const res = await me.post('/api/friends/requests', { username: `${t}_targe_` })
    expect(res.body.error === 'BAD_REQUEST' || res.body.error === 'NOT_ELIGIBLE').toBe(true)
  })
})

describe('who may search', () => {
  it('needs a session and a registered account', async () => {
    const g = await guest(h)
    expect((await search(g, 'abc')).status).toBe(403)
    const anon = await registered(h)
    anon.cookies.clear()
    expect((await search(anon, 'abc')).status).toBe(401)
  })

  it('rate limits per user, and invalid queries count too', async () => {
    const me = await registered(h)
    for (let i = 0; i < PLAYER_SEARCHES_PER_MIN; i++) {
      const res = await search(me, i % 2 ? 'ab' : 'abc') // half of them invalid
      expect(res.status).not.toBe(429)
    }
    expect((await search(me, 'abc')).status).toBe(429)
    // Another account keeps its own budget (the key is the user, not one shared bucket).
    const other = await registered(h)
    expect((await search(other, 'abc')).status).toBe(200)
  })
})

describe('what leaks', () => {
  it('a stranger’s search row and profile carry no email and no user id', async () => {
    const me = await registered(h)
    const t = tag()
    const id = await fakeUser(`${t}_leak`)
    const res = await search(me, `${t}_leak`)
    expect(res.status).toBe(200)
    const row = res.body.results.find((r) => r.username === `${t}_leak`)
    expect(row).toBeDefined()
    expect(Object.keys(row ?? {}).sort()).toEqual(['gamesPlayed', 'rating', 'relation', 'username'])
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain(id)
    expect(raw).not.toContain('@example.test')

    const prof = await me.get(`/api/players/${t}_leak`)
    expect(prof.status).toBe(200)
    const body = prof.body as unknown as PublicProfileResponse
    expect(body.userId).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain(id)
    expect(JSON.stringify(body)).not.toContain('@example.test')
    expect(body.memberSince).toMatch(/^\d{4}-\d{2}$/)
  })

  it('a guest viewer gets no relation and no id', async () => {
    const t = tag()
    const id = await fakeUser(`${t}_gview`)
    const g = await guest(h)
    const prof = await g.get(`/api/players/${t}_gview`)
    expect(prof.status).toBe(200)
    expect(prof.body).toMatchObject({ relation: 'unavailable', capReached: false })
    expect(JSON.stringify(prof.body)).not.toContain(id)
  })

  it('profile paths outside the username charset are the same 404', async () => {
    const me = await registered(h)
    for (const p of ['%25', '..%2F..%2Fadmin', 'a%20b', 'x'.repeat(21)]) {
      const res = await me.get(`/api/players/${p}`)
      expect(res.status, p).toBe(404)
      expect(res.body).toEqual({ error: 'NOT_FOUND', message: 'Player not found.' })
    }
  })
})
