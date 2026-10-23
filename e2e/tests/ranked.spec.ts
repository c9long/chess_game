import { expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import { chooseCiv, signUpAndVerify, startAsGuest, YOUR_TURN } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

test('a guest sees Ranked disabled and cannot join a ranked lobby', async ({ browser }) => {
  test.setTimeout(120_000)
  // A registered player creates a ranked lobby.
  const hostCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  const creds = await signUpAndVerify(host)
  await host.goto('/play')
  const toggle = host.getByTestId('ranked-toggle')
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()
  await host.getByText('Rated games, for players with accounts').click()
  await expect(toggle).toBeChecked()
  await expect(host.getByTestId('ranked-hint')).toContainText('Counts toward your Elo')
  await host.getByTestId('lobby-name').fill('Ranked ladder night')
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/ranked-create.png`, fullPage: true })
  await host.getByTestId('create-lobby').click()

  // Lobby room: Ranked badge, open seats wait for accounts (no bot controls).
  await expect(host.getByRole('heading', { name: 'Ranked ladder night' })).toBeVisible()
  await expect(host.getByTestId('ranked-badge').first()).toBeVisible()
  await expect(host.getByTestId('seat-south').getByTestId('seat-name')).toHaveText(creds.username)
  await expect(host.getByTestId('seat-west').getByTestId('ranked-seat-hint')).toBeVisible()
  await expect(host.getByTestId('add-bot')).toHaveCount(0)
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/ranked-lobby.png`, fullPage: true })

  // A guest: Ranked is disabled with a way to create an account.
  const guestCtx = await browser.newContext()
  const guest = await guestCtx.newPage()
  await startAsGuest(guest)
  await guest.goto('/play')
  await expect(guest.getByTestId('ranked-toggle')).toBeDisabled()
  await expect(guest.getByTestId('ranked-hint')).toHaveText('Create an account to play ranked.')
  await expect(guest.getByTestId('ranked-hint').getByRole('link')).toHaveAttribute(
    'href',
    '/sign-up',
  )

  // The lobby browser badges the ranked lobby; the guest can't join it.
  const row = guest.getByTestId('lobby-list').locator('li', { hasText: 'Ranked ladder night' })
  await expect(row.getByTestId('ranked-badge')).toBeVisible()
  await expect(row.getByTestId('join-lobby')).toHaveText('Create account to join')
  await expect(row.getByTestId('join-lobby')).toHaveAttribute('href', '/sign-up')
  if (SHOTS) await guest.screenshot({ path: `${SHOTS}/ranked-guest-browser.png`, fullPage: true })

  // Filters: Ranked keeps it, Casual hides it.
  await guest.getByTestId('lobby-filter-casual').click()
  await expect(row).toHaveCount(0)
  await guest.getByTestId('lobby-filter-ranked').click()
  await expect(row).toHaveCount(1)
  await expect(guest).toHaveURL(/[?&]lobbies=ranked/)
  await guest.getByTestId('lobby-filter-all').click()
  await expect(row).toHaveCount(1)
  // A link can open the browser pre-filtered.
  await guest.goto('/play?lobbies=casual')
  await expect(guest.getByTestId('lobby-filter-casual')).toHaveAttribute('aria-pressed', 'true')
  await expect(row).toHaveCount(0)

  await host.getByTestId('leave-lobby').click()
  await expect(host.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
  await hostCtx.close()
  await guestCtx.close()
})

