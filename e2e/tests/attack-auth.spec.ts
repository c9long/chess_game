import { expect, type Page, test } from '@playwright/test'
import { E2E_WEB_ORIGIN } from '../env.ts'
import {
  latestMailLink,
  passAgeScreen,
  signInWithPassword,
  signOut,
  signUpAndVerify,
  uniqueUser,
} from './helpers.ts'

const log = (...a: unknown[]) => console.log('[attack-auth]', ...a)

async function mailbox(page: Page, to: string) {
  const res = await page.request.get(`/api/dev/mail?to=${encodeURIComponent(to)}`)
  return ((await res.json()) as { messages: { kind: string; text: string }[] }).messages
}

async function fillSignUp(
  page: Page,
  { email, username, password }: { email: string; username: string; password: string },
) {
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByTestId('clickwrap-checkbox').check()
}

test('signup validation: weak password, bad username, duplicate username, duplicate email', async ({
  page,
}) => {
  const existing = await signUpAndVerify(page)
  await signOut(page)

  // Weak password
  const u = uniqueUser()
  await fillSignUp(page, { ...u, password: 'short' })
  const submit = page.getByRole('button', { name: 'Create account' })
  log('weak password hint:', await page.getByText('At least 10 characters.').first().innerText())
  await expect(submit).toBeDisabled()

  // A 10-char trivially weak password
  await page.getByLabel('Password').fill('aaaaaaaaaa')
  await page.waitForTimeout(2500)
  log('aaaaaaaaaa enabled submit:', await submit.isEnabled())

  // Bad username
  await page.getByLabel('Password').fill(u.password)
  await page.getByLabel('Username').fill('bad name!')
  const unameDesc = await page.getByLabel('Username').getAttribute('aria-describedby')
  log(
    'bad username message:',
    unameDesc ? await page.locator(`[id="${unameDesc}"]`).innerText() : '(none)',
    'invalid:',
    await page.getByLabel('Username').getAttribute('aria-invalid'),
  )
  await expect(submit).toBeDisabled()

  // Duplicate username (different case)
  await page.getByLabel('Username').fill(existing.username.toUpperCase())
  await expect(submit).toBeEnabled()
  await submit.click()
  const alert = page.getByRole('alert')
  await expect(alert.or(page.getByRole('heading', { name: 'Check your email' }))).toBeVisible()
  log(
    'duplicate username (upper-case) result:',
    page.url(),
    (await alert.isVisible()) ? await alert.innerText() : '(no alert)',
  )
  // After an error, is the clickwrap still checked and turnstile resetting?
  if (await alert.isVisible()) {
    log(
      'clickwrap still checked after error:',
      await page.getByTestId('clickwrap-checkbox').isChecked(),
    )
    await expect(submit).toBeEnabled({ timeout: 15_000 })
  }

  // Duplicate email (new username)
  const u2 = uniqueUser()
  await fillSignUp(page, { email: existing.email, username: u2.username, password: u2.password })
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForTimeout(1500)
  const alertVisible = await page.getByRole('alert').isVisible()
  log(
    'duplicate email result url:',
    page.url(),
    'alert:',
    alertVisible ? await page.getByRole('alert').innerText() : '(none)',
    'heading:',
    await page.locator('h1').innerText(),
  )
  await page.waitForTimeout(1000)
  log(
    'emails to existing owner after duplicate signup:',
    (await mailbox(page, existing.email)).map((m) => m.kind),
  )
  // Does the duplicate-email response let a 3rd party enumerate? Compare to a fresh address.
})

test('sign-in errors: wrong password, unknown user, unverified account', async ({ page }) => {
  const creds = await signUpAndVerify(page)
  await signOut(page)
  await signInWithPassword(page, creds.username, 'wrong password 123')
  await expect(page.getByRole('alert')).toBeVisible()
  log('wrong password msg:', await page.getByRole('alert').innerText())
  // Password field retained? Turnstile re-armed?
  log('password field after failure:', await page.getByLabel('Password').inputValue())
  const submit = page.getByRole('button', { name: 'Sign in', exact: true })
  const t0 = Date.now()
  await expect(submit).toBeEnabled()
  log('re-enabled after ms:', Date.now() - t0)

  // 12 rapid wrong attempts (rate limiting is off in E2E; check messages/lockout)
  const msgs = new Set<string>()
  for (let i = 0; i < 6; i++) {
    await page.getByLabel('Password').fill(`nope ${i} xxxxxxx`)
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByRole('alert')).toBeVisible()
    msgs.add(await page.getByRole('alert').innerText())
  }
  log('messages over repeated failures:', [...msgs])
  await page.getByLabel('Password').fill(creds.password)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByTestId('display-name')).toBeVisible()
  log('correct password after 7 failures still works (no lockout)')
  await signOut(page)

  // Unverified account
  const u = uniqueUser()
  await fillSignUp(page, u)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.waitForTimeout(500)
  const before = (await mailbox(page, u.email)).length
  await signInWithPassword(page, u.email, u.password)
  await expect(page.getByRole('alert')).toBeVisible()
  log('unverified sign-in (email) msg:', await page.getByRole('alert').innerText())
  await page.waitForTimeout(1500)
  const after = (await mailbox(page, u.email)).length
  log('verification emails before/after unverified sign-in:', before, after)
  await signInWithPassword(page, u.username, u.password)
  await expect(page.getByRole('alert')).toBeVisible()
  log('unverified sign-in (username) msg:', await page.getByRole('alert').innerText())
  await page.waitForTimeout(1500)
  log('emails after username sign-in:', (await mailbox(page, u.email)).length)
})

