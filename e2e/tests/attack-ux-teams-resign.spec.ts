/**
 * UX review: Teams resignation vote screens at 1280x800 and 390x844 (screenshots + a11y probes).
 * Runs only when UX_SHOTS points at a directory; the normal E2E run skips it.
 */
import { expect, type Page, test } from '@playwright/test'
import { chooseCiv, playMove, startAsGuest, YOUR_TURN } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''
const sizes = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

async function turn(page: Page) {
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
}

async function boardReady(page: Page) {
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
}

async function active(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    if (!a) return 'null'
    return `${a.tagName}#${a.id}[testid=${a.dataset.testid ?? ''}] text="${(a.textContent ?? '').slice(0, 40)}" disabled=${(a as HTMLButtonElement).disabled ?? ''}`
  })
}

async function inViewport(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }
  })
}

async function teamsTable(
  browser: import('@playwright/test').Browser,
  size: { width: number; height: number },
  name: string,
  humans: 2 | 4,
) {
  const pages: Page[] = []
  for (let i = 0; i < humans; i++) {
    const ctx = await browser.newContext({ viewport: size })
    const p = await ctx.newPage()
    await startAsGuest(p)
    pages.push(p)
  }
  const S = pages[0] as Page
  await S.goto('/play')
  const form = S.locator('form').filter({ has: S.getByTestId('lobby-name') })
  await S.getByTestId('lobby-name').fill(name)
  await form.getByRole('button', { name: 'Teams 2v2' }).click()
  await S.getByTestId('create-lobby').click()
  await expect(S.getByRole('heading', { name })).toBeVisible()
  if (humans === 2) {
    for (const seat of ['west', 'east'] as const) {
      const card = S.getByTestId(`seat-${seat}`)
      await card.getByTestId('add-bot').click()
      await expect(card.getByTestId('seat-name')).toHaveText(/^Bot · /)
    }
  }
  // Join order: 2 humans -> South, North (bots fill W/E); 4 humans -> S, W, N, E.
  for (const p of pages.slice(1)) {
    await p.goto(S.url())
    await expect(p.getByRole('heading', { name })).toBeVisible()
  }
  const civs = ['mali', 'france', 'japan', 'china']
  for (const [i, p] of pages.entries()) {
    await chooseCiv(p, civs[i] as string)
    await p.getByTestId('ready').click()
  }
  await expect(S.getByTestId('start-game')).toBeEnabled()
  await S.getByTestId('start-game').click()
  await turn(S)
  for (const p of pages) await boardReady(p)
  return pages
}

