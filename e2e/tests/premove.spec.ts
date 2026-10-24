import { expect, type Page, test } from '@playwright/test'
import {
  type BoardHook,
  chooseCiv,
  playMove,
  position,
  startAsGuest,
  YOUR_TURN,
} from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

/** The piece on `square` in a position string, as seat letter + kind letter ('sN'), or null. */
function pieceAt(ps: string, square: string): string | null {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square.slice(1))
  const row = ps.split(' ')[1]?.split('/')[16 - rank] ?? ''
  let f = 0
  for (const token of row.match(/\d+|[a-z][A-Z]/g) ?? []) {
    if (/^\d+$/.test(token)) f += Number(token)
    else if (f++ === file) return token
    if (f > file) break
  }
  return null
}

/** The to-move field of a position string: whose turn it is ('S', 'W', 'N' or 'E'). */
const toMove = (ps: string) => ps.split(' ')[2]

async function clickSquare(page: Page, square: string) {
  const pt = await page.evaluate(
    (s) => (window as unknown as { __board: BoardHook }).__board.squareToClient(s),
    square,
  )
  if (!pt) throw new Error(`square ${square} not on screen`)
  await page.mouse.click(pt.x, pt.y)
}

const queued = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __board: { premove(): string | null } }).__board.premove(),
  )

async function startSolo(page: Page) {
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'japan', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await page.waitForFunction(
    () => 'premove' in ((window as never as { __board?: object }).__board ?? {}),
  )
}

test('a premove made during the bots’ turns plays when the turn comes', async ({ page }) => {
  test.setTimeout(120_000)
  await startSolo(page)
  await playMove(page, 'e2', 'e4')
  // The bots are thinking (spaced 700 ms apart): queue the knight's jump.
  expect(toMove(await position(page))).not.toBe('S')
  await clickSquare(page, 'k1')
  await clickSquare(page, 'j3')
  expect(await queued(page)).toBe('k1j3')
  const notice = page.getByTestId('premove-notice')
  await expect(notice.getByTestId('premove-text')).toHaveText('Premove: knight k1 to j3')
  await expect(notice.getByTestId('premove-short')).toBeHidden()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/premove-queued-desktop.png` })
  // When the turn comes back the premove is sent at once: the knight lands on j3 without
  // another click, and the bots carry on.
  await expect.poll(async () => pieceAt(await position(page), 'j3'), { timeout: 30_000 }).toBe('sN')
  expect(pieceAt(await position(page), 'k1')).toBeNull()
  await expect(notice).toHaveCount(0)
  expect(await queued(page)).toBeNull()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  expect(pieceAt(await position(page), 'j3')).toBe('sN')
})

test('the banner cancels a premove, and the board setting turns premoves off', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await startSolo(page)
  await playMove(page, 'e2', 'e4')
  await clickSquare(page, 'f1')
  await clickSquare(page, 'g3')
  const notice = page.getByTestId('premove-notice')
  // Phones: the bracket mark and the squares only, so the banner keeps its room; the full
  // words are still there for screen readers. Read and cancel in the frame the pill shows
  // up in: the bots' turns are short, and the premove would otherwise play first.
  const handle = await page.waitForFunction(() => {
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    const cancel = q('premove-cancel')
    if (!cancel) return null
    const pill = {
      short: q('premove-short')?.innerText ?? null,
      text: q('premove-text')?.textContent ?? null,
      width: q('premove-notice')?.getBoundingClientRect().width ?? 0,
      banner: q('turn-banner')?.getBoundingClientRect().width ?? 0,
      cancel: cancel.getBoundingClientRect().height,
    }
    cancel.click()
    return pill
  })
  const pill = await handle.jsonValue()
  expect(pill?.short).toBe('f1→g3')
  expect(pill?.text).toBe('Premove: knight f1 to g3')
  expect(pill?.width ?? 0).toBeLessThan((pill?.banner ?? 0) * 0.75)
  expect(pill?.cancel ?? 0).toBeGreaterThanOrEqual(40)
  await expect(notice).toHaveCount(0)
  expect(await queued(page)).toBeNull()
  // Nothing was queued, so the turn comes back with f1 untouched.
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  expect(pieceAt(await position(page), 'f1')).toBe('sN')

  await page.getByRole('button', { name: 'Board settings' }).click()
  const settings = page.getByTestId('board-settings')
  const toggle = settings.getByLabel('Premoves')
  await expect(toggle).toBeChecked()
  if (SHOTS) {
    await settings.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/premove-setting-phone.png` })
  }
  await toggle.uncheck()
  await page.getByRole('button', { name: 'Board settings' }).click()
  await playMove(page, 'k1', 'j3')
  expect(toMove(await position(page))).not.toBe('S')
  await clickSquare(page, 'f1')
  await clickSquare(page, 'g3')
  expect(await queued(page)).toBeNull()
  await expect(notice).toHaveCount(0)
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  expect(pieceAt(await position(page), 'f1')).toBe('sN')
})
