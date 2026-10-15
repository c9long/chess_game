import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import { latestMailLink, passAgeScreen, uniqueUser } from './helpers.ts'

test('guest → upgrade to an email account → old match still in history', async ({ page }) => {
  await page.goto('/')
  await passAgeScreen(page)
  await page.getByRole('link', { name: 'Play as Guest' }).click()
  await page.getByTestId('clickwrap-checkbox').check()
  await expect(page.getByTestId('guest-continue')).toBeEnabled()
  await page.getByTestId('guest-continue').click()
  await expect(page.getByTestId('display-name')).toHaveText(/^Guest-\d{4}$/)

  // Stand-in for a finished casual game (lobbies arrive in M4).
  const session = await (await page.request.get('/api/auth/get-session')).json()
  const guestId = session.user.id as string
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    const [match] = await sql`
      insert into matches (mode, time_control, rules_version, status)
      values ('ffa', '10+0', 1, 'finished') returning id`
    await sql`
      insert into match_players (match_id, seat, user_id, civ_id, civ_version, placement)
      select ${match?.id}, 0, ${guestId}, id, 1, 1 from civilizations where slug = 'canada'`

    const creds = uniqueUser()
    await page.getByRole('link', { name: 'Create account and keep your history' }).click()
    await expect(page.getByText('Your guest games will move to your new account')).toBeVisible()
    await page.getByLabel('Email').fill(creds.email)
    await page.getByLabel('Username').fill(creds.username)
    await page.getByLabel('Password').fill(creds.password)
    await page.getByTestId('clickwrap-checkbox').check()
    const submit = page.getByRole('button', { name: 'Create account' })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

    await page.goto(await latestMailLink(page.request, creds.email, 'verify-email'))
    await page.getByTestId('verified-continue').click()
    await expect(page.getByTestId('display-name')).toHaveText(creds.username)

    const after = await (await page.request.get('/api/auth/get-session')).json()
    expect(after.user.id).not.toBe(guestId)
    const rows = await sql`select user_id from match_players where match_id = ${match?.id}`
    expect(rows.map((r) => r.user_id)).toEqual([after.user.id])
    expect(await sql`select 1 from users where id = ${guestId}`).toHaveLength(0)

    const exported = await (await page.request.get('/api/account/export')).json()
    expect(exported.matchHistory.map((m: { matchId: string }) => m.matchId)).toEqual([match?.id])
  } finally {
    await sql.end()
  }
})
