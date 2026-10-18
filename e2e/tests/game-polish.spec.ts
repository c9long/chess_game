import { AxeBuilder } from '@axe-core/playwright'
import { type Browser, expect, type Page, test } from '@playwright/test'
import { chooseCiv, playMove, startAsGuest, YOUR_TURN } from './helpers.ts'

/**
 * Game screen polish: screen-reader announcement verbosity, clock times in the move log
 * (live and in the replay), "Watch replay" on the result screen, the replay's choice of
 * perspective, the shareable watch link, and held seats in a rematch lobby.
 */

const SHOTS = process.env.E2E_SCREENSHOTS

async function audit(page: Page, name: string) {
  await page.waitForTimeout(600)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('[data-testid="board"] canvas')
    .exclude('[data-testid="replay-board"] canvas')
    .analyze()
  const report = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}\n      ${n.failureSummary}`).join('\n'),
    )
  expect.soft(report, `axe violations on ${name}:\n${report.join('\n')}`).toEqual([])
}

const roomIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1) as string

const waitBoard = (page: Page) =>
  page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )

/** Lines read so far by the board's moves live region. */
const announced = (page: Page) =>
  page
    .locator('[data-board-announcer="moves"] p')
    .allTextContents()
    .then((t) => t.join(' '))

/**
 * Two guests in a timed Teams lobby (South and North, teammates) with bots West and East;
 * the game started. South's page is 1280 wide, North's a 390 px phone.
 */
async function teamsGame(browser: Browser, name: string) {
  const sCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const nCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const S = await sCtx.newPage()
  const N = await nCtx.newPage()
  await startAsGuest(S)
  await startAsGuest(N)
  await S.goto('/play')
  const form = S.locator('form').filter({ has: S.getByTestId('lobby-name') })
  await S.getByTestId('lobby-name').fill(name)
  await form.getByRole('button', { name: 'Teams 2v2' }).click()
  await S.getByTestId('create-lobby').click()
  await expect(S.getByRole('heading', { name })).toBeVisible()
  for (const seat of ['west', 'east'] as const) {
    const card = S.getByTestId(`seat-${seat}`)
    await card.getByTestId('add-bot').click()
    await expect(card.getByTestId('seat-name')).toHaveText(/^Bot · /)
  }
  await N.goto(S.url())
  await expect(N.getByRole('heading', { name })).toBeVisible()
  await chooseCiv(S, 'mali')
  await S.getByTestId('ready').click()
  await chooseCiv(N, 'japan')
  await N.getByTestId('ready').click()
  await expect(S.getByTestId('start-game')).toBeEnabled()
  await S.getByTestId('start-game').click()
  await expect(S.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await waitBoard(S)
  await expect(N.getByTestId('turn-banner')).toBeVisible({ timeout: 20_000 })
  await waitBoard(N)
  return { sCtx, nCtx, S, N }
}

/** South resigns the team and North agrees: the game is over for both. */
async function resignTeam(S: Page, N: Page) {
  await S.getByTestId('resign').click()
  await S.getByTestId('resign-confirm').click()
  await N.getByTestId('team-resign-accept').click()
  await expect(S.getByTestId('game-over')).toBeVisible({ timeout: 15_000 })
  await expect(N.getByTestId('game-over')).toBeVisible({ timeout: 15_000 })
}

test('board settings: announce only my moves, checks and results, or every move', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'france', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await waitBoard(page)

  await page.getByRole('button', { name: 'Board settings' }).click()
  const setting = page.getByTestId('announce-moves')
  await expect(setting).toHaveValue('all')
  await expect(page.getByLabel('Read out moves')).toBeVisible()
  await setting.selectOption('own')
  await page.getByTestId('board-settings').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/announce-setting-desktop.png` })

  // Only mine: my move and "Your move." are read, the bots' moves are not.
  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await expect.poll(() => announced(page), { timeout: 10_000 }).toContain('Your move.')
  const quiet = await announced(page)
  expect(quiet).toContain('You: pawn e2 to e4.')
  expect(quiet).not.toMatch(/\b(West|North|East): /)

  // Remembered across a reload (board preferences), then back to every move.
  await page.reload()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await waitBoard(page)
  await page.getByRole('button', { name: 'Board settings' }).click()
  await expect(page.getByTestId('announce-moves')).toHaveValue('own')
  await page.getByTestId('announce-moves').selectOption('all')
  await playMove(page, 'k1', 'j3')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await expect.poll(() => announced(page), { timeout: 10_000 }).toMatch(/\b(West|North|East): /)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('board-settings').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/announce-setting-phone.png` })
  await audit(page, 'board settings with the announcement setting')
})

test('timed game: clock times in the move log, the watch link, Watch replay and its perspective', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const { sCtx, nCtx, S, N } = await teamsGame(browser, 'Clocked teams')
  await sCtx.grantPermissions(['clipboard-read', 'clipboard-write'])
  const matchRoom = roomIdOf(S)

  // Each move in the log shows the mover's time left, small, under the notation.
  await playMove(S, 'e2', 'e4')
  await expect(N.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await playMove(N, 'h15', 'h13')
  await expect(S.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  const log = S.getByTestId('move-log')
  const clocks = log.getByTestId('move-log-clock')
  await expect(clocks).toHaveCount(4)
  for (const t of await clocks.allTextContents()) expect(t).toMatch(/^(9|10):\d\d$/)
  await expect(log.getByTestId('move-log-item').first()).toContainText(/South: e2e4, \d+:\d\d left/)
  await S.waitForTimeout(500)
  if (SHOTS) await S.screenshot({ path: `${SHOTS}/move-log-clocks-desktop.png` })
  const toggle = N.getByTestId('move-log-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(N.getByTestId('move-log-clock').first()).toBeVisible()
  await N.waitForTimeout(400)
  if (SHOTS) await N.screenshot({ path: `${SHOTS}/move-log-clocks-phone.png`, fullPage: true })

  // The watch link: copied, with who may watch; it opens the watch page of this game.
  await S.getByTestId('watch-link').click()
  await expect(S.getByTestId('toast').last()).toContainText(
    'Watch link copied. Anyone signed in can watch.',
  )
  const copied = await S.evaluate(() => navigator.clipboard.readText())
  expect(new URL(copied).pathname).toBe(`/watch/${matchRoom}`)
  if (SHOTS) await S.screenshot({ path: `${SHOTS}/watch-link-desktop.png` })
  await expect(N.getByTestId('watch-link')).toBeVisible()
  if (SHOTS) await N.screenshot({ path: `${SHOTS}/watch-link-phone.png` })
  const vCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const V = await vCtx.newPage()
  await startAsGuest(V)
  await V.goto(copied)
  await expect(V.getByTestId('spectator-banner')).toBeVisible({ timeout: 20_000 })
  // Spectators may share it too (the same match room link).
  await expect(V.getByTestId('watch-link')).toBeVisible()
  await vCtx.close()

  // The result screen offers the replay once the game is saved.
  await resignTeam(S, N)
  await expect(S.getByTestId('watch-replay')).toBeVisible({ timeout: 15_000 })
  await audit(S, 'result screen with Watch replay')
  await S.getByTestId('watch-replay').click()
  await expect(S).toHaveURL(/\/history\/[0-9a-f-]{36}$/)
  const replay = S.getByTestId('replay')
  await expect(replay).toBeVisible({ timeout: 20_000 })
  await expect(replay).toHaveAttribute('data-verified', 'true')
  // Clock times in the replay's log and on the players, as of the step shown.
  await expect(S.getByTestId('move-log').getByTestId('move-log-clock')).toHaveCount(4)
  await expect(S.getByTestId('replay-clock-south')).toHaveText(/(9|10):\d\d/)
  await S.getByTestId('replay-first').click()
  await expect(S.getByTestId('replay-clock-south')).toHaveText(/10:00/)
  await S.getByTestId('replay-last').click()
  // Perspective: the viewer's own seat first, then any seat.
  const perspective = () =>
    S.evaluate(() =>
      (
        window as unknown as { __replayBoard: { perspective(): string } }
      ).__replayBoard.perspective(),
    )
  await expect(S.getByTestId('replay-view-south')).toHaveAttribute('aria-pressed', 'true')
  expect(await perspective()).toBe('south')
  await S.getByTestId('replay-view-north').click()
  await expect(S.getByTestId('replay-view-north')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(perspective).toBe('north')
  await S.keyboard.press('r')
  await expect.poll(perspective).toBe('east')
  await S.waitForTimeout(1200)
  if (SHOTS) await S.screenshot({ path: `${SHOTS}/replay-perspective-desktop.png` })
  await S.setViewportSize({ width: 390, height: 844 })
  await S.waitForTimeout(800)
  if (SHOTS) await S.screenshot({ path: `${SHOTS}/replay-perspective-phone.png`, fullPage: true })
  await audit(S, 'replay with clocks and perspective')
  await sCtx.close()
  await nCtx.close()
})

test('rematch lobby: a held seat shows whom it is saved for until they arrive', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const { sCtx, nCtx, S, N } = await teamsGame(browser, 'Saved seats')
  await resignTeam(S, N)
  // South's way into the new lobby is held up a few seconds, so North sees the held seat.
  let release: () => void = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await S.route('**/matchmake/joinById/**', async (route) => {
    await held
    await route.continue()
  })
  await N.getByTestId('rematch-propose').click()
  await S.getByTestId('rematch-panel').getByTestId('rematch-accept').click()
  await expect(N.getByTestId('ready')).toBeVisible({ timeout: 15_000 })
  const seat = N.getByTestId('seat-south')
  await expect(seat.getByTestId('seat-held')).toBeVisible()
  await expect(seat.getByTestId('seat-held')).toContainText(/Saved for Guest-\d{4}/)
  await expect(seat.getByTestId('seat-held')).toContainText(/\d+ s more/)
  // The host (North) gets no bot controls on it.
  await expect(seat.getByTestId('add-bot')).toHaveCount(0)
  await N.waitForTimeout(400)
  if (SHOTS) await N.screenshot({ path: `${SHOTS}/rematch-held-phone.png`, fullPage: true })
  await N.setViewportSize({ width: 1280, height: 800 })
  await N.waitForTimeout(400)
  if (SHOTS) await N.screenshot({ path: `${SHOTS}/rematch-held-desktop.png`, fullPage: true })
  await audit(N, 'rematch lobby with a held seat')

  // South arrives: the seat is theirs, no longer "saved".
  release()
  await expect(S.getByTestId('ready')).toBeVisible({ timeout: 15_000 })
  await expect(seat.getByTestId('seat-held')).toHaveCount(0)
  await expect(seat.getByTestId('seat-name')).toHaveText(/^Guest-\d{4}$/)
  await sCtx.close()
  await nCtx.close()
})
