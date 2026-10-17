import { expect, test } from '@playwright/test'
import {
  clickSquare,
  dragSquare,
  engineBoard,
  expectBoardMatchesEngine,
  openSandbox,
  position,
  renderedBoard,
  type Seat,
  sb,
  seatToMove,
  setPerspective,
  settle,
  squarePoint,
} from './attack-interaction-helpers.ts'

test.beforeEach(async ({ page }) => {
  await openSandbox(page)
})

test('initial render equals engine snapshot', async ({ page }) => {
  await expectBoardMatchesEngine(page, 'start')
  const ren = await renderedBoard(page)
  expect(ren.length).toBe(64)
})

const CLICK_ROUND: [Seat, string, string][] = [
  ['south', 'e2', 'e4'],
  ['west', 'b5', 'd5'],
  ['north', 'e15', 'e13'],
  ['east', 'o6', 'm6'],
]
const DRAG_ROUND: [Seat, string, string][] = [
  ['south', 'h2', 'h4'],
  ['west', 'b8', 'd8'],
  ['north', 'h15', 'h13'],
  ['east', 'o9', 'm9'],
]

test('click-to-move for each seat with that seat at the bottom', async ({ page }) => {
  for (const [seat, from, to] of CLICK_ROUND) {
    expect(await seatToMove(page)).toBe(seat)
    await setPerspective(page, seat)
    await clickSquare(page, from)
    await clickSquare(page, to)
    await settle(page)
    const eng = await engineBoard(page)
    expect(eng.pieces[to], `${seat} ${from}${to}`).toBe(`${seat} pawn`)
    expect(eng.pieces[from]).toBeUndefined()
    await expectBoardMatchesEngine(page, `${seat} click ${from}${to}`)
  }
})

test('drag-and-drop for each seat with that seat at the bottom', async ({ page }) => {
  for (const [seat, from, to] of DRAG_ROUND) {
    expect(await seatToMove(page)).toBe(seat)
    await setPerspective(page, seat)
    await dragSquare(page, from, to)
    await settle(page)
    const eng = await engineBoard(page)
    expect(eng.pieces[to], `${seat} drag ${from}${to}`).toBe(`${seat} pawn`)
    await expectBoardMatchesEngine(page, `${seat} drag ${from}${to}`)
  }
})

test('illegal drops snap back for each seat and change nothing', async ({ page }) => {
  for (const [seat, from] of CLICK_ROUND) {
    await setPerspective(page, seat)
    const before = await position(page)
    // A pawn four squares forward is never legal; also try dropping off-board.
    const illegal: Record<Seat, string> = { south: 'e6', west: 'f5', north: 'e11', east: 'k6' }
    await dragSquare(page, from, illegal[seat])
    await settle(page)
    expect(await position(page)).toBe(before)
    await expectBoardMatchesEngine(page, `${seat} illegal drop`)
    // Drop outside the field (on the frame) too.
    const a = await squarePoint(page, from)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(a.x + 10, a.y + 10, { steps: 2 })
    await page.mouse.move(5, 5, { steps: 6 })
    await page.mouse.up()
    await settle(page)
    expect(await position(page)).toBe(before)
    await expectBoardMatchesEngine(page, `${seat} off-board drop`)
    // Play a legal move to hand over the turn.
    const legal = (await sb<string[]>(page, 'legal')).find((m) => m.startsWith(from))
    expect(legal).toBeTruthy()
    await sb(page, 'play', legal)
    await settle(page)
  }
})

test('drop on an opponent piece that is not a legal target snaps back', async ({ page }) => {
  // South rook e1 onto West pawn b5 (not a rook move).
  const before = await position(page)
  await dragSquare(page, 'e1', 'b5')
  await settle(page)
  expect(await position(page)).toBe(before)
  await expectBoardMatchesEngine(page, 'rook drop on b5')
})

test('clicking a piece of a seat that is not to move does nothing', async ({ page }) => {
  const before = await position(page)
  await clickSquare(page, 'b5')
  await clickSquare(page, 'd5')
  await settle(page)
  expect(await position(page)).toBe(before)
  await dragSquare(page, 'e15', 'e13')
  await settle(page)
  expect(await position(page)).toBe(before)
  await expectBoardMatchesEngine(page, 'off-turn input')
})

test('click-to-move works after window resize (hit area grows with the canvas)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await settle(page)
  await page.setViewportSize({ width: 1900, height: 1100 })
  await page.waitForTimeout(300)
  await settle(page)
  // South j2j4: j2 is right of centre; at the larger size it lies outside the original canvas box.
  const p = await squarePoint(page, 'j2')
  expect(p.x).toBeGreaterThan(900 - 320)
  await clickSquare(page, 'j2')
  await clickSquare(page, 'j4')
  await settle(page)
  expect((await engineBoard(page)).pieces.j4).toBe('south pawn')
  await expectBoardMatchesEngine(page, 'after resize click')
})
