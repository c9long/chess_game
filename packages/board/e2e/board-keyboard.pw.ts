import { expect, type Page, test } from '@playwright/test'
import {
  buildPosition,
  engineBoard,
  load,
  openSandbox,
  sb,
  settle,
} from './attack-interaction-helpers.ts'

/**
 * Full keyboard play and screen-reader announcements on the sandbox board (hot seat, so the
 * seats are named, never "you"): focus, the cursor and what it reads, picking up and placing
 * pieces, Escape, the promotion picker, zoom keys, and batched move announcements.
 */

const SHOTS = process.env.BOARD_SHOTS_DIR

/** The keyboard cursor's live region. */
function cursorRegion(page: Page) {
  return page.locator('[data-board-announcer="cursor"]')
}

async function announcements(page: Page): Promise<string[]> {
  return page.locator('[data-board-announcer="moves"] p').allTextContents()
}

async function focusBoard(page: Page) {
  // The canvas is the first stop in the tab order (the zoom button only shows on small boards).
  await page.keyboard.press('Tab')
  await expect(page.locator('canvas')).toBeFocused()
}

async function press(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key)
}

test.beforeEach(async ({ page }) => {
  await openSandbox(page)
})

test('the board is labelled and has polite live regions', async ({ page }) => {
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('role', 'application')
  await expect(canvas).toHaveAttribute('aria-label', /Arrow keys move the cursor/)
  await expect(page.locator('[data-board-announcer="moves"]')).toHaveAttribute(
    'aria-live',
    'polite',
  )
  await expect(cursorRegion(page)).toHaveAttribute('aria-live', 'polite')
  await expect(page.locator('[data-board-zoom]')).toBeHidden()
})