test('four registered players finish a ranked game and see their Elo changes', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const civs = ['mali', 'france', 'japan', 'china']
  const pages: Page[] = []
  const names: string[] = []
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    names.push((await signUpAndVerify(page)).username)
    pages.push(page)
  }
  const [south, west, north, east] = pages as [Page, Page, Page, Page]
  await south.goto('/play')
  await south.getByTestId('lobby-name').fill('Ranked four')
  await south.getByTestId('ranked-toggle').check({ force: true })
  await south.getByTestId('create-lobby').click()
  await expect(south.getByRole('heading', { name: 'Ranked four' })).toBeVisible()
  for (const p of [west, north, east]) {
    await p.goto(south.url())
    await expect(p.getByRole('heading', { name: 'Ranked four' })).toBeVisible()
  }
  for (const [i, p] of pages.entries()) {
    await chooseCiv(p, civs[i] as string)
    await p.getByTestId('ready').click()
  }
  await expect(south.getByTestId('start-game')).toBeEnabled()
  await south.getByTestId('start-game').click()
  await expect(south.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  // The game header carries the Ranked badge.
  for (const p of pages) await expect(p.getByTestId('ranked-badge').first()).toBeVisible()
  await south.waitForTimeout(600)
  if (SHOTS) await south.screenshot({ path: `${SHOTS}/ranked-game.png` })

  // West, North and East resign in turn: South wins; placements 4th, 3rd, 2nd.
  for (const [p, seat] of [
    [west, 'west'],
    [north, 'north'],
    [east, 'east'],
  ] as const) {
    await p.getByTestId('resign').click()
    // The dialog says the resign counts for Elo.
    await expect(p.getByTestId('resign-ranked-note')).toContainText('ranked game')
    await p.getByTestId('resign-confirm').click()
    await expect(p.getByTestId('resign-dialog')).toHaveCount(0)
    await expect(south.getByTestId(`player-${seat}`)).toContainText('Resigned')
  }
  const over = south.getByTestId('game-over')
  await expect(over).toBeVisible({ timeout: 20_000 })
  await expect(over).toContainText('Ranked game')
  await expect(over.getByRole('heading', { name: 'Victory' })).toBeVisible()
  // Four new players (K 40): +20, +7, -7, -20.
  await expect(south.getByTestId('elo-south')).toContainText('1220')
  await expect(south.getByTestId('elo-south')).toContainText('+20')
  await expect(south.getByTestId('elo-east')).toContainText('1207')
  await expect(south.getByTestId('elo-north')).toContainText('1193')
  await expect(south.getByTestId('elo-west')).toContainText('1180')
  await expect(south.getByTestId('my-elo-change')).toContainText('1200 → 1220')
  await expect(west.getByTestId('my-elo-change')).toContainText('1200 → 1180')
  await south.waitForTimeout(400)
  if (SHOTS) await south.screenshot({ path: `${SHOTS}/ranked-game-over.png` })

  // History: the game is Ranked with its Elo change; the card shows the new rating.
  await south.getByTestId('back-to-lobbies').click()
  await south.goto('/history')
  const row = south.getByTestId('match-history').locator('li').first()
  await expect(row.getByTestId('ranked-badge')).toBeVisible()
  await expect(row.getByTestId('history-elo')).toContainText('1220')
  await expect(row.getByTestId('history-elo')).toContainText('+20')
  await expect(south.getByTestId('rating-ffa-10+0')).toContainText('1220')
  await expect(south.getByTestId('rating-ffa-10+0')).toContainText('1 game, peak 1220')
  if (SHOTS) await south.screenshot({ path: `${SHOTS}/ranked-history.png`, fullPage: true })
  for (const p of pages) await p.context().close()
})

test('the leaderboard lists players by Elo per mode and time control', async ({ page }) => {
  test.setTimeout(90_000)
  const creds = await signUpAndVerify(page)
  // Give the new account a Teams 3+2 Elo with enough games to be listed.
  const me = await (await page.request.get('/api/auth/get-session')).json()
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    await sql`
      insert into elo_ratings (user_id, mode, time_control, rating, games, peak)
      values (${me.user.id as string}, 'teams', '3+2', 1342, 12, 1360)`
  } finally {
    await sql.end()
  }

  // Linked from the header and from the Play page.
  await page.goto('/play')
  await page.getByTestId('play-leaderboard-link').click()
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()
  await page.getByTestId('nav-leaderboard').click()
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()

  // Four tabs; FFA 10+0 first.
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(4)
  await expect(page.getByTestId('leaderboard-tab-ffa-10+0')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTestId('leaderboard').getByTestId('leaderboard-row')).toHaveCount(0)
  await expect(page.getByTestId('leaderboard-empty')).toBeVisible()

  await page.getByTestId('leaderboard-tab-teams-3+2').click()
  await expect(page).toHaveURL(/mode=teams&tc=3%2B2/)
  const mine = page.getByTestId('leaderboard-row').filter({ hasText: creds.username })
  await expect(mine).toHaveCount(1)
  await expect(mine).toContainText('1342')
  await expect(mine).toContainText('(you)')
  await expect(page.getByTestId('leaderboard-tab-ffa-10+0')).toHaveAttribute(
    'aria-selected',
    'false',
  )
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/leaderboard.png`, fullPage: true })

  // Ratings cards in the history show Elo, games and peak.
  await page.goto('/history')
  const card = page.getByTestId('rating-teams-3+2')
  await expect(card).toContainText('1342')
  await expect(card).toContainText('12 games, peak 1360')
  await expect(page.getByTestId('rating-ffa-10+0')).toContainText('No ranked games yet')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/history-ratings.png`, fullPage: true })

  // Public: a signed-out visitor (past the age screen) can open it too.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.goto('/leaderboard?mode=teams&tc=3%2B2')
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()
  await expect(page.getByTestId('leaderboard-row').filter({ hasText: creds.username })).toHaveCount(
    1,
  )
})