for (const size of sizes) {
  const tag = String(size.width)

  test(`ux teams resign vote, 2 humans + 2 bots, ${tag}`, async ({ browser }) => {
    test.skip(!OUT, 'UX_SHOTS not set')
    test.setTimeout(300_000)
    const [S, N] = (await teamsTable(browser, size, `UX tr ${tag}`, 2)) as [Page, Page]

    // (a) dialog
    await S.getByTestId('resign').click()
    await expect(S.getByTestId('resign-dialog')).toBeVisible()
    await shot(S, `${tag}-a0-teams-resign-dialog`)
    console.log(`[${tag}] dialog focus:`, await active(S))
    await S.getByTestId('resign-confirm').click()
    await expect(S.getByTestId('team-resign-waiting')).toBeVisible()
    console.log(`[${tag}] focus after confirm:`, await active(S))
    await shot(S, `${tag}-a1-proposer-waiting`)
    await S.getByTestId('resign').locator('..').hover()
    await shot(S, `${tag}-a2-proposer-hover-disabled-resign`)

    // (b) teammate card
    const req = N.getByTestId('team-resign-request')
    await expect(req).toBeVisible()
    console.log(`[${tag}] teammate focus on arrival:`, await active(N))
    console.log(`[${tag}] request card rect:`, await inViewport(N, 'team-resign-request'))
    console.log(
      `[${tag}] request card a11y:`,
      await req.evaluate((el) => el.outerHTML.slice(0, 400)),
    )
    await shot(N, `${tag}-b0-teammate-request`)
    await shot(N, `${tag}-b0-teammate-request-full`, true)
    await N.getByTestId('resign').locator('..').hover()
    await shot(N, `${tag}-b1-teammate-hover-disabled-resign`)
    // keyboard: how many Tabs from body to reach accept?
    await N.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    let tabs = 0
    for (; tabs < 40; tabs++) {
      await N.keyboard.press('Tab')
      const t = await N.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.testid)
      if (t === 'team-resign-accept') break
    }
    console.log(`[${tag}] tabs from top to accept:`, tabs + 1)
    await shot(N, `${tag}-b2-teammate-accept-focused`)

    // (c) decline
    await N.getByTestId('team-resign-decline').click()
    // The proposer sees the decline in place of the waiting card (no toast).
    await expect(S.getByTestId('team-resign-outcome')).toContainText('declined')
    await shot(S, `${tag}-c0-proposer-declined-toast`)
    await shot(N, `${tag}-c1-decliner-toast`)
    console.log(`[${tag}] decliner focus after decline:`, await active(N))
    await expect(S.getByTestId('resign-hint')).toBeVisible()
    await shot(S, `${tag}-c2-proposer-cooldown`)

    // (d) North proposes, nobody answers for a full round -> lapse.
    await N.getByTestId('resign').click()
    await N.getByTestId('resign-confirm').click()
    await expect(S.getByTestId('team-resign-request')).toBeVisible()
    await shot(S, `${tag}-d0-south-request-on-own-turn`)
    // also a draw offer coexisting
    await S.getByTestId('offer-draw').click()
    await expect(S.getByTestId('draw-offer')).toBeVisible()
    await shot(S, `${tag}-d1-south-request-plus-draw`)
    await shot(N, `${tag}-d1b-north-waiting-plus-draw`)
    await playMove(S, 'e2', 'e4')
    await turn(N)
    await playMove(N, 'e15', 'e13')
    await turn(S)
    await playMove(S, 'k1', 'j3')
    await turn(N)
    await expect(N.getByTestId('team-resign-outcome')).toContainText('full round', {
      timeout: 15_000,
    })
    await expect(S.getByTestId('toast').filter({ hasText: 'lapsed' })).toBeVisible()
    await shot(N, `${tag}-d2-north-lapse-toast`)
    await shot(S, `${tag}-d3-south-lapse-toast`)
    console.log(
      `[${tag}] lapse toasts S:`,
      await S.getByTestId('toast').allTextContents(),
      'N:',
      await N.getByTestId('toast').allTextContents(),
    )

    // (e) South proposes again, North accepts -> result.
    await expect(S.getByTestId('resign')).toBeEnabled({ timeout: 15_000 })
    await S.getByTestId('resign').click()
    await S.getByTestId('resign-confirm').click()
    await expect(N.getByTestId('team-resign-request')).toBeVisible()
    await N.getByTestId('team-resign-accept').click()
    for (const p of [S, N]) await expect(p.getByTestId('game-over')).toBeVisible()
    await shot(S, `${tag}-e0-result-proposer`)
    await shot(N, `${tag}-e1-result-accepter`)
    console.log(`[${tag}] result text:`, await S.getByTestId('game-over').innerText())
    await S.getByRole('button', { name: 'View board' }).click()
    await shot(S, `${tag}-e2-board-after`)
    await S.context().close()
    await N.context().close()
  })

  test(`ux teams resign: teammate leaves -> lapse, then immediate, ${tag}`, async ({ browser }) => {
    test.skip(!OUT, 'UX_SHOTS not set')
    test.setTimeout(240_000)
    const [S, N] = (await teamsTable(browser, size, `UX tl ${tag}`, 2)) as [Page, Page]
    await S.getByTestId('resign').click()
    await S.getByTestId('resign-confirm').click()
    await expect(N.getByTestId('team-resign-request')).toBeVisible()
    // North leaves instead of answering.
    await N.getByRole('button', { name: 'Leave game' }).click()
    await N.getByTestId('leave-confirm').click()
    await expect(S.getByTestId('toast').filter({ hasText: 'dropped' })).toContainText(
      'You can now resign for your team without a vote.',
      { timeout: 15_000 },
    )
    await expect(S.getByTestId('toast').filter({ hasText: 'dropped' })).not.toContainText('play on')
    console.log(`[${tag}] voters-changed toast:`, await S.getByTestId('toast').allTextContents())
    await shot(S, `${tag}-f0-voters-changed-toast`)
    await S.getByTestId('resign').locator('..').hover()
    await shot(S, `${tag}-f1-hover-resign-teammate-out`)
    await S.getByTestId('resign').click()
    await expect(S.getByTestId('resign-dialog')).toBeVisible()
    await shot(S, `${tag}-f2-dialog-teammate-out`)
    console.log(`[${tag}] out-dialog:`, await S.getByTestId('resign-dialog').innerText())
    await S.getByTestId('resign-confirm').click()
    await expect(S.getByTestId('game-over')).toBeVisible()
    await shot(S, `${tag}-f3-result-immediate`)
    console.log(`[${tag}] immediate result:`, await S.getByTestId('game-over').innerText())
    await S.context().close()
    await N.context().close()
  })
}

