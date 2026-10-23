import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { chooseCiv, startAsGuest } from './helpers.ts'

/**
 * Civ cards (display copy from `CIV_INFO` in @game/config): the card under the picker, the
 * preview pane beside the list on wide screens, and the details of any seated civ, opened from
 * its lobby seat (a popover from 640px, a bottom sheet on phones).
 */

const SHOTS = process.env.E2E_SCREENSHOTS

/** axe (WCAG 2 A/AA) on one civ surface; contrast included, so labels must stay legible. */
async function auditCiv(page: Page, selector: string, name: string) {
  await page.waitForTimeout(400) // entrance animations finish, so colours are final
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include(selector)
    .analyze()
  const report = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}: ${n.failureSummary}`).join('\n'),
    )
  expect.soft(report, `axe violations on ${name}:\n${report.join('\n')}`).toEqual([])
}

/** Whether a point (page coordinates) lands on `target` or inside it. */
async function hits(page: Page, target: Locator, x: number, y: number) {
  const handle = await target.elementHandle()
  return page.evaluate(
    ([el, px, py]) => {
      const at = document.elementFromPoint(px as number, py as number)
      return Boolean(at && (el as Element).contains(at))
    },
    [handle, x, y] as const,
  )
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}

test('the Play page shows the chosen civ’s card and, on wide screens, a preview pane', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await startAsGuest(page)
  await page.goto('/play')
  const panel = page.getByTestId('vs-bots')
  // Nothing chosen yet: no card.
  await expect(panel.getByTestId('civ-card')).toHaveCount(0)
  const trigger = panel.getByTestId('civ-select')
  await trigger.click()
  const list = page.getByTestId('civ-select-list')
  await expect(list).toBeVisible()
  // The pane follows the highlighted row (and is hidden from screen readers: rows say it).
  const pane = page.getByTestId('civ-preview')
  await expect(pane).toHaveAttribute('aria-hidden', 'true')
  await expect(pane.getByTestId('civ-card')).toHaveAttribute('data-civ', 'canada')
  await list.getByTestId('civ-england').hover()
  await expect(pane.getByTestId('civ-card')).toHaveAttribute('data-civ', 'england')
  await expect(pane).toContainText('Magna Carta')
  await expect(pane).toContainText('England has no king, queen or knights.')
  if (SHOTS) {
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/civ-preview-1280.png` })
  }
  await list.getByTestId('civ-england').click()
  const card = panel.getByTestId('civ-card')
  await expect(card).toHaveAttribute('data-civ', 'england')
  // Under the page's own h3 "Your civilization", the ability title is an h4.
  await expect(card.getByRole('heading', { name: 'Magna Carta', level: 4 })).toBeVisible()
  await auditCiv(page, '[data-testid="vs-bots"]', 'Play with England chosen')
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/civ-card-play-1280.png` })

  // Phones: no pane, the card stacks under the picker, nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(card).toBeVisible()
  await noSideScroll(page)
  if (SHOTS) {
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/civ-card-play-390.png` })
  }
  await trigger.click()
  await expect(list).toBeVisible()
  await expect(pane).toHaveCount(0)
  await page.getByTestId('civ-select-search').fill('prime')
  await expect(list.getByRole('option')).toHaveCount(1)
  if (SHOTS) {
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/civ-search-390.png` })
  }
  await page.keyboard.press('Escape')
  await chooseCiv(page, 'mali', panel)
  await expect(card).toContainText('Standard army')
  await expect(card).toContainText('Chiwara')
  await auditCiv(page, '[data-testid="vs-bots"] [data-testid="civ-card"]', 'standard civ card')
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/civ-card-standard-390.png` })
})

