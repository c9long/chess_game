import { AxeBuilder } from '@axe-core/playwright'
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL, E2E_WEB_ORIGIN } from '../env.ts'
import { signUpAndVerify, totpFrom } from './helpers.ts'

/**
 * Account security: backup codes left in the two-step section, and confirming it's you with
 * a two-step code or a passkey when deleting an account from a session older than a day.
 * Set E2E_SCREENSHOTS=<dir> to save screenshots of each state at 1280 and 390 px.
 */

const SHOTS = process.env.E2E_SCREENSHOTS

async function shoot(page: Page, target: Locator, name: string) {
  if (!SHOTS) return
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await target.scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
    await target.screenshot({ path: `${SHOTS}/${name}-${width}.png` })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
}

async function audit(page: Page, selector: string, name: string) {
  await page.waitForTimeout(300)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include(selector)
    .analyze()
  const report = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect.soft(report, `axe violations on ${name}`).toEqual([])
}

async function sqlRun<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    return await fn(sql)
  } finally {
    await sql.end()
  }
}

/** Ages this browser's session past the one-day window for deleting without a step-up. */
async function makeSessionStale(username: string) {
  await sqlRun(
    (sql) => sql`update sessions set created_at = now() - interval '26 hours'
      where user_id = (select id from users where username = ${username})`,
  )
}

async function virtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

test('backup codes left, low-codes prompt, and deleting with a TOTP step-up', async ({ page }) => {
  const creds = await signUpAndVerify(page)
  await page.getByTestId('nav-account').click()
  const tf = page.getByTestId('two-factor')
  await tf.getByTestId('two-factor-password').fill(creds.password)
  await tf.getByTestId('two-factor-start').click()
  const secret = (await tf.getByTestId('totp-secret').textContent())?.trim() ?? ''
  const backup = await tf.getByTestId('backup-codes').locator('li').allInnerTexts()
  const totp = totpFrom(secret)
  await tf.getByTestId('totp-confirm-code').fill(totp.generate())
  await tf.getByRole('button', { name: 'Turn on' }).click()
  await expect(tf.getByTestId('two-factor-status')).toContainText('On')

  const left = tf.getByTestId('backup-codes-left')
  await expect(left).toHaveText(/10 of 10 backup codes left/)
  await expect(left).not.toHaveAttribute('data-low', 'true')
  await audit(page, '[data-testid="two-factor"]', 'two-step section')
  await shoot(page, tf, 'two-step-codes-left')

  // Use up 8 codes (verifying a backup code from a signed-in session just spends it).
  for (const code of backup.slice(0, 8)) {
    const r = await page.request.post('/api/auth/two-factor/verify-backup-code', {
      data: { code, disableSession: true },
      headers: { origin: E2E_WEB_ORIGIN },
    })
    expect(r.status()).toBe(200)
  }
  await page.reload()
  await expect(left).toHaveAttribute('data-low', 'true')
  await expect(left).toContainText('2 of 10 backup codes left')
  await expect(left.getByRole('status')).toBeVisible()
  await audit(page, '[data-testid="two-factor"]', 'two-step section, low codes')
  await shoot(page, tf, 'two-step-codes-low')

  // The prompt asks for the password first, then creates a fresh set.
  const prompt = left.getByTestId('backup-codes-low-regenerate')
  await expect(prompt).toHaveText('Enter password')
  await prompt.click()
  await expect(tf.getByTestId('two-factor-password')).toBeFocused()
  await tf.getByTestId('two-factor-password').fill(creds.password)
  await expect(prompt).toHaveText('Create new codes')
  await prompt.click()
  await expect(tf.getByTestId('backup-codes').locator('li')).toHaveCount(10)
  await expect(left).toHaveText(/10 of 10 backup codes left/)
  await expect(prompt).toHaveCount(0)

  // Codes the server can't read: the count is unknown, which isn't "none left".
  await sqlRun(
    (sql) => sql`update two_factor set backup_codes = 'unreadable'
      where user_id = (select id from users where username = ${creds.username})`,
  )
  await page.reload()
  await expect(left).toHaveAttribute('data-unknown', 'true')
  await expect(left).toContainText('couldn’t check how many backup codes')
  await expect(left).not.toContainText('No backup codes left')
  await shoot(page, tf, 'two-step-codes-unknown')

  // A day-old session: deleting asks to confirm it's you, with the methods this account has.
  await makeSessionStale(creds.username)
  await page.reload()
  const danger = page.getByTestId('delete-account')
  await danger.getByTestId('delete-open').click()
  await danger.getByTestId('delete-confirm').fill('DELETE')
  await danger.getByTestId('delete-submit').click()
  const stepUp = danger.getByTestId('delete-step-up')
  await expect(stepUp).toBeVisible()
  await expect(stepUp).toContainText('signed in more than a day ago')
  await expect(danger.getByRole('alert')).toHaveCount(0)
  // Not an error, but announced, and keyboard focus moves into the new choice.
  await expect(danger.getByTestId('delete-announcement')).toContainText('Confirm it’s you')
  await expect(stepUp.getByRole('radio')).toHaveCount(2)
  await expect(stepUp.getByRole('radio', { name: 'Password' })).toBeChecked()
  await expect(stepUp.getByRole('radio', { name: 'Password' })).toBeFocused()
  await expect(danger.getByTestId('delete-submit')).toBeDisabled()
  await audit(page, '[data-testid="delete-account"]', 'delete step-up')
  await shoot(page, danger, 'delete-step-up-password')
  // Arrow keys move between methods, with the shared focus ring on the chosen pill.
  await stepUp.getByRole('radio', { name: 'Password' }).press('ArrowRight')
  await expect(stepUp.getByRole('radio', { name: 'Authenticator app' })).toBeFocused()
  await shoot(page, danger, 'delete-step-up-radio-focus')

  await stepUp.getByText('Authenticator app', { exact: true }).click()
  await expect(stepUp.getByRole('radio', { name: 'Authenticator app' })).toBeChecked()
  await expect(stepUp.getByLabel('Code from your authenticator app')).toBeVisible()
  const toggleBox = await stepUp.getByTestId('delete-use-backup').boundingBox()
  expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(24)
  await stepUp.getByTestId('delete-use-backup').click()
  await expect(stepUp.getByLabel('Backup code')).toBeVisible()
  await shoot(page, danger, 'delete-step-up-backup')
  await stepUp.getByTestId('delete-use-backup').click()
  await shoot(page, danger, 'delete-step-up-totp')

  // Enter submits; a wrong code puts focus back on the field.
  await stepUp.getByTestId('delete-code').fill('000000')
  await stepUp.getByTestId('delete-code').press('Enter')
  await expect(danger.getByRole('alert')).toContainText('That code didn’t work')
  await expect(stepUp.getByTestId('delete-code')).toBeFocused()

  // Cancel, then open again: nothing typed or kept, no old error, and not armed.
  await danger.getByTestId('delete-cancel').click()
  await expect(danger.getByTestId('delete-open')).toBeFocused()
  await danger.getByTestId('delete-open').click()
  await expect(danger.getByTestId('delete-confirm')).toHaveValue('')
  await expect(danger.getByRole('alert')).toHaveCount(0)
  await expect(stepUp.getByTestId('delete-code')).toHaveValue('')
  await expect(danger.getByTestId('delete-submit')).toBeDisabled()

  await danger.getByTestId('delete-confirm').fill('DELETE')
  await stepUp.getByTestId('delete-code').fill(totp.generate())
  await stepUp.getByTestId('delete-code').press('Enter')
  await expect(page.getByText('Your account has been deleted.')).toBeVisible()
  expect(
    await sqlRun((sql) => sql`select 1 from users where username = ${creds.username}`),
  ).toHaveLength(0)
})

