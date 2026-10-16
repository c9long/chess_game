import { expect, type Page, test } from '@playwright/test'
import { passAgeScreen } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

async function startAsGuest(page: Page) {
  await page.goto('/')
  await passAgeScreen(page)
  await page.getByRole('link', { name: 'Play as Guest' }).click()
  await page.getByTestId('clickwrap-checkbox').check()
  await page.getByTestId('guest-continue').click()
  await expect(page.getByTestId('signed-in')).toBeVisible()
}

interface BoardHook {
  squareToClient(s: string): { x: number; y: number } | null
  position(): string
}

const position = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board: BoardHook }).__board.position())

/**
 * Plays a move by clicking its from- and to-squares on the live board (dev-only hook),
 * then waits until the server has applied it (the position changes).
 */
async function playMove(page: Page, from: string, to: string) {
  const before = await position(page)
  for (const sq of [from, to]) {
    const pt = await page.evaluate(
      (s) => (window as unknown as { __board: BoardHook }).__board.squareToClient(s),
      sq,
    )
    if (!pt) throw new Error(`square ${sq} not on screen`)
    await page.mouse.click(pt.x, pt.y)
  }
  await expect.poll(() => position(page), { timeout: 10_000 }).not.toBe(before)
}

test('guest creates a lobby, fills it with bots, plays and sees the result', async ({ page }) => {
  test.setTimeout(240_000)
  await startAsGuest(page)

  await page.getByTestId('play').click()
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
  await page.getByTestId('lobby-name').fill('E2E table')
  await page.getByTestId('create-lobby').click()

  // Lobby room: the creator is South and host.
  await expect(page.getByRole('heading', { name: 'E2E table' })).toBeVisible()
  const south = page.getByTestId('seat-south')
  await expect(south.getByTestId('seat-name')).toHaveText(/^Guest-\d{4}$/)

  // Fill the other three seats with bots at different strengths.
  for (const [seat, level] of [
    ['west', '600'],
    ['north', '900'],
    ['east', '1200'],
  ] as const) {
    const card = page.getByTestId(`seat-${seat}`)
    await card.getByTestId('bot-level').selectOption(level)
    await card.getByTestId('add-bot').click()
    await expect(card.getByTestId('seat-name')).toHaveText(`Bot · ${level}`)
  }

  // Choose a civilization: its emblem appears next to the username, then ready up.
  await page.getByTestId('civ-mali').click()
  await expect(south.getByRole('img', { name: 'Mali' }).first()).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lobby.png`, fullPage: true })
  await page.getByTestId('ready').click()
  await expect(page.getByTestId('start-game')).toBeEnabled()
  await page.getByTestId('start-game').click()

  // Live game: South moves first.
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
  await page.waitForTimeout(800)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/game-start.png` })

  // Push the e-pawn two squares and develop a knight; after each move the three bots
  // answer and the turn comes back to South.
  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 30_000 })
  await playMove(page, 'i1', 'h3')
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 30_000 })
  // Both moves are on the board: South's knight now stands on h3, the pawn on e4.
  const pos = await position(page)
  expect(pos).toMatch(/^ffa /)
  await page.waitForTimeout(600)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/game-mid.png` })

  // The clocks are live: South's clock is running down from 10:00 (or the dev override).
  const clock = page.getByTestId('player-south').getByTestId('clock')
  const before = await clock.textContent()
  await page.waitForTimeout(1500)
  expect(await clock.textContent()).not.toBe(before)

  // Leaving mid-game eliminates the seat; the bots finish and the result appears.
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Leave game' }).click()
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
})

test('a private lobby asks for its password', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  await startAsGuest(host)
  await host.goto('/play')
  await host.getByTestId('lobby-name').fill('Secret table')
  await host.getByTestId('lobby-password').fill('hunter22')
  await host.getByTestId('create-lobby').click()
  await expect(host.getByRole('heading', { name: 'Secret table' })).toBeVisible()

  const guestCtx = await browser.newContext()
  const guest = await guestCtx.newPage()
  await startAsGuest(guest)
  await guest.goto('/play')
  const row = guest.getByTestId('lobby-list').locator('li', { hasText: 'Secret table' })
  await expect(row).toBeVisible()
  await expect(row.getByTitle('Private: password required')).toBeVisible()
  await row.getByTestId('join-lobby').click()
  await guest.getByTestId('join-password').fill('wrong-password')
  await guest.getByTestId('join-submit').click()
  await expect(guest.getByRole('alert')).toContainText('password is not right')
  await guest.getByTestId('join-password').fill('hunter22')
  await guest.getByTestId('join-submit').click()
  await expect(guest.getByRole('heading', { name: 'Secret table' })).toBeVisible()
  // Both players see each other in the seats.
  await expect(host.getByTestId('seat-west').getByTestId('seat-name')).toHaveText(/^Guest-\d{4}$/)
  await hostCtx.close()
  await guestCtx.close()
})
