/**
 * Mobile and install preparation (docs/MOBILE.md phase 1): the web manifest and icons, phone
 * safe areas, the keep-awake lock, the "leaving forfeits" hint, and rejoining a game after the
 * app was suspended or killed in the background.
 */
import { APP_NAME } from '@game/config'
import { type Browser, expect, type Page, test } from '@playwright/test'
import { chooseCiv, startAsGuest, YOUR_TURN } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

/** An iPhone-sized touch screen (Chromium; the iPhone's own engine isn't needed here). */
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

/** Simulated notch and home indicator: the page reads the insets through CSS variables. */
async function simulateSafeArea(page: Page) {
  await page.addStyleTag({
    content: ':root{--safe-top:47px!important;--safe-bottom:34px!important}',
  })
}

/** Records Screen Wake Lock requests and releases (headless Chromium may refuse real ones). */
async function stubWakeLock(page: Page) {
  await page.addInitScript(() => {
    const log: string[] = []
    ;(window as unknown as { __wake: string[] }).__wake = log
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          log.push(`request:${type}`)
          const listeners: (() => void)[] = []
          const sentinel = {
            released: false,
            release: async () => {
              if (sentinel.released) return
              sentinel.released = true
              log.push('release')
              for (const l of listeners) l()
            },
            addEventListener: (_: string, cb: () => void) => listeners.push(cb),
          }
          return sentinel
        },
      },
    })
  })
}

/** Keeps every WebSocket the page opens, so a test can make one go silent. */
async function trackSockets(page: Page) {
  await page.addInitScript(() => {
    const Native = window.WebSocket
    const sockets: WebSocket[] = []
    ;(window as unknown as { __sockets: WebSocket[] }).__sockets = sockets
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        sockets.push(this)
      }
    } as typeof WebSocket
  })
}

async function startSolo(page: Page) {
  await startAsGuest(page)
  await page.goto('/play')
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'mali', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page).toHaveURL(/\/match\//)
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  return new URL(page.url()).pathname.split('/').pop() as string
}

async function phonePage(browser: Browser) {
  const context = await browser.newContext(PHONE)
  const page = await context.newPage()
  return { context, page }
}

test('the app has a valid web manifest and icons Chrome can install from', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /viewport-fit=cover/,
  )
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1d1b19')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe('/manifest.webmanifest')

  const res = await page.request.get(href as string)
  expect(res.ok()).toBe(true)
  expect(res.headers()['content-type']).toContain('application/manifest+json')
  const manifest = await res.json()
  expect(manifest).toMatchObject({
    name: APP_NAME,
    display: 'standalone',
    orientation: 'any',
    theme_color: '#1d1b19',
    background_color: '#1d1b19',
    start_url: '.',
  })
  expect(manifest.short_name).toBeTruthy()

  // Every icon loads, is a PNG of the size it claims; both purposes are there.
  const purposes = new Set<string>()
  for (const icon of manifest.icons as { src: string; sizes: string; purpose: string }[]) {
    purposes.add(`${icon.purpose}:${icon.sizes}`)
    const url = new URL(icon.src, new URL(href as string, page.url())).href
    const img = await page.request.get(url)
    expect(img.ok(), url).toBe(true)
    expect(img.headers()['content-type']).toBe('image/png')
    const size = await page.evaluate(async (src) => {
      const el = new Image()
      el.src = src
      await el.decode()
      return `${el.naturalWidth}x${el.naturalHeight}`
    }, url)
    expect(size).toBe(icon.sizes)
  }
  expect([...purposes].sort()).toEqual([
    'any:192x192',
    'any:512x512',
    'maskable:192x192',
    'maskable:512x512',
  ])
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  expect((await page.request.get(touchIcon as string)).ok()).toBe(true)

  // Chrome's own parser: no manifest errors, and the icons it picked load.
  const cdp = await page.context().newCDPSession(page)
  const parsed = await cdp.send('Page.getAppManifest')
  expect(parsed.url).toMatch(/\/manifest\.webmanifest$/)
  expect(parsed.errors).toEqual([])
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([])
})

