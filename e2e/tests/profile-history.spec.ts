/**
 * Opt-in public match history: a player's recent games stay off their profile until they
 * turn on "Show my recent games on my profile" on the Account page (saved at once). Then a
 * second account sees them on the public profile: result and civ, the game line, other
 * players (registered names link to their profiles, bots don't), the Elo change of a ranked
 * game, and a replay link only on the game the viewer played in. Turning it off hides them
 * again. axe scans the setting and the profile; the phone layout must not scroll sideways.
 * With UX_SHOTS set it saves screenshots of the setting and the profile.
 */
import { AxeBuilder } from '@axe-core/playwright'
import { type Browser, expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import { signUpAndVerify, solidBackdropForAxe, uniqueUser } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''

async function shot(page: Page, name: string, fullPage = false) {
  if (!OUT) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

/** axe-core WCAG A/AA scan (as in ui-a11y.spec): serious or critical violations fail. */
async function audit(page: Page, name: string) {
  await page.waitForTimeout(600)
  const restore = await solidBackdropForAxe(page)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  await restore()
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect.soft(blocking, `axe violations on ${name}`).toEqual([])
}

async function player(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const creds = await signUpAndVerify(page, uniqueUser())
  return { page, name: creds.username }
}

/**
 * Two finished games for `owner`: a ranked free-for-all against bots an hour ago (won, +16
 * Elo), then a casual one with `viewer` in seat 1 (owner 2nd). Returns the shared game's id.
 */
async function seedGames(owner: string, viewer: string): Promise<string> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    const ids = await sql<{ id: string; username: string }[]>`
      select id, username from users where username in (${owner}, ${viewer})`
    const o = ids.find((u) => u.username === owner)?.id
    const v = ids.find((u) => u.username === viewer)?.id
    if (!o || !v) throw new Error('players missing')
    const civs = await sql<{ id: number; slug: string }[]>`
      select id, slug from civilizations where slug in ('england', 'japan', 'mali')`
    const civ = (slug: string) => civs.find((c) => c.slug === slug)?.id ?? 0

    const [ranked] = await sql<{ id: string }[]>`
      insert into matches (mode, time_control, rules_version, status, ranked, rated,
                           started_at, ended_at, end_reason)
      values ('ffa', '3+2', 3, 'finished', true, true,
              now() - interval '70 minutes', now() - interval '60 minutes', 'checkmate')
      returning id`
    const [shared] = await sql<{ id: string }[]>`
      insert into matches (mode, time_control, rules_version, status, started_at, ended_at,
                           end_reason)
      values ('ffa', '10+0', 3, 'finished', now() - interval '20 minutes',
              now() - interval '5 minutes', 'checkmate')
      returning id`
    if (!ranked || !shared) throw new Error('fixture failed')
    for (const seat of [0, 1, 2, 3]) {
      await sql`
        insert into match_players (match_id, seat, user_id, bot_level, civ_id, civ_version,
                                   placement, rating_before, rating_after)
        values (${ranked.id}, ${seat}, ${seat === 0 ? o : null}, ${seat === 0 ? null : '1200'},
                ${civ(seat === 0 ? 'england' : 'japan')}, 1, ${seat + 1},
                ${seat === 0 ? 1200 : null}, ${seat === 0 ? 1216 : null})`
    }
    const sharedSeats = [v, o, null, null]
    for (const seat of [0, 1, 2, 3]) {
      const user = sharedSeats[seat] ?? null
      await sql`
        insert into match_players (match_id, seat, user_id, bot_level, civ_id, civ_version,
                                   placement)
        values (${shared.id}, ${seat}, ${user}, ${user ? null : '1200'},
                ${civ(seat === 1 ? 'mali' : 'japan')}, 1, ${seat + 1})`
    }
    return shared.id
  } finally {
    await sql.end()
  }
}

test('profile history: opt in on Account, another player sees the recent games', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const owner = await player(browser)
  const viewer = await player(browser)
  const O = owner.page
  const V = viewer.page
  const sharedId = await seedGames(owner.name, viewer.name)

  // Off by default: the viewer sees the private note, no games.
  await V.goto(`/u/${owner.name}`)
  await expect(V.getByTestId('profile-username')).toHaveText(owner.name)
  await expect(V.getByTestId('profile-history-private')).toContainText('Match history is private')
  await expect(V.getByTestId('profile-games')).toHaveCount(0)

  // The owner's own profile points to the setting.
  await O.goto(`/u/${owner.name}`)
  await expect(O.getByTestId('profile-history-private')).toContainText('Account page')

  // The owner turns it on (saved at once, kept after a reload).
  // The page re-renders its sections while the settings load: wait for the switch to be
  // ready before touching it, and use locators (they retry) rather than element handles.
  await O.goto('/account')
  const setting = O.getByTestId('history-privacy')
  const toggle = O.getByRole('switch', { name: 'Show my recent games on my profile' })
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()
  await setting.getByText('Show my recent games on my profile').click()
  await expect(setting.getByText('Saved.')).toBeVisible()
  await expect(toggle).toBeChecked()
  await shot(O, 'history-account-setting')
  await audit(O, 'account recent games setting')
  await O.reload()
  await expect(O.getByTestId('public-history-toggle')).toBeChecked()
  // The friend-request setting next to it kept its value.
  await expect(O.getByTestId('friend-requests-anyone')).toBeChecked()

  // The viewer now sees both games, newest first.
  await V.reload()
  const games = V.getByTestId('profile-game')
  await expect(games).toHaveCount(2)
  await expect(V.getByTestId('profile-history-private')).toHaveCount(0)

  const shared = games.nth(0)
  await expect(shared).toContainText('2nd place')
  await expect(shared).toContainText('Mali')
  await expect(shared).toContainText('Free-for-all, 10+0, casual')
  const viewerLink = shared.getByRole('link', { name: viewer.name })
  await expect(viewerLink).toHaveAttribute('href', `/u/${viewer.name}`)
  await expect(
    shared.getByTestId('profile-game-player').filter({ hasText: 'Bot 1200' }),
  ).toHaveCount(2)
  await expect(shared.getByRole('link', { name: 'Bot 1200' })).toHaveCount(0)
  // The viewer played in this one: a link to their own replay, named after the game.
  await expect(shared.getByRole('link', { name: /^Replay, 2nd place as Mali, / })).toBeVisible()
  await expect(shared.getByTestId('profile-game-replay')).toHaveAttribute(
    'href',
    `/history/${sharedId}`,
  )

  const ranked = games.nth(1)
  await expect(ranked).toContainText('Victory')
  await expect(ranked).toContainText('England')
  await expect(ranked.getByTestId('ranked-badge')).toBeVisible()
  await expect(ranked.getByTestId('profile-game-elo')).toContainText('+16')
  // Not the viewer's game: no replay link.
  await expect(ranked.getByTestId('profile-game-replay')).toHaveCount(0)
  await shot(V, 'history-profile', true)
  await audit(V, 'profile with recent games')

  // Phone width: the rows wrap, nothing scrolls sideways.
  await V.setViewportSize({ width: 390, height: 844 })
  await expect(games.first()).toBeVisible()
  const overflow = await V.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await shot(V, 'history-profile-phone', true)

  // The owner turns it off again: gone at once.
  await O.getByTestId('history-privacy').getByText('Show my recent games on my profile').click()
  await expect(O.getByTestId('history-privacy').getByText('Saved.')).toBeVisible()
  await V.reload()
  await expect(V.getByTestId('profile-history-private')).toBeVisible()
  await expect(V.getByTestId('profile-game')).toHaveCount(0)

  for (const p of [O, V]) await p.context().close()
})
