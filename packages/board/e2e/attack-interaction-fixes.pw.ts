import { expect, type Page, test } from '@playwright/test'
import { expectBoardMatchesEngine, openSandbox, sb, settle } from './attack-interaction-helpers.ts'

// Regression checks for the M2 review fixes (lifecycle, power, robustness).

type PixiApp = {
  ticker: { started: boolean; maxFPS: number }
  renderer: { gl: WebGLRenderingContext }
}

async function ticker(page: Page) {
  return page.evaluate(() => {
    const t = (globalThis as unknown as { __pixiApp: PixiApp }).__pixiApp.ticker
    return { started: t.started, maxFPS: t.maxFPS }
  })
}

/** Average colour of an 8x8 patch at the centre of square f6 (empty) (a screen capture). */
async function patchColor(page: Page): Promise<[number, number, number]> {
  const p = await page.evaluate(() => {
    const v = (
      globalThis as unknown as {
        __sandbox: {
          view: {
            canvas: HTMLCanvasElement
            squareToClient(s: string): { x: number; y: number } | null
          }
        }
      }
    ).__sandbox.view
    const r = v.canvas.getBoundingClientRect()
    const a = v.squareToClient('f6') as { x: number; y: number }
    return { x: r.left + a.x, y: r.top + a.y }
  })
  const png = await page.screenshot({ clip: { x: p.x - 4, y: p.y - 4, width: 8, height: 8 } })
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d') as CanvasRenderingContext2D
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    const sum = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      sum[0] += d[i] as number
      sum[1] += d[i + 1] as number
      sum[2] += d[i + 2] as number
    }
    const n = d.length / 4
    return [sum[0] / n, sum[1] / n, sum[2] / n] as [number, number, number]
  }, png.toString('base64'))
}

test('idle board caps the frame rate; animations uncap it', async ({ page }) => {
  await openSandbox(page)
  await page.waitForTimeout(300)
  expect((await ticker(page)).maxFPS).toBe(30)
  await page.evaluate(() => {
    ;(
      globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
    ).__sandbox.view.timeScale = 0.05
  })
  await sb(page, 'play', 'e2e4')
  await page.waitForTimeout(200)
  expect((await ticker(page)).maxFPS).toBe(0)
})

test('hiding the container stops rendering; showing it resumes without changes', async ({
  page,
}) => {
  await openSandbox(page)
  await page.evaluate(() => {
    ;(document.getElementById('stage') as HTMLElement).style.display = 'none'
  })
  await page.waitForTimeout(400)
  expect((await ticker(page)).started).toBe(false)
  await page.evaluate(() => {
    ;(document.getElementById('stage') as HTMLElement).style.display = ''
  })
  await page.waitForTimeout(400)
  expect((await ticker(page)).started).toBe(true)
  await expectBoardMatchesEngine(page, 'after show')
})

test('the board surface comes back after a WebGL context loss', async ({ page }) => {
  await openSandbox(page)
  const before = await patchColor(page)
  await page.evaluate(() => {
    const g = globalThis as unknown as { __pixiApp: PixiApp; __lose: WEBGL_lose_context | null }
    g.__lose = g.__pixiApp.renderer.gl.getExtension('WEBGL_lose_context')
    g.__lose?.loseContext()
  })
  await page.waitForTimeout(300)
  await sb(page, 'timeout', 'north') // a status change while the context is lost
  await page.evaluate(() => {
    ;(globalThis as unknown as { __lose: WEBGL_lose_context | null }).__lose?.restoreContext()
  })
  await page.waitForTimeout(1000)
  await settle(page)
  // f6 is an empty square: without the board texture it would show the dark page.
  const after = await patchColor(page)
  const diff = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])
  expect(diff, `before ${before} after ${after}`).toBeLessThan(30)
  await expectBoardMatchesEngine(page, 'after context restore')
})

test('a destroyed view refuses to mount again', async ({ page }) => {
  await openSandbox(page)
  const r = await page.evaluate(async () => {
    const view = (
      globalThis as unknown as {
        __sandbox: {
          view: {
            canvas: HTMLCanvasElement | null
            destroy(): void
            mount(el: HTMLElement): Promise<void>
          }
        }
      }
    ).__sandbox.view
    const parent = view.canvas?.parentElement as HTMLElement
    view.destroy()
    try {
      await view.mount(parent)
      return 'resolved'
    } catch (e) {
      return `threw ${(e as Error).message}; canvas=${String(view.canvas)}`
    }
  })
  expect(r).toMatch(/^threw .*destroyed.*canvas=null$/)
})
