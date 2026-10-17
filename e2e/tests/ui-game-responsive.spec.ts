import { expect, type Page, test } from '@playwright/test'
import { chooseCiv, startAsGuest, YOUR_TURN } from './helpers.ts'

/** The game screen and the lobby on a phone (390px) and a tablet (768px). */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
] as const

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test('game screen fits phones and tablets: board, players and actions without scrolling', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await startAsGuest(page)
  await page.goto('/play')
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'mali', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    expect(await horizontalOverflow(page), `${size.name}: horizontal overflow`).toBe(0)

    const board = page.getByTestId('board')
    await expect(board).toBeInViewport({ ratio: 1 })
    const box = await board.boundingBox()
    // The board uses the width it has (minus the page gutters), not a postage stamp.
    expect(box?.width ?? 0, `${size.name}: board width`).toBeGreaterThan(size.width - 64)

    await expect(page.getByTestId('turn-banner')).toBeInViewport({ ratio: 1 })
    for (const seat of ['south', 'west', 'north', 'east']) {
      await expect(page.getByTestId(`player-${seat}`)).toBeInViewport({ ratio: 1 })
    }
    await expect(page.getByTestId('resign')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('offer-draw')).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'Leave game' })).toBeInViewport({ ratio: 1 })
    await expect(page.getByText('Free-for-all · Untimed')).toBeVisible()
  }

  // Board settings open from the gear and list the keyboard controls.
  await page.getByRole('button', { name: 'Board settings' }).click()
  await expect(page.getByTestId('board-settings')).toBeVisible()
  await expect(page.getByTestId('board-settings')).toContainText('Keyboard')
  expect(await horizontalOverflow(page)).toBe(0)
})

test('lobby room fits phones and tablets: seats, civ dropdown and Ready/Start reachable', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await startAsGuest(page)
  await page.goto('/play')
  await page.getByTestId('lobby-name').fill('Responsive table')
  await page.getByTestId('create-lobby').click()
  await expect(page.getByRole('heading', { name: 'Responsive table' })).toBeVisible()

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    expect(await horizontalOverflow(page), `${size.name}: horizontal overflow`).toBe(0)
    for (const seat of ['south', 'west', 'north', 'east']) {
      await expect(page.getByTestId(`seat-${seat}`)).toBeVisible()
    }
    await expect(page.getByTestId('civ-select')).toBeVisible()
    await page.getByTestId('ready').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('ready')).toBeInViewport()
    await expect(page.getByTestId('start-game')).toBeInViewport()
  }

  // Phones: Ready and Start stay in a bar at the bottom of the screen, even scrolled to the top.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.getByTestId('ready')).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('start-game')).toBeInViewport({ ratio: 1 })

  // Fill a seat with a bot from the phone layout.
  const west = page.getByTestId('seat-west')
  await west.getByTestId('bot-level').selectOption('1500')
  await west.getByTestId('add-bot').click()
  await expect(west.getByTestId('seat-name')).toHaveText('Bot · 1500')
  expect(await horizontalOverflow(page)).toBe(0)
})