test('ux teams resign, 4 humans, opponents + winners view, 1280', async ({ browser }) => {
  test.skip(!OUT, 'UX_SHOTS not set')
  test.setTimeout(300_000)
  const size = { width: 1280, height: 800 }
  const [S, W, N, E] = (await teamsTable(browser, size, 'UX tr4', 4)) as [Page, Page, Page, Page]
  await W.getByTestId('resign').click()
  await W.getByTestId('resign-confirm').click()
  await expect(E.getByTestId('team-resign-request')).toBeVisible()
  await shot(S, '4h-g0-opponent-during-proposal')
  await shot(E, '4h-g1-east-request-offturn')
  await E.getByTestId('team-resign-accept').click()
  for (const p of [S, W, N, E]) await expect(p.getByTestId('game-over')).toBeVisible()
  await shot(S, '4h-g2-winner-result')
  await shot(W, '4h-g3-loser-result')
  console.log('winner result:', await S.getByTestId('game-over').innerText())
  await S.getByRole('button', { name: 'View board' }).click()
  await shot(S, '4h-g4-winner-board-cards')
  for (const p of [S, W, N, E]) await p.context().close()
})

for (const size of sizes) {
  test(`ux FFA + solo Teams resign dialogs, ${size.width}`, async ({ browser }) => {
    test.skip(!OUT, 'UX_SHOTS not set')
    test.setTimeout(180_000)
    const tag = String(size.width)
    for (const mode of ['Free-for-all', 'Teams 2v2'] as const) {
      const ctx = await browser.newContext({ viewport: size })
      const page = await ctx.newPage()
      await startAsGuest(page)
      await page.getByTestId('play-vs-bots').click()
      const panel = page.getByTestId('vs-bots')
      await chooseCiv(page, 'mali', panel)
      await panel.getByRole('button', { name: mode }).click()
      await panel.getByTestId('start-solo').click()
      await turn(page)
      await boardReady(page)
      await page.getByTestId('resign').click()
      await expect(page.getByTestId('resign-dialog')).toBeVisible()
      const m = mode === 'Teams 2v2' ? 'teams' : 'ffa'
      await shot(page, `${tag}-h-solo-${m}-dialog`)
      console.log(`[${tag}] ${m} dialog:`, await page.getByTestId('resign-dialog').innerText())
      if (m === 'teams') {
        await page.getByTestId('resign-confirm').click()
        await page.waitForTimeout(150)
        await shot(page, `${tag}-h-solo-teams-waiting`)
        await expect(page.getByTestId('team-resign-outcome')).toHaveText(
          /^The [\w ]+ bot declined to resign\. You both play on\.$/,
        )
        await shot(page, `${tag}-h-solo-teams-declined`)
        console.log(
          `[${tag}] solo outcome:`,
          await page.getByTestId('team-resign-outcome').innerText(),
        )
      }
      await ctx.close()
    }
  })
}

test('ux teams resign keyboard focus probe, 1280', async ({ browser }) => {
  test.skip(!OUT, 'UX_SHOTS not set')
  test.setTimeout(240_000)
  const size = { width: 1280, height: 800 }
  const [S, N] = (await teamsTable(browser, size, 'UX kb', 2)) as [Page, Page]
  await S.getByTestId('resign').focus()
  await S.keyboard.press('Enter')
  await expect(S.getByTestId('resign-dialog')).toBeVisible()
  await S.getByTestId('resign-confirm').focus()
  await S.keyboard.press('Enter')
  await expect(S.getByTestId('resign-dialog')).toHaveCount(0)
  await S.waitForTimeout(800)
  console.log('[kb] proposer focus after keyboard confirm:', await active(S))
  await expect(S.getByTestId('team-resign-waiting')).toBeFocused()
  await expect(N.getByTestId('team-resign-request')).toBeVisible()
  await N.waitForTimeout(500)
  console.log('[kb] teammate focus on arrival:', await active(N))
  await N.getByTestId('team-resign-decline').focus()
  await N.keyboard.press('Enter')
  await expect(N.getByTestId('team-resign-request')).toHaveCount(0)
  await N.waitForTimeout(500)
  console.log('[kb] teammate focus after keyboard decline:', await active(N))
  await expect(N.getByTestId('resign')).toBeFocused()
  // The proposer's card shows the decline and keeps focus; when it goes, focus returns to
  // the Resign control (its hint wrapper: the button is disabled by the cooldown).
  await expect(S.getByTestId('team-resign-outcome')).toBeVisible()
  await expect(S.getByTestId('team-resign-waiting')).toBeFocused()
  await expect(S.getByTestId('team-resign-waiting')).toHaveCount(0, { timeout: 10_000 })
  await expect(S.getByTestId('resign').locator('..')).toBeFocused()
  await N.keyboard.press('Tab')
  console.log('[kb] teammate focus after one Tab:', await active(N))
  await shot(N, 'kb-after-decline-tab')
  for (const p of [S, N]) await p.context().close()
})
