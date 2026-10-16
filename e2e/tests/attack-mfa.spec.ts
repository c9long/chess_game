import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E_DATABASE_URL } from '../env.ts'
import { passAgeScreen, signInWithPassword, signOut, signUpAndVerify, totpFrom } from './helpers.ts'

const log = (...a: unknown[]) => console.log('[attack-mfa]', ...a)

async function enableTotp(page: Page, password: string) {
  await page.getByTestId('nav-account').click()
  const tf = page.getByTestId('two-factor')
  await tf.getByTestId('two-factor-password').fill(password)
  await tf.getByTestId('two-factor-start').click()
  const secret = (await tf.getByTestId('totp-secret').textContent())?.trim() ?? ''
  const backup = await tf.getByTestId('backup-codes').locator('li').allInnerTexts()
  return { tf, secret, backup, totp: totpFrom(secret) }
}

async function virtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}

test('TOTP: wrong setup code, wrong login code, backup code, backup reuse, disable', async ({
  page,
}) => {
  const creds = await signUpAndVerify(page)
  // Wrong password at setup
  await page.getByTestId('nav-account').click()
  const tf0 = page.getByTestId('two-factor')
  await tf0.getByTestId('two-factor-password').fill('not my password')
  await tf0.getByTestId('two-factor-start').click()
  await expect(tf0.getByRole('alert')).toBeVisible()
  log('setup wrong password:', await tf0.getByRole('alert').innerText())

  const { tf, backup, totp } = await enableTotp(page, creds.password)
  log('backup codes sample:', backup.slice(0, 2))
  await tf.getByTestId('totp-confirm-code').fill('000000')
  await tf.getByRole('button', { name: 'Turn on' }).click()
  await expect(tf.getByRole('alert')).toBeVisible()
  log('setup wrong code:', await tf.getByRole('alert').innerText())
  await tf.getByTestId('totp-confirm-code').fill(totp.generate())
  await tf.getByRole('button', { name: 'Turn on' }).click()
  await expect(tf.getByTestId('two-factor-status')).toContainText('On')
  log('two-factor section after enable:', (await tf.innerText()).replace(/\s+/g, ' '))

  await signOut(page)
  await signInWithPassword(page, creds.username, creds.password)
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  // focus on code field?
  log(
    'focused on 2fa page:',
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
  )
  await page.getByTestId('two-factor-code').fill('111111')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  log('wrong totp:', await page.getByRole('alert').innerText())
  // Brute-force probe: after 5 wrong codes the challenge is gone. The page must say so and
  // send the player back to sign in, not keep saying "that code didn't work".
  const statuses: string[] = []
  for (let i = 0; i < 8; i++) {
    if (await page.getByTestId('two-factor-restart').isVisible()) break
    await page.getByTestId('two-factor-code').fill(String(200000 + i))
    const rp = page.waitForResponse((r) => r.url().includes('verify-totp'))
    await page.getByRole('button', { name: 'Verify' }).click()
    const r = await rp
    await page.waitForTimeout(200)
    statuses.push(
      `${r.status()} ${(await r.text()).slice(0, 90)} | UI: ${await page.getByRole('alert').innerText()}`,
    )
  }
  log('wrong totp statuses (rate limit disabled in e2e):', statuses)
  await expect(page.getByTestId('two-factor-restart')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('sign in again')
  await page.getByTestId('two-factor-restart').click()
  // A fresh sign-in gets a fresh challenge, and a backup code completes it.
  await signInWithPassword(page, creds.username, creds.password)
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  await page.getByRole('button', { name: 'Use a backup code instead' }).click()
  await page.getByTestId('two-factor-code').fill(backup[0] as string)
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
  log('backup code sign-in OK')

  await signOut(page)
  await signInWithPassword(page, creds.username, creds.password)
  await page.getByRole('button', { name: 'Use a backup code instead' }).click()
  await page.getByTestId('two-factor-code').fill(backup[0] as string)
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  log('backup reuse:', await page.getByRole('alert').innerText())
  // Formatting tolerance: lower-case / spaces in backup code
  const variant = ` ${(backup[1] as string).toLowerCase()} `
  await page.getByTestId('two-factor-code').fill(variant)
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.waitForTimeout(1000)
  log(
    'lower-case backup code accepted?',
    await page.getByTestId('display-name').isVisible(),
    (await page.getByRole('alert').isVisible()) ? await page.getByRole('alert').innerText() : '',
  )
  if (!(await page.getByTestId('display-name').isVisible())) {
    await page.getByTestId('two-factor-code').fill(backup[1] as string)
    await page.getByRole('button', { name: 'Verify' }).click()
  }
  await expect(page.getByTestId('display-name')).toBeVisible()

  // Disable with wrong password
  await page.getByTestId('nav-account').click()
  const tf2 = page.getByTestId('two-factor')
  log('backup code management UI present?', (await tf2.innerText()).replace(/\s+/g, ' '))
  await tf2.getByTestId('two-factor-password').fill('bad password 000')
  await tf2.getByRole('button', { name: 'Turn off' }).click()
  await expect(tf2.getByRole('alert')).toBeVisible()
  log('disable wrong password:', await tf2.getByRole('alert').innerText())
})

test('TOTP: cancel setup midway leaves consistent state', async ({ page }) => {
  const creds = await signUpAndVerify(page)
  const { tf } = await enableTotp(page, creds.password)
  await tf.getByRole('button', { name: 'Cancel' }).click()
  log('after cancel:', (await tf.innerText()).replace(/\s+/g, ' '))
  await signOut(page)
  await signInWithPassword(page, creds.username, creds.password)
  await page.waitForTimeout(1500)
  log('after cancelled setup, sign-in lands on:', page.url())
})

test('passkey: add, cancel, remove, sign-in after removal, stale session add', async ({
  page,
  context,
}) => {
  const { cdp, authenticatorId } = await virtualAuthenticator(context, page)
  const creds = await signUpAndVerify(page)
  await page.getByTestId('nav-account').click()
  const section = page.getByTestId('passkeys')
  await section.getByTestId('add-passkey').click()
  await expect(section.getByTestId('passkey-row')).toHaveCount(1)
  log('passkey row:', await section.getByTestId('passkey-row').innerText())

  // Add a second passkey on the same authenticator (should be excluded / error)
  await section.getByTestId('add-passkey').click()
  await page.waitForTimeout(2000)
  log(
    'second add on same authenticator:',
    await section.getByTestId('passkey-row').count(),
    (await section.getByRole('alert').isVisible())
      ? await section.getByRole('alert').innerText()
      : '',
  )

  // Remove asks for confirmation in an in-page dialog (not a native one): Cancel keeps the
  // key and returns focus to Remove; confirming deletes it.
  const rowsBefore = await section.getByTestId('passkey-row').count()
  const removeButton = section.getByRole('button', { name: 'Remove' }).first()
  await removeButton.click()
  const confirmDialog = page.getByTestId('passkey-remove-dialog')
  await expect(confirmDialog).toBeVisible()
  await expect(confirmDialog).toHaveAttribute('role', 'alertdialog')
  await expect(confirmDialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirmDialog).toHaveCount(0)
  await expect(removeButton).toBeFocused()
  await expect(section.getByTestId('passkey-row')).toHaveCount(rowsBefore)
  await removeButton.click()
  await page.getByTestId('passkey-remove-confirm').click()
  await expect(confirmDialog).toHaveCount(0)
  await expect(section.getByTestId('passkey-row')).toHaveCount(rowsBefore - 1)
  log('remove confirmation dialog shown: true', 'rows now:', rowsBefore - 1)
  const remaining = await section.getByTestId('passkey-row').count()

  if (remaining === 0) {
    // Credential still on the authenticator, but deleted server-side.
    await signOut(page)
    await page.goto('/sign-in')
    await page.getByTestId('passkey-sign-in').click()
    await expect(page.getByRole('alert')).toBeVisible()
    log('sign-in with removed passkey:', await page.getByRole('alert').innerText())
  }

  // Simulate user cancel: remove authenticator → no credentials
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
  await page.goto('/sign-in')
  await page.getByTestId('passkey-sign-in').click()
  await page.waitForTimeout(3000)
  log(
    'passkey sign-in with no authenticator:',
    (await page.getByRole('alert').isVisible())
      ? await page.getByRole('alert').innerText()
      : '(no alert, still busy?)',
    'busy:',
    await page.getByTestId('passkey-sign-in').getAttribute('aria-busy'),
  )

  // Stale session (>24h) then add passkey
  await signInWithPassword(page, creds.username, creds.password)
  await expect(page.getByTestId('display-name')).toBeVisible()
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    await sql`update sessions set created_at = now() - interval '26 hours', updated_at = now() - interval '26 hours'
      where user_id = (select id from users where username = ${creds.username})`
  } finally {
    await sql.end()
  }
  await virtualAuthenticator(context, page)
  await page.getByTestId('nav-account').click()
  await page.getByTestId('passkeys').getByTestId('add-passkey').click()
  await page.waitForTimeout(2000)
  const pk = page.getByTestId('passkeys')
  log(
    'stale session add passkey:',
    (await pk.getByRole('alert').isVisible())
      ? await pk.getByRole('alert').innerText()
      : `(rows ${await pk.getByTestId('passkey-row').count()})`,
  )
  // stale session delete account
  const danger = page.getByTestId('delete-account')
  await danger.getByTestId('delete-open').click()
  await danger.getByTestId('delete-confirm').fill('DELETE')
  await danger.getByTestId('delete-submit').click()
  await expect(danger.getByRole('alert')).toBeVisible()
  log('stale session delete:', await danger.getByRole('alert').innerText())
})

