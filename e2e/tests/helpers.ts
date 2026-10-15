import { randomBytes } from 'node:crypto'
import { type APIRequestContext, expect, type Page } from '@playwright/test'
import * as OTPAuth from 'otpauth'

export function uniqueUser() {
  const username = `e2e_${randomBytes(4).toString('hex')}`
  return { username, email: `${username}@example.test`, password: 'e2e password 12345' }
}

export type Creds = ReturnType<typeof uniqueUser>

/** Neutral DOB screen: month/day selects start empty; fill and continue. */
export async function passAgeScreen(page: Page, { month = '5', day = '17', year = '1992' } = {}) {
  await expect(page.getByTestId('dob-form')).toBeVisible()
  await page.getByTestId('dob-month').selectOption(month)
  await page.getByTestId('dob-day').selectOption(day)
  await page.getByTestId('dob-year').fill(year)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('dob-form')).toBeHidden()
}

export async function latestMailLink(request: APIRequestContext, to: string, kind: string) {
  let link: string | undefined
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/dev/mail?to=${encodeURIComponent(to)}`)
        const { messages } = (await res.json()) as { messages: { kind: string; text: string }[] }
        const mail = messages.filter((m) => m.kind === kind).at(-1)
        link = mail?.text.match(/https?:\/\/\S+/)?.[0]
        return link
      },
      { message: `waiting for ${kind} email to ${to}` },
    )
    .toBeTruthy()
  return link as string
}

/** Create account → verification email (dev mailbox) → verify → signed in on the landing page. */
export async function signUpAndVerify(page: Page, creds: Creds = uniqueUser()) {
  await page.goto('/')
  await passAgeScreen(page)
  await page.getByRole('link', { name: 'Create account' }).click()
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Username').fill(creds.username)
  await page.getByLabel('Password').fill(creds.password)
  const submit = page.getByRole('button', { name: 'Create account' })
  await expect(submit).toBeDisabled()
  await page.getByTestId('clickwrap-checkbox').check()
  // Enabled once the (always-pass test key) Turnstile widget has produced a token.
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

  const link = await latestMailLink(page.request, creds.email, 'verify-email')
  await page.goto(link)
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  await page.getByTestId('verified-continue').click()
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
  return creds
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Play as Guest' })).toBeVisible()
}

export async function signInWithPassword(page: Page, identifier: string, password: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email or username').fill(identifier)
  await page.getByLabel('Password').fill(password)
  const submit = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(submit).toBeEnabled()
  await submit.click()
}

export function totpFrom(secret: string) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 })
}
