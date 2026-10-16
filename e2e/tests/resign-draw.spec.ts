import { expect, type Page, test } from '@playwright/test'
import { playMove, startAsGuest } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

/** Starts a singleplayer game from the landing page and waits for South's first move. */
async function startSolo(page: Page, mode: 'Free-for-all' | 'Teams 2v2', civ = 'mali') {
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await panel.getByTestId(`civ-${civ}`).click()
  await panel.getByRole('button', { name: mode }).click()
  await panel.getByTestId('start-solo').click()
  await expect(page).toHaveURL(/\/match\//)
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
}

test('resigning a singleplayer Teams game freezes the player; the result shows "Resigned"', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await startSolo(page, 'Teams 2v2')
  const resign = page.getByTestId('resign')
  await expect(resign).toBeEnabled()
  await expect(page.getByTestId('offer-draw')).toBeEnabled()

  // The confirm dialog explains the Teams consequence; "Keep playing" changes nothing.
  await resign.click()
  const dialog = page.getByTestId('resign-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Teams 2v2')
  await expect(dialog).toContainText('freeze')
  await expect(dialog).toContainText('Your partner plays on alone')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/resign-dialog.png` })
  await dialog.getByRole('button', { name: 'Keep playing' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('player-south')).not.toContainText('Resigned')

  await resign.click()
  await page.getByTestId('resign-confirm').click()
  await expect(page.getByTestId('player-south')).toContainText('Resigned (frozen)')
  await expect(page.getByTestId('out-note')).toHaveText(
    'You resigned. You can keep watching or leave.',
  )
  // Out of the game: no more resigning or draw offers, and leaving needs no confirmation.
  await expect(page.getByTestId('resign')).toBeDisabled()
  await expect(page.getByTestId('offer-draw')).toBeDisabled()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/resign-frozen.png` })

  // The bots finish the game (South's partner North plays on); the result keeps South's seat.
  const over = page.getByTestId('game-over')
  await expect(over).toBeVisible({ timeout: 150_000 })
  await expect(over).toContainText('Untimed game vs bots')
  await expect(page.getByTestId('defeat-south')).toContainText('Resigned')
  const south = page.getByTestId('placement-south')
  await expect(south).toContainText(/1st|2nd/)
  const north = page.getByTestId('placement-north')
  // Teams: partners share their placement.
  expect((await south.textContent())?.slice(0, 3)).toBe((await north.textContent())?.slice(0, 3))
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/resign-game-over.png` })
})

test('offering a draw to bots in an even position: they decline, and the offer cools down', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await startSolo(page, 'Free-for-all', 'china')
  const offer = page.getByTestId('offer-draw')
  await expect(offer).toBeEnabled()
  await offer.click()

  // Everyone sees the offer: South accepted (the offerer), the bots pending, then West
  // declines (bots answer after the usual move pacing), which ends it.
  const card = page.getByTestId('draw-offer')
  await expect(card).toBeVisible()
  await expect(card).toContainText('You offered a draw')
  await expect(page.getByTestId('draw-vote-south')).toHaveAttribute('data-status', 'accepted')
  await expect(page.getByTestId('draw-accept')).toHaveCount(0)
  await expect(offer).toBeDisabled()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/draw-offer.png` })

  await expect(page.getByTestId('toast').filter({ hasText: 'declined the draw' })).toBeVisible()
  await expect(card).toContainText('Draw declined')
  await expect(page.getByTestId('draw-vote-west')).toHaveAttribute('data-status', 'declined')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/draw-declined.png` })
  // The declined card goes away; South must make two more moves before offering again.
  await expect(card).toHaveCount(0, { timeout: 10_000 })
  await expect(offer).toBeDisabled()
  await expect(page.getByTestId('draw-hint')).toHaveText('You can offer again after 2 more moves.')
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move')

  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 30_000 })
  await expect(page.getByTestId('draw-hint')).toHaveText('You can offer again after 1 more move.')
  await playMove(page, 'i1', 'h3')
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 30_000 })
  await expect(page.getByTestId('draw-hint')).toHaveCount(0)
  await expect(offer).toBeEnabled()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/draw-ready-again.png` })
})

test('four people agree a draw: everyone sees the votes, and the result says "Draw agreed"', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const civs = ['mali', 'france', 'japan', 'china']
  const pages: Page[] = []
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await startAsGuest(page)
    pages.push(page)
  }
  const [south, west, north, east] = pages as [Page, Page, Page, Page]
  await south.goto('/play')
  await south.getByTestId('lobby-name').fill('Draw table')
  await south.getByTestId('create-lobby').click()
  await expect(south.getByRole('heading', { name: 'Draw table' })).toBeVisible()
  for (const p of [west, north, east]) {
    await p.goto(south.url())
    await expect(p.getByRole('heading', { name: 'Draw table' })).toBeVisible()
  }
  for (const [i, p] of pages.entries()) {
    await p.getByTestId(`civ-${civs[i]}`).click()
    await p.getByTestId('ready').click()
  }
  await expect(south.getByTestId('start-game')).toBeEnabled()
  await south.getByTestId('start-game').click()
  await expect(south.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  for (const p of pages) await expect(p.getByTestId('board')).toBeVisible()

  // West offers off turn; South (to move) sees Accept / Decline and the votes so far.
  await west.getByTestId('offer-draw').click()
  const card = south.getByTestId('draw-offer')
  await expect(card).toContainText(/offered a draw/)
  await expect(card).toContainText('West')
  await expect(south.getByTestId('draw-vote-west')).toHaveAttribute('data-status', 'accepted')
  await expect(south.getByTestId('draw-vote-south')).toHaveAttribute('data-status', 'pending')
  await expect(west.getByTestId('draw-accept')).toHaveCount(0)
  await south.waitForTimeout(400)
  if (SHOTS) await south.screenshot({ path: `${SHOTS}/draw-pending-voter.png` })

  await south.getByTestId('draw-accept').click()
  await expect(west.getByTestId('draw-vote-south')).toHaveAttribute('data-status', 'accepted')
  await north.getByTestId('draw-accept').click()
  await expect(east.getByTestId('draw-vote-north')).toHaveAttribute('data-status', 'accepted')
  if (SHOTS) await east.screenshot({ path: `${SHOTS}/draw-last-voter.png` })
  await east.getByTestId('draw-accept').click()

  for (const p of pages) {
    const over = p.getByTestId('game-over')
    await expect(over).toBeVisible({ timeout: 15_000 })
    await expect(over.getByRole('heading', { name: 'Draw agreed' })).toBeVisible()
    await expect(over).toContainText('Every player still in the game agreed to a draw')
    await expect(over).toContainText('You share 1st place')
  }
  await expect(south.getByTestId('placement-east')).toContainText('1st')
  await south.waitForTimeout(400)
  if (SHOTS) await south.screenshot({ path: `${SHOTS}/draw-agreed.png` })
  for (const p of pages) await p.context().close()
})
