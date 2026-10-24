import { expect, type Page, test } from '@playwright/test'
import {
  buildPosition,
  clickSquare,
  dragSquare,
  engineBoard,
  load,
  openSandbox,
  renderedBoard,
  type Seat,
  sb,
  setPerspective,
  settle,
  squarePoint,
} from './attack-interaction-helpers.ts'

/**
 * Premoves on the sandbox board in its premove practice mode (`setPremoveSeat`: one seat is
 * "you", the others move from the API): picking a premove by drag, click and keyboard, the
 * highlight, playing it when the turn comes, dropping it when it is no longer legal or its
 * piece is taken, the ways to cancel it, and the queen as the default promotion.
 */

const SHOTS = process.env.BOARD_SHOTS_DIR

function cursorRegion(page: Page) {
  return page.locator('[data-board-announcer="cursor"]')
}

async function announcements(page: Page): Promise<string> {
  return (await page.locator('[data-board-announcer="moves"] p').allTextContents()).join(' ')
}

async function premoveSeat(page: Page, seat: Seat | null) {
  await sb(page, 'setPremoveSeat', seat)
  await settle(page)
}

async function queued(page: Page): Promise<string | null> {
  return sb<string | null>(page, 'premove')
}

/** Size of the premove highlight layer in page px (0 when nothing is drawn). */
async function premoveHighlight(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => {
    type N = { label?: string; children: N[]; getBounds(): { width: number; height: number } }
    const g = globalThis as unknown as { __pixiApp: { stage: N } }
    const root = g.__pixiApp.stage.children[0] as N
    const layer = root.children.find((c) => c.label === 'premove') as N
    const b = layer.getBounds()
    return { w: b.width, h: b.height }
  })
}

/** South to move: West's pawn on b5 (its push goes to c5) and a South rook on `rook`. */
function pawnAndRook(rook: string) {
  return buildPosition(
    'ffa',
    {
      b5: 'west pawn',
      [rook]: 'south rook',
      i1: 'south king',
      a9: 'west king',
      i16: 'north king',
      p9: 'east king',
    },
    'S AAAA - - 0 0',
  )
}

test.beforeEach(async ({ page }) => {
  await openSandbox(page)
})

