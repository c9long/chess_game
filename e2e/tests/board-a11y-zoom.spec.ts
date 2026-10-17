import { type Browser, expect, type Page, test } from '@playwright/test'
import { type BoardHook, chooseCiv, position, startAsGuest, YOUR_TURN } from './helpers.ts'

/**
 * The live game screen: keyboard play with screen-reader announcements (the viewer's own
 * move confirmed as "You", the bots' replies read together, no "is thinking" chatter), and
 * the phone zoom (button, tap-tap at the zoomed size).
 */

const SHOTS = process.env.E2E_SCREENSHOTS

async function startSolo(page: Page) {
  await startAsGuest(page)
  await page.goto('/play')
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'mali', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
}

const movesRegion = (page: Page) => page.locator('[data-board-announcer="moves"]')
const cursorRegion = (page: Page) => page.locator('[data-board-announcer="cursor"]')

test('keyboard move with announcements in a solo game', async ({ page }) => {
  test.setTimeout(120_000)
  await startSolo(page)
  await expect(movesRegion(page)).toHaveAttribute('aria-live', 'polite')
  // The banner no longer announces every seat's turn; its own live text says only "Your move".
  await expect(page.getByTestId('turn-banner')).not.toHaveAttribute('aria-live', /.+/)
  await expect(page.getByTestId('turn-announcer')).toHaveText(YOUR_TURN)

  const canvas = page.getByTestId('board').locator('canvas')
  await canvas.focus()
  // Keyboard focus may already show the cursor; Escape hides it (it stays on the leader),
  // and the first arrow key shows it again there.
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowUp')
  await expect(cursorRegion(page)).toHaveText('i1, your king')
  await page.keyboard.press('ArrowUp')
  await expect(cursorRegion(page)).toHaveText('i2, your pawn')
  await page.keyboard.press('Enter')
  await expect(cursorRegion(page)).toHaveText(/^Picked up pawn on i2: 2 moves/)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(cursorRegion(page)).toHaveText('i4, empty, move here')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/game-1280-keyboard.png` })
  const before = await position(page)
  await page.keyboard.press('Enter')
  await expect.poll(() => position(page), { timeout: 10_000 }).not.toBe(before)

  // Your move is confirmed first, then the three bots' replies; the turn comes back.
  await expect(movesRegion(page).locator('p').first()).toHaveText('You: pawn i2 to i4.')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await expect
    .poll(async () => (await movesRegion(page).locator('p').allTextContents()).join(' '), {
      timeout: 10_000,
    })
    .toMatch(/West: .+ North: .+ East: /)
  const lines = await movesRegion(page).locator('p').allTextContents()
  // Batched: one line for your move, at most one per bot, never a line per event.
  expect(lines.length).toBeLessThanOrEqual(4)
  for (const l of lines) expect(l).not.toMatch(/thinking/)
  await expect(page.getByTestId('turn-announcer')).toHaveText(YOUR_TURN)
})

async function phonePage(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  })
  return { context, page: await context.newPage() }
}

async function squarePx(page: Page) {
  return page.evaluate(() => {
    const b = (window as unknown as { __board: BoardHook }).__board
    const p = b.squareToClient('e4') as { x: number; y: number }
    const q = b.squareToClient('f4') as { x: number; y: number }
    return Math.hypot(p.x - q.x, p.y - q.y)
  })
}

async function tap(page: Page, sq: string) {
  const pt = await page.evaluate(
    (s) => (window as unknown as { __board: BoardHook }).__board.squareToClient(s),
    sq,
  )
  if (!pt) throw new Error(`no square ${sq}`)
  await page.touchscreen.tap(pt.x, pt.y)
}

test('phone: zoom button, tap-tap at the zoomed size, zoom back out', async ({ browser }) => {
  test.setTimeout(150_000)
  const { context, page } = await phonePage(browser)
  try {
    await startSolo(page)
    // Let the board settle (fonts, atlas) before measuring.
    await page.waitForTimeout(800)
    expect(await squarePx(page)).toBeLessThan(24)
    const button = page.getByTestId('board').locator('[data-board-zoom]')
    await expect(button).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/game-390-zoom1.png` })
    await button.tap()
    await expect.poll(() => squarePx(page)).toBeGreaterThanOrEqual(40)
    await page.waitForTimeout(600)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/game-390-zoomed.png` })
    await tap(page, 'h2')
    await page.waitForTimeout(400)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/game-390-zoomed-selected.png` })
    const before = await position(page)
    await tap(page, 'h4')
    await expect.poll(() => position(page), { timeout: 10_000 }).not.toBe(before)
    await expect(movesRegion(page).locator('p').first()).toHaveText('You: pawn h2 to h4.')
    await button.tap()
    await expect.poll(() => squarePx(page)).toBeLessThan(24)
    await expect(button).toHaveAttribute('data-board-zoom', 'in')
  } finally {
    await context.close()
  }
})
