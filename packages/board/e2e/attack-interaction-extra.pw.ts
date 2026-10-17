import { expect, test } from '@playwright/test'
import {
  buildPosition,
  engineBoard,
  expectBoardMatchesEngine,
  load,
  openSandbox,
  renderedBoard,
  sb,
  setPerspective,
  settle,
} from './attack-interaction-helpers.ts'

test.beforeEach(async ({ page }) => {
  await openSandbox(page)
})

test('keyboard move for West (arrows are relative to the viewer) is animated', async ({ page }) => {
  await sb(page, 'play', 'e2e4')
  await settle(page)
  await setPerspective(page, 'west')
  await page.locator('canvas').focus()
  // Keyboard focus may already show the cursor; Escape hides it (it stays on West's king).
  await page.keyboard.press('Escape')
  // First arrow shows the cursor on West's king (a9). In West's view, "up" is toward file p.
  await page.keyboard.press('ArrowUp') // cursor appears on a9
  // Move cursor to b9 (one step "up" for West = +1 file), select the pawn, then up twice -> d9.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.evaluate(() => {
    ;(
      globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
    ).__sandbox.view.timeScale = 0.05
  })
  await page.keyboard.press('Enter')
  const ren = await renderedBoard(page)
  const pawn = ren.find(
    (r) =>
      r.variant === 'west' &&
      r.kind === 'pawn' &&
      (r.square === 'd9' || r.square === 'c9' || r.square === 'b9'),
  )
  console.log('west pawn right after keyboard commit (slowed 20x):', pawn)
  await page.evaluate(() => {
    ;(
      globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
    ).__sandbox.view.timeScale = 1
  })
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.pieces.d9).toBe('west pawn')
  await expectBoardMatchesEngine(page, 'keyboard west')
  expect(pawn?.square === 'd9' && (pawn?.off ?? 0) < 0.02, 'keyboard move teleported').toBe(false)
})

test('check indicator only for ACTIVE seats (frozen Teams king not highlighted)', async ({
  page,
}) => {
  const pos = buildPosition(
    'teams',
    {
      i1: 'south king',
      a9: 'west king',
      a5: 'west rook',
      i16: 'north king',
      p10: 'east king',
      h9: 'south queen',
    },
    'W AAAA - - 0 0',
  )
  await load(page, pos)
  const glows = async () =>
    page.evaluate(() => {
      type N = { children: N[]; visible: boolean; x: number; y: number; label?: string }
      const root = (globalThis as unknown as { __pixiApp: { stage: N } }).__pixiApp.stage
        .children[0] as N
      return root.children.filter((c) => c.label?.startsWith('leaderGlow') && c.visible).length
    })
  const attacked = async () =>
    page.evaluate(
      () =>
        (globalThis as unknown as { __sandbox: { snapshot: { leaderUnderAttack: boolean[] } } })
          .__sandbox.snapshot.leaderUnderAttack,
    )
  console.log('before freeze', await attacked(), await glows())
  expect(await glows()).toBeGreaterThanOrEqual(1)
  await sb(page, 'timeout', 'west')
  await settle(page)
  console.log('after freeze', await attacked(), await glows())
  expect(await glows(), 'frozen West king still marked in check').toBe(0)
})

test('perspective switch during a running move keeps pieces on their squares', async ({ page }) => {
  await page.evaluate(() => {
    ;(
      globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
    ).__sandbox.view.timeScale = 0.1
  })
  await sb(page, 'play', 'e2e4')
  await page.waitForTimeout(300)
  await sb(page, 'setPerspective', 'north')
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    ;(
      globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
    ).__sandbox.view.timeScale = 1
  })
  await settle(page)
  await expectBoardMatchesEngine(page, 'rotate mid-move')
})

test('new snapshot while a piece is being dragged cancels the drag cleanly', async ({ page }) => {
  // South starts dragging e2, then West abandons (snapshot arrives mid-drag).
  const a = await page.evaluate(() => {
    const v = (
      globalThis as unknown as {
        __sandbox: {
          view: { squareToClient(s: string): { x: number; y: number }; canvas: HTMLCanvasElement }
        }
      }
    ).__sandbox.view
    const r = v.canvas.getBoundingClientRect()
    const p = v.squareToClient('e2')
    const q = v.squareToClient('e5')
    return { x: r.left + p.x, y: r.top + p.y, qx: r.left + q.x, qy: r.top + q.y }
  })
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 10, a.y - 10, { steps: 2 })
  await page.mouse.move(a.qx, a.qy, { steps: 4 })
  await sb(page, 'abandon', 'west')
  await page.mouse.move(a.qx + 20, a.qy, { steps: 3 })
  await page.mouse.up()
  await settle(page)
  const ren = await renderedBoard(page)
  console.log(
    'drag layer after:',
    ren.filter((r) => r.layer !== 'pieces'),
  )
  await expectBoardMatchesEngine(page, 'snapshot during drag')
})
