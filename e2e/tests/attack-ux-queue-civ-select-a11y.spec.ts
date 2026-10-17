/**
 * UX/a11y review: axe on the civ dropdown while it is open (Play page and lobby, desktop and
 * phone). Includes axe's `aria-dialog-name` rule, because the open list sits in a Radix
 * Popover whose content has role="dialog". Runs only when UX_SHOTS is set.
 */
import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { startAsGuest } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''

async function auditOpen(page: Page, name: string) {
  await page.waitForTimeout(400) // open animation
  await page.addStyleTag({ content: 'body { background: #322b1e !important; }' })
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
    .analyze()
  // WCAG A/AA rules, plus the one best-practice rule this review is about.
  const relevant = (tags: string[], id: string) =>
    tags.includes('wcag2a') || tags.includes('wcag2aa') || id === 'aria-dialog-name'
  const blocking = results.violations
    .filter((v) => relevant(v.tags, v.id))
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    )
  if (OUT) await page.screenshot({ path: `${OUT}/queue-civ-a11y-${name}.png` })
  expect.soft(blocking, `axe on ${name} with the civ dropdown open`).toEqual([])
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`ux queue: civ dropdown open passes axe (${label})`, async ({ page }) => {
    test.skip(!OUT, 'UX review only (set UX_SHOTS)')
    test.setTimeout(90_000)
    await page.setViewportSize(viewport)
    await startAsGuest(page)
    await page.goto('/play')
    await page.getByTestId('civ-select').click()
    await expect(page.getByTestId('civ-select-list')).toBeVisible()
    await auditOpen(page, `${label}-play`)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('civ-select-list')).toBeHidden()

    await page.getByTestId('create-lobby').click()
    await expect(page.getByTestId('seat-south')).toBeVisible()
    await page.getByTestId('civ-select').click()
    await expect(page.getByTestId('civ-select-list')).toBeVisible()
    await auditOpen(page, `${label}-lobby`)
    await page.keyboard.press('Escape')
    await page.getByTestId('leave-lobby').click()
  })
}
