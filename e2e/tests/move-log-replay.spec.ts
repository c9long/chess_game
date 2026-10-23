import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import {
  chooseCiv,
  playMove,
  position,
  solidBackdropForAxe,
  startAsGuest,
  YOUR_TURN,
} from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

test.use({ viewport: { width: 1280, height: 800 } })

/** axe-core WCAG A/AA scan (as in ui-a11y.spec.ts): no serious or critical violations. */
async function audit(page: Page, name: string) {
  await page.waitForTimeout(600)
  await solidBackdropForAxe(page)
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

const replayPosition = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __replayBoard: { position(): string } }).__replayBoard.position(),
  )

test('the move log fills during a solo game, and the game replays from History', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'france', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )

  // Desktop: the log is a section of the side panel, empty until the first move.
  const log = page.getByTestId('move-log')
  await expect(log).toBeVisible()
  await expect(log).toContainText('No moves yet.')
  await expect(page.getByTestId('move-log-toggle')).toBeHidden()

  // Each round adds four moves in seat order, in the engine's notation; the newest is current.
  const items = log.getByTestId('move-log-item')
  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await expect(items).toHaveCount(4)
  await expect(items.first()).toContainText('South: e2e4')
  await expect(items.last()).toHaveAttribute('aria-current', 'true')
  await expect(log.getByRole('list', { name: 'Round 1' })).toBeVisible()
  await playMove(page, 'k1', 'j3')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  // Bots can knock each other out (their seats then have no turn), so count South's moves.
  const south = items.filter({ hasText: 'South:' })
  await expect(south).toHaveCount(2)
  await expect(south.nth(1)).toContainText('South: k1j3')
  const afterTwo = await items.count()
  expect(afterTwo).toBeGreaterThan(4)
  await expect(log.locator('[aria-current="true"]')).toHaveCount(1)
  await expect(items.last()).toHaveAttribute('aria-current', 'true')
  // The log is a plain list, not a live region (the board announces the moves).
  await expect(log.locator('[aria-live]')).toHaveCount(0)

  // A reload rebuilds the log from the server (`moveLog`). (Two rounds only: the bots'
  // quick local moves are random, and a third round sometimes ends the game.)
  await page.reload()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await expect(items).toHaveCount(afterTwo)
  await expect(items.first()).toContainText('South: e2e4')
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
  const moves = afterTwo
  await page.waitForTimeout(600)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/move-log-desktop.png` })

  // Phones: a bar under the actions with the newest move; it opens the log below.
  await page.setViewportSize({ width: 390, height: 844 })
  const toggle = page.getByTestId('move-log-toggle')
  await expect(toggle).toBeVisible()
  await expect(toggle).toContainText(/Moves\s*2\. /)
  const boardBox = await page.getByTestId('board').boundingBox()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(log).toBeVisible()
  // Opening it moves nothing above it.
  expect(await page.getByTestId('board').boundingBox()).toEqual(boardBox)
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/move-log-phone.png`, fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  await audit(page, 'game screen with the move log')

  // Resigning ends the solo FFA game: the log ends with the result.
  await page.getByTestId('resign').click()
  await page.getByTestId('resign-confirm').click()
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('move-log-result')).toContainText('Game over')
  const final = await position(page)
  const liveItems = await items.count()

  // History → Replay: the stored game re-simulated in the browser reaches the same position.
  await expect(async () => {
    await page.goto('/history')
    await expect(page.getByTestId('history-replay').first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 10_000 })
  await expect(page.getByTestId('history-replay').first()).toHaveText('Replay')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/history-replay-link.png` })
  await page.getByTestId('history-replay').first().click()
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/)
  const replay = page.getByTestId('replay')
  await expect(replay).toBeVisible({ timeout: 20_000 })
  await expect(replay).toHaveAttribute('data-verified', 'true')
  await expect(page.getByTestId('replay-verified')).toBeVisible()
  await expect(page.getByTestId('replay-mismatch')).toHaveCount(0)
  await page.waitForFunction(() => '__replayBoard' in window)
  // It opens on the final position: the same one the live game ended on.
  const total = await page
    .getByTestId('replay-position')
    .textContent()
    .then((t) => Number(t?.split('/')[1]))
  // The moves and the resignation, with the draw that ends a solo game folded in (as live).
  expect(total).toBe(moves + 1)
  await expect(page.getByTestId('replay-position')).toHaveText(`${total} / ${total}`)
  expect(await replayPosition(page)).toBe(final)
  const replayLog = page.getByTestId('move-log')
  await expect(replayLog.getByTestId('move-log-item')).toHaveCount(moves + 1)
  // The same steps as the live log showed.
  expect(liveItems).toBe(moves + 1)
  await expect(page.getByTestId('move-log-result')).toContainText('Game over')
  await page.waitForTimeout(800)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/replay-desktop.png` })

  // Controls: first, next, keyboard, click-to-jump, last.
  // Jumps are said once by a polite status (single steps forward by the board).
  const announcer = page.getByTestId('replay-announcer')
  await page.getByTestId('replay-first').click()
  await expect(page.getByTestId('replay-position')).toHaveText('Start')
  await expect(announcer).toHaveText('Start position')
  const start = await replayPosition(page)
  expect(start).not.toBe(final)
  await page.getByTestId('replay-next').click()
  await expect(page.getByTestId('replay-position')).toHaveText(`1 / ${total}`)
  await expect(announcer).toHaveText('')
  await expect(replayLog.getByTestId('move-log-item').first()).toHaveAttribute(
    'aria-current',
    'step',
  )
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('replay-position')).toHaveText(`2 / ${total}`)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('replay-position')).toHaveText(`1 / ${total}`)
  await replayLog.getByTestId('move-log-item').nth(5).click()
  await expect(page.getByTestId('replay-position')).toHaveText(`6 / ${total}`)
  await expect(replayLog.getByTestId('move-log-item').nth(5)).toHaveAttribute(
    'aria-current',
    'step',
  )
  await expect(announcer).toContainText(`Move 6 of ${total}: `)
  // The list is one Tab stop (the move shown); focus follows the arrow keys.
  await expect(replayLog.locator('button[tabindex="0"]')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(replayLog.getByTestId('move-log-item').nth(6)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(replayLog.getByTestId('move-log-item').nth(5)).toBeFocused()
  // Play advances by itself; pause stops it.
  await page.getByTestId('replay-speed').selectOption('4')
  await page.getByTestId('replay-play').click()
  await expect(page.getByTestId('replay-position')).toHaveText(`8 / ${total}`, { timeout: 5_000 })
  await page.getByTestId('replay-play').click()
  await page.keyboard.press('End')
  await expect(page.getByTestId('replay-position')).toHaveText(`${total} / ${total}`)
  await expect.poll(() => replayPosition(page)).toBe(final)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('replay-first').click()
  await page.getByTestId('replay-next').click()
  await page.getByTestId('replay-next').click()
  await page.waitForTimeout(800)
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/replay-phone.png` })
    await page.screenshot({ path: `${SHOTS}/replay-phone-full.png`, fullPage: true })
  }
  await audit(page, 'replay')
})

test('a game from the old 12×12 board says it can’t be replayed', async ({ page }) => {
  await startAsGuest(page)
  const me = await (await page.request.get('/api/auth/get-session')).json()
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    const [match] = await sql`
      insert into matches (mode, time_control, rules_version, status, end_reason)
      values ('ffa', '10+0', 1, 'finished', 'last_standing') returning id`
    await sql`
      insert into match_players (match_id, seat, user_id, civ_id, civ_version, placement)
      select ${match?.id}, 0, ${me.user.id}, id, 1, 2 from civilizations where slug = 'japan'`
    for (const seat of [1, 2, 3]) {
      await sql`
        insert into match_players (match_id, seat, bot_level, civ_id, civ_version, placement)
        select ${match?.id}, ${seat}, '600', id, 1, ${seat === 1 ? 1 : seat + 1}
        from civilizations where slug = 'mali'`
    }
  } finally {
    await sql.end()
  }
  await page.goto('/history')
  const link = page.getByTestId('history-replay').first()
  await expect(link).toHaveText('Details')
  await link.click()
  await expect(page.getByTestId('replay-unavailable')).toHaveText(
    'This game was played on the old 12×12 board and can’t be replayed.',
  )
  await expect(page.getByTestId('replay-player-south')).toContainText('(you)')
  await expect(page.getByTestId('replay-board')).toHaveCount(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/replay-v1.png` })
  await audit(page, 'game details (12×12)')
})

