import { Game, initRules } from '@game/rules'
import { expect, type Page, test } from '@playwright/test'
import {
  type BoardHook,
  chooseCiv,
  playMove,
  position,
  startAsGuest,
  YOUR_TURN,
} from './helpers.ts'

/**
 * England (civ version 2, docs/RULES.md "Civilization abilities": Magna Carta): four Prime
 * Ministers replace the king, queen and knights. The civ list names the ability, the Play
 * page's civ card explains it, the player card opens the same card in a game, and a game with
 * England starts with the Prime Ministers on f1, h1, i1 and k1.
 */

const SHOTS = process.env.E2E_SCREENSHOTS

const checkSquares = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board: BoardHook }).__board.checkSquares())

test.beforeAll(async () => {
  await initRules()
})

test('England: Magna Carta in the picker and civ card, and a game with Prime Ministers', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'england', panel)
  // The trigger names the ability, and the card under it explains it.
  const trigger = panel.getByTestId('civ-select')
  await expect(trigger.getByTestId('civ-ability-line')).toHaveText('Ability: Magna Carta')
  await expect(trigger).toHaveAccessibleDescription('Ability: Magna Carta')
  const card = panel.getByTestId('civ-card')
  await expect(card).toHaveAttribute('data-civ', 'england')
  await expect(card).toContainText('The Tudor rose')
  await expect(card).toContainText('Civilization ability')
  const ability = card.getByTestId('civ-ability-magna-carta')
  await expect(ability.getByRole('heading', { name: 'Magna Carta' })).toBeVisible()
  await expect(ability).toContainText('Four Prime Ministers stand on their squares')
  await expect(ability).toContainText('England is out only when all four are captured')
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/england-play-card.png` })
    await trigger.click()
    const row = page.getByTestId('civ-select-list').getByTestId('civ-england')
    await row.scrollIntoViewIfNeeded()
    await row.hover()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/england-civ-list.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('civ-select-list')).toBeHidden()
  }
  // The search finds England by its ability's summary, and shows that line with the match.
  await trigger.click()
  await page.getByTestId('civ-select-search').fill('prime')
  const list = page.getByTestId('civ-select-list')
  await expect(list.getByRole('option')).toHaveCount(1)
  await expect(list.getByTestId('civ-england')).toBeVisible()
  await expect(list.getByTestId('civ-england').locator('mark')).toHaveText('Prime')
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  // A standard civ: no ability line, and the card says it plays the standard army.
  await chooseCiv(page, 'canada', panel)
  await expect(trigger.getByTestId('civ-ability-line')).toHaveCount(0)
  await expect(panel.getByTestId('civ-card')).toHaveAttribute('data-civ', 'canada')
  await expect(panel.getByTestId('civ-card')).toContainText('Standard army')
  await expect(panel.getByTestId('civ-card').getByTestId('civ-ability-line')).toHaveCount(0)
  await chooseCiv(page, 'england', panel)

  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  const pos = await position(page)
  expect(pos).toMatch(/ civ=england\.2,/)
  const game = Game.fromPosition(pos)
  const snap = game.snapshot()
  game.free()
  expect(snap.leaderSquares[0]).toEqual(['f1', 'h1', 'i1', 'k1'])
  for (const sq of ['f1', 'h1', 'i1', 'k1']) {
    const i = (Number(sq.slice(1)) - 1) * 16 + (sq.charCodeAt(0) - 97)
    expect(snap.board[i]).toEqual({ kind: 'prime_minister', owner: 'south' })
  }
  await expect.poll(() => checkSquares(page)).toEqual([])
  // The player card's emblem opens England's civ card; Escape closes it and returns focus.
  const info = page.getByTestId('civ-info-south')
  await expect(info).toHaveAccessibleName('England, ability Magna Carta: show civilization details')
  await info.click()
  const pop = page.getByTestId('civ-info-popover')
  await expect(pop).toBeVisible()
  await expect(pop).toHaveAccessibleName('England')
  await expect(pop.getByTestId('civ-card-kicker')).toContainText('South')
  await expect(pop.getByTestId('civ-ability-magna-carta')).toContainText('Four Prime Ministers')
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(info).toBeFocused()
  if (SHOTS) {
    const size = page.viewportSize()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/england-1280x800.png` })
    // A bot's civ card from its player row (a popover to the left of the side panel).
    await page.getByTestId('civ-info-west').click()
    await expect(page.getByTestId('civ-info-popover')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/england-civ-popover-1280.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('civ-info-popover')).toBeHidden()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/england-390x844.png` })
    // Phones: the same card in a bottom sheet.
    await page.getByTestId('civ-info-south').click()
    await expect(page.getByTestId('civ-info-popover')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/england-civ-sheet-390.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('civ-info-popover')).toBeHidden()
    if (size) await page.setViewportSize(size)
    await page.waitForTimeout(600)
  }

  // A Prime Minister leaps like a knight.
  await playMove(page, 'f1', 'e3')
  const after = Game.fromPosition(await position(page))
  const board = after.snapshot().board
  after.free()
  expect(board[2 * 16 + 4]).toEqual({ kind: 'prime_minister', owner: 'south' })
  // ...and on the next turn steps like a king (e3 → e4 if still free, else any king step).
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  const now = Game.fromPosition(await position(page))
  const step = now
    .legalMoves()
    .find((m) => m.from === 'e3' && m.piece === 'prime_minister' && !m.capture)
  // The check ring, if any Prime Minister is attacked, covers only the attacked ones.
  const attacked = now.snapshot().attackedLeaderSquares[0]
  now.free()
  await expect.poll(() => checkSquares(page)).toEqual(attacked)
  if (step) {
    await playMove(page, step.from, step.to)
  }
})
