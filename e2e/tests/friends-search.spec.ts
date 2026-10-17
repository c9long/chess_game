/**
 * Add friends without a game together (2026-10-17): search a player by part of their name,
 * open their public profile, add them by exact username (any case), and the other side
 * accepts. A player who only takes requests from people they played with refuses with the
 * one neutral message. Also covers the other states of search and profiles (no results, a
 * failed search, an invalid query, "Player not found", your own profile, a friend's profile,
 * a profile you blocked) and keyboard focus after each action. Runs at desktop and phone
 * width; with UX_SHOTS set it saves screenshots of every state, and axe scans each.
 */
import { AxeBuilder } from '@axe-core/playwright'
import { type Browser, expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import { signUpAndVerify, uniqueUser } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''

async function shot(page: Page, name: string, fullPage = false) {
  if (!OUT) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

/** axe-core WCAG A/AA scan (as in ui-a11y.spec): serious or critical violations fail. */
async function audit(page: Page, name: string) {
  await page.waitForTimeout(600)
  // The checkerboard gradient background can't be measured: a solid stand-in at its lightest.
  const style = await page.addStyleTag({ content: 'body { background: #322b1e !important; }' })
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  await style.evaluate((el) => (el as Element).remove())
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect.soft(blocking, `axe violations on ${name}`).toEqual([])
}

async function player(browser: Browser, size: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport: size })
  const page = await ctx.newPage()
  const creds = await signUpAndVerify(page, uniqueUser())
  return { page, name: creds.username }
}

/**
 * Public numbers for `username`: two Elo buckets (FFA 3+2 on the leaderboard, Teams 3+2
 * provisional) and three finished games as England (bots in the other seats). The Elo rows go
 * again at the end of the test (`clearStats`), so other specs see the leaderboards they expect.
 */
async function seedStats(username: string) {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    const [u] = await sql<{ id: string }[]>`select id from users where username = ${username}`
    if (!u) throw new Error('player missing')
    await sql`
      insert into elo_ratings (user_id, mode, time_control, rating, games, peak)
      values (${u.id}, 'ffa', '3+2', 1288, 7, 1301), (${u.id}, 'teams', '3+2', 1190, 2, 1205)`
    const [civ] = await sql<{ id: number }[]>`select id from civilizations where slug = 'england'`
    for (let i = 0; i < 3; i++) {
      const [m] = await sql<{ id: string }[]>`
        insert into matches (mode, time_control, rules_version, status, ended_at)
        values ('ffa', '10+0', 1, 'finished', now()) returning id`
      for (const seat of [0, 1, 2, 3]) {
        await sql`
          insert into match_players (match_id, seat, user_id, bot_level, civ_id, civ_version)
          values (${m?.id ?? ''}, ${seat}, ${seat === 0 ? u.id : null},
                  ${seat === 0 ? null : '1200'}, ${civ?.id ?? 0}, 1)`
      }
    }
  } finally {
    await sql.end()
  }
}

async function clearStats(username: string) {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    await sql`
      delete from elo_ratings where user_id = (select id from users where username = ${username})`
  } finally {
    await sql.end()
  }
}

/** A visible hint or error in the "Add friends" panel (not its screen-reader copy). */
const addHint = (page: Page, text: string) =>
  page.getByTestId('find-players').locator('p:not(.sr-only)', { hasText: text })

async function openFriends(page: Page) {
  await page.goto('/friends')
  await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible()
  await expect(page.getByTestId('find-players')).toBeVisible()
}

