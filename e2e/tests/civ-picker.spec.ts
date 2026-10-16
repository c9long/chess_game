import { expect, test } from '@playwright/test'
import { startAsGuest } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

// 9 tiles, 3 per row: canada usa china / japan germany russia / england france mali
test('the civ picker works from the keyboard (roving tabindex)', async ({ page }) => {
  await startAsGuest(page)
  await page.goto('/play')
  const group = page.getByRole('radiogroup', { name: 'Your civilization' })
  await expect(group).toBeVisible()
  const tile = (slug: string) => group.getByTestId(`civ-${slug}`)

  // Nothing chosen yet: only the first tile is in the tab order.
  await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
  await expect(tile('canada')).toHaveAttribute('tabindex', '0')
  await tile('canada').focus()

  // Arrows move focus without choosing; Space chooses.
  await page.keyboard.press('ArrowRight')
  await expect(tile('usa')).toBeFocused()
  await expect(tile('usa')).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Space')
  await expect(tile('usa')).toHaveAttribute('aria-checked', 'true')
  await expect(group.locator('[aria-checked="true"]')).toHaveCount(1)

  await page.keyboard.press('ArrowDown')
  await expect(tile('germany')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tile('japan')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tile('china')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(tile('mali')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tile('canada')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tile('mali')).toBeFocused()
  await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/civ-picker-focus.png` })
  await page.keyboard.press('Enter')
  await expect(tile('mali')).toHaveAttribute('aria-checked', 'true')
  await expect(tile('usa')).toHaveAttribute('aria-checked', 'false')

  // Tab leaves the group, Shift+Tab comes back to the chosen tile.
  await page.keyboard.press('Tab')
  await expect(tile('mali')).not.toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(tile('mali')).toBeFocused()
})

test('lobby cards show the civs already chosen at each table', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  await startAsGuest(host)
  await host.goto('/play')
  await host.getByTestId('lobby-name').fill('Emblem table')
  await host.getByTestId('create-lobby').click()
  await expect(host.getByRole('heading', { name: 'Emblem table' })).toBeVisible()

  const viewerCtx = await browser.newContext()
  const viewer = await viewerCtx.newPage()
  await startAsGuest(viewer)
  await viewer.goto('/play')
  const row = viewer.getByTestId('lobby-list').locator('li', { hasText: 'Emblem table' })
  await expect(row).toBeVisible()
  await expect(row.getByTestId('seated-civs')).toHaveCount(0)

  // The host (South) picks a civ: the card updates live.
  await host.getByTestId('civ-mali').click()
  const civs = row.getByTestId('seated-civs')
  await expect(civs).toHaveAttribute('aria-label', 'Civilizations: Mali (South)')
  await expect(civs.locator('[data-civ]')).toHaveCount(1)
  await host.getByTestId('civ-japan').click()
  await expect(civs).toHaveAttribute('aria-label', 'Civilizations: Japan (South)')
  if (SHOTS) await row.screenshot({ path: `${SHOTS}/lobby-card-civs.png` })
  await hostCtx.close()
  await viewerCtx.close()
})
