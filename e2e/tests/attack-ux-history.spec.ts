/** UX review: history row of an aborted ranked game (screenshots only; needs UX_SHOTS). */
import { expect, test } from '@playwright/test'
import { passAgeScreen, signInWithPassword } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''

test('ux history: aborted ranked game', async ({ page }) => {
  test.skip(!OUT || !process.env.UX_USER, 'UX_SHOTS / UX_USER not set')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await passAgeScreen(page)
  await signInWithPassword(page, process.env.UX_USER as string, 'e2e password 12345')
  await expect(page.getByTestId('display-name')).toBeVisible()
  await page.goto('/history')
  await expect(page.getByTestId('match-history')).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/1280-h1-history-aborted-ranked.png`, fullPage: true })
})