test('guest: export, delete after 25h session (cannot re-authenticate)', async ({ page }) => {
  await page.goto('/')
  await passAgeScreen(page)
  await page.getByRole('link', { name: 'Play as Guest' }).click()
  await page.getByTestId('clickwrap-checkbox').check()
  await expect(page.getByTestId('guest-continue')).toBeEnabled()
  await page.getByTestId('guest-continue').click()
  await expect(page.getByTestId('display-name')).toBeVisible()
  await page.getByTestId('nav-account').click()
  log('guest account page:', (await page.locator('main').innerText()).replace(/\s+/g, ' '))
  // Guests get a reference code for email requests (PLAN §8).
  await expect(page.getByTestId('reference-code')).toHaveText(
    /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
  )

  const dl = page.waitForEvent('download')
  await page.getByTestId('export-data').click()
  log('guest export filename:', (await dl).suggestedFilename())

  const session = await (await page.request.get('/api/auth/get-session')).json()
  const sql = postgres(E2E_DATABASE_URL, { max: 1 })
  try {
    await sql`update sessions set created_at = now() - interval '25 hours' where user_id = ${session.user.id}`
  } finally {
    await sql.end()
  }
  // Guests have nothing to re-authenticate with, so an old session can still delete.
  const danger = page.getByTestId('delete-account')
  await expect(danger.getByRole('heading', { name: 'Delete guest account' })).toBeVisible()
  await danger.getByTestId('delete-open').click()
  await danger.getByTestId('delete-confirm').fill('DELETE')
  await danger.getByTestId('delete-submit').click()
  await expect(page.getByText('Your account has been deleted.')).toBeVisible()
  log('guest stale delete: deleted')
})