test('phone: keep-awake lock, leave hint, settings and safe areas during a game', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const { context, page } = await phonePage(browser)
  await stubWakeLock(page)
  await startSolo(page)
  const wake = () => page.evaluate(() => (window as unknown as { __wake: string[] }).__wake)
  await expect.poll(wake).toContain('request:screen')

  const hint = page.getByTestId('leave-hint')
  await expect(hint).toHaveText(/Leaving the app for more than 60 s forfeits/)
  await page.getByRole('button', { name: 'Board settings' }).click()
  await expect(page.getByTestId('board-settings').getByLabel('Vibration')).toBeChecked()

  if (SHOTS) {
    await simulateSafeArea(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SHOTS}/phone-game-safe-area.png` })
    await page.screenshot({ path: `${SHOTS}/phone-game-safe-area-full.png`, fullPage: true })
    // The header clears the simulated notch.
    const header = await page.locator('header').first().boundingBox()
    const logo = await page.locator('header a').first().boundingBox()
    expect(logo?.y ?? 0).toBeGreaterThanOrEqual((header?.y ?? 0) + 47)
    await page.getByRole('button', { name: 'Leave game' }).click()
    await expect(page.getByTestId('leave-dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/phone-leave-dialog.png` })
    await page.getByRole('button', { name: 'Keep playing' }).click()
  }

  // Dismissed for good on this device.
  await hint.getByRole('button', { name: /Dismiss/ }).click()
  await expect(hint).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await expect(page.getByTestId('leave-hint')).toHaveCount(0)

  // Leaving the game gives the seat up: the lock goes and the saved tokens are cleared.
  await page.getByRole('button', { name: 'Leave game' }).click()
  await page.getByTestId('leave-confirm').click()
  await expect(page).toHaveURL(/\/play$/)
  await expect.poll(wake).toContain('release')
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('match:reconnect:')),
  )
  expect(saved).toEqual([])
  await context.close()
})

test('desktop: no leave hint without a touch screen', async ({ page }) => {
  test.setTimeout(120_000)
  await startSolo(page)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('leave-hint')).toHaveCount(0)
  if (SHOTS) {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOTS}/desktop-game.png` })
  }
})

test('rejoins the seat after the app was killed in the background (new tab, no sessionStorage)', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const { context, page } = await phonePage(browser)
  const roomId = await startSolo(page)
  const token = await page.evaluate((id) => localStorage.getItem(`match:reconnect:${id}`), roomId)
  expect(JSON.parse(token ?? '{}').token).toContain(roomId)

  // The OS kills the WebView: the page is gone, and with it sessionStorage.
  await page.close()
  const again = await context.newPage()
  await again.goto(`/match/${roomId}`)
  await expect(again.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await expect(again.getByTestId('player-south')).toContainText('(you)')
  await context.close()
})

test('back in the app: a socket that died while away is replaced at once', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await phonePage(browser)
  await trackSockets(page)
  await startSolo(page)

  // The phone suspended the app and the connection died silently: nothing more goes out on
  // it (no close event either). Coming back to the app checks the connection right away.
  await page.evaluate(() => {
    const sockets = (window as unknown as { __sockets: WebSocket[] }).__sockets
    const live = sockets.filter((s) => s.readyState === WebSocket.OPEN)
    for (const s of live) s.send = () => {}
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const banner = page.getByTestId('reconnecting')
  await expect(banner).toBeVisible({ timeout: 6_000 })
  if (SHOTS) {
    await simulateSafeArea(page)
    await page.screenshot({ path: `${SHOTS}/phone-reconnecting.png` })
  }
  await expect(banner).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN)
  await expect(page.getByTestId('player-south')).toContainText('(you)')
  await context.close()
})

test('phone screenshots: landing and play page with a notch', async ({ browser }) => {
  test.skip(!SHOTS, 'screenshots only (E2E_SCREENSHOTS)')
  const { context, page } = await phonePage(browser)
  await startAsGuest(page)
  await simulateSafeArea(page)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/phone-landing-safe-area.png` })
  await page.goto('/play')
  await simulateSafeArea(page)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/phone-play-safe-area.png` })
  await page.screenshot({ path: `${SHOTS}/phone-play-safe-area-full.png`, fullPage: true })
  await context.close()
})

test('desktop screenshots: landing and play page', async ({ page }) => {
  test.skip(!SHOTS, 'screenshots only (E2E_SCREENSHOTS)')
  await page.setViewportSize({ width: 1280, height: 800 })
  await startAsGuest(page)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/desktop-landing.png` })
  await page.goto('/play')
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/desktop-play.png` })
})

test('a second tab taking the seat over keeps its saved token, and the first says so', async ({
  browser,
}) => {
  const { context, page } = await phonePage(browser)
  const roomId = await startSolo(page)
  const key = `match:reconnect:${roomId}`
  const tab2 = await context.newPage()
  await tab2.goto(`/match/${roomId}`)
  await expect(tab2.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Opened somewhere else' })).toBeVisible()
  // The token the playing tab needs after the app is killed is still there, and is its own.
  const saved = await tab2.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key)
  const own = await tab2.evaluate((k) => sessionStorage.getItem(k), key)
  expect(saved?.token).toBeTruthy()
  expect(saved?.token).toBe(own)
  await context.close()
})

test('a phone held sideways shows the board and the game actions without scrolling', async ({
  browser,
}) => {
  const context = await browser.newContext({ ...PHONE, viewport: { width: 844, height: 390 } })
  const page = await context.newPage()
  await startSolo(page)
  for (const name of ['Resign', 'Offer draw']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(box && box.y + box.height).toBeLessThanOrEqual(390)
  }
  const board = await page.locator('canvas').first().boundingBox()
  expect(board && board.y + board.height).toBeLessThanOrEqual(390)
  await context.close()
})
