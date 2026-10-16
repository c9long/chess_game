import { expect, test } from '@playwright/test'
import { passAgeScreen, uniqueUser } from './helpers.ts'

test('local signup: the dev mailbox shows the verification email and its link works', async ({
  page,
}) => {
  const creds = uniqueUser()
  await page.goto('/')
  await passAgeScreen(page)
  await page.getByRole('link', { name: 'Create account' }).click()
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Username').fill(creds.username)
  await page.getByLabel('Password').fill(creds.password)
  await page.getByTestId('clickwrap-checkbox').check()
  const submit = page.getByRole('button', { name: 'Create account' })
  await expect(submit).toBeEnabled()
  await submit.click()

  // "Check your email" explains that local email lands in the dev mailbox.
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const hint = page.getByTestId('dev-mail-hint')
  await expect(hint).toContainText('emails aren’t really sent')
  await hint.getByRole('link', { name: 'dev mailbox' }).click()

  // The mailbox lists the email (filtered to this address) with a clickable link.
  await expect(page.getByRole('heading', { name: 'Dev mailbox' })).toBeVisible()
  const mailbox = page.getByTestId('dev-mailbox')
  await expect(mailbox).toContainText(`To: ${creds.email}`)
  await mailbox.getByTestId('dev-mail-link').first().click()

  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  await page.getByTestId('verified-continue').click()
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
})
