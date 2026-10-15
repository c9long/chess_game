import { readFile } from 'node:fs/promises'
import { createDb } from '@game/db'
import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { reapplyDeletionLog } from '../../apps/server/src/account/anonymize.ts'
import { E2E_DATABASE_URL } from '../env.ts'
import { signInWithPassword, signUpAndVerify } from './helpers.ts'

test('account export download and deletion (history re-keyed, stays deleted after a restore)', async ({
  page,
}) => {
  const creds = await signUpAndVerify(page)
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    // A finished game against a bot, so deletion has real history to de-identify.
    const me = await (await page.request.get('/api/auth/get-session')).json()
    const userId = me.user.id as string
    const [match] = await sql`
      insert into matches (mode, time_control, rules_version, status)
      values ('ffa', '3+2', 1, 'finished') returning id`
    await sql`
      insert into match_players (match_id, seat, user_id, civ_id, civ_version, placement)
      select ${match?.id}, 0, ${userId}, id, 1, 1 from civilizations where slug = 'france'`
    await sql`
      insert into match_players (match_id, seat, bot_level, civ_id, civ_version, placement)
      select ${match?.id}, 1, '1200', id, 1, 2 from civilizations where slug = 'mali'`

    await page.getByTestId('nav-account').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-data').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^account-export-\d{4}-\d{2}-\d{2}\.json$/)
    const data = JSON.parse(await readFile((await download.path()) as string, 'utf8'))
    expect(data.profile).toMatchObject({
      username: creds.username,
      email: creds.email,
      isGuest: false,
      ageBand: '18+',
    })
    expect(
      data.legalAcceptances
        .map((a: { document: string; kind: string }) => `${a.document}:${a.kind}`)
        .sort(),
    ).toEqual(['privacy:acknowledged', 'terms:accepted'])
    expect(data.matchHistory.map((m: { matchId: string }) => m.matchId)).toEqual([match?.id])

    const danger = page.getByTestId('delete-account')
    await danger.getByTestId('delete-open').click()
    await expect(danger.getByTestId('delete-submit')).toBeDisabled()
    await danger.getByTestId('delete-confirm').fill('DELETE')
    await danger.getByTestId('delete-submit').click()
    await expect(page.getByText('Your account has been deleted.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Play as Guest' })).toBeVisible()

    // The account row is gone (credentials cascade) and the deletion is logged.
    expect(await sql`select 1 from users where id = ${userId}`).toHaveLength(0)
    expect(await sql`select 1 from accounts where user_id = ${userId}`).toHaveLength(0)
    const log = await sql`select id from deletion_log where user_id = ${userId}`
    expect(log).toHaveLength(1)
    // The game is still there for the other seat, re-keyed to a "Deleted player" placeholder
    // whose id deletion_log never stores.
    const seats = await sql`
      select mp.user_id, u.name from match_players mp left join users u on u.id = mp.user_id
      where mp.match_id = ${match?.id} order by mp.seat`
    expect(seats).toHaveLength(2)
    const placeholderId = seats[0]?.user_id as string
    expect(placeholderId).not.toBe(userId)
    expect(seats[0]?.name).toMatch(/^Deleted player #\d+$/)
    expect(await sql`select 1 from deletion_log where user_id = ${placeholderId}`).toHaveLength(0)

    // The old credentials no longer work.
    await signInWithPassword(page, creds.email, creds.password)
    await expect(page.getByRole('alert')).toContainText('did not match')

    // Test restore: a backup brings the account row back; re-applying deletion_log removes it.
    await sql`
      insert into users (id, name, email, email_verified, username, display_username)
      values (${userId}, ${creds.username}, ${creds.email}, true, ${creds.username.toLowerCase()}, ${creds.username})`
    const { db, close } = createDb(E2E_DATABASE_URL, { max: 1 })
    try {
      expect(await reapplyDeletionLog(db)).toContain(userId)
    } finally {
      await close()
    }
    expect(await sql`select 1 from users where id = ${userId}`).toHaveLength(0)
  } finally {
    await sql.end()
  }
})
