import { type Browser, expect, type Page, test } from '@playwright/test'
import {
  type BoardHook,
  chooseCiv,
  passAgeScreen,
  position,
  startAsGuest,
  YOUR_TURN,
} from './helpers.ts'

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
  await page.setViewportSize({ width: 1280, height: 800 })
  await startSolo(page)
  await expect(movesRegion(page)).toHaveAttribute('aria-live', 'polite')
  // The banner is not a live region: the board reads the moves, then "Your move", in order.
  await expect(page.getByTestId('turn-banner')).not.toHaveAttribute('aria-live', /.+/)
  await expect(page.getByTestId('turn-announcer')).toHaveCount(0)

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

  // Your move is confirmed first (no separate "Move sent."), then the three bots' replies,
  // and "Your move." comes last: the cause is always read before the effect.
  await expect(movesRegion(page).locator('p').first()).toHaveText('You: pawn i2 to i4.')
  await expect(cursorRegion(page)).not.toHaveText(/Move sent/)
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  // Read at once when the turn arrives (no batching delay after the banner changes).
  await expect
    .poll(async () => (await movesRegion(page).locator('p').allTextContents()).join(' '), {
      timeout: 1_000,
    })
    .toMatch(/West: .+ North: .+ East: .+ Your move\.( Check: .+)?$/)
  const lines = await movesRegion(page).locator('p').allTextContents()
  // Batched: one line for your move, at most one per bot, never a line per event.
  expect(lines.length).toBeLessThanOrEqual(4)
  for (const l of lines) expect(l).not.toMatch(/thinking/)
  expect(lines.filter((l) => l.includes('Your move.'))).toHaveLength(1)
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

test('landing demo board: decorative, so no zoom button and no live regions', async ({
  browser,
}) => {
  const { context, page } = await phonePage(browser)
  try {
    await page.goto('/')
    await passAgeScreen(page)
    const demo = page.getByTestId('demo-board')
    await expect(demo).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
    await expect(demo.locator('canvas')).toHaveCount(1)
    await expect(demo.locator('[data-board-zoom]')).toHaveCount(0)
    await expect(demo.locator('[data-board-announcer]')).toHaveCount(0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/landing-390.png` })
  } finally {
    await context.close()
  }
})

test('solo resign: the board says the elimination (not a draw), and the result dialog repeats it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await startSolo(page)
  await page.getByTestId('resign').click()
  await page.getByTestId('resign-confirm').click()
  const dialog = page.getByTestId('game-over')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('You were eliminated')
  const last = movesRegion(page).locator('p').last()
  await expect(last).toHaveText(
    /^You are defeated: resigned\. Game over\. You were eliminated, so the game ends here\. .+ share first place\.$/,
  )
  await expect(last).not.toHaveText(/agreement/)
  // The modal dialog's description repeats the final moves (live regions outside a modal
  // dialog can be silenced), without the result its heading already says.
  await expect(dialog).toHaveAttribute('aria-describedby', 'game-over-moves')
  await expect(page.getByTestId('game-over-moves')).toHaveText(
    'Last moves: You are defeated: resigned.',
  )
})