test('the live move log stays clear of the pinned actions and follows them in Tab order', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'france', panel)
  // Teams: one more line in the side panel (the teams), the tightest wide layout.
  await panel.getByRole('button', { name: 'Teams 2v2' }).click()
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
  await playMove(page, 'e2', 'e4')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await playMove(page, 'k1', 'j3')
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  const log = page.getByTestId('move-log')
  const newest = log.locator('[aria-current="true"]')
  await expect(newest).toHaveCount(1)
  await page.waitForTimeout(400)
  const actions = page.getByRole('region', { name: 'Actions' })
  const cell = await newest.boundingBox()
  const bar = await actions.boundingBox()
  expect(cell && bar && cell.y + cell.height <= bar.y + 0.5, 'newest move above the actions').toBe(
    true,
  )
  // The side panel itself doesn't scroll (the log shrinks instead).
  const overflow = await page
    .getByRole('complementary', { name: 'Game' })
    .evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(overflow).toBeLessThanOrEqual(1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/move-log-teams-desktop.png` })

  // Phones: the Moves bar comes after the actions in Tab order, as on screen.
  await page.setViewportSize({ width: 390, height: 844 })
  const gear = page.getByRole('button', { name: 'Board settings' })
  await gear.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('move-log-toggle')).toBeFocused()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/move-log-teams-phone.png`, fullPage: true })
})
