import { expect, type Page, test } from '@playwright/test'
import {
  clickSquare,
  dragSquare,
  expectBoardMatchesEngine,
  openSandbox,
  renderedBoard,
  sb,
  settle,
} from './attack-interaction-helpers.ts'

const SHOT =
  '/tmp/claude-1000/-home-c9long-chess-game/bb6dac1d-5690-4e27-9699-e9c91353b39a/scratchpad/m2'

async function animating(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as unknown as { __sandbox: { view: { animating: boolean } } }).__sandbox.view
        .animating,
  )
}

async function rootRotation(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as unknown as { __pixiApp: { stage: { children: { rotation: number }[] } } })
        .__pixiApp.stage.children[0]?.rotation ?? Number.NaN,
  )
}

/** Crispness facts: renderer resolution, canvas backing store, piece texture density. */
async function crisp(page: Page) {
  return page.evaluate(() => {
    type N = {
      children: N[]
      width: number
      texture?: { frame: { width: number } }
      resolution?: number
    }
    const g = globalThis as unknown as {
      __pixiApp: {
        renderer: { resolution: number }
        canvas: HTMLCanvasElement
        screen: { width: number; height: number }
        stage: N & { hitArea?: { width: number; height: number } }
      }
    }
    const app = g.__pixiApp
    const root = app.stage.children[0] as N & { scale: { x: number } }
    const pieceLayer = (root.children as (N & { label?: string })[]).find(
      (c) => c.label === 'pieces',
    ) as N
    const first = pieceLayer.children[0] as N
    const body = first.children[0] as N
    const labels = (root.children as (N & { label?: string })[]).find(
      (c) => c.label === 'labels',
    ) as N
    const label = labels.children[0] as N
    const rect = app.canvas.getBoundingClientRect()
    return {
      dpr: devicePixelRatio,
      resolution: app.renderer.resolution,
      cssW: rect.width,
      cssH: rect.height,
      backingW: app.canvas.width,
      backingH: app.canvas.height,
      screenW: app.screen.width,
      screenH: app.screen.height,
      hitW: app.stage.hitArea?.width,
      hitH: app.stage.hitArea?.height,
      // device px drawn per texture px for the piece sprite (should be <= ~1 for crisp)
      pieceTexPx: body.texture?.frame.width ?? 0,
      pieceDevicePx: body.width * root.scale.x * devicePixelRatio,
      labelResolution: label.resolution,
      rootScale: root.scale.x,
    }
  })
}

/** True once the board stops animating within `ms` (polled, so a loaded machine's frame hiccups don't count). */
async function quietWithin(page: Page, ms: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      () =>
        !(globalThis as unknown as { __sandbox: { view: { animating: boolean } } }).__sandbox.view
          .animating,
      undefined,
      { timeout: ms },
    )
    return true
  } catch {
    return false
  }
}

test.describe('reduced motion', () => {
  test('OS setting (prefers-reduced-motion) turns the option on', async ({ page }) => {
    await openSandbox(page, { reducedMotion: true })
    const on = await page.evaluate(
      () =>
        (globalThis as unknown as { __sandbox: { view: { options: { reducedMotion: boolean } } } })
          .__sandbox.view.options.reducedMotion,
    )
    expect(on).toBe(true)
    await expect(page.getByLabel('Reduced motion')).toBeChecked()
  })

  test('moves, perspective and drag are instant with reduced motion', async ({ page }) => {
    await openSandbox(page)
    await sb(page, 'setOptions', { reducedMotion: true })
    // API move: no slide. The piece is on its new square at once and only
    // short fades (piece, highlight, turn) run, all done within ~150 ms.
    await sb(page, 'play', 'e2e4')
    const ren = await renderedBoard(page)
    const e4 = ren.find((r) => r.square === 'e4')
    expect(e4?.off ?? 1, 'pawn should already sit on e4').toBeLessThan(0.02)
    expect(await quietWithin(page, 500), 'a quiet move should only fade briefly').toBe(true)
    // Perspective change: no spin.
    await sb(page, 'setPerspective', 'west')
    const rot = await rootRotation(page)
    expect(Math.abs(rot - (3 * Math.PI) / 2) < 1e-6 || Math.abs(rot + Math.PI / 2) < 1e-6).toBe(
      true,
    )
    expect(await animating(page)).toBe(false)
    await settle(page)
    // Drag-drop: after mouseup nothing should still be tweening.
    const legal = await sb<string[]>(page, 'legal')
    expect(legal).toContain('b5d5')
    await dragSquare(page, 'b5', 'd5')
    // Only the short highlight/turn fades (~150 ms) may still run.
    expect(await quietWithin(page, 500), 'drop/lift tweens still run with reduced motion').toBe(
      true,
    )
    await expectBoardMatchesEngine(page, 'reduced motion')
  })

  test('turn band does not pulse with reduced motion', async ({ page }) => {
    await openSandbox(page)
    await sb(page, 'setOptions', { reducedMotion: true })
    const alphas: number[] = []
    for (let i = 0; i < 5; i++) {
      alphas.push(
        await page.evaluate(
          () =>
            (
              globalThis as unknown as {
                __pixiApp: {
                  stage: { children: { children: { alpha: number; label?: string }[] }[] }
                }
              }
            ).__pixiApp.stage.children[0]?.children.find((c) => c.label === 'bandGlow')?.alpha ??
            -1,
        ),
      )
      await page.waitForTimeout(150)
    }
    expect(new Set(alphas.map((a) => a.toFixed(3))).size).toBe(1)
  })

  test('capture with reduced motion: no particles', async ({ page }) => {
    await openSandbox(page)
    await sb(page, 'setOptions', { reducedMotion: true })
    // South c2xb3 captures West's corner pawn on move 1.
    await sb(page, 'play', 'c2b3')
    const particles = await page.evaluate(() => {
      type N = { children: unknown[]; label?: string; visible?: boolean }
      const root = (
        globalThis as unknown as { __pixiApp: { stage: { children: { children: N[] }[] } } }
      ).__pixiApp.stage.children[0]
      const visible = (name: string) =>
        (root?.children.find((c) => c.label === name)?.children as N[] | undefined)?.filter(
          (c) => c.visible,
        ).length ?? -1
      return visible('particles') + visible('chips')
    })
    expect(particles, 'no particles with reduced motion').toBe(0)
    await settle(page)
    await expectBoardMatchesEngine(page, 'reduced capture')
  })
})

