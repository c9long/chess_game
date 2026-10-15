import { expect, test } from '@playwright/test'
import { signOut, signUpAndVerify } from './helpers.ts'

test('passkey registration and sign-in with a virtual authenticator', async ({ page, context }) => {
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

  const creds = await signUpAndVerify(page)
  await page.getByTestId('nav-account').click()
  const section = page.getByTestId('passkeys')
  await expect(section).toContainText('No passkeys yet.')
  await section.getByTestId('add-passkey').click()
  await expect(section.getByTestId('passkey-row')).toHaveCount(1)

  await signOut(page)
  await page.goto('/sign-in')
  await page.getByTestId('passkey-sign-in').click()
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
})
