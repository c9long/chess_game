import { CIVILIZATIONS } from '@game/config'
import { expect, type Page, test } from '@playwright/test'
import { chooseCiv, startAsGuest } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

/** The option the search box currently highlights (aria-activedescendant), by its test id. */
async function activeCiv(page: Page) {
  const id = await page.getByTestId('civ-select-search').getAttribute('aria-activedescendant')
  if (!id) return null
  return page.locator(`[id="${id}"]`).getAttribute('data-testid')
}

// Roster order: canada usa china japan germany russia england france mali
test('the civ dropdown works from the keyboard (ARIA combobox + listbox)', async ({ page }) => {
  await startAsGuest(page)
  await page.goto('/play')
  const trigger = page.getByRole('combobox', { name: 'Your civilization' })
  await expect(trigger).toHaveText('Choose a civilization')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
  const list = page.getByRole('listbox', { name: 'Your civilization' })
  const search = page.getByRole('combobox', { name: 'Search civilizations' })

  // Arrow Down opens the list with the search box focused and the first civ highlighted.
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(list).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(search).toBeFocused()
  await expect(list.getByRole('option')).toHaveCount(CIVILIZATIONS.length)
  expect(await activeCiv(page)).toBe('civ-canada')
  await page.keyboard.press('ArrowDown')
  expect(await activeCiv(page)).toBe('civ-usa')
  await page.keyboard.press('End')
  expect(await activeCiv(page)).toBe('civ-mali')
  await page.keyboard.press('ArrowDown') // stops at the end
  expect(await activeCiv(page)).toBe('civ-mali')
  await page.keyboard.press('Home')
  expect(await activeCiv(page)).toBe('civ-canada')
  await page.keyboard.press('PageDown')
  expect(await activeCiv(page)).toBe('civ-russia')
  if (SHOTS) {
    await page.waitForTimeout(300) // let the open animation finish
    await page.screenshot({ path: `${SHOTS}/civ-select-open.png` })
  }

  // Enter chooses, closes and gives focus back to the trigger, which now names the civ.
  await page.keyboard.press('Enter')
  await expect(list).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('data-value', 'russia')
  await expect(page.getByRole('combobox', { name: 'Your civilization Russia' })).toBeVisible()
  await expect(page.getByTestId('start-solo')).toBeEnabled()

  // Reopening highlights the chosen civ, marked selected with a check.
  await page.keyboard.press('Enter')
  await expect(list).toBeVisible()
  expect(await activeCiv(page)).toBe('civ-russia')
  await expect(list.getByTestId('civ-russia')).toHaveAttribute('aria-selected', 'true')
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(1)

  // Typing filters by name (case- and accent-insensitive); Enter picks the best match.
  await page.keyboard.type('ÉNG')
  await expect(list.getByRole('option')).toHaveCount(1)
  // England fields a special army: its row says so under the name.
  await expect(list.getByRole('option')).toContainText('England')
  await expect(list.getByRole('option')).toContainText('Special army')
  await expect(list.getByRole('option')).toContainText(
    'Four Prime Ministers replace the king, queen and knights',
  )
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('an')
  await expect(list.getByRole('option')).toHaveCount(5)
  await page.keyboard.type('zz')
  await expect(list.getByRole('option')).toHaveCount(0)
  await expect(list).toContainText('No civilization matches “anzz”')
  await search.fill('fr')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('data-value', 'france')
  await expect(trigger).toBeFocused()

  // Escape closes without changing anything.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('data-value', 'france')

  // Typeahead on the closed trigger opens the list already filtered.
  await page.keyboard.press('j')
  await expect(list).toBeVisible()
  await expect(search).toHaveValue('j')
  expect(await activeCiv(page)).toBe('civ-japan')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('data-value', 'japan')

  // Tab closes the list and moves on to the next field (like a native select); Shift+Tab from
  // there comes back to the trigger.
  await page.keyboard.press('ArrowUp')
  await expect(list).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(list).toBeHidden()
  await expect(page.getByTestId('bot-level')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(trigger).toBeFocused()
  // Shift+Tab in the open list closes it and moves to the field before the trigger.
  await page.keyboard.press('ArrowUp')
  await expect(list).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(list).toBeHidden()
  await expect(trigger).not.toBeFocused()
  await page.keyboard.press('Tab')
  await expect(trigger).toBeFocused()

  // Mouse: hover highlights, a click chooses.
  await trigger.click()
  await list.getByTestId('civ-mali').hover()
  expect(await activeCiv(page)).toBe('civ-mali')
  await list.getByTestId('civ-mali').click()
  await expect(trigger).toHaveAttribute('data-value', 'mali')
  await expect(trigger).toHaveText('Mali')
  await expect(trigger).toBeFocused()
  if (SHOTS)
    await page.getByTestId('vs-bots').screenshot({ path: `${SHOTS}/civ-select-chosen.png` })
})

test('the civ dropdown fits a phone screen and scrolls inside itself', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startAsGuest(page)
  await page.goto('/play')
  const trigger = page.getByTestId('civ-select')
  const box = await trigger.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(52)
  await trigger.click()
  const list = page.getByTestId('civ-select-list')
  await expect(list).toBeVisible()
  const pop = await list.boundingBox()
  expect(pop).not.toBeNull()
  if (pop) {
    expect(pop.x).toBeGreaterThanOrEqual(0)
    expect(pop.x + pop.width).toBeLessThanOrEqual(390)
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  // Every row is thick enough to tap.
  const row = await list.getByTestId('civ-canada').boundingBox()
  expect(row?.height).toBeGreaterThanOrEqual(52)
  if (SHOTS) {
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/civ-select-phone.png` })
  }
  // Scrolling to the last row keeps the page where it is.
  const pageY = await page.evaluate(() => window.scrollY)
  await page.keyboard.press('End')
  await expect(list.getByTestId('civ-mali')).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(pageY)
  await list.getByTestId('civ-mali').click()
  await expect(trigger).toHaveAttribute('data-value', 'mali')
})

test('the host picks a bot civ from the seat menu, which stays open', async ({ page }) => {
  await startAsGuest(page)
  await page.goto('/play')
  await page.getByTestId('lobby-name').fill('Bot civ table')
  await page.getByTestId('create-lobby').click()
  await expect(page.getByRole('heading', { name: 'Bot civ table' })).toBeVisible()
  const west = page.getByTestId('seat-west')
  await west.getByTestId('add-bot').click()
  await expect(west.getByTestId('seat-name')).toHaveText(/^Bot/)

  await west
    .getByRole('button', { name: 'Seat options (West)' })
    .or(west.locator('summary'))
    .click()
  const menu = west.locator('details')
  await expect(menu).toHaveAttribute('open', '')
  // Its name says which seat it changes ("West bot Civilization <civ>").
  const trigger = page.getByRole('combobox', { name: /^West bot Civilization/ })
  await expect(trigger).toHaveAttribute('data-testid', 'civ-select-west')
  const current = await trigger.getAttribute('data-value')
  const target = current === 'germany' ? 'china' : 'germany'
  const name = CIVILIZATIONS.find((c) => c.slug === target)?.name as string
  await chooseCiv(page, target, west, 'civ-select-west')
  await expect(west).toContainText(name)
  await expect(menu).toHaveAttribute('open', '')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/civ-select-bot.png` })

  // Searching works the same in the bot's dropdown.
  await trigger.click()
  await page.getByTestId('civ-select-west-search').fill('mal')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('data-value', 'mali')
  await expect(west).toContainText('Mali')
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
  await chooseCiv(host, 'mali')
  const civs = row.getByTestId('seated-civs')
  await expect(civs).toHaveAttribute('aria-label', 'Civilizations: Mali (South)')
  await expect(civs.locator('[data-civ]')).toHaveCount(1)
  await chooseCiv(host, 'japan')
  await expect(civs).toHaveAttribute('aria-label', 'Civilizations: Japan (South)')
  if (SHOTS) await row.screenshot({ path: `${SHOTS}/lobby-card-civs.png` })
  await hostCtx.close()
  await viewerCtx.close()
})