test('a dragged premove waits on its square and plays when the turn comes', async ({ page }) => {
  await premoveSeat(page, 'west')
  expect((await premoveHighlight(page)).w).toBe(0)
  await dragSquare(page, 'a6', 'c7')
  await settle(page)
  expect(await queued(page)).toBe('knight a6 to c7')
  await expect(cursorRegion(page)).toHaveText(
    'Premove: knight a6 to c7. It plays when your turn comes.',
  )
  // Nothing moved: the knight went back home, and both squares are marked.
  const engine = await engineBoard(page)
  expect(engine.pieces.a6).toBe('west knight')
  expect(engine.seatToMove).toBe('south')
  const drawn = await renderedBoard(page)
  expect(drawn.find((p) => p.square === 'a6' && p.layer === 'pieces')?.off ?? 1).toBeLessThan(0.05)
  const hl = await premoveHighlight(page)
  const a6 = await squarePoint(page, 'a6')
  const c7 = await squarePoint(page, 'c7')
  // Two squares apart across, one up: the layer spans three by two squares.
  const sq = Math.abs(c7.x - a6.x) / 2 || Math.abs(c7.y - a6.y) / 2
  expect(hl.w).toBeGreaterThan(sq * 1.5)
  expect(hl.h).toBeGreaterThan(sq * 1.5)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/premove-queued.png` })
  await sb(page, 'play', 'e2e4')
  await settle(page)
  await expect.poll(async () => (await engineBoard(page)).pieces.c7).toBe('west knight')
  const after = await engineBoard(page)
  expect(after.pieces.a6).toBeUndefined()
  expect(after.seatToMove).toBe('north')
  expect(await queued(page)).toBeNull()
  expect((await premoveHighlight(page)).w).toBe(0)
  await expect.poll(() => announcements(page)).toContain('West: knight a6 to c7.')
})

test('a premove that is no longer legal is dropped and said', async ({ page }) => {
  await load(page, pawnAndRook('c1'))
  await premoveSeat(page, 'west')
  await clickSquare(page, 'b5')
  await clickSquare(page, 'c5')
  expect(await queued(page)).toBe('pawn b5 to c5')
  // South's rook blocks the push.
  await sb(page, 'play', 'c1c5')
  await settle(page)
  expect(await queued(page)).toBeNull()
  const engine = await engineBoard(page)
  expect(engine.pieces.b5).toBe('west pawn')
  expect(engine.seatToMove).toBe('west')
  await expect
    .poll(() => announcements(page))
    .toContain('Premove cancelled: pawn b5 to c5 is not a legal move now.')
  expect((await premoveHighlight(page)).w).toBe(0)
})

test('a premove is dropped at once when its piece is taken', async ({ page }) => {
  await load(page, pawnAndRook('b1'))
  await premoveSeat(page, 'west')
  await dragSquare(page, 'b5', 'c5')
  expect(await queued(page)).toBe('pawn b5 to c5')
  await sb(page, 'play', 'b1b5')
  await settle(page)
  expect(await queued(page)).toBeNull()
  await expect
    .poll(() => announcements(page))
    .toContain('Premove cancelled: your pawn on b5 is gone.')
})

test('a premove is dropped quietly when its seat stops taking turns', async ({ page }) => {
  await sb(page, 'newGame', 'teams')
  await premoveSeat(page, 'north')
  await dragSquare(page, 'f16', 'e14')
  expect(await queued(page)).toBe('knight f16 to e14')
  // North leaves: frozen, its pieces stay, and the game goes on.
  await sb(page, 'abandon', 'north')
  await settle(page)
  const engine = await engineBoard(page)
  expect(engine.pieces.f16).toBe('north knight')
  expect(await queued(page)).toBeNull()
  expect((await premoveHighlight(page)).w).toBe(0)
  expect(await announcements(page)).not.toContain('Premove cancelled')
  // Nothing more to premove for a seat that no longer moves.
  await clickSquare(page, 'f16')
  await clickSquare(page, 'e14')
  expect(await queued(page)).toBeNull()
  // The keyboard too: the first Enter shows the cursor, the second has nothing to pick up.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(cursorRegion(page)).toHaveText('Not your turn. South to move.')
})

test('right click, a click on the piece and Escape cancel; a new premove replaces the old', async ({
  page,
}) => {
  await premoveSeat(page, 'west')
  await dragSquare(page, 'a6', 'c7')
  expect(await queued(page)).toBe('knight a6 to c7')
  // Another premove takes its place (one at a time).
  await clickSquare(page, 'b9')
  await clickSquare(page, 'd9')
  expect(await queued(page)).toBe('pawn b9 to d9')
  // Right click: cancelled, and the browser's menu stays shut.
  const menu = page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        document
          .querySelector('canvas')
          ?.addEventListener(
            'contextmenu',
            (e) => setTimeout(() => resolve(e.defaultPrevented), 0),
            { once: true },
          )
      }),
  )
  const b9 = await squarePoint(page, 'b9')
  await page.mouse.click(b9.x, b9.y, { button: 'right' })
  expect(await menu).toBe(true)
  expect(await queued(page)).toBeNull()
  await expect(cursorRegion(page)).toHaveText('Premove cancelled.')
  // Only that click's menu: the next right click, with nothing to cancel, gets its menu.
  await page.evaluate(() => {
    const g = globalThis as unknown as { __menuShut: Promise<boolean> }
    g.__menuShut = new Promise<boolean>((resolve) => {
      document.querySelector('canvas')?.addEventListener(
        'contextmenu',
        (e) => {
          const shut = e.defaultPrevented
          // The test's own: no real menu over the page.
          e.preventDefault()
          setTimeout(() => resolve(shut), 0)
        },
        { once: true },
      )
    })
  })
  await page.mouse.click(b9.x, b9.y, { button: 'right' })
  expect(
    await page.evaluate(
      () => (globalThis as unknown as { __menuShut: Promise<boolean> }).__menuShut,
    ),
  ).toBe(false)
  // A click on the premoved piece cancels it too.
  await dragSquare(page, 'a6', 'c7')
  expect(await queued(page)).toBe('knight a6 to c7')
  await clickSquare(page, 'a6')
  expect(await queued(page)).toBeNull()
  // ...and so does Escape on the focused board.
  await dragSquare(page, 'a6', 'c7')
  expect(await queued(page)).toBe('knight a6 to c7')
  await page.keyboard.press('Escape')
  expect(await queued(page)).toBeNull()
  // Turning premoves off drops a queued one.
  await dragSquare(page, 'a6', 'c7')
  expect(await queued(page)).toBe('knight a6 to c7')
  await premoveSeat(page, null)
  expect(await queued(page)).toBeNull()
  expect((await premoveHighlight(page)).w).toBe(0)
})

test('a premove by keyboard, every step read out', async ({ page }) => {
  await premoveSeat(page, 'west')
  await setPerspective(page, 'west')
  await page.keyboard.press('Tab')
  await expect(page.locator('canvas')).toBeFocused()
  await expect(cursorRegion(page)).toHaveText(
    'Board. South to move. You can premove. Cursor on a9, West king.',
  )
  // West faces east: up is toward the higher files.
  await page.keyboard.press('ArrowUp')
  await expect(cursorRegion(page)).toHaveText('b9, West pawn')
  await page.keyboard.press('Enter')
  await expect(cursorRegion(page)).toHaveText(
    'Picked up pawn on b9 for a premove: 2 moves. Arrow to a square and press Enter.',
  )
  await page.keyboard.press('ArrowUp')
  await expect(cursorRegion(page)).toHaveText('c9, empty, premove here')
  await page.keyboard.press('Enter')
  await expect(cursorRegion(page)).toHaveText(
    'Premove: pawn b9 to c9. It plays when your turn comes.',
  )
  await expect(cursorRegion(page)).not.toHaveText(/Not your turn/)
  await page.keyboard.press('ArrowDown')
  await expect(cursorRegion(page)).toHaveText('b9, West pawn, premove from here')
  await page.keyboard.press('Escape')
  await expect(cursorRegion(page)).toHaveText('Premove cancelled.')
  expect(await queued(page)).toBeNull()
  // Again, and this time South moves and the premove plays.
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  expect(await queued(page)).toBe('pawn b9 to c9')
  await sb(page, 'play', 'e2e4')
  await settle(page)
  await expect.poll(async () => (await engineBoard(page)).pieces.c9).toBe('west pawn')
})

test('a turn that comes during a board rotation still plays the premove', async ({ page }) => {
  await premoveSeat(page, 'west')
  await dragSquare(page, 'a6', 'c7')
  expect(await queued(page)).toBe('knight a6 to c7')
  // South moves while the board is still turning toward North.
  await page.evaluate(() => {
    const api = (
      globalThis as unknown as {
        __sandbox: { setPerspective(s: string): void; play(m: string): void }
      }
    ).__sandbox
    api.setPerspective('north')
    api.play('e2e4')
  })
  await settle(page)
  await expect.poll(async () => (await engineBoard(page)).pieces.c7).toBe('west knight')
  expect(await queued(page)).toBeNull()
  expect((await premoveHighlight(page)).w).toBe(0)
})

test('a piece picked up for a premove stays in hand while another seat moves', async ({ page }) => {
  await premoveSeat(page, 'north')
  await clickSquare(page, 'f16')
  await sb(page, 'play', 'e2e4')
  await settle(page)
  // The target hints wear the premove lavender.
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/premove-hints.png` })
  // Still selected: a click on a target queues the premove.
  await clickSquare(page, 'e14')
  expect(await queued(page)).toBe('knight f16 to e14')
})

test('a promotion premove takes the queen', async ({ page }) => {
  await load(
    page,
    buildPosition(
      'ffa',
      {
        e8: 'south pawn',
        i1: 'south king',
        a9: 'west king',
        i16: 'north king',
        p9: 'east king',
      },
      'W AAAA - - 0 0',
    ),
  )
  await premoveSeat(page, 'south')
  await dragSquare(page, 'e8', 'e9')
  expect(await queued(page)).toBe('pawn e8 to e9, promotes to queen')
  // No picker opens for a move that hasn't happened.
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { __pixiApp: { stage: { children: { children: unknown[] }[] } } })
          .__pixiApp.stage.children[2]?.children.length ?? 0,
    ),
  ).toBe(0)
  await sb(page, 'playAll', ['a9a8', 'i16i15', 'p9p8'])
  await settle(page)
  await expect.poll(async () => (await engineBoard(page)).pieces.e9).toBe('south queen')
})
