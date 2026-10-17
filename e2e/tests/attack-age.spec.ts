import { expect, test } from '@playwright/test'
import { passAgeScreen } from './helpers.ts'

const log = (...a: unknown[]) => console.log('[attack-age]', ...a)

test('deep links on first visit all show the DOB screen first, with no age hints', async ({
  page,
}) => {
  for (const path of ['/', '/sign-up', '/guest', '/account', '/device', '/leaderboard']) {
    await page.context().clearCookies()
    await page.goto(path)
    await expect(page.getByTestId('dob-form'), path).toBeVisible()
    const body = (
      await page.evaluate(() => {
        const c = document.body.cloneNode(true) as HTMLElement
        for (const s of c.querySelectorAll('select')) s.remove()
        return c.innerText || c.textContent || ''
      })
    ).replace(/\s+/g, ' ')
    log(path, '=>', body.slice(0, 300))
    expect
      .soft(body, `${path} mentions cutoff`)
      .not.toMatch(/\b13\b|thirteen|old enough|years old/i)
    // Nothing but the DOB step and footer links should be interactive.
    const links = await page.locator('main a').count()
    expect.soft(links, `${path} has links in main`).toBe(0)
    // Existing accounts can still sign in from the header without answering.
    await expect(page.getByTestId('nav-sign-in')).toBeVisible()
  }
})

test('sign-in and recovery pages need no DOB screen on first visit', async ({ page }) => {
  for (const [path, heading] of [
    ['/sign-in', 'Sign in'],
    ['/forgot-password', 'Reset your password'],
    ['/two-factor', 'Two-step verification'],
  ] as const) {
    await page.context().clearCookies()
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, level: 1 }), path).toBeVisible()
    await expect(page.getByTestId('dob-form'), path).toHaveCount(0)
  }
  // "Create account" from there still goes through the DOB screen first.
  await page.goto('/sign-in')
  await page.getByRole('link', { name: 'Create account' }).click()
  await expect(page.getByTestId('dob-form')).toBeVisible()
})

test('invalid dates: Feb 30, future year, ancient year', async ({ page }) => {
  await page.goto('/')
  const cases = [
    { month: '2', day: '30', year: '2000' },
    { month: '1', day: '1', year: String(new Date().getFullYear() + 1) },
    { month: '1', day: '1', year: '1850' },
    { month: '1', day: '1', year: '0000' },
  ]
  for (const c of cases) {
    await page.getByTestId('dob-month').selectOption(c.month)
    await page.getByTestId('dob-day').selectOption(c.day)
    await page.getByTestId('dob-year').fill(c.year)
    await page.getByRole('button', { name: 'Continue' }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    log('invalid', c, '=>', await alert.innerText())
    await expect(page.getByTestId('dob-form')).toBeVisible()
  }
})

test('under-13 then retry: blocked across routes and direct API retry', async ({ page }) => {
  await page.goto('/')
  const year = String(new Date().getFullYear() - 10)
  await passAgeScreen(page, { month: '6', day: '1', year })
  await expect(page.getByTestId('age-refusal')).toBeVisible()
  const refusalText = await page.locator('main').innerText()
  log('refusal main text:', JSON.stringify(refusalText))
  for (const path of ['/sign-in', '/sign-up', '/guest', '/forgot-password']) {
    await page.goto(path)
    await expect.soft(page.getByTestId('age-refusal'), path).toBeVisible()
  }
  // Legal pages stay reachable.
  await page.goto('/terms')
  await expect(page.getByTestId('legal-doc')).toBeVisible()

  // Direct API retry with an adult DOB while blocked.
  const res = await page.request.post('/api/legal/age-confirmation', {
    data: { dateOfBirth: '1990-01-01' },
    headers: { origin: 'http://localhost:5174' },
  })
  log('API retry while blocked:', res.status(), await res.text())
  expect(res.status()).toBe(403)

  // Cookies seen by the browser.
  const cookies = await page.context().cookies()
  log(
    'cookies after refusal:',
    cookies.map((c) => `${c.name} exp=${new Date(c.expires * 1000).toISOString()}`),
  )

  // Clear only the block cookie: can the user immediately retry with an adult DOB?
  await page
    .context()
    .clearCookies({ name: 'age_block' })
    .catch(async () => {
      const keep = cookies.filter((c) => c.name !== 'age_block')
      await page.context().clearCookies()
      await page.context().addCookies(keep)
    })
  await page.goto('/')
  const dobVisible = await page.getByTestId('dob-form').isVisible()
  log('after clearing age_block cookie, DOB screen visible:', dobVisible)
})

test('existing adult user, new device, accidentally enters under-13 → cannot reach sign-in', async ({
  page,
}) => {
  await page.goto('/')
  await passAgeScreen(page, { month: '1', day: '1', year: String(new Date().getFullYear() - 5) })
  await expect(page.getByTestId('age-refusal')).toBeVisible()
  await page.goto('/sign-in')
  const blocked = await page.getByTestId('age-refusal').isVisible()
  const backLinks = await page.locator('main a, main button').count()
  log('sign-in blocked for refused browser:', blocked, 'actions on refusal page:', backLinks)
})

test('keyboard-only DOB entry', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dob-form')).toBeVisible()
  const order: string[] = []
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return 'none'
        return `${el.tagName}:${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)}`
      }),
    )
  }
  log('DOB tab order:', order)
})
