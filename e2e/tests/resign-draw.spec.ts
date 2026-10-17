import { expect, type Page, test } from '@playwright/test'
import { chooseCiv, playMove, startAsGuest, YOUR_TURN } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

/** Starts a singleplayer game from the landing page and waits for South's first move. */
async function startSolo(page: Page, mode: 'Free-for-all' | 'Teams 2v2', civ = 'mali') {
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, civ, panel)
  await panel.getByRole('button', { name: mode }).click()
  await panel.getByTestId('start-solo').click()
  await expect(page).toHaveURL(/\/match\//)
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
}

test('asking the bot teammate to resign in an even Teams position: it declines and the game goes on', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await startSolo(page, 'Teams 2v2')
  const resign = page.getByTestId('resign')
  await expect(resign).toBeEnabled()
  await expect(page.getByTestId('offer-draw')).toBeEnabled()

  // The confirm dialog explains the teammate vote; "Keep playing" changes nothing.
  await resign.click()
  const dialog = page.getByTestId('resign-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Teams 2v2')
  await expect(dialog.getByRole('heading')).toHaveText('Ask your teammate to resign?')
  await expect(page.getByTestId('resign-vote-note')).toHaveText(
    'Your teammate must agree. If they agree, your team loses. If they decline, you both play on.',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/resign-dialog-teams.png` })
  await dialog.getByRole('button', { name: 'Keep playing' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('team-resign-waiting')).toHaveCount(0)

  // Ask: the North bot answers after its usual pacing and declines (even material).
  await resign.click()
  await expect(page.getByTestId('resign-confirm')).toHaveText('Ask to resign')
  await page.getByTestId('resign-confirm').click()
  // The answer replaces "Waiting for …" in the same card for a moment, naming the bot by its
  // civilization as the player panel does.
  await expect(page.getByTestId('team-resign-outcome')).toHaveText(
    /^The [\w ]+ bot declined to resign\. You both play on\.$/,
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/resign-declined.png` })
  await expect(page.getByTestId('team-resign-waiting')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByTestId('player-south')).not.toContainText('Resigned')
  await expect(page.getByTestId('player-north')).not.toContainText('Resigned')
  await expect(page.getByTestId('game-over')).toHaveCount(0)
  // South keeps playing and must make two more moves before asking again.
  await expect(resign).toBeDisabled()
  await expect(page.getByTestId('resign-hint')).toHaveText('You can ask again after 2 more moves.')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN)
  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await expect(page.getByTestId('resign-hint')).toHaveText('You can ask again after 1 more move.')
  await playMove(page, 'i1', 'h3')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await expect(page.getByTestId('resign-hint')).toHaveCount(0)
  await expect(resign).toBeEnabled()
})

test('Teams with two people and two bots: the teammate agrees to resign and the result says the team resigned', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const pages: Page[] = []
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await startAsGuest(page)
    pages.push(page)
  }
  const [south, north] = pages as [Page, Page]
  await south.goto('/play')
  const form = south.locator('form').filter({ has: south.getByTestId('lobby-name') })
  await south.getByTestId('lobby-name').fill('Team table')
  await form.getByRole('button', { name: 'Teams 2v2' }).click()
  await south.getByTestId('create-lobby').click()
  await expect(south.getByRole('heading', { name: 'Team table' })).toBeVisible()
  // Bots at West and East; the second person joins at North.
  for (const seat of ['west', 'east'] as const) {
    const card = south.getByTestId(`seat-${seat}`)
    await card.getByTestId('add-bot').click()
    await expect(card.getByTestId('seat-name')).toHaveText(/^Bot · /)
  }
  await north.goto(south.url())
  await expect(north.getByRole('heading', { name: 'Team table' })).toBeVisible()
  await expect(south.getByTestId('seat-north').getByTestId('seat-name')).toHaveText(/^Guest-\d{4}$/)
  const northName =
    (await south.getByTestId('seat-north').getByTestId('seat-name').textContent()) ?? ''
  const southName =
    (await south.getByTestId('seat-south').getByTestId('seat-name').textContent()) ?? ''
  for (const [i, p] of pages.entries()) {
    await chooseCiv(p, ['mali', 'japan'][i] as string)
    await p.getByTestId('ready').click()
  }
  await expect(south.getByTestId('start-game')).toBeEnabled()
  await south.getByTestId('start-game').click()
  await expect(south.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  for (const p of pages) await expect(p.getByTestId('board')).toBeVisible()

  // North's own request arriving while South's confirm dialog is open closes the dialog (its
  // text promised a vote; confirming would agree at once) and shows the request instead.
  await south.getByTestId('resign').click()
  await expect(south.getByTestId('resign-dialog')).toBeVisible()
  await north.getByTestId('resign').click()
  await north.getByTestId('resign-confirm').click()
  await expect(south.getByTestId('resign-dialog')).toHaveCount(0)
  await expect(south.getByTestId('team-resign-request')).toBeVisible()
  await south.getByTestId('team-resign-decline').click()
  await expect(north.getByTestId('team-resign-outcome')).toHaveText(
    `${southName} declined to resign. You both play on.`,
  )
  await expect(south.getByTestId('team-resign-request')).toHaveCount(0)

  // South asks; South waits, North gets the request.
  await south.getByTestId('resign').click()
  await expect(south.getByTestId('resign-vote-note')).toBeVisible()
  await south.getByTestId('resign-confirm').click()
  await expect(south.getByTestId('team-resign-waiting')).toContainText(`Waiting for ${northName}…`)
  await expect(south.getByTestId('resign')).toBeDisabled()
  const request = north.getByTestId('team-resign-request')
  await expect(request).toContainText(`${southName} wants to resign for your team`)
  await expect(request.getByTestId('team-resign-accept')).toHaveText('Resign the game')
  await expect(request.getByTestId('team-resign-decline')).toHaveText('Keep playing')
  await north.waitForTimeout(400)
  if (SHOTS) {
    await south.screenshot({ path: `${SHOTS}/team-resign-waiting.png` })
    await north.screenshot({ path: `${SHOTS}/team-resign-request.png` })
  }

  // North agrees: the team resigns and both see that their team lost.
  await request.getByTestId('team-resign-accept').click()
  for (const p of pages) {
    const over = p.getByTestId('game-over')
    await expect(over).toBeVisible({ timeout: 15_000 })
    await expect(over.getByRole('heading', { name: 'You finished 2nd' })).toBeVisible()
    await expect(p.getByTestId('game-over-subline')).toHaveText('Your team resigned.')
    await expect(p.getByTestId('placement-south')).toContainText('2nd')
    await expect(p.getByTestId('placement-north')).toContainText('2nd')
    await expect(p.getByTestId('placement-west')).toContainText('1st')
    await expect(p.getByTestId('defeat-south')).toContainText('Resigned')
    await expect(p.getByTestId('defeat-north')).toContainText('Resigned')
  }
  await south.waitForTimeout(400)
  if (SHOTS) await south.screenshot({ path: `${SHOTS}/team-resigned-game-over.png` })
  for (const p of pages) await p.context().close()
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
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN)

  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await expect(page.getByTestId('draw-hint')).toHaveText('You can offer again after 1 more move.')
  await playMove(page, 'i1', 'h3')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
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
    await chooseCiv(p, civs[i] as string)
    await p.getByTestId('ready').click()
  }
  await expect(south.getByTestId('start-game')).toBeEnabled()
  await south.getByTestId('start-game').click()
  await expect(south.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
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