test('deleted account: old credentials, back button, and "deleted player" visible state', async ({
  page,
}) => {
  const creds = await signUpAndVerify(page)
  await page.getByTestId('nav-account').click()
  const danger = page.getByTestId('delete-account')
  await danger.getByTestId('delete-open').click()
  // lower-case "delete" should not enable
  await danger.getByTestId('delete-confirm').fill('delete')
  log('lower-case delete enables submit:', await danger.getByTestId('delete-submit').isEnabled())
  await danger.getByTestId('delete-confirm').fill('DELETE')
  await danger.getByTestId('delete-submit').click()
  await expect(page.getByText('Your account has been deleted.')).toBeVisible()
  await page.goBack()
  await page.waitForTimeout(1000)
  log('back after delete →', page.url(), (await page.locator('main').innerText()).slice(0, 120))
  await signInWithPassword(page, creds.username, creds.password)
  await expect(page.getByRole('alert')).toBeVisible()
  log('sign in deleted:', await page.getByRole('alert').innerText())
  // Reuse the email for a new signup?
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Username').fill(creds.username)
  await page.getByLabel('Password').fill(creds.password)
  await page.getByTestId('clickwrap-checkbox').check()
  const submit = page.getByRole('button', { name: 'Create account' })
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForTimeout(1500)
  log(
    're-signup with same email+username after deletion:',
    page.url(),
    (await page.getByRole('alert').isVisible()) ? await page.getByRole('alert').innerText() : '',
  )
})
