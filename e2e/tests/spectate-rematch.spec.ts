import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { chooseCiv, playMove, signUpAndVerify, startAsGuest, YOUR_TURN } from './helpers.ts'

const SHOTS = process.env.E2E_SCREENSHOTS

/** axe-core WCAG A/AA scan (as in ui-a11y.spec.ts): no serious or critical violations. */
async function audit(page: Page, name: string) {
  await page.waitForTimeout(600)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('[data-testid="board"] canvas')
    .analyze()
  const report = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}\n      ${n.failureSummary}`).join('\n'),
    )
  expect.soft(report, `axe violations on ${name}:\n${report.join('\n')}`).toEqual([])
}

async function startSolo(page: Page, civ: string) {
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, civ, panel)
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await page.waitForFunction(
    () => 'squareToClient' in ((window as never as { __board?: object }).__board ?? {}),
  )
}

const roomIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1) as string

test('a second browser watches a solo game live; the player then plays a rematch', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const playerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const viewerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const player = await playerCtx.newPage()
  const viewer = await viewerCtx.newPage()
  await startAsGuest(player)
  await startSolo(player, 'france')
  await playMove(player, 'e2', 'e4')
  await expect(player.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  const roomId = roomIdOf(player)

  // The viewer opens the watch link: the live board, players and move log, no game actions.
  await startAsGuest(viewer)
  await viewer.goto(`/watch/${roomId}`)
  await expect(viewer.getByTestId('spectator-banner')).toContainText('Watching')
  await expect(viewer.getByTestId('board')).toBeVisible()
  const viewerLog = viewer.getByTestId('move-log')
  await expect(viewerLog.getByTestId('move-log-item').first()).toContainText('South: e2e4')
  await expect(viewer.getByTestId('resign')).toHaveCount(0)
  await expect(viewer.getByTestId('offer-draw')).toHaveCount(0)
  await expect(viewer.getByRole('button', { name: 'Stop watching' })).toBeVisible()
  // Both see that someone is watching.
  await expect(player.getByTestId('spectator-count').first()).toContainText('1 watching')
  await expect(viewer.getByTestId('spectator-count').first()).toContainText('1 watching')

  // A move by the player shows up for the viewer.
  await playMove(player, 'k1', 'j3')
  await expect(
    viewerLog.getByTestId('move-log-item').filter({ hasText: 'South: k1j3' }),
  ).toHaveCount(1, { timeout: 15_000 })
  await expect(player.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  await viewer.waitForTimeout(800)
  if (SHOTS) await viewer.screenshot({ path: `${SHOTS}/spectate-desktop.png` })
  if (SHOTS) await player.screenshot({ path: `${SHOTS}/spectate-player-desktop.png` })
  await audit(viewer, 'watch page')

  // Phone width: the same read-only screen.
  await viewer.setViewportSize({ width: 390, height: 844 })
  await expect(viewer.getByTestId('spectator-banner')).toBeVisible()
  await viewer.waitForTimeout(600)
  if (SHOTS) await viewer.screenshot({ path: `${SHOTS}/spectate-phone.png` })
  await viewer.setViewportSize({ width: 1280, height: 800 })

  // The player resigns: the game ends for both. The viewer gets the result, no rematch.
  await player.getByTestId('resign').click()
  await player.getByTestId('resign-confirm').click()
  await expect(player.getByTestId('game-over')).toBeVisible({ timeout: 15_000 })
  await expect(viewer.getByTestId('game-over')).toBeVisible({ timeout: 15_000 })
  await expect(viewer.getByTestId('rematch-panel')).toHaveCount(0)
  await expect(viewer.getByTestId('game-over').getByTestId('back-to-lobbies')).toHaveText(
    'Stop watching',
  )

  // The player proposes a rematch: alone with bots, the new game opens at once.
  const panel = player.getByTestId('rematch-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('same civs and bots')
  if (SHOTS) await player.screenshot({ path: `${SHOTS}/rematch-offer-desktop.png` })
  await audit(player, 'result with rematch')
  await player.setViewportSize({ width: 390, height: 844 })
  await player.waitForTimeout(400)
  if (SHOTS) await player.screenshot({ path: `${SHOTS}/rematch-offer-phone.png`, fullPage: true })
  await player.setViewportSize({ width: 1280, height: 800 })
  await panel.getByTestId('rematch-propose').click()
  await expect(player).not.toHaveURL(new RegExp(`/match/${roomId}$`), { timeout: 15_000 })
  await expect(player).toHaveURL(/\/match\/[A-Za-z0-9_-]+$/)
  await expect(player.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  await expect(player.getByTestId('move-log')).toContainText('No moves yet.')
  // Same civ for the player (France).
  await expect(player.getByTestId('player-south')).toContainText('France')
  expect(roomIdOf(player)).not.toBe(roomId)

  // The viewer stops watching.
  await viewer.getByTestId('game-over').getByTestId('back-to-lobbies').click()
  await expect(viewer.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
  await playerCtx.close()
  await viewerCtx.close()
})

test('a running public game is listed with Watch, and spectators can’t act', async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const fanCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const host = await hostCtx.newPage()
  const fan = await fanCtx.newPage()
  await startAsGuest(host)
  await host.goto('/play')
  await host.getByTestId('lobby-name').fill('Watch party')
  await host.getByTestId('create-lobby').click()
  await expect(host.getByRole('heading', { name: 'Watch party' })).toBeVisible()
  for (const seat of ['west', 'north', 'east'] as const) {
    const card = host.getByTestId(`seat-${seat}`)
    await card.getByTestId('add-bot').click()
    await expect(card.getByTestId('seat-name')).toHaveText(/^Bot/)
  }
  await chooseCiv(host, 'mali')
  await host.getByTestId('ready').click()
  await host.getByTestId('start-game').click()
  await expect(host.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })

  // The lobby browser lists the running game with a Watch link.
  await startAsGuest(fan)
  await fan.goto('/play')
  const row = fan.getByTestId('lobby-list').locator('li', { hasText: 'Watch party' })
  await expect(row).toContainText('In game')
  const watch = row.getByTestId('watch-game')
  await expect(watch).toHaveText('Watch')
  await fan.waitForTimeout(400)
  if (SHOTS) await fan.screenshot({ path: `${SHOTS}/lobby-watch-phone.png`, fullPage: true })
  await watch.click()
  await expect(fan).toHaveURL(/\/watch\//)
  await expect(fan.getByTestId('spectator-banner')).toBeVisible()
  await expect(fan.getByTestId('board')).toBeVisible()
  // The host sees the spectator in the lobby browser too.
  await expect(host.getByTestId('spectator-count').first()).toContainText('1 watching')
  await fan.waitForTimeout(600)
  if (SHOTS) await fan.screenshot({ path: `${SHOTS}/spectate-lobby-game-phone.png` })

  // Leaving the watch page stops watching.
  await fan.getByRole('button', { name: 'Stop watching' }).click()
  await expect(fan.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
  await expect(host.getByTestId('spectator-count')).toHaveCount(0, { timeout: 10_000 })

  await host.getByRole('button', { name: 'Leave game' }).click()
  await host.getByTestId('leave-confirm').click()
  await hostCtx.close()
  await fanCtx.close()
})

test('two players agree to a rematch: both land in a fresh lobby with their seats and civs', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const sCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const nCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const S = await sCtx.newPage()
  const N = await nCtx.newPage()
  await startAsGuest(S)
  await startAsGuest(N)
  const name = 'Rematch night'
  await S.goto('/play')
  const form = S.locator('form').filter({ has: S.getByTestId('lobby-name') })
  await S.getByTestId('lobby-name').fill(name)
  await form.getByRole('button', { name: 'Teams 2v2' }).click()
  await S.getByTestId('create-lobby').click()
  await expect(S.getByRole('heading', { name })).toBeVisible()
  for (const seat of ['west', 'east'] as const) {
    const card = S.getByTestId(`seat-${seat}`)
    await card.getByTestId('add-bot').click()
    await expect(card.getByTestId('seat-name')).toHaveText(/^Bot /)
  }
  // The second player joins North: South's teammate.
  await N.goto(S.url())
  await expect(N.getByRole('heading', { name })).toBeVisible()
  await chooseCiv(S, 'mali')
  await S.getByTestId('ready').click()
  await chooseCiv(N, 'japan')
  await N.getByTestId('ready').click()
  await expect(S.getByTestId('start-game')).toBeEnabled()
  await S.getByTestId('start-game').click()
  await expect(S.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 20_000 })
  const firstRoom = roomIdOf(S)

  // South asks to resign the team, North agrees: the game is over.
  await S.getByTestId('resign').click()
  await S.getByTestId('resign-confirm').click()
  await N.getByTestId('team-resign-accept').click()
  await expect(S.getByTestId('game-over')).toBeVisible({ timeout: 15_000 })
  await expect(N.getByTestId('game-over')).toBeVisible({ timeout: 15_000 })

  // North proposes; South gets Accept / Decline with a countdown.
  await N.getByTestId('rematch-propose').click()
  const sPanel = S.getByTestId('rematch-panel')
  await expect(sPanel).toContainText('wants a rematch')
  await expect(sPanel.getByTestId('rematch-countdown')).toHaveText(/\d+ s left/)
  await expect(sPanel.getByTestId('rematch-vote-2')).toContainText('In')
  await expect(N.getByTestId('rematch-panel')).toContainText('You proposed a rematch')
  await S.waitForTimeout(500)
  if (SHOTS) await S.screenshot({ path: `${SHOTS}/rematch-vote-desktop.png` })
  if (SHOTS) await N.screenshot({ path: `${SHOTS}/rematch-waiting-phone.png`, fullPage: true })
  await audit(S, 'rematch vote')
  await sPanel.getByTestId('rematch-accept').click()

  // Both are taken to the new lobby: same seats, civs and bots, nobody ready yet.
  for (const p of [S, N]) {
    await expect(p).not.toHaveURL(new RegExp(`/match/${firstRoom}$`), { timeout: 15_000 })
    await expect(p.getByTestId('ready')).toBeVisible({ timeout: 15_000 })
    await expect(p.getByRole('heading', { name })).toBeVisible()
  }
  expect(roomIdOf(S)).toBe(roomIdOf(N))
  await expect(S.getByTestId('seat-north').getByTestId('seat-name')).toHaveText(/^Guest-\d{4}$/)
  await expect(S.getByTestId('seat-west').getByTestId('seat-name')).toHaveText(/^Bot /)
  await expect(S.getByTestId('civ-select')).toHaveAttribute('data-value', 'mali')
  await expect(N.getByTestId('civ-select')).toHaveAttribute('data-value', 'japan')
  await S.waitForTimeout(500)
  if (SHOTS) await S.screenshot({ path: `${SHOTS}/rematch-lobby-desktop.png`, fullPage: true })
  await sCtx.close()
  await nCtx.close()
})

test('the Friends page lists a friend’s game to watch', async ({ browser }) => {
  test.setTimeout(150_000)
  const aCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const bCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const A = await aCtx.newPage()
  const B = await bCtx.newPage()
  const a = await signUpAndVerify(A)
  await signUpAndVerify(B)
  // Friends (through the API, as the Friends page would).
  const sent = await A.evaluate(
    async (username) => {
      const res = await fetch('/api/friends/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      return res.status
    },
    (await B.getByTestId('display-name').textContent()) ?? '',
  )
  expect(sent).toBeLessThan(300)
  const accepted = await B.evaluate(async () => {
    const list = await (await fetch('/api/friends')).json()
    const from = list.incoming[0].user.userId as string
    return (await fetch(`/api/friends/requests/${from}/accept`, { method: 'POST' })).status
  })
  expect(accepted).toBeLessThan(300)

  await A.goto('/')
  await startSolo(A, 'japan')
  await B.goto('/friends')
  const playing = B.getByTestId('friends-playing')
  await expect(playing).toBeVisible({ timeout: 20_000 })
  const game = playing.getByTestId('friend-game')
  await expect(game).toContainText(a.username)
  await expect(game).toContainText('Playing against bots')
  await B.waitForTimeout(300)
  if (SHOTS) await B.screenshot({ path: `${SHOTS}/friends-playing-desktop.png`, fullPage: true })
  await audit(B, 'friends playing')
  await B.setViewportSize({ width: 390, height: 844 })
  await B.waitForTimeout(300)
  if (SHOTS) await B.screenshot({ path: `${SHOTS}/friends-playing-phone.png`, fullPage: true })
  await game.getByTestId('friend-game-watch').click()
  await expect(B).toHaveURL(/\/watch\//)
  await expect(B.getByTestId('spectator-banner')).toBeVisible()
  await expect(B.getByTestId('player-south')).toContainText(a.username)
  await aCtx.close()
  await bCtx.close()
})
