/**
 * Friends and challenges, end to end: two registered players finish a short Teams game with
 * two bots, one adds the other from the result screen, the other accepts on the Friends page,
 * then a challenge brings both into an invite-only lobby. A ranked challenge brings four
 * friends to a ranked, invite-only table (three friends needed, no bots), and the lobby warns
 * when the four already played their rated games together for the day. With UX_SHOTS set it
 * also runs at phone width and saves screenshots there.
 */
import { type Browser, expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL, E2E_WEB_ORIGIN } from '../env.ts'
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
      await expect(card.getByTestId('seat-name')).toHaveText(/^Bot /)
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
    // One friend is too few for a ranked challenge: the switch is locked and says why.
    await expect(dialog.getByTestId('ranked-toggle')).toBeDisabled()
    await expect(dialog.getByTestId('ranked-hint')).toHaveText(
      'A ranked challenge needs 3 friends. You have 1.',
    )
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

/** A friend request by username over REST (as the app sends it). */
async function requestFriend(page: Page, username: string) {
  const res = await page.request.post('/api/friends/requests', {
    data: { username },
    headers: { origin: E2E_WEB_ORIGIN },
  })
  expect(res.ok(), await res.text()).toBe(true)
}

/** Three finished rated games of these four players today: the ranked repeat limit. */
async function seedRatedGames(usernames: string[]) {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    const ids: string[] = []
    for (const name of usernames) {
      const [u] = await sql<{ id: string }[]>`select id from users where username = ${name}`
      if (!u) throw new Error(`player ${name} missing`)
      ids.push(u.id)
    }
    const [civ] = await sql<{ id: number }[]>`select id from civilizations where slug = 'japan'`
    for (let i = 0; i < 3; i++) {
      const [m] = await sql<{ id: string }[]>`
        insert into matches (mode, time_control, rules_version, status, rated, ranked, ended_at)
        values ('ffa', '10+0', 1, 'finished', true, true, now()) returning id`
      for (const [seat, id] of ids.entries()) {
        await sql`
          insert into match_players (match_id, seat, user_id, civ_id, civ_version, placement)
          values (${m?.id ?? ''}, ${seat}, ${id}, ${civ?.id ?? 0}, 1, ${seat + 1})`
      }
    }
  } finally {
    await sql.end()
  }
}

test('friends: ranked challenge for a full table, unrated past the daily limit', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const size = { width: 1280, height: 800 }
  const a = await player(browser, size)
  const others = [
    await player(browser, size),
    await player(browser, size),
    await player(browser, size),
  ]
  const A = a.page
  const [B, C, D] = others.map((o) => o.page) as [Page, Page, Page]
  // A asks each by username; a request back accepts it.
  for (const o of others) {
    await requestFriend(A, o.name)
    await requestFriend(o.page, a.name)
  }
  // The four already played 3 rated games together today: this one will be unrated.
  await seedRatedGames([a.name, ...others.map((o) => o.name)])
  // B and D wait elsewhere (a prompt); C waits on the Friends page (a row).
  await B.goto('/history')
  await D.goto('/history')
  await C.goto('/friends')

  await A.goto('/friends')
  await expect(A.getByTestId('friend-row')).toHaveCount(3)
  await A.getByTestId('challenge-friends').click()
  const dialog = A.getByTestId('challenge-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('challenge-blocker')).toHaveText('Pick at least one friend.')
  await dialog.getByText('Elo-rated, for you and 3 friends').click()
  await expect(dialog.getByTestId('ranked-toggle')).toBeChecked()
  await expect(dialog.getByTestId('ranked-hint')).toContainText('Bots can’t sit in.')
  await expect(dialog.getByTestId('challenge-blocker')).toHaveText('Pick 3 more friends.')
  const picks = dialog.getByTestId('challenge-pick')
  await picks.nth(0).check()
  await picks.nth(1).check()
  await expect(dialog.getByTestId('challenge-blocker')).toHaveText('Pick 1 more friend.')
  await expect(dialog.getByTestId('challenge-send')).toBeDisabled()
  await picks.nth(2).check()
  await expect(dialog.getByTestId('challenge-blocker')).toHaveCount(0)
  await shot(A, 'ranked-challenge-form')
  await dialog.getByTestId('challenge-send').click()

  // A ranked, invite-only lobby with no bot controls.
  const lobby = `${a.name}'s challenge`
  await expect(A.getByRole('heading', { name: lobby })).toBeVisible()
  await expect(A.locator('header').getByTestId('ranked-badge')).toBeVisible()
  await expect(A.getByTestId('invite-only-note')).toContainText('ranked')
  await expect(A.getByTestId('add-bot')).toHaveCount(0)
  await expect(A.getByTestId('ranked-seat-hint').first()).toBeVisible()

  // The prompt and the Friends row say it is ranked.
  for (const P of [B, D]) {
    const prompt = P.getByTestId('challenge-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('ranked.')
    await expect(prompt.getByTestId('ranked-badge')).toBeVisible()
  }
  await shot(B, 'ranked-challenge-prompt')
  const row = C.getByTestId('friends-challenge-join').locator('xpath=ancestor::li[1]')
  await expect(row.getByTestId('ranked-badge')).toBeVisible()
  await C.getByTestId('friends-challenge-join').click()
  for (const P of [B, D])
    await P.getByTestId('challenge-prompt').getByTestId('challenge-join').click()
  for (const P of [B, C, D]) await expect(P.getByRole('heading', { name: lobby })).toBeVisible()

  // Full table: everyone is told before the start that it won't be rated.
  for (const P of [A, B, C, D]) {
    await expect(P.getByTestId('unrated-repeat-note')).toContainText(
      '3 rated games together in the last 24 hours',
    )
  }
  await shot(A, 'ranked-challenge-unrated')
  for (const [P, civ] of [
    [A, 'mali'],
    [B, 'japan'],
    [C, 'china'],
    [D, 'canada'],
  ] as const) {
    await chooseCiv(P, civ)
    await P.getByTestId('ready').click()
  }
  await expect(A.getByTestId('start-game')).toBeEnabled()
  await A.getByTestId('start-game').click()
  await expect(A.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
  // Ranked rules, no Elo: the resign dialog says so.
  await A.getByTestId('resign').click()
  await expect(A.getByTestId('resign-ranked-note')).toHaveText(
    'This ranked game isn’t rated, so nobody’s Elo changes.',
  )
  await A.getByRole('button', { name: 'Keep playing' }).click()
  for (const P of [A, B, C, D]) await P.context().close()
})