test('deleting a passkey-only account from a stale session with a passkey step-up', async ({
  page,
  context,
}) => {
  await virtualAuthenticator(context, page)
  const creds = await signUpAndVerify(page)
  await page.getByTestId('nav-account').click()
  const keys = page.getByTestId('passkeys')
  await keys.getByTestId('add-passkey').click()
  await expect(keys.getByTestId('passkey-row')).toHaveCount(1)

  // No password any more (like an account made through a sign-in provider), and a day-old
  // session: a passkey is the only way to confirm besides signing in again.
  await sqlRun(
    (sql) => sql`delete from accounts where provider_id = 'credential'
      and user_id = (select id from users where username = ${creds.username})`,
  )
  await makeSessionStale(creds.username)
  await page.reload()

  const danger = page.getByTestId('delete-account')
  await danger.getByTestId('delete-open').click()
  await danger.getByTestId('delete-confirm').fill('DELETE')
  await danger.getByTestId('delete-submit').click()
  const stepUp = danger.getByTestId('delete-step-up')
  await expect(stepUp).toContainText('ask for one of this account’s passkeys')
  await expect(stepUp.getByRole('radio')).toHaveCount(0)
  // The button says what the next press does, and has focus.
  await expect(danger.getByTestId('delete-submit')).toBeEnabled()
  await expect(danger.getByTestId('delete-submit')).toHaveText('Confirm with passkey and delete')
  await expect(danger.getByTestId('delete-submit')).toBeFocused()
  await audit(page, '[data-testid="delete-account"]', 'delete step-up passkey')
  await shoot(page, danger, 'delete-step-up-passkey')

  await danger.getByTestId('delete-submit').click()
  await expect(page.getByText('Your account has been deleted.')).toBeVisible()
  expect(
    await sqlRun((sql) => sql`select 1 from users where username = ${creds.username}`),
  ).toHaveLength(0)
})
