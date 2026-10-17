/**
 * UX review: ranked lobby, badge, Elo on game over / history, ratings cards, leaderboard,
 * at 1280x800 and 1920x1080 (screenshots only). Runs only when UX_SHOTS is set.
 */
import { expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import { chooseCiv, signUpAndVerify, startAsGuest, YOUR_TURN } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''
const DB = process.env.UX_DB ?? E2E_DATABASE_URL
const BIG = { width: 1920, height: 1080 }
const SMALL = { width: 1280, height: 800 }

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

async function both(page: Page, name: string, fullPage = false) {
  await page.setViewportSize(SMALL)
  await shot(page, `1280-${name}`, fullPage)
  await page.setViewportSize(BIG)
  await shot(page, `1920-${name}`, fullPage)
  await page.setViewportSize(SMALL)
}

test('ux ranked: create, lobby, guest view, game, game over, history, leaderboard', async ({
  browser,
}) => {
  test.skip(!OUT, 'UX_SHOTS not set')
  test.setTimeout(400_000)

  // Leaderboard empty state for a fresh bucket (signed-out visitor past the age screen).
  const visitorCtx = await browser.newContext({ viewport: SMALL })
  const visitor = await visitorCtx.newPage()
  await startAsGuest(visitor)
  await visitor.goto('/leaderboard?mode=teams&tc=10%2B0')
  await expect(visitor.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()
  await visitor.waitForTimeout(800)
  await both(visitor, 'r0-leaderboard-guest-teams10', true)

  const civs = ['mali', 'france', 'japan', 'china']
  const pages: Page[] = []
  const names: string[] = []
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ viewport: SMALL })
    const p = await ctx.newPage()
    names.push((await signUpAndVerify(p)).username)
    pages.push(p)
  }
  const [S, W, N, E] = pages as [Page, Page, Page, Page]
  await S.goto('/play')
  await S.getByTestId('lobby-name').fill('UX ranked table')
  await S.getByTestId('ranked-toggle').check({ force: true })
  await both(S, 'r1-create-ranked-on', true)
  await S.getByTestId('create-lobby').click()
  await expect(S.getByRole('heading', { name: 'UX ranked table' })).toBeVisible()
  await both(S, 'r2-ranked-lobby-host', true)

  // Guest: browser with badge + filter, and opening the invite link directly.
  await visitor.goto('/play')
  await expect(visitor.getByTestId('ranked-toggle')).toBeDisabled()
  await both(visitor, 'r3-guest-play', true)
  await visitor.getByTestId('lobby-filter-ranked').click()
  await both(visitor, 'r3b-guest-filter-ranked', true)
  await visitor.goto(S.url())
  await visitor.waitForTimeout(2500)
  await both(visitor, 'r4-guest-opens-ranked-invite', true)

  // Second registered player in the lobby (not host).
  for (const p of [W, N, E]) {
    await p.goto(S.url())
    await expect(p.getByRole('heading', { name: 'UX ranked table' })).toBeVisible()
  }
  await both(W, 'r5-ranked-lobby-member', true)
  for (const [i, p] of pages.entries()) {
    await chooseCiv(p, civs[i] as string)
    await p.getByTestId('ready').click()
  }
  await expect(S.getByTestId('start-game')).toBeEnabled()
  await S.getByTestId('start-game').click()
  await expect(S.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await S.waitForTimeout(800)
  await both(S, 'r6-ranked-game')
  // Ranked resign dialog
  await N.getByTestId('resign').click()
  await both(N, 'r6b-ranked-resign-dialog')
  await N.getByRole('button', { name: 'Keep playing' }).click()

  for (const [p, seat] of [
    [W, 'west'],
    [N, 'north'],
    [E, 'east'],
  ] as const) {
    await p.getByTestId('resign').click()
    await p.getByTestId('resign-confirm').click()
    await expect(S.getByTestId(`player-${seat}`)).toContainText('Resigned')
  }
  for (const p of pages) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 20_000 })
  await expect(S.getByTestId('my-elo-change')).toBeVisible()
  await both(S, 'r7-gameover-winner')
  await both(W, 'r7b-gameover-last')
  await both(N, 'r7c-gameover-third')

  await S.goto('/history')
  await expect(S.getByTestId('rating-ffa-10+0')).toContainText('1 game')
  await both(S, 'r8-history', true)

  // Seed the leaderboard: the four players and some long names.
  const sql = postgres(DB, { max: 1 })
  try {
    const ids = await sql<{ id: string; username: string }[]>`
      select id, username from users where username = any(${names.map((n) => n.toLowerCase())})`
    let r = 1500
    for (const u of ids) {
      await sql`update elo_ratings set games = 7, rating = ${r}, peak = ${r + 40}
        where user_id = ${u.id} and mode = 'ffa' and time_control = '10+0'`
      r -= 35
    }
    // A tie at the top to check rank numbering.
    if (ids[1])
      await sql`update elo_ratings set rating = 1500 where user_id = ${ids[1].id}
      and mode = 'ffa' and time_control = '10+0'`
  } finally {
    await sql.end()
  }
  await S.goto('/leaderboard')
  await expect(S.getByTestId('leaderboard-row').first()).toBeVisible()
  await S.mouse.move(0, 0)
  await both(S, 'r9-leaderboard-populated', true)
  await W.goto('/history')
  await expect(W.getByTestId('rating-ffa-10+0')).toBeVisible()
  await both(W, 'r10-history-loser', true)

  for (const p of pages) await p.context().close()
  await visitorCtx.close()
})
