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
 * England (civ version 2, docs/RULES.md "Civilizations with special armies"): four Prime
 * Ministers replace the king, queen and knights. The civ list tags it, the Play page explains
 * it, and a game with England starts with the Prime Ministers on f1, h1, i1 and k1.
 */

const SHOTS = process.env.E2E_SCREENSHOTS

const checkSquares = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board: BoardHook }).__board.checkSquares())

test.beforeAll(async () => {
  await initRules()
})

test('England: special-army tag, explanation, and a game with Prime Ministers', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'england', panel)
  // The trigger shows the tag, and the panel explains the army.
  await expect(panel.getByTestId('civ-select').getByTestId('special-army-tag')).toHaveText(
    'Special army',
  )
  const note = panel.getByTestId('civ-army-note')
  await expect(note).toContainText('Four Prime Ministers stand on their squares')
  await expect(note).toContainText('England is out only when all four are captured')
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/england-play-note.png` })
    await panel.getByTestId('civ-select').click()
    const row = page.getByTestId('civ-select-list').getByTestId('civ-england')
    await row.scrollIntoViewIfNeeded()
    await row.hover()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/england-civ-list.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('civ-select-list')).toBeHidden()
  }
  // The search finds England by its army ("prime", "special").
  await panel.getByTestId('civ-select').click()
  await page.getByTestId('civ-select-search').fill('prime')
  await expect(page.getByTestId('civ-select-list').getByRole('option')).toHaveCount(1)
  await expect(page.getByTestId('civ-select-list').getByTestId('civ-england')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('civ-select-list')).toBeHidden()
  // A standard civ gets the plain note.
  await chooseCiv(page, 'japan', panel)
  await expect(panel.getByTestId('civ-army-note')).toHaveCount(0)
  await expect(panel).toContainText('This civilization plays the standard army')
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
  if (SHOTS) {
    const size = page.viewportSize()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/england-1280x800.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/england-390x844.png` })
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