test.describe('resize', () => {
  test('resize re-lays out: backing store, hit area, pieces on squares', async ({ page }) => {
    await openSandbox(page)
    const sizes = [
      { width: 1280, height: 800 },
      { width: 700, height: 500 },
      { width: 1920, height: 1080 },
      { width: 1000, height: 1300 },
    ]
    for (const s of sizes) {
      await page.setViewportSize(s)
      await page.waitForTimeout(400)
      await settle(page)
      const c = await crisp(page)
      console.log(s, JSON.stringify(c))
      expect(c.backingW).toBe(Math.floor(c.cssW) * c.resolution)
      expect(c.screenW).toBe(Math.floor(c.cssW))
      expect(c.hitW).toBe(c.screenW)
      expect(c.pieceTexPx, 'piece texture upscaled (blurry)').toBeGreaterThanOrEqual(
        Math.floor(c.pieceDevicePx) - 1,
      )
      await expectBoardMatchesEngine(page, `size ${s.width}x${s.height}`)
      await page.screenshot({ path: `${SHOT}/attack-int-resize-${s.width}x${s.height}.png` })
    }
  })

  test('devicePixelRatio change (zoom / monitor move) re-renders at the new density', async ({
    page,
  }) => {
    await openSandbox(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await page.waitForTimeout(800)
    await settle(page)
    const c = await crisp(page)
    console.log('after dpr 2', JSON.stringify(c))
    expect(c.dpr).toBe(2)
    expect(c.resolution).toBe(2)
    expect(c.backingW).toBe(Math.floor(c.cssW) * 2)
    expect(c.labelResolution).toBe(2)
    expect(c.pieceTexPx).toBeGreaterThanOrEqual(Math.floor(c.pieceDevicePx) - 1)
    await page.screenshot({ path: `${SHOT}/attack-int-dpr2.png` })
  })

  test('resize in the middle of a move animation leaves pieces on their squares', async ({
    page,
  }) => {
    await openSandbox(page)
    await page.evaluate(() => {
      ;(
        globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
      ).__sandbox.view.timeScale = 0.05
    })
    await sb(page, 'play', 'e2e4')
    await page.waitForTimeout(500)
    await page.setViewportSize({ width: 800, height: 560 })
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      ;(
        globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
      ).__sandbox.view.timeScale = 1
    })
    await settle(page)
    await page.screenshot({ path: `${SHOT}/attack-int-resize-mid-move.png` })
    await expectBoardMatchesEngine(page, 'resize mid-move')
  })

  test('resize while a drag is in progress, then drop', async ({ page }) => {
    await openSandbox(page)
    const box = await page.evaluate(() => 0)
    void box
    await clickSquare(page, 'e2') // select
    await clickSquare(page, 'e2') // deselect
    await settle(page)
    await expectBoardMatchesEngine(page, 'pre drag')
  })

  test('resize while the promotion picker is open keeps state consistent', async ({ page }) => {
    await openSandbox(page)
    await sb(
      page,
      'loadPosition',
      'ffa 6nK5/12/12/12/12/wK10eK/5sP6/12/12/12/12/6sK5 S AAAA - - 0 0',
      false,
    )
    await settle(page)
    await clickSquare(page, 'f6')
    await clickSquare(page, 'f7')
    await settle(page)
    await page.setViewportSize({ width: 1100, height: 760 })
    await page.waitForTimeout(400)
    await settle(page)
    await page.screenshot({ path: `${SHOT}/attack-int-resize-promo.png` })
    await expectBoardMatchesEngine(page, 'resize with picker')
  })
})
