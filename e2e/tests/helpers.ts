import { randomBytes } from 'node:crypto'
import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test'
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
  // Every E2E browser shares 127.0.0.1, so the age endpoint's per-IP rate limit can trip in
  // a full run. The app then says "Too many attempts. Try again in N seconds": do that.
  const form = page.getByTestId('dob-form')
  const tooMany = form.getByRole('alert').filter({ hasText: 'Too many attempts' })
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByRole('button', { name: 'Continue' }).click()
    const outcome = await Promise.race([
      form.waitFor({ state: 'hidden' }).then(() => 'done' as const),
      tooMany.waitFor({ state: 'visible' }).then(() => 'limited' as const),
    ])
    if (outcome === 'done') return
    const seconds = Number((await tooMany.textContent())?.match(/(\d+) second/)?.[1] ?? 2)
    await page.waitForTimeout((seconds + 1) * 1000)
  }
  await expect(form).toBeHidden()
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

/** Landing page → age screen → "Play as Guest" → signed in on the landing page. */
export async function startAsGuest(page: Page) {
  await page.goto('/')
  await passAgeScreen(page)
  await page.getByRole('link', { name: 'Play as Guest' }).click()
  await page.getByTestId('clickwrap-checkbox').check()
  await page.getByTestId('guest-continue').click()
  await expect(page.getByTestId('signed-in')).toBeVisible()
}

/**
 * Chooses a civilization in a civ dropdown (`CivSelect`): opens the trigger (`civ-select`, or
 * `testId` such as `civ-select-west` for a bot's), clicks the `civ-<slug>` row in the list and
 * waits until the trigger shows it (in a lobby that means the server accepted the choice).
 * `scope` narrows where the trigger is looked up (e.g. the "Play vs bots" panel); the list
 * itself opens in a popover at the end of the page.
 */
export async function chooseCiv(
  page: Page,
  slug: string,
  scope: Page | Locator = page,
  testId = 'civ-select',
) {
  const trigger = scope.getByTestId(testId)
  await trigger.click()
  const list = page.getByTestId(`${testId}-list`)
  await expect(list).toBeVisible()
  await list.getByTestId(`civ-${slug}`).click()
  await expect(list).toBeHidden()
  await expect(trigger).toHaveAttribute('data-value', slug)
}

/**
 * The turn banner on the viewer's turn: "Your move", or the check indicator's text when their
 * leader is under attack as the turn starts (a bot can give check in any game).
 */
export const YOUR_TURN = /^(Your move|Check! Your leader is under attack)$/

/** The live board's development-only test hook (`window.__board`). */
export interface BoardHook {
  squareToClient(s: string): { x: number; y: number } | null
  position(): string
  /** Squares the board draws as in check (the check indicator), e.g. ['i1']. */
  checkSquares(): string[]
}

/** The position string the board currently shows. */
export const position = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board: BoardHook }).__board.position())

/**
 * Plays a move by clicking its from- and to-squares on the live board (dev-only hook),
 * then waits until the server has applied it (the position changes).
 */
export async function playMove(page: Page, from: string, to: string) {
  const before = await position(page)
  for (const sq of [from, to]) {
    const pt = await page.evaluate(
      (s) => (window as unknown as { __board: BoardHook }).__board.squareToClient(s),
      sq,
    )
    if (!pt) throw new Error(`square ${sq} not on screen`)
    await page.mouse.click(pt.x, pt.y)
  }
  await expect.poll(() => position(page), { timeout: 10_000 }).not.toBe(before)
}

/**
 * Before an axe scan. The room (ink) is a solid colour and needs nothing. On the table (baize
 * routes) the felt grain is a background image, which axe can't measure: it reports every text
 * node on it as "incomplete" instead of checking it. A solid stand-in at the felt's lightest
 * point (baize plus the grain) replaces it, so passing here means passing everywhere on it.
 * Returns a function that puts the real background back.
 */
export async function solidBackdropForAxe(page: Page): Promise<() => Promise<void>> {
  const baize = await page.evaluate(() => document.documentElement.dataset.surface === 'baize')
  if (!baize) return async () => {}
  const style = await page.addStyleTag({ content: 'body { background: #29352f !important; }' })
  return async () => {
    await style.evaluate((el) => (el as Element).remove())
  }
}