/** A searches for B, opens B's profile and the leaderboard link, adds B by username; B accepts. */
async function findAndAdd(A: Page, B: Page, aName: string, bName: string, tag: string) {
  // Search by part of B's name (the random part, in capitals).
  await openFriends(A)
  const part = bName.slice(4).toUpperCase()
  await A.getByTestId('player-search').fill(part.slice(0, 2))
  await expect(addHint(A, 'Type at least 3 characters.')).toBeVisible()
  // No 3 letters or digits in a row: refused before any request.
  await A.getByTestId('player-search').fill('a__')
  await expect(addHint(A, 'Include 3 letters or digits in a row.')).toBeVisible()
  await expect(A.getByTestId('player-search-status')).toHaveText(
    'Include 3 letters or digits in a row.',
  )
  // No results.
  await A.getByTestId('player-search').fill('qzqzqzqx9')
  await expect(A.getByTestId('player-search-empty')).toHaveText('No players found for “qzqzqzqx9”.')
  await expect(A.getByTestId('player-search-status')).toHaveText('No players found for qzqzqzqx9.')
  await shot(A, `${tag}-search-empty`)
  await audit(A, `search, no results (${tag})`)
  // A failed search (rate limited), said in the field and aloud.
  await A.route(/\/api\/players\?q=/, (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many requests.' }),
    }),
  )
  await A.getByTestId('player-search').fill('qzqzqzqx8')
  await expect(addHint(A, 'Too many searches. Wait a moment and try again.')).toBeVisible()
  await expect(A.getByTestId('player-search-status')).toHaveText(
    'Too many searches. Wait a moment and try again.',
  )
  await shot(A, `${tag}-search-error`)
  await audit(A, `search, error (${tag})`)
  await A.unroute(/\/api\/players\?q=/)

  await A.getByTestId('player-search').fill(part)
  const result = A.getByTestId('player-result').filter({ hasText: bName })
  await expect(result).toBeVisible()
  await expect(result.getByTestId('player-result-add')).toHaveAttribute('data-state', 'add')
  await expect(result).toContainText('1288 · Free-for-all 3+2 · 3 games')
  await expect(A.getByTestId('player-search-status')).toHaveText(
    new RegExp(`^\\d+ players? found for ${part}\\.$`),
  )
  await shot(A, `${tag}-friends-search`)
  await audit(A, `friends search (${tag})`)

  // Open B's profile from the result.
  await result.getByTestId('player-result-name').click()
  await expect(A).toHaveURL(new RegExp(`/u/${bName}$`))
  await expect(A.getByTestId('profile-username')).toHaveText(bName)
  await expect(A.getByText(/^Member since /)).toBeVisible()
  await expect(A.getByText('3 games played')).toBeVisible()
  const ratings = A.getByTestId('profile-rating')
  await expect(ratings).toHaveCount(2)
  await expect(ratings.first()).toContainText('1288')
  await expect(ratings.nth(1)).toContainText('provisional')
  await expect(A.getByText(/^Provisional: fewer than \d+ ranked games/)).toBeVisible()
  await expect(A.getByTestId('profile-civ')).toContainText('England')
  await expect(A.getByText('Match history is private', { exact: false })).toBeVisible()
  await expect(A.getByTestId('profile-add')).toHaveAttribute('data-state', 'add')
  await expect(A).toHaveTitle(new RegExp(`^${bName} · `))
  await shot(A, `${tag}-profile`, true)
  await audit(A, `profile (${tag})`)

  // Your own profile.
  await A.goto(`/u/${aName}`)
  await expect(A.getByTestId('profile-username')).toHaveText(aName)
  await expect(A.getByText('This is you')).toBeVisible()
  await expect(A.getByTestId('profile-add')).toHaveCount(0)
  await shot(A, `${tag}-profile-self`, true)
  await audit(A, `own profile (${tag})`)

  // Unknown name: "Player not found" (the same for deleted, suspended and guests).
  await A.goto(`/u/${bName}zz`)
  await expect(A.getByTestId('profile-not-found')).toBeVisible()
  await expect(A).toHaveTitle(/^Player not found · /)
  await shot(A, `${tag}-profile-not-found`)
  await audit(A, `profile not found (${tag})`)

  // The leaderboard links names to profiles.
  await A.goto('/leaderboard?mode=ffa&tc=3%2B2')
  await A.getByTestId('leaderboard-name').filter({ hasText: bName }).click()
  await expect(A.getByTestId('profile-username')).toHaveText(bName)

  // Add B by exact username, in other capitals.
  await openFriends(A)
  await A.getByTestId('add-by-username').fill(bName.toUpperCase())
  await A.getByTestId('add-by-username-send').click()
  await expect(addHint(A, `Friend request sent to ${bName}.`)).toBeVisible()
  await expect(A.getByTestId('add-by-username-status')).toHaveText(
    `Friend request sent to ${bName}.`,
  )
  // The button never went disabled, so keyboard focus stayed on it.
  await expect(A.getByTestId('add-by-username-send')).toBeFocused()
  await expect(A.getByTestId('request-outgoing').filter({ hasText: bName })).toBeVisible()
  await shot(A, `${tag}-friends-request-sent`)

  // B accepts on the Friends page.
  await openFriends(B)
  const incoming = B.getByTestId('request-incoming').filter({ hasText: aName })
  await expect(incoming).toBeVisible()
  await incoming.getByTestId('request-accept').click()
  await expect(B.getByTestId('friend-row').filter({ hasText: aName })).toBeVisible()

  // A sees the friendship, and B's profile now says Friends with a Challenge button.
  const row = A.getByTestId('friend-row').filter({ hasText: bName })
  await expect(row).toBeVisible()
  // With a friend, the list comes before the "Add friends" panel.
  const order = await A.locator(
    '[data-testid="friends-list"], [data-testid="friends-add"]',
  ).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(order).toEqual(['friends-list', 'friends-add'])
  await shot(A, `${tag}-friends-list`, true)
  await row.getByRole('link', { name: bName }).click()
  await expect(A.getByTestId('profile-add')).toHaveAttribute('data-state', 'friends')
  await expect(A.getByTestId('profile-challenge')).toBeVisible()
  await shot(A, `${tag}-profile-friend`, true)
  await audit(A, `friend's profile (${tag})`)
  await A.getByTestId('profile-challenge').click()
  await expect(A.getByTestId('challenge-dialog')).toBeVisible()
  await expect(A.getByTestId('challenge-pick').first()).toBeChecked()
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  const tag = String(size.width)

  test(`friends search: find, open profile, add by username, accept (${tag})`, async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const a = await player(browser, size)
    const b = await player(browser, size)
    const A = a.page
    const B = b.page
    await seedStats(b.name)
    try {
      await findAndAdd(A, B, a.name, b.name, tag)
    } finally {
      await clearStats(b.name)
    }
    for (const p of [A, B]) await p.context().close()
  })

  test(`friends search: "only players I've played with" refuses neutrally (${tag})`, async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const c = await player(browser, size)
    const d = await player(browser, size)
    const C = c.page
    const D = d.page

    // C limits requests to players they played with (saved at once).
    await C.goto('/account')
    const setting = C.getByTestId('friend-request-privacy')
    await setting.scrollIntoViewIfNeeded()
    await expect(C.getByTestId('friend-requests-anyone')).toBeChecked()
    await C.getByTestId('friend-requests-played_with').check()
    await expect(setting.getByText('Saved.')).toBeVisible()
    // Saving doesn't disable the group, so the chosen radio keeps keyboard focus.
    await expect(C.getByTestId('friend-requests-played_with')).toBeFocused()
    await shot(C, `${tag}-account-friend-requests`)
    await audit(C, `account friend requests (${tag})`)
    await C.reload()
    await expect(C.getByTestId('friend-requests-played_with')).toBeChecked()

    // D never played with C: by username, the neutral refusal.
    await openFriends(D)
    await D.getByTestId('add-by-username').fill(c.name)
    await D.getByTestId('add-by-username-send').click()
    await expect(addHint(D, 'We couldn’t send that request.')).toBeVisible()
    await expect(D.getByTestId('add-by-username-status')).toHaveText(
      'We couldn’t send that request.',
    )
    // Focus goes back to the field, which reads out with the error attached.
    await expect(D.getByTestId('add-by-username')).toBeFocused()
    // An unknown username reads exactly the same (sent with Enter this time).
    await D.getByTestId('add-by-username').fill(`${c.name}x`)
    await D.getByTestId('add-by-username').press('Enter')
    await expect(addHint(D, 'We couldn’t send that request.')).toBeVisible()
    await expect(D.getByTestId('add-by-username-status')).toHaveText(
      'We couldn’t send that request.',
    )

    // Search still offers "Add friend" (nothing reveals the setting); it refuses the same way.
    await D.getByTestId('player-search').fill(c.name)
    const result = D.getByTestId('player-result').filter({ hasText: c.name })
    await expect(result.getByTestId('player-result-add')).toHaveAttribute('data-state', 'add')
    await result.getByTestId('player-result-add').click()
    await expect(result.getByText('We couldn’t send that request.')).toBeVisible()
    await expect(result.getByTestId('player-result-add')).toBeFocused()
    await expect(D.getByTestId('request-outgoing')).toHaveCount(0)

    // D blocks C from C's profile: the profile says so, and search no longer lists C.
    await D.goto(`/u/${c.name}`)
    await expect(D.getByTestId('profile-username')).toHaveText(c.name)
    await D.getByTestId('profile-menu').click()
    await D.getByTestId('player-menu').getByTestId('menu-block').click()
    await expect(D.getByTestId('block-dialog')).toContainText(`Block ${c.name}?`)
    await D.getByTestId('block-confirm').click()
    await expect(D.getByText('You blocked this player.', { exact: false })).toBeVisible()
    await expect(D.getByTestId('profile-add')).toHaveCount(0)
    await shot(D, `${tag}-profile-blocked`, true)
    await audit(D, `blocked profile (${tag})`)
    await openFriends(D)
    await D.getByTestId('player-search').fill(c.name)
    await expect(D.getByTestId('player-search-status')).toHaveText(
      new RegExp(`found for ${c.name}\\.$`),
    )
    await expect(D.getByTestId('player-result').filter({ hasText: c.name })).toHaveCount(0)
    for (const p of [C, D]) await p.context().close()
  })
}
