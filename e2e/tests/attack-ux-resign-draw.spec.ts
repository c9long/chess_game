/**
 * UX review: resign and draw-offer screens at 1280x800 and 1920x1080 (screenshots only).
 * Runs only when UX_SHOTS points at a directory; the normal E2E run skips it.
 */
import { expect, type Page, test } from '@playwright/test'
import { playMove, startAsGuest } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''
const sizes = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

async function turn(page: Page) {
  await expect(page.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 30_000 })
}

for (const size of sizes) {
  test(`ux resign + draw flow, 4 guests, ${size.width}`, async ({ browser }) => {
    test.skip(!OUT, 'UX_SHOTS not set')
    test.setTimeout(300_000)
    const tag = String(size.width)
    const civs = ['mali', 'france', 'japan', 'china']
    const pages: Page[] = []
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext({ viewport: size })
      const p = await ctx.newPage()
      await startAsGuest(p)
      pages.push(p)
    }
    const [S, W, N, E] = pages as [Page, Page, Page, Page]
    await S.goto('/play')
    await S.getByTestId('lobby-name').fill(`UX draw ${tag}`)
    await S.getByTestId('create-lobby').click()
    await expect(S.getByRole('heading', { name: `UX draw ${tag}` })).toBeVisible()
    for (const p of [W, N, E]) {
      await p.goto(S.url())
      await expect(p.getByRole('heading', { name: `UX draw ${tag}` })).toBeVisible()
    }
    for (const [i, p] of pages.entries()) {
      await p.getByTestId(`civ-${civs[i]}`).click()
      await p.getByTestId('ready').click()
    }
    await expect(S.getByTestId('start-game')).toBeEnabled()
    await S.getByTestId('start-game').click()
    await turn(S)
    for (const p of pages)
      await p.waitForFunction(
        () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
      )
    await shot(S, `${tag}-a0-game-start`)

    // (a) South offers on its own turn.
    await S.getByTestId('offer-draw').click()
    await expect(S.getByTestId('draw-offer')).toBeVisible()
    await expect(W.getByTestId('draw-offer')).toBeVisible()
    await shot(S, `${tag}-a1-offerer-south`)
    await shot(W, `${tag}-a2-voter-west`)
    // hover tooltip on disabled Offer draw for the offerer
    await S.getByTestId('offer-draw').locator('..').hover()
    await shot(S, `${tag}-a3-offerer-hover-disabled`)

    // (b) A full round without answers -> lapse.
    await playMove(S, 'e2', 'e4')
    await turn(W)
    await playMove(W, 'b5', 'd5')
    await turn(N)
    await playMove(N, 'e11', 'e9')
    await turn(E)
    await shot(E, `${tag}-b0-east-before-last-move`)
    await playMove(E, 'k6', 'i6')
    await turn(S)
    await expect(S.getByTestId('draw-offer')).toHaveCount(0, { timeout: 10_000 })
    await shot(S, `${tag}-b1-lapse-south`)
    await shot(W, `${tag}-b2-lapse-west`)

    // (c) West offers off turn, North declines.
    await W.getByTestId('offer-draw').click()
    await expect(N.getByTestId('draw-accept')).toBeVisible()
    await shot(N, `${tag}-c0-voter-north`)
    await N.getByTestId('draw-decline').click()
    await expect(S.getByTestId('draw-offer')).toContainText('Draw declined')
    await shot(S, `${tag}-c1-declined-south`)
    await shot(W, `${tag}-c2-declined-west-offerer`)
    await shot(N, `${tag}-c3-declined-north-decliner`)
    await expect(W.getByTestId('draw-offer')).toHaveCount(0, { timeout: 10_000 })
    await shot(W, `${tag}-c4-west-cooldown`)

    // (d) East resigns (FFA dialog), then watches.
    await E.getByTestId('resign').click()
    await expect(E.getByTestId('resign-dialog')).toBeVisible()
    await shot(E, `${tag}-d0-resign-dialog-ffa`)
    await E.getByTestId('resign-confirm').click()
    await expect(S.getByTestId('player-east')).toContainText('Resigned')
    await shot(E, `${tag}-d1-east-after-resign`)
    await shot(S, `${tag}-d2-south-sees-east-resigned`)

    // (e) North offers; East (out) watches the card; then West resigns -> lapse (voters changed).
    await N.getByTestId('offer-draw').click()
    await expect(E.getByTestId('draw-offer')).toBeVisible()
    await shot(E, `${tag}-e0-spectator-east-sees-offer`)
    await W.getByTestId('resign').click()
    await W.getByTestId('resign-confirm').click()
    await expect(S.getByTestId('player-west')).toContainText('Resigned')
    await expect(S.getByTestId('draw-offer')).toHaveCount(0, { timeout: 10_000 })
    await shot(S, `${tag}-e1-voters-changed-south`)
    await shot(N, `${tag}-e2-voters-changed-north-offerer`)

    // (f) South makes 2 moves, then offers; North accepts.
    await turn(S)
    await playMove(S, 'i1', 'h3')
    await turn(N)
    await playMove(N, 'i12', 'h10')
    await turn(S)
    await playMove(S, 'd2', 'd4')
    await turn(N)
    await playMove(N, 'd11', 'd10')
    await turn(S)
    await expect(S.getByTestId('offer-draw')).toBeEnabled()
    await S.getByTestId('offer-draw').click()
    await expect(N.getByTestId('draw-accept')).toBeVisible()
    await shot(N, `${tag}-f0-north-two-voters`)
    await N.getByTestId('draw-accept').click()
    for (const p of pages) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 15_000 })
    await shot(S, `${tag}-f1-gameover-south`)
    await shot(N, `${tag}-f2-gameover-north`)
    await shot(W, `${tag}-f3-gameover-west-resigned`)
    await shot(E, `${tag}-f4-gameover-east-resigned`)
    await E.getByRole('button', { name: 'View board' }).click()
    await shot(E, `${tag}-f5-east-view-board`)
    for (const p of pages) await p.context().close()
  })
}

test('ux solo Teams resign dialog + frozen + game over, 1920', async ({ browser }) => {
  test.skip(!OUT, 'UX_SHOTS not set')
  test.setTimeout(240_000)
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage()
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await panel.getByTestId('civ-mali').click()
  await panel.getByRole('button', { name: 'Teams 2v2' }).click()
  await panel.getByTestId('start-solo').click()
  await turn(page)
  await page.getByTestId('offer-draw').click()
  await expect(page.getByTestId('draw-offer')).toBeVisible()
  await shot(page, 'solo-teams-offer')
  await expect(page.getByTestId('toast').first()).toBeVisible({ timeout: 15_000 })
  await shot(page, 'solo-teams-offer-answer')
  await page.getByTestId('resign').click()
  await shot(page, 'solo-teams-resign-dialog')
  await page.getByTestId('resign-confirm').click()
  await shot(page, 'solo-teams-after-resign')
  await page.setViewportSize({ width: 1280, height: 800 })
  await shot(page, 'solo-teams-after-resign-1280')
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 200_000 })
  await shot(page, 'solo-teams-gameover-1280')
  await ctx.close()
})