test('check-email resend', async ({ page }) => {
  await page.goto('/')
  await passAgeScreen(page)
  const u = uniqueUser()
  await fillSignUp(page, u)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const resp = page.waitForResponse((r) => r.url().includes('send-verification-email'))
  await page.getByRole('button', { name: 'Resend email' }).click()
  const r = await resp
  log('resend status:', r.status(), await r.text())
  await page.waitForTimeout(800)
  log('resend UI:', await page.locator('main').innerText())
  log(
    'mail kinds:',
    (await mailbox(page, u.email)).map((m) => m.kind),
  )
  // Reload loses router state → no resend button anymore?
  await page.reload()
  log('after reload:', await page.locator('main').innerText())
})

test('password reset flow incl. mismatch, reuse, old sessions', async ({ page, browser }) => {
  const creds = await signUpAndVerify(page)
  // Second browser session stays signed in to see if it is revoked.
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await otherPage.goto('/')
  await passAgeScreen(otherPage)
  await signInWithPassword(otherPage, creds.username, creds.password)
  await expect(otherPage.getByTestId('display-name')).toBeVisible()

  await signOut(page)
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(creds.email)
  const send = page.getByRole('button', { name: 'Send reset link' })
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByRole('status')).toBeVisible()
  log('reset requested:', await page.getByRole('status').innerText())

  // unknown email gives same answer?
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill('nobody-here@example.test')
  await expect(send).toBeEnabled()
  await send.click()
  log('unknown email answer:', await page.locator('main').innerText())

  const link = await latestMailLink(page.request, creds.email, 'reset-password')
  log('reset link:', link)
  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill('brand new password 1')
  await page.getByLabel('Confirm new password').fill('brand new password 2')
  await page.getByRole('button', { name: 'Save password' }).click()
  log('mismatch msg:', await page.getByRole('alert').innerText())
  await page.getByLabel('Confirm new password').fill('brand new password 1')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('status')).toBeVisible()
  log('done msg:', await page.getByRole('status').innerText())

  // Other session revoked?
  await otherPage.reload()
  await otherPage.waitForTimeout(1500)
  log(
    'other session after reset shows name?',
    await otherPage.getByTestId('display-name').isVisible(),
  )

  // Reuse link
  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill('another password 33')
  await page.getByLabel('Confirm new password').fill('another password 33')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  log('reuse msg:', await page.getByRole('alert').innerText())

  await signInWithPassword(page, creds.username, creds.password)
  await expect(page.getByRole('alert')).toBeVisible()
  await signInWithPassword(page, creds.username, 'brand new password 1')
  await expect(page.getByTestId('display-name')).toBeVisible()
  // Reset email content
  const mails = await mailbox(page, creds.email)
  log('reset email text:', mails.filter((m) => m.kind === 'reset-password').at(-1)?.text)
  await other.close()
})

test('redirect back after sign-in from protected deep links', async ({ page }) => {
  const creds = await signUpAndVerify(page)
  await signOut(page)
  await page.goto('/device?user_code=ABCD-EFGH')
  await expect(page).toHaveURL(/sign-in/)
  await page.getByLabel('Email or username').fill(creds.username)
  await page.getByLabel('Password').fill(creds.password)
  const submit = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(
    page.getByTestId('display-name').or(page.getByText('Connect a device')),
  ).toBeVisible()
  log('after sign-in from /device deep link, url =', page.url())
})

test('oauth buttons hidden when unconfigured', async ({ page }) => {
  await page.goto('/')
  await passAgeScreen(page)
  const cfg = await (await page.request.get('/api/config')).json()
  log('oauthProviders:', cfg.oauthProviders)
  await page.goto('/sign-in')
  await expect(page.getByRole('button', { name: /Continue with/ })).toHaveCount(0)
  await page.goto('/sign-up')
  log('sign-up buttons:', await page.locator('main button').allInnerTexts())
  // Direct social sign-in call
  const r = await page.request.post('/api/auth/sign-in/social', {
    data: { provider: 'google', callbackURL: '/' },
    headers: { origin: E2E_WEB_ORIGIN },
  })
  log('social sign-in w/o provider config:', r.status(), (await r.text()).slice(0, 200))
})

test('two-factor page visited directly without challenge', async ({ page }) => {
  await page.goto('/')
  await passAgeScreen(page)
  await page.goto('/two-factor')
  await page.getByTestId('two-factor-code').fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  log('direct 2fa msg:', await page.getByRole('alert').innerText())
})
