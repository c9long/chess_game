/**
 * Moderation, end to end: two registered players finish a short Teams game with two bots. A
 * reports B from the result screen, then blocks B from the Friends page (B had sent a friend
 * request), and an admin suspends B from the review queue: B is signed out and can't sign in
 * again. With UX_SHOTS set it also runs at phone width and saves screenshots there.
 */
import { type Browser, expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_ADMIN_USER_ID, E2E_DATABASE_URL } from '../env.ts'
import { chooseCiv, signInWithPassword, signUpAndVerify, uniqueUser, YOUR_TURN } from './helpers.ts'

const OUT = process.env.UX_SHOTS ?? ''
const ADMIN_EMAIL = 'e2e-admin@example.test'

async function shot(page: Page, name: string, fullPage = false) {
  if (!OUT) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

async function player(browser: Browser, size: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport: size })
  const page = await ctx.newPage()
  const creds = await signUpAndVerify(page, uniqueUser())
  return { page, creds, name: creds.username }
}

/**
 * The admin account: the E2E API treats E2E_ADMIN_USER_ID as an admin (ADMIN_USER_IDS), so the
 * account is inserted with that id, borrowing a real player's password hash (every E2E account
 * shares one password) and legal acceptances.
 */
async function ensureAdmin(fromUsername: string) {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    const [src] = await sql<{ id: string }[]>`select id from users where username = ${fromUsername}`
    if (!src) throw new Error('source account missing')
    await sql`
      insert into users (id, name, email, email_verified, username, display_username,
                         age_confirmed, age_band, age_confirmed_at, created_at, updated_at)
      values (${E2E_ADMIN_USER_ID}, 'e2e_mod', ${ADMIN_EMAIL}, true, 'e2e_mod', 'e2e_mod',
              true, '18+', now(), now(), now())
      on conflict (id) do nothing`
    await sql`
      insert into accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
      select 'e2e-admin-credential', ${E2E_ADMIN_USER_ID}, 'credential', ${E2E_ADMIN_USER_ID},
             password, now(), now()
      from accounts where user_id = ${src.id} and provider_id = 'credential'
      on conflict (id) do nothing`
    await sql`
      insert into legal_acceptances (user_id, document, version, kind, accepted_at)
      select ${E2E_ADMIN_USER_ID}, document, version, kind, now()
      from legal_acceptances l where user_id = ${src.id}
        and not exists (select 1 from legal_acceptances x
                        where x.user_id = ${E2E_ADMIN_USER_ID} and x.document = l.document
                          and x.version = l.version)`
  } finally {
    await sql.end()
  }
}

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

  test(`moderation: report, block, suspend (${tag})`, async ({ browser }) => {
    test.skip(phone && !OUT, 'phone width runs with UX_SHOTS only')
    test.setTimeout(240_000)
    const a = await player(browser, size)
    const b = await player(browser, size)
    const A = a.page
    const B = b.page

    // A Teams game: A (South) and B (North) against two bots.
    const lobbyName = `Moderation ${tag}`
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

    // Live game: B's player card has the menu (bots have none).
    const cardMenu = A.getByTestId('card-menu-north')
    await expect(cardMenu).toBeVisible()
    await expect(A.getByTestId('card-menu-west')).toHaveCount(0)
    await cardMenu.click()
    const menu = A.getByTestId('player-menu')
    await expect(menu.getByTestId('menu-block')).toBeVisible()
    await expect(menu.getByTestId('menu-report')).toBeVisible()
    await shot(A, `${tag}-mod-card-menu`)
    await A.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // The team resigns together: the game ends at once.
    await A.getByTestId('resign').click()
    await A.getByTestId('resign-confirm').click()
    await B.getByTestId('team-resign-accept').click()
    await expect(A.getByTestId('placement-north')).toBeVisible({ timeout: 20_000 })

    // Result screen: Escape in the menu or the report dialog closes only that layer, and Tab
    // moves through the dialog (the result screen's own focus trap leaves it alone).
    const backToLobbies = A.getByTestId('back-to-lobbies')
    await A.getByTestId('result-menu-north').click()
    await expect(A.getByTestId('player-menu')).toBeVisible()
    await A.keyboard.press('Escape')
    await expect(A.getByTestId('player-menu')).toHaveCount(0)
    await expect(backToLobbies).toBeVisible()
    await A.getByTestId('result-menu-north').click()
    await A.getByTestId('player-menu').getByTestId('menu-report').click()
    const report = A.getByTestId('report-dialog')
    await expect(report).toBeVisible()
    await A.getByTestId('report-reason-offensive_username').focus()
    await A.keyboard.press('Tab')
    await expect(report.getByTestId('report-note')).toBeFocused()
    await A.keyboard.press('Escape')
    await expect(report).toHaveCount(0)
    await expect(backToLobbies).toBeVisible()

    // A reports B.
    await A.getByTestId('result-menu-north').click()
    await shot(A, `${tag}-mod-result-menu`)
    await A.getByTestId('player-menu').getByTestId('menu-report').click()
    await expect(report).toBeVisible()
    await expect(report).toContainText(`Report ${b.name}`)
    await report.getByTestId('report-send').click()
    await expect(report.getByRole('alert')).toContainText('Choose a reason')
    await report.getByTestId('report-reason-offensive_username').check()
    await report.getByTestId('report-note').fill('Their name is a slur in another language.')
    await shot(A, `${tag}-mod-report-dialog`)
    await report.getByTestId('report-send').click()
    const sent = A.getByTestId('report-sent')
    await expect(sent).toContainText('Report sent')
    await sent.getByTestId('report-done').click()
    await expect(sent).toHaveCount(0)
    // The menu now says "Reported" instead of offering a form the server would refuse.
    await A.getByTestId('result-menu-north').click()
    await expect(A.getByTestId('player-menu').getByTestId('menu-reported')).toBeVisible()
    await expect(A.getByTestId('player-menu').getByTestId('menu-report')).toHaveCount(0)
    await A.keyboard.press('Escape')
    await expect(backToLobbies).toBeVisible()

    // B asks A to be friends from their result screen.
    const add = B.getByTestId('result-friend-south')
    await add.click()
    await expect(add).toHaveAttribute('data-state', 'sent')
    await B.getByTestId('back-to-lobbies').click()
    await A.getByTestId('back-to-lobbies').click()

    // Match history rows have the same menu.
    await A.goto('/history')
    const historyMenu = A.getByTestId('history-menu').first()
    await expect(historyMenu).toBeVisible()
    await historyMenu.click()
    await expect(A.getByTestId('player-menu').getByTestId('menu-block')).toBeVisible()
    await shot(A, `${tag}-mod-history-menu`)
    await A.keyboard.press('Escape')

    // Friends page: A blocks B from the request row.
    await openFriends(A, phone)
    const req = A.getByTestId('request-incoming').filter({ hasText: b.name })
    await expect(req).toBeVisible()
    await req.getByTestId('request-menu').click()
    await shot(A, `${tag}-mod-request-menu`)
    await A.getByTestId('player-menu').getByTestId('menu-block').click()
    const blockDialog = A.getByTestId('block-dialog')
    await expect(blockDialog).toContainText(`Block ${b.name}?`)
    await shot(A, `${tag}-mod-block-dialog`)
    await A.getByTestId('block-confirm').click()
    await expect(A.getByTestId('request-incoming')).toHaveCount(0)
    const blocked = A.getByTestId('friends-blocked')
    await expect(blocked.getByTestId('blocked-row')).toContainText(b.name)
    // The row is gone, but focus stays on the page instead of falling to <body>.
    await expect
      .poll(() => A.evaluate(() => document.activeElement?.tagName ?? 'BODY'))
      .not.toBe('BODY')
    await shot(A, `${tag}-mod-friends-blocked`, true)

    // B's request is gone too, without saying why.
    await openFriends(B, phone)
    await expect(B.getByTestId('request-outgoing')).toHaveCount(0)
    await expect(B.getByTestId('friends-blocked')).toHaveCount(0)

    // A player who isn't an admin can't open the review queue.
    await A.goto('/admin/reports')
    await expect(A.getByTestId('admin-denied')).toBeVisible()

    // The admin suspends B from the queue.
    await ensureAdmin(a.name)
    const adminCtx = await browser.newContext({ viewport: size })
    const M = await adminCtx.newPage()
    await signInWithPassword(M, ADMIN_EMAIL, a.creds.password)
    await expect(M.getByTestId('display-name')).toHaveText('e2e_mod')
    await M.goto('/admin/reports')
    await expect(M.getByRole('heading', { name: 'Review queue' })).toBeVisible()
    const item = M.getByTestId('admin-report').filter({ hasText: b.name })
    await expect(item).toContainText('Offensive username')
    await expect(item).toContainText('Their name is a slur in another language.')
    await expect(item).toContainText(`by ${a.name}`)
    await shot(M, `${tag}-mod-admin-queue`, true)
    await item.getByTestId('admin-suspend').click()
    await expect(M.getByTestId('admin-confirm-dialog')).toContainText(`Suspend ${b.name}?`)
    await M.getByTestId('admin-confirm').click()
    await expect(M.getByTestId('admin-report').filter({ hasText: b.name })).toHaveCount(0)
    await expect(M.getByTestId('suspended-row').filter({ hasText: b.name })).toBeVisible()
    await shot(M, `${tag}-mod-admin-suspended`, true)

    // B is signed out, and signing in is refused.
    await B.reload()
    await expect(B.getByRole('heading', { name: 'Friends', exact: true })).toHaveCount(0)
    await signInWithPassword(B, b.name, b.creds.password)
    await expect(B.getByText('This account has been suspended.')).toBeVisible()
    await expect(B.getByTestId('suspended-help')).toContainText('Appeals')
    await shot(B, `${tag}-mod-suspended-sign-in`)

    // Lifting the suspension lets B back in.
    await M.getByTestId('suspended-row')
      .filter({ hasText: b.name })
      .getByTestId('admin-unsuspend')
      .click()
    await expect(M.getByTestId('suspended-row').filter({ hasText: b.name })).toHaveCount(0)
    await signInWithPassword(B, b.name, b.creds.password)
    // Back where the sign-in started (the Friends page), signed in.
    await expect(B.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible()

    await adminCtx.close()
    await A.context().close()
    await B.context().close()
  })
}
