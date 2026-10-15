import { expect, test } from '@playwright/test'
import { signInWithPassword, signOut, signUpAndVerify, totpFrom } from './helpers.ts'

test('signup → verify email → enable TOTP → sign out → sign in with TOTP', async ({ page }) => {
  const creds = await signUpAndVerify(page)

  await page.getByTestId('nav-account').click()
  const tf = page.getByTestId('two-factor')
  await expect(tf.getByTestId('two-factor-status')).toContainText('Off')
  await tf.getByTestId('two-factor-password').fill(creds.password)
  await tf.getByTestId('two-factor-start').click()
  const secret = (await tf.getByTestId('totp-secret').textContent())?.trim() ?? ''
  expect(secret).toMatch(/^[A-Z2-7]+=*$/)
  await expect(tf.getByTestId('backup-codes').locator('li')).toHaveCount(10)
  await expect(tf.locator('svg').first()).toBeVisible() // QR code
  const totp = totpFrom(secret)
  await tf.getByTestId('totp-confirm-code').fill(totp.generate())
  await tf.getByRole('button', { name: 'Turn on' }).click()
  await expect(tf.getByTestId('two-factor-status')).toContainText('On')

  await signOut(page)
  await signInWithPassword(page, creds.username, creds.password)
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  // Use the next time step so the code differs from the one used during setup.
  await page.getByTestId('two-factor-code').fill(totp.generate({ timestamp: Date.now() + 30_000 }))
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
})