test('a whole move by keyboard, every step read out', async ({ page }) => {
  await focusBoard(page)
  // Focus puts the cursor on the leader of the seat to move and says so.
  await expect(cursorRegion(page)).toHaveText('Board. Your move. Cursor on i1, South king.')
  const outline = await page.locator('canvas').evaluate((c) => getComputedStyle(c).outlineStyle)
  expect(outline).toBe('solid')
  await press(page, 'ArrowUp')
  await expect(cursorRegion(page)).toHaveText('i2, South pawn')
  await press(page, 'ArrowLeft', 4)
  await expect(cursorRegion(page)).toHaveText('e2, South pawn')
  await press(page, 'Enter')
  await expect(cursorRegion(page)).toHaveText(
    'Picked up pawn on e2: 2 moves. Arrow to a square and press Enter.',
  )
  await press(page, 'ArrowUp')
  await expect(cursorRegion(page)).toHaveText('e3, empty, move here')
  await press(page, 'ArrowUp')
  await expect(cursorRegion(page)).toHaveText('e4, empty, move here')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-1280-keyboard-cursor.png` })
  await press(page, 'Space')
  await settle(page)
  expect((await engineBoard(page)).pieces.e4).toBe('south pawn')
  await expect.poll(() => announcements(page)).toContain('South: pawn e2 to e4.')
})

test('Escape cancels a selection; an illegal square says why', async ({ page }) => {
  await focusBoard(page)
  await press(page, 'ArrowUp')
  await press(page, 'Enter')
  await expect(cursorRegion(page)).toHaveText(/Picked up pawn on i2/)
  await press(page, 'Escape')
  await expect(cursorRegion(page)).toHaveText('Nothing selected.')
  // Escape again hides the cursor; Enter shows it first, then picks up.
  await press(page, 'Escape')
  await press(page, 'Enter')
  await expect(cursorRegion(page)).toHaveText('Cursor on i2, South pawn.')
  await press(page, 'Enter')
  await expect(cursorRegion(page)).toHaveText(/Picked up pawn on i2/)
  await press(page, 'ArrowUp', 3)
  await expect(cursorRegion(page)).toHaveText('i5, empty')
  await press(page, 'Enter')
  await expect(cursorRegion(page)).toHaveText('i5, empty. Not a legal move; nothing selected.')
  await press(page, 'ArrowRight', 3)
  await press(page, 'ArrowUp', 2)
  await press(page, 'Enter')
  await expect(cursorRegion(page)).toHaveText('l7, empty. Nothing to pick up.')
  // A West piece, while South is to move, can't be picked up.
  expect((await engineBoard(page)).seatToMove).toBe('south')
})

test('promotion picker by keyboard', async ({ page }) => {
  await load(
    page,
    buildPosition(
      'ffa',
      {
        e8: 'south pawn',
        i1: 'south king',
        a8: 'west king',
        i16: 'north king',
        p8: 'east king',
      },
      'S AAAA - - 0 0',
    ),
  )
  await focusBoard(page)
  await expect(cursorRegion(page)).toHaveText(/Cursor on i1, South king/)
  // i1 -> e8: four left, seven up.
  await press(page, 'ArrowLeft', 4)
  await press(page, 'ArrowUp', 7)
  await expect(cursorRegion(page)).toHaveText('e8, South pawn')
  await press(page, 'Enter')
  await press(page, 'ArrowUp')
  await expect(cursorRegion(page)).toHaveText('e9, empty, move and promote')
  await press(page, 'Enter')
  await expect(cursorRegion(page)).toHaveText(/^Promote to: queen, 1 of \d\. Arrow keys choose/)
  await press(page, 'ArrowDown')
  await expect(cursorRegion(page)).toHaveText(/^rook, 2 of \d$/)
  await press(page, 'Enter')
  await settle(page)
  expect((await engineBoard(page)).pieces.e9).toBe('south rook')
  await expect.poll(() => announcements(page)).toContain('South: pawn e8 to e9, promotes to rook.')
})

test('+, - and 0 zoom toward the cursor', async ({ page }) => {
  await focusBoard(page)
  await press(page, '+')
  await settle(page)
  const z1 = await page.evaluate(
    () => (globalThis as unknown as { __sandbox: { view: { zoom: number } } }).__sandbox.view.zoom,
  )
  expect(z1).toBeGreaterThanOrEqual(1.5)
  await expect(cursorRegion(page)).toHaveText(/^Zoomed in/)
  // The cursor square stays in view while it moves across the zoomed board.
  await press(page, 'ArrowUp', 12)
  await settle(page)
  const inView = await page.evaluate(() => {
    const v = (
      globalThis as unknown as {
        __sandbox: {
          view: { canvas: HTMLCanvasElement; squareToClient(s: string): { x: number; y: number } }
        }
      }
    ).__sandbox.view
    const p = v.squareToClient('i13')
    const r = v.canvas.getBoundingClientRect()
    return p.x > 0 && p.y > 0 && p.x < r.width && p.y < r.height
  })
  expect(inView).toBe(true)
  await press(page, '0')
  await settle(page)
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { __sandbox: { view: { zoom: number } } }).__sandbox.view.zoom,
    ),
  ).toBe(1)
  await expect(cursorRegion(page)).toHaveText('Whole board.')
})

test('moves played in quick succession are announced together', async ({ page }) => {
  await sb(page, 'playAll', ['e2e4', 'a6c7', 'f16e14', 'p6n7'], 60)
  await expect
    .poll(() => announcements(page))
    .toEqual([
      'South: pawn e2 to e4. West: knight a6 to c7. North: knight f16 to e14. East: knight p6 to n7.',
    ])
})

test('captures, defeats, checks and the result are announced', async ({ page }) => {
  await load(
    page,
    buildPosition(
      'ffa',
      { i16: 'north king', a8: 'west king', i1: 'south queen', a1: 'south king', p1: 'east king' },
      'S AAAA - - 0 0',
    ),
  )
  await sb(page, 'play', 'i1i16')
  await expect
    .poll(() => announcements(page))
    .toEqual([
      expect.stringContaining("South: queen i1 to i16, takes North's king.") as unknown as string,
    ])
  const text = (await announcements(page)).join(' ')
  expect(text).toContain('North is defeated: leader captured.')
  await sb(page, 'abandon', 'west')
  await sb(page, 'abandon', 'east')
  await expect
    .poll(async () => (await announcements(page)).join(' '))
    .toContain('Game over. South wins.')
})
