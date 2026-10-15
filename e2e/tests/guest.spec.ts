import { expect, test } from '@playwright/test'
import { passAgeScreen } from './helpers.ts'

test('first visit: DOB screen → accept terms → landing as a guest', async ({ page }) => {
  await page.goto('/')
  // The age screen comes before anything else, with nothing pre-selected.
  await expect(page.getByTestId('dob-form')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Play as Guest' })).toHaveCount(0)
  await expect(page.getByTestId('dob-month')).toHaveValue('')
  await expect(page.getByTestId('dob-day')).toHaveValue('')
  await expect(page.getByTestId('dob-year')).toHaveValue('')
  // The visible copy never mentions an age cutoff.
  await expect(page.locator('main header')).toContainText('Please enter your date of birth.')
  await expect(page.locator('main header')).not.toContainText(/\d|thirteen|old enough|\bage\b/i)

  await passAgeScreen(page)
  await expect(page.getByRole('link', { name: 'Play as Guest' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible()

  await page.getByRole('link', { name: 'Play as Guest' }).click()
  const checkbox = page.getByTestId('clickwrap-checkbox')
  const cont = page.getByTestId('guest-continue')
  await expect(checkbox).not.toBeChecked()
  const notice = page.locator('label', { has: checkbox })
  await expect(notice.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
    'href',
    '/terms',
  )
  await expect(notice.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    '/privacy',
  )
  await expect(notice).not.toContainText(/\d|\bage\b|years/i)
  await expect(cont).toBeDisabled()
  await checkbox.check()
  await expect(cont).toBeEnabled()
  await cont.click()

  await expect(page.getByTestId('signed-in')).toBeVisible()
  await expect(page.getByTestId('display-name')).toHaveText(/^Guest-\d{4}$/)

  // The acceptance was recorded for the guest.
  const status = await page.request.get('/api/legal/status')
  expect(await status.json()).toMatchObject({
    needsAcceptance: false,
    accepted: { terms: '0.2', privacy: '0.2' },
  })

  // A reload keeps the guest session and skips the DOB screen.
  await page.reload()
  await expect(page.getByTestId('display-name')).toHaveText(/^Guest-\d{4}$/)
})

test('under-13 answer gets a neutral refusal that persists', async ({ page }) => {
  await page.goto('/')
  const year = String(new Date().getFullYear() - 9)
  await passAgeScreen(page, { month: '3', day: '1', year })
  await expect(page.getByTestId('age-refusal')).toHaveText(
    "Sorry, we can't create an account right now.",
  )
  await page.reload()
  await expect(page.getByTestId('age-refusal')).toBeVisible()
  await expect(page.getByTestId('dob-form')).toHaveCount(0)
})

test('terms and privacy pages render', async ({ page }) => {
  await page.goto('/terms')
  await expect(page.getByTestId('legal-doc')).toContainText(/Terms of Service/i)
  await page.goto('/privacy')
  await expect(page.getByTestId('legal-doc')).toContainText(/Privacy/i)
})