test('lobby: your civ’s folded card, and any seated civ’s details from its seat', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await startAsGuest(page)
  await page.goto('/play')
  await page.getByTestId('lobby-name').fill('Civ card table')
  await page.getByTestId('create-lobby').click()
  await expect(page.getByRole('heading', { name: 'Civ card table' })).toBeVisible()
  await chooseCiv(page, 'england')

  // Your civilization: the ability is a folded row (title and summary); opening shows the rest.
  const own = page.getByTestId('civ-card')
  await expect(own).toHaveAttribute('data-civ', 'england')
  const ability = own.getByTestId('civ-ability-magna-carta')
  const summary = ability.locator('summary')
  await expect(summary).toContainText('Magna Carta')
  await expect(summary).toContainText('Four Prime Ministers replace the king, queen and knights')
  await expect(ability.getByText('England has no king, queen or knights.')).toBeHidden()
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(ability.getByText('England has no king, queen or knights.')).toBeVisible()
  // Folded, the title is still a real heading (outside the <summary>) for heading navigation.
  await expect(ability.getByRole('heading', { name: 'Magna Carta', level: 3 })).toBeAttached()
  await auditCiv(page, '[data-testid="civ-card"]', 'lobby: your civ card')

  // A bot at West; its civ line opens a popover with its card. Escape closes it.
  const west = page.getByTestId('seat-west')
  await west.getByTestId('add-bot').click()
  await expect(west.getByTestId('seat-name')).toHaveText(/^Bot/)
  const westInfo = page.getByTestId('civ-info-west')
  await expect(westInfo).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(westInfo).toHaveAttribute('aria-expanded', 'false')
  // The hit area reaches past the text into the gap above the badges, but never over the
  // player's name above it.
  const box = await westInfo.boundingBox()
  const name = await west.getByTestId('seat-name').boundingBox()
  if (!box || !name) throw new Error('no seat boxes')
  expect(await hits(page, westInfo, box.x + 8, box.y + box.height + 6)).toBe(true)
  expect(await hits(page, westInfo, name.x + 4, name.y + name.height / 2)).toBe(false)
  await westInfo.click()
  const pop = page.getByTestId('civ-info-popover')
  await expect(pop).toBeVisible()
  await expect(westInfo).toHaveAttribute('aria-expanded', 'true')
  await expect(pop.getByTestId('civ-card-kicker')).toHaveText(/^Bot \S+ at West$/)
  await expect(pop.getByTestId('civ-card')).toBeVisible()
  await auditCiv(page, '[data-testid="civ-info-popover"]', 'lobby: seat popover')
  if (SHOTS) {
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/civ-lobby-popover-1280.png` })
  }
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(westInfo).toBeFocused()

  // Your own seat opens England's card, with Magna Carta open.
  const southInfo = page.getByTestId('civ-info-south')
  await expect(southInfo).toHaveAccessibleName(
    'England, ability Magna Carta: show civilization details',
  )
  await expect(southInfo.getByTestId('civ-ability-line')).toHaveText('Ability: Magna Carta')
  await southInfo.click()
  await expect(pop).toBeVisible()
  await expect(pop).toHaveAccessibleName('England')
  // The dialog is the only named container: no nested region repeating the civ name.
  await expect(pop.getByRole('region')).toHaveCount(0)
  await expect(pop.getByRole('heading', { name: 'Magna Carta' })).toBeVisible()
  await expect(pop).toContainText('England is out only when all four are captured')
  if (SHOTS) {
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/civ-lobby-england-1280.png` })
  }
  // An outside click closes it too.
  await page.mouse.click(5, 5)
  await expect(pop).toBeHidden()

  // Phones: a bottom sheet with a close button; nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  await noSideScroll(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/civ-lobby-390.png`, fullPage: true })
  await southInfo.scrollIntoViewIfNeeded()
  await southInfo.click()
  await expect(pop).toBeVisible()
  const sheet = await pop.boundingBox()
  expect(sheet?.x).toBe(0)
  expect(sheet?.width).toBe(390)
  await noSideScroll(page)
  await auditCiv(page, '[data-testid="civ-info-popover"]', 'lobby: phone sheet')
  if (SHOTS) {
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/civ-lobby-sheet-390.png` })
  }
  await pop.getByRole('button', { name: 'Close' }).click()
  await expect(pop).toBeHidden()
  await expect(southInfo).toBeFocused()
})
