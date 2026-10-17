import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { chooseCiv, passAgeScreen, signUpAndVerify, YOUR_TURN } from './helpers.ts'

/**
 * Accessibility audit: axe-core (WCAG 2.0 A and AA rules) on every main page, as a guest and
 * as a registered user. Fails on violations with impact "serious" or "critical".
 */

const BLOCKING = new Set(['serious', 'critical'])

async function audit(page: Page, name: string, extraRules: readonly string[] = []) {
  // Let entrance transitions (fades, slides) finish so contrast is measured on final colors.
  await page.waitForTimeout(600)
  // The page background is a CSS gradient (checkerboard plus a warm glow at the top), which
  // axe can't measure: it reports every text node on it as "incomplete" instead of checking
  // it. Swap in a solid stand-in so contrast is actually tested: the lightest visible point of
  // that background (ink + the glow's ~8.6% gold at the top edge + the 2.5% checker square),
  // so passing here means passing everywhere on it.
  await page.addStyleTag({ content: 'body { background: #322b1e !important; }' })
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', ...(extraRules.length > 0 ? ['best-practice'] : [])])
    // The live PixiJS board has its own aria-label and keyboard controls; axe can't read a
    // canvas's pixels anyway.
    .exclude('[data-testid="board"] canvas')
    // Cloudflare's Turnstile widget is a third-party frame we don't control.
    .exclude('[data-testid="turnstile"] iframe')
    .analyze()
  const blocking = results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    // Best-practice rules count only when asked for by name.
    .filter(
      (v) => v.tags.includes('wcag2a') || v.tags.includes('wcag2aa') || extraRules.includes(v.id),
    )
  const report = blocking.map(
    (v) =>
      `[${v.impact}] ${v.id} (${v.nodes.length}): ${v.help}\n` +
      v.nodes.map((n) => `    ${n.target.join(' ')}\n      ${n.failureSummary}`).join('\n'),
  )
  expect.soft(report, `axe violations on ${name}:\n${report.join('\n')}`).toEqual([])
}

test('a11y: signed-out pages and a guest session', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await passAgeScreen(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await audit(page, 'landing (signed out)')

  await page.goto('/sign-in')
  await expect(page.getByLabel('Email or username')).toBeVisible()
  await audit(page, 'sign-in')

  await page.goto('/sign-up')
  await expect(page.getByLabel('Username')).toBeVisible()
  await audit(page, 'sign-up')

  await page.goto('/terms')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await audit(page, 'terms')

  await page.goto('/')
  await page.getByRole('link', { name: 'Play as Guest' }).click()
  await expect(page.getByTestId('guest-continue')).toBeVisible()
  await audit(page, 'guest start')
  await page.getByTestId('clickwrap-checkbox').check()
  await page.getByTestId('guest-continue').click()
  await expect(page.getByTestId('signed-in')).toBeVisible()
  await audit(page, 'landing (guest)')
  await page.goto('/friends')
  await expect(page.getByTestId('friends-guest')).toBeVisible()
  await audit(page, 'friends (guest)')
  await page.goto('/')

  // Lobby browser, then a lobby room.
  await page.getByTestId('play').click()
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
  await audit(page, 'play (lobby browser)')
  // The civ dropdown, open (its popover must be a named dialog, or none at all).
  await page.getByTestId('civ-select').click()
  await expect(page.getByTestId('civ-select-list')).toBeVisible()
  await audit(page, 'play (civ dropdown open)', ['aria-dialog-name'])
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('civ-select-list')).toBeHidden()
  await page.getByTestId('create-lobby').click()
  await expect(page.getByTestId('seat-south')).toBeVisible()
  await audit(page, 'lobby room')
  await page.getByTestId('civ-select').click()
  await expect(page.getByTestId('civ-select-list')).toBeVisible()
  await audit(page, 'lobby room (civ dropdown open)', ['aria-dialog-name'])
  await page.keyboard.press('Escape')
  // One lobby or game at a time: leave before starting a singleplayer game.
  await page.getByTestId('leave-lobby').click()
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()

  // Singleplayer game screen, once the game has started.
  await page.goto('/')
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'mali', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page).toHaveURL(/\/match\//)
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await audit(page, 'singleplayer game')

  // Resigning ends a solo FFA game at once: the "You were eliminated" result dialog.
  await page.getByTestId('resign').click()
  await page.getByTestId('resign-confirm').click()
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 10_000 })
  await audit(page, 'solo result (eliminated)')
})

test('a11y: registered user pages', async ({ page }) => {
  test.setTimeout(120_000)
  await signUpAndVerify(page)
  await audit(page, 'landing (signed in)')

  await page.goto('/history')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await audit(page, 'history')

  await page.goto('/leaderboard')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await audit(page, 'leaderboard')

  await page.goto('/friends')
  await expect(page.getByTestId('friends-empty')).toBeVisible()
  await audit(page, 'friends')

  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await audit(page, 'account')
})
