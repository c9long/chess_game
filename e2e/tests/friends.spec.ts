/**
 * Friends and challenges, end to end: two registered players finish a short Teams game with
 * two bots, one adds the other from the result screen, the other accepts on the Friends page,
 * then a challenge brings both into an invite-only lobby. With UX_SHOTS set it also runs at
 * phone width and saves screenshots there.
 */
import { type Browser, expect, type Page, test } from '@playwright/test'
import { chooseCiv, signUpAndVerify, uniqueUser, YOUR_TURN } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''

async function shot(page: Page, name: string, fullPage = false) {
  if (!OUT) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

async function player(browser: Browser, size: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport: size })
  const page = await ctx.newPage()
  const creds = await signUpAndVerify(page, uniqueUser())
  return { page, name: creds.username }
}

/** Opens the Friends page from the header (or the phone menu). */
async function openFriends(page: Page, phone: boolean) {
  if (phone) {
    await page.getByRole('button', { name: /^Menu/ }).click()
    await page.getByTestId('menu-friends').click()
  } else {
    await page.getByTestId('nav-friends').click()
  }
  await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible()
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  const tag = String(size.width)
  const phone = size.width < 1024

  test(`friends: add after a game, accept, challenge (${tag})`, async ({ browser }) => {
    test.skip(phone && !OUT, 'phone width runs with UX_SHOTS only')
    test.setTimeout(240_000)
    const a = await player(browser, size)
    const b = await player(browser, size)
    const A = a.page
    const B = b.page

    // Before any game: the Friends page explains how to add friends.
    await openFriends(A, phone)
    await expect(A.getByTestId('friends-empty')).toBeVisible()
    await shot(A, `${tag}-friends-empty`)

    // A Teams game: A (South) and B (North) against two bots.
    const lobbyName = `Friends ${tag}`
    await A.goto('/play')
    const form = A.locator('form').filter({ has: A.getByTestId('lobby-name') })
    await A.getByTestId('lobby-name').fill(lobbyName)
    await form.getByRole('button', { name: 'Teams 2v2' }).click()
    await A.getByTestId('create-lobby').click()
    await expect(A.getByRole('heading', { name: lobbyName })).toBeVisible()
    for (const seat of ['west', 'east'] as const) {
      const card = A.getByTestId(`seat-${seat}`)
      await card.getByTestId('add-bot').click()
      await expect(card.getByTestId('seat-name')).toHaveText(/^Bot · /)
    }
    await B.goto(A.url())
    await expect(B.getByRole('heading', { name: lobbyName })).toBeVisible()
    await chooseCiv(A, 'mali')
    await A.getByTestId('ready').click()
    await chooseCiv(B, 'japan')
    await B.getByTestId('ready').click()
    await expect(A.getByTestId('start-game')).toBeEnabled()
    await A.getByTestId('start-game').click()
    await expect(A.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })

    // Live game: B's player card offers "Add friend" to A (bots get none).
    const card = A.getByTestId('card-friend-north')
    await expect(card).toHaveAttribute('data-state', 'add')
    await expect(A.getByTestId('card-friend-west')).toHaveCount(0)
    await shot(A, `${tag}-game-card-add-friend`)

    // The team resigns together: the game ends at once.
    await A.getByTestId('resign').click()
    await A.getByTestId('resign-confirm').click()
    await B.getByTestId('team-resign-accept').click()
    await expect(A.getByTestId('placement-north')).toBeVisible({ timeout: 20_000 })

    // Result screen: A asks B.
    const add = A.getByTestId('result-friend-north')
    await expect(add).toHaveAttribute('data-state', 'add')
    await expect(add).toHaveAccessibleName(`Add friend: ${b.name}`)
    await add.click()
    await expect(add).toHaveAttribute('data-state', 'sent')
    await expect(add).toHaveAccessibleName(`Request sent: ${b.name}`)
    await shot(A, `${tag}-result-request-sent`)

    // B is told at once, and the header counts it.
    await expect(B.getByText(`${a.name} sent you a friend request`).first()).toBeVisible()
    await shot(B, `${tag}-toast-friend-request`)
    // B's own result screen shows the request waiting for an answer.
    await expect(B.getByTestId('result-friend-south')).toHaveAttribute('data-state', 'accept')

    await B.getByTestId('back-to-lobbies').click()
    await A.getByTestId('back-to-lobbies').click()
    // Match history shows the same state for that game.
    await B.goto('/history')
    await expect(B.getByTestId('history-friend')).toHaveAttribute('data-state', 'accept')
    await shot(B, `${tag}-history-friend`)
    await openFriends(B, phone)
    const req = B.getByTestId('request-incoming')
    await expect(req).toContainText(a.name)
    await shot(B, `${tag}-friends-request`, true)
    await req.getByTestId('request-accept').click()
    const row = B.getByTestId('friend-row')
    await expect(row).toContainText(a.name)
    await expect(B.getByTestId('request-incoming')).toHaveCount(0)

    // A sees B as a friend, online (both have the app open).
    await openFriends(A, phone)
    const friend = A.getByTestId('friend-row').filter({ hasText: b.name })
    await expect(friend).toContainText('Online')
    await shot(A, `${tag}-friends-list`, true)

    // B moves on (on the Friends page a challenge shows as a row, not a prompt).
    await B.goto('/history')
    await expect(B.getByRole('heading', { name: 'Match history' })).toBeVisible()

    // Challenge: A invites B to an invite-only lobby and lands in it.
    await friend.getByTestId('friend-challenge').click()
    const dialog = A.getByTestId('challenge-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('challenge-pick').first()).toBeChecked()
    await shot(A, `${tag}-challenge-form`)
    await dialog.getByTestId('challenge-send').click()
    await expect(A.getByRole('heading', { name: `${a.name}'s challenge` })).toBeVisible()
    await expect(A.getByTestId('invite-only-note')).toBeVisible()
    await expect(A.getByTestId('lobby-invite-open')).toContainText(b.name)

    // B gets the prompt and joins.
    const prompt = B.getByTestId('challenge-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText(`${a.name} challenges you`)
    await shot(B, `${tag}-challenge-prompt`)
    await prompt.getByTestId('challenge-join').click()
    await expect(B.getByRole('heading', { name: `${a.name}'s challenge` })).toBeVisible()
    await expect(
      A.getByTestId('seat-north').or(A.getByTestId('seat-west')).getByTestId('seat-name').filter({
        hasText: b.name,
      }),
    ).toBeVisible()
    await expect(A.getByText(`${b.name} joined your lobby`).first()).toBeVisible()
    await shot(A, `${tag}-challenge-lobby`)
    await A.context().close()
    await B.context().close()
  })
}
