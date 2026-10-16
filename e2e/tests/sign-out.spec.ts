import { expect, type Page, test } from '@playwright/test'
import { signInWithPassword, signUpAndVerify } from './helpers.ts'

/**
 * Signing out from a page behind RequireAuth used to race its redirect to /sign-in against the
 * navigation to the landing page. Repeat it so a race would show up, on both the desktop button
 * and the phone menu, and check no URL on the way was /sign-in.
 */
async function signOutFromAccount(page: Page, via: 'header' | 'menu') {
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible()
  const seen: string[] = []
  const onNav = (frame: { url(): string; parentFrame(): unknown }) => {
    if (!frame.parentFrame()) seen.push(new URL(frame.url()).pathname)
  }
  page.on('framenavigated', onNav)
  if (via === 'menu') {
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.locator('#mobile-menu').getByRole('button', { name: 'Sign out' }).click()
  } else {
    await page.getByRole('button', { name: 'Sign out' }).click()
  }
  await expect(page.getByRole('link', { name: 'Play as Guest' })).toBeVisible()
  // Give a late redirect the chance to happen before checking.
  await page.waitForTimeout(300)
  page.off('framenavigated', onNav)
  expect(new URL(page.url()).pathname).toBe('/')
  expect(seen).not.toContain('/sign-in')
  await expect(page.getByRole('link', { name: 'Play as Guest' })).toBeVisible()
}

test('signing out from /account always lands on the landing page', async ({ page }) => {
  test.setTimeout(240_000)
  const creds = await signUpAndVerify(page)
  // A slow CPU (as on a phone) widens the window between the session ending and the route
  // change committing, which is where the redirect to /sign-in used to slip in.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  for (let i = 0; i < 5; i++) {
    await signOutFromAccount(page, 'header')
    await signInWithPassword(page, creds.username, creds.password)
    await expect(page.getByTestId('display-name')).toHaveText(creds.username)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (let i = 0; i < 3; i++) {
    await signOutFromAccount(page, 'menu')
    await signInWithPassword(page, creds.username, creds.password)
    await expect(page.getByTestId('display-name')).toHaveText(creds.username)
  }
})

test('following a header link while signing out still ends on the landing page', async ({
  page,
}) => {
  await signUpAndVerify(page)
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible()
  // Hold the sign-out request so the header still shows the signed-in nav on the landing page.
  let release: () => void = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await page.route('**/api/auth/sign-out', async (route) => {
    await held
    await route.continue()
  })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/$/)
  // Open a signed-in page before the session ends, then let the sign-out finish.
  await page.getByTestId('nav-play').click()
  await expect(page).toHaveURL(/\/play$/)
  release()
  await expect(page.getByRole('link', { name: 'Play as Guest' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
})