test('a 120-civ roster filters, scrolls and keeps the highlighted row in view', async ({
  page,
}) => {
  // Development-only page with a synthetic roster (apps/web/src/pages/DevCivSelect.tsx).
  await page.goto('/dev/civ-select')
  const trigger = page.getByTestId('civ-select')
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const list = page.getByTestId('civ-select-list')
  await expect(list).toBeVisible()
  await expect(list.getByRole('option')).toHaveCount(120)
  // The list scrolls inside itself: far fewer rows fit than there are.
  const box = await list.boundingBox()
  expect(box?.height ?? 0).toBeLessThan(120 * 56)

  await page.keyboard.press('End')
  expect(await activeCiv(page)).toBe('civ-realm-119')
  await expect(list.getByTestId('civ-realm-119')).toBeInViewport()
  await page.keyboard.press('Home')
  expect(await activeCiv(page)).toBe('civ-realm-0')
  await expect(list.getByTestId('civ-realm-0')).toBeInViewport()
  for (let i = 0; i < 10; i++) await page.keyboard.press('PageDown')
  expect(await activeCiv(page)).toBe('civ-realm-50')
  await expect(list.getByTestId('civ-realm-50')).toBeInViewport()
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
  expect(await activeCiv(page)).toBe('civ-realm-80')
  await expect(list.getByTestId('civ-realm-80')).toBeInViewport()

  // Filtering 120 rows stays quick (each keystroke re-renders the list).
  const started = Date.now()
  await page.keyboard.type('realm 11')
  await expect(list.getByRole('option')).toHaveCount(10)
  expect(Date.now() - started).toBeLessThan(3000)
  await page.getByTestId('civ-select-search').fill('ALAND')
  await expect(list.getByRole('option')).toHaveCount(1)
  await expect(list.getByTestId('civ-aland')).toContainText('Åland')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('data-value', 'aland')
  await expect(page.getByTestId('dev-civ-value')).toHaveText('aland')
})
