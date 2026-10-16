import { expect, type Page, test } from '@playwright/test'
import { type BoardHook, playMove, position, startAsGuest } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

/** Starts recording every position the board shows, with the time it appeared. */
async function recordPositions(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __board: BoardHook
      __positions?: { ps: string; at: number }[]
    }
    const seen: { ps: string; at: number }[] = [{ ps: w.__board.position(), at: performance.now() }]
    w.__positions = seen
    const tick = () => {
      const ps = w.__board.position()
      if (ps && ps !== seen[seen.length - 1]?.ps) seen.push({ ps, at: performance.now() })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

const recorded = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __positions: { ps: string; at: number }[] }).__positions.map(
      (p) => p.at,
    ),
  )

test('guest plays an untimed game against three bots', async ({ page }) => {
  test.setTimeout(120_000)
  await startAsGuest(page)

  // Landing → "Play vs bots" opens the singleplayer panel on the Play page.
  if (SHOTS) {
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOTS}/solo-landing.png` })
  }
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await expect(panel.getByRole('heading', { name: 'Play vs bots' })).toBeVisible()
  const start = panel.getByTestId('start-solo')
  await expect(start).toBeDisabled()
  await expect(panel.getByTestId('bot-level')).toHaveValue('1200')
  await expect(
    panel.getByTestId('bot-level').locator('option', { hasText: 'Max strength' }),
  ).toHaveCount(1)
  await panel.getByTestId('civ-mali').click()
  await expect(panel.getByTestId('civ-mali')).toHaveAttribute('aria-checked', 'true')
  await panel.getByTestId('bot-level').selectOption('1500')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/solo-setup.png`, fullPage: true })
  await expect(start).toBeEnabled()
  await start.click()

  // The game starts by itself: board, no lobby controls, no clocks anywhere.
  await expect(page).toHaveURL(/\/match\//)
  if (SHOTS) {
    await expect(page.getByTestId('solo-lineup')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/solo-starting.png` })
  }
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  await expect(page.getByText('Free-for-all · Untimed')).toBeVisible()
  await expect(page.getByTestId('clock')).toHaveCount(0)
  await expect(page.getByTestId('start-game')).toHaveCount(0)

  // South is the player with Mali; West, North and East are bots with other civs.
  await expect(page.getByTestId('player-south')).toContainText('Mali')
  await expect(page.getByTestId('player-south')).toContainText('(you)')
  for (const seat of ['west', 'north', 'east']) {
    const row = page.getByTestId(`player-${seat}`)
    await expect(row).toContainText('Bot · 1500')
    await expect(row).not.toContainText('Mali')
  }

  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
  await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/solo-start.png` })

  // Play a move by clicking squares; the three bots reply, spaced for their animations,
  // and the turn comes back.
  await recordPositions(page)
  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 30_000 })
  const times = await recorded(page)
  // start, South's move, then West, North and East.
  expect(times.length).toBe(5)
  const gaps = times.slice(2).map((t, i) => t - (times[i + 1] ?? 0))
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/solo-mid.png` })

  // Untimed: waiting changes nothing, and nobody's flag falls.
  const pos = await position(page)
  await page.waitForTimeout(1500)
  expect(await position(page)).toBe(pos)
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move')

  await playMove(page, 'i1', 'h3')
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 30_000 })

  // Leaving ends the player's part; the bots finish and the game shows up in the history.
  await page.getByRole('button', { name: 'Leave game' }).click()
  await page.getByTestId('leave-confirm').click()
  await expect(page.getByTestId('vs-bots')).toBeVisible()
  await expect(async () => {
    await page.goto('/history')
    await expect(page.getByTestId('match-history')).toContainText('Untimed · vs bots', {
      timeout: 2_000,
    })
  }).toPass({ timeout: 30_000 })
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/solo-history.png`, fullPage: true })
})

// Leaving gives the seat up for good: the match page must not rejoin it on the way out, so
// the player can start another game right away.
test('after leaving a solo game the player can start another', async ({ page }) => {
  test.setTimeout(120_000)
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  let panel = page.getByTestId('vs-bots')
  await panel.getByTestId('civ-china').click()
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })

  // The leave confirmation is a modal: Escape cancels and focus goes back to the button.
  const leaveButton = page.getByRole('button', { name: 'Leave game' })
  await leaveButton.click()
  const leaveDialog = page.getByTestId('leave-dialog')
  await expect(leaveDialog).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/leave-dialog.png` })
  await expect(leaveDialog.getByRole('button', { name: 'Keep playing' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(leaveDialog).toHaveCount(0)
  await expect(leaveButton).toBeFocused()
  await leaveButton.click()
  await page.getByTestId('leave-confirm').click()
  panel = page.getByTestId('vs-bots')
  await expect(panel).toBeVisible()
  await page.waitForTimeout(2000)
  await expect(page.getByText('You have a seat in')).toHaveCount(0)

  await panel.getByTestId('civ-france').click()
  await expect(panel.getByTestId('start-solo')).toBeEnabled()
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  await expect(page.getByTestId('player-south')).toContainText('France')
})
