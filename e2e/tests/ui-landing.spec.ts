import { expect, type Page, test } from '@playwright/test'
import { passAgeScreen, startAsGuest } from './helpers.ts'

/** Console errors and uncaught exceptions on a page. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const board = (page: Page) => page.getByTestId('demo-board')
const ply = async (page: Page) => Number((await board(page).getAttribute('data-ply')) ?? '-1')

test('landing: demo board loads after first paint, emblems, CTAs, no console errors', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await passAgeScreen(page)
  // A fresh load of the landing page (the age screen is done).
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The copy matches the 16×16 board everywhere (hero, demo label, how a game goes).
  await expect(
    page.getByText('Four players. Sixteen by sixteen. One civ left standing.'),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: /on the 16 by 16 board/ })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'How a game goes', level: 2 })).toBeVisible()
  await expect(page.getByText(/sets up on one side of a 16×16 board/)).toBeVisible()
  await expect(
    page.getByRole('img', { name: /Turn order: South, West, North, East/ }),
  ).toBeAttached()
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/twelve|12\s*(×|x|by)\s*12|144 squares/i)

  // The board renderer arrives after first paint, then draws into a canvas.
  await expect(board(page)).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  await expect(board(page).locator('canvas')).toHaveCount(1)
  // Its code is requested only after the page's first frame. (Chrome's first-contentful-paint
  // time is no use here: on a loaded machine it is reported seconds late, after the idle
  // fallback has already started the download.)
  const timing = await page.evaluate(() => {
    const firstFrame = performance.getEntriesByName('landing:first-frame')[0]?.startTime
    const chunk = performance
      .getEntriesByType('resource')
      .find((r) => r.name.includes('DemoBoard'))?.startTime
    return { firstFrame, chunk }
  })
  expect(timing.firstFrame).toBeDefined()
  expect(timing.chunk).toBeDefined()
  expect(timing.chunk as number).toBeGreaterThan(timing.firstFrame as number)

  // Decorative and watch-only: the canvas is out of the tab order and the a11y tree.
  await expect(board(page).locator('canvas')).toHaveAttribute('tabindex', '-1')
  await expect(board(page).locator('canvas')).toHaveAttribute('aria-hidden', 'true')

  // It plays: the engine's moves advance the position.
  const start = await ply(page)
  await expect.poll(() => ply(page), { timeout: 15_000 }).toBeGreaterThan(start + 1)

  // Hidden tab: the demo pauses.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(1200)
  const paused = await ply(page)
  await page.waitForTimeout(2500)
  expect(await ply(page)).toBe(paused)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => ply(page), { timeout: 10_000 }).toBeGreaterThan(paused)

  // Off screen, the renderer stops too (not just the move timer), and comes back on return.
  // (Extra room at the bottom so the board can scroll fully out of a 720px-high window.)
  await expect(board(page)).toHaveAttribute('data-rendering', 'true')
  await page.evaluate(() => {
    document.body.style.paddingBottom = '200vh'
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  await expect(board(page)).toHaveAttribute('data-rendering', 'false')
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    document.body.style.paddingBottom = ''
  })
  await expect(board(page)).toHaveAttribute('data-rendering', 'true')

  // The nine civ medallions, with their emblem art.
  const medals = page.getByTestId('civ-medallions')
  await medals.scrollIntoViewIfNeeded()
  await expect(medals.getByRole('listitem')).toHaveCount(9)
  // Each medallion's emblem is one labelled image (the inlined SVG sits inside it).
  await expect(medals.locator('[role="img"]')).toHaveCount(9)
  await expect(medals.getByRole('img', { name: 'Mali' }).first()).toBeVisible()

  // Exactly one of each call to action, and each one leads where it says.
  for (const [name, heading] of [
    ['Sign in', 'Sign in'],
    ['Create account', 'Create account'],
    ['Play as Guest', 'Play as Guest'],
  ] as const) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1)
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    await page.goBack()
    await expect(board(page)).toBeVisible()
  }

  expect(errors).toEqual([])
})

test('landing: reduced motion shows a still position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await passAgeScreen(page)
  await expect(board(page)).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  const still = await ply(page)
  expect(still).toBeGreaterThan(0)
  // Once drawn, the renderer stops; the last frame stays on screen at full size.
  await expect(board(page)).toHaveAttribute('data-rendering', 'false', { timeout: 5_000 })
  const canvas = await board(page).locator('canvas').boundingBox()
  expect(canvas?.width ?? 0).toBeGreaterThan(200)
  await page.waitForTimeout(3000)
  expect(await ply(page)).toBe(still)
})

test('landing (signed in): play tiles, links, and a phone layout without overflow', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await startAsGuest(page)
  await expect(page.getByTestId('play-vs-bots')).toBeVisible()
  await expect(page.getByTestId('play')).toBeVisible()
  await expect(page.getByTestId('play')).toContainText('Play online')
  await expect(
    page.getByRole('link', { name: 'Create account and keep your history' }),
  ).toHaveCount(1)
  await expect(board(page)).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })

  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  expect(errors).toEqual([])

  await page.getByTestId('play-vs-bots').click()
  await expect(page).toHaveURL(/\/play$/)
})

test('pages have their own browser-tab titles and the app has an icon', async ({ page }) => {
  await page.goto('/terms')
  await expect(page).toHaveTitle(/^Terms of Service · /)
  await page.goto('/privacy')
  await expect(page).toHaveTitle(/^Privacy Policy · /)
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  const icon = await page.request.get('/favicon.svg')
  expect(icon.ok()).toBe(true)
})

test('unknown pages show a friendly not-found screen', async ({ page }) => {
  await page.goto('/terms')
  await page.goto('/this-page-does-not-exist')
  await expect(page.getByTestId('not-found')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page).toHaveTitle(/^Page not found · /)
  await page.getByRole('link', { name: 'Back to the start' }).click()
  await expect(page).toHaveURL(/\/$/)
})
