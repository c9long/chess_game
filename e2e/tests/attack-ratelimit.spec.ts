import { expect, test } from '@playwright/test'
import { latestMailLink, passAgeScreen, uniqueUser } from './helpers.ts'

/**
 * Runs against a second, manually started stack with RATE_LIMIT_ENABLED=true
 * (API :3200, web :5175, same E2E database). Skipped when that stack isn't up.
 */
const RL_ORIGIN = process.env.RL_ORIGIN ?? 'http://localhost:5175'
test.use({ baseURL: RL_ORIGIN })

const log = (...a: unknown[]) => console.log('[attack-rl]', ...a)

test.beforeAll(async ({ request }) => {
  const ok = await request
    .get(`${RL_ORIGIN}/api/health`)
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!ok, 'rate-limited stack not running')
})

test('repeated wrong passwords: lockout / rate-limit messaging in the UI', async ({ page }) => {
  await page.goto('/')
  await passAgeScreen(page)
  // Make a verified account on this stack.
  const creds = uniqueUser()
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Username').fill(creds.username)
  await page.getByLabel('Password').fill(creds.password)
  await page.getByTestId('clickwrap-checkbox').check()
  const create = page.getByRole('button', { name: 'Create account' })
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.goto(await latestMailLink(page.request, creds.email, 'verify-email'))
  await page.getByTestId('verified-continue').click()
  await page.getByRole('button', { name: 'Sign out' }).click()

  await page.goto('/sign-in')
  const submit = page.getByRole('button', { name: 'Sign in', exact: true })
  await page.getByLabel('Email or username').fill(creds.username)
  const seen: string[] = []
  for (let i = 0; i < 8; i++) {
    await page.getByLabel('Password').fill(`wrong password ${i}`)
    await expect(submit).toBeEnabled({ timeout: 20_000 })
    const resP = page.waitForResponse((r) => r.url().includes('/sign-in/'))
    await submit.click()
    const res = await resP
    await expect(page.getByRole('alert')).toBeVisible()
    const msg = await page.getByRole('alert').innerText()
    seen.push(`#${i} ${res.status()} ${res.headers()['x-retry-after'] ?? ''} → ${msg}`)
  }
  log('attempts:', seen)
  // Now the right password immediately.
  await page.getByLabel('Password').fill(creds.password)
  await expect(submit).toBeEnabled({ timeout: 20_000 })
  const resP = page.waitForResponse((r) => r.url().includes('/sign-in/'))
  await submit.click()
  const res = await resP
  log('correct password right after:', res.status())
  await page.waitForTimeout(500)
  if (await page.getByRole('alert').isVisible()) {
    log('alert:', await page.getByRole('alert').innerText())
  }
})

test('guest creation limit message', async ({ page }) => {
  await page.goto('/')
  await passAgeScreen(page)
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    await page.goto('/guest')
    await page.getByTestId('clickwrap-checkbox').check()
    const cont = page.getByTestId('guest-continue')
    await expect(cont).toBeEnabled({ timeout: 20_000 })
    const resP = page.waitForResponse((r) => r.url().includes('/sign-in/anonymous'))
    await cont.click()
    const res = await resP
    await page.waitForTimeout(400)
    const alert = page.getByRole('alert')
    out.push(
      `#${i} ${res.status()} ${(await alert.isVisible()) ? await alert.innerText() : page.url()}`,
    )
    if (res.ok()) {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(page.getByRole('link', { name: 'Play as Guest' })).toBeVisible()
    }
  }
  log('guest attempts:', out)
})

test('age-confirmation limiter message', async ({ page }) => {
  await page.goto('/')
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    await page.getByTestId('dob-month').selectOption('2')
    await page.getByTestId('dob-day').selectOption('31')
    await page.getByTestId('dob-year').fill('2001')
    const resP = page.waitForResponse((r) => r.url().includes('age-confirmation'))
    await page.getByRole('button', { name: 'Continue' }).click()
    const res = await resP
    await page.waitForTimeout(150)
    out.push(
      `${res.status()} ${await page
        .getByRole('alert')
        .innerText()
        .catch(() => '-')}`,
    )
  }
  log('dob attempts:', out)
})
