import { expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import { latestMailLink, passAgeScreen, signInWithPassword, uniqueUser } from './helpers.ts'

async function startGuest(page: Page) {
  await page.goto('/')
  await passAgeScreen(page)
  await page.getByRole('link', { name: 'Play as Guest' }).click()
  await page.getByTestId('clickwrap-checkbox').check()
  await expect(page.getByTestId('guest-continue')).toBeEnabled()
  await page.getByTestId('guest-continue').click()
  await expect(page.getByTestId('display-name')).toHaveText(/^Guest-/)
  return (await (await page.request.get('/api/auth/get-session')).json()).user.id as string
}

async function fakeMatch(sql: postgres.Sql, userId: string) {
  const [match] = await sql`insert into matches (mode, time_control, rules_version, status)
    values ('ffa', '10+0', 1, 'finished') returning id`
  await sql`insert into match_players (match_id, seat, user_id, civ_id, civ_version, placement)
    select ${match?.id}, 0, ${userId}, id, 1, 1 from civilizations where slug = 'mali'`
  return match?.id as string
}

test('guest upgrade when the verification link is opened in another browser', async ({
  page,
  browser,
}) => {
  const guestId = await startGuest(page)
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    const matchId = await fakeMatch(sql, guestId)
    const creds = uniqueUser()
    await page.getByRole('link', { name: 'Create account and keep your history' }).click()
    await page.getByLabel('Email').fill(creds.email)
    await page.getByLabel('Username').fill(creds.username)
    await page.getByLabel('Password').fill(creds.password)
    await page.getByTestId('clickwrap-checkbox').check()
    const submit = page.getByRole('button', { name: 'Create account' })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

    // The email is opened on another device: the address is verified and the guest's games
    // move to the new account, but that other browser is not signed in by the link.
    const other = await browser.newContext()
    const p2 = await other.newPage()
    await p2.goto(await latestMailLink(page.request, creds.email, 'verify-email'))
    await expect(p2.getByRole('heading', { name: 'Email verified' })).toBeVisible()
    await expect(p2.getByTestId('verified-sign-in')).toBeVisible()
    const [newUser] = await sql`select id from users where username = ${creds.username}`
    const owner = await sql`select user_id from match_players where match_id = ${matchId}`
    expect(owner.map((r) => r.user_id)).toEqual([newUser?.id])
    expect(await sql`select 1 from users where id = ${guestId}`).toHaveLength(0)

    // The player signs in on the other device and sees their history.
    await p2.goto('/')
    await passAgeScreen(p2)
    await signInWithPassword(p2, creds.username, creds.password)
    await expect(p2.getByTestId('display-name')).toHaveText(creds.username)
    const exported = await (await p2.request.get('/api/account/export')).json()
    expect(exported.matchHistory.map((m: { matchId: string }) => m.matchId)).toEqual([matchId])
    await other.close()
  } finally {
    await sql.end()
  }
})

test("a guest who opens someone else's verification link keeps their games and session", async ({
  page,
  browser,
}) => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    // Attacker signs up in their own browser and leaves the address unverified.
    const attackerCtx = await browser.newContext()
    const attacker = await attackerCtx.newPage()
    await attacker.goto('/')
    await passAgeScreen(attacker)
    const evil = uniqueUser()
    await attacker.goto('/sign-up')
    await attacker.getByLabel('Email').fill(evil.email)
    await attacker.getByLabel('Username').fill(evil.username)
    await attacker.getByLabel('Password').fill(evil.password)
    await attacker.getByTestId('clickwrap-checkbox').check()
    await expect(attacker.getByRole('button', { name: 'Create account' })).toBeEnabled()
    await attacker.getByRole('button', { name: 'Create account' }).click()
    await expect(attacker.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    const link = await latestMailLink(attacker.request, evil.email, 'verify-email')
    await attackerCtx.close()

    // The victim, playing as a guest with a game, opens that link.
    const guestId = await startGuest(page)
    const matchId = await fakeMatch(sql, guestId)
    await page.goto(link)
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
    const owner = await sql`select user_id from match_players where match_id = ${matchId}`
    expect(owner.map((r) => r.user_id)).toEqual([guestId])
    const session = await (await page.request.get('/api/auth/get-session')).json()
    expect(session.user.id).toBe(guestId)
    await page.goto('/')
    await expect(page.getByTestId('display-name')).toHaveText(/^Guest-/)
  } finally {
    await sql.end()
  }
})
