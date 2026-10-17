import { type ChildProcess, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { type Browser, expect, type Page, test } from '@playwright/test'
import { E2E_DATABASE_URL } from '../env.ts'
import { latestMailLink, passAgeScreen, signInWithPassword, uniqueUser } from './helpers.ts'

/**
 * Regression: a signed-in player was shown the date-of-birth screen after the dev server
 * restarted. These tests run their own API and web server (on spare ports, sharing the E2E
 * database) so they can stop and restart the API under an open page, the way `pnpm dev` and
 * `node --watch` do.
 */

const API_PORT = 3102
const WEB_PORT = 5175
const WEB = `http://localhost:${WEB_PORT}`
const e2eDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

let api: ChildProcess | undefined
let web: ChildProcess | undefined

async function waitFor(url: string, up: boolean, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const ok = await fetch(url).then(
      (r) => r.ok,
      () => false,
    )
    if (ok === up) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`${url} did not come ${up ? 'up' : 'down'} in time`)
}

function startApi() {
  api = spawn('node', ['start-server.ts'], {
    cwd: e2eDir,
    env: {
      ...process.env,
      E2E_DATABASE_URL,
      E2E_SERVER_PORT: String(API_PORT),
      E2E_SERVER_WEB_ORIGIN: WEB,
      // The main E2E server already reset and seeded the database.
      E2E_SKIP_DB_RESET: '1',
    },
    stdio: 'ignore',
    detached: true,
  })
  return waitFor(`http://127.0.0.1:${API_PORT}/api/health`, true)
}

async function stopApi() {
  const p = api
  api = undefined
  if (!p?.pid) return
  const exited = new Promise((r) => p.once('exit', r))
  process.kill(-p.pid, 'SIGTERM')
  await exited
  await waitFor(`http://127.0.0.1:${API_PORT}/api/health`, false)
}

function kill(p: ChildProcess | undefined) {
  try {
    if (p?.pid) process.kill(-p.pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  web = spawn(
    'pnpm',
    ['--filter', '@game/web', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'],
    {
      cwd: repoRoot,
      env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      stdio: 'ignore',
      detached: true,
    },
  )
  await Promise.all([startApi(), waitFor(WEB, true)])
})

test.afterAll(() => {
  kill(api)
  kill(web)
})

/** Records, across reloads of this tab, whether the DOB screen ever appeared. */
async function watchForDobScreen(page: Page) {
  await page.addInitScript(() => {
    const check = () => {
      if (document.querySelector('[data-testid="dob-form"]')) {
        const seen = sessionStorage.getItem('dobSeen') ?? ''
        sessionStorage.setItem('dobSeen', `${seen} ${location.pathname}`.trim())
      }
    }
    new MutationObserver(check).observe(document, { childList: true, subtree: true })
  })
}
const dobSeen = (page: Page) => page.evaluate(() => sessionStorage.getItem('dobSeen'))

/** A registered, verified account, created in its own browser context. */
async function registeredAccount(browser: Browser) {
  const creds = uniqueUser()
  const ctx = await browser.newContext({ baseURL: WEB })
  const page = await ctx.newPage()
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
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.goto(await latestMailLink(page.request, creds.email, 'verify-email'))
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  await ctx.close()
  return creds
}

test('signed in on a browser with no age cookie, the API restarts: no age screen', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const creds = await registeredAccount(browser)

  // A different browser (no age cookie): sign-in is reachable without the age screen.
  const ctx = await browser.newContext({ baseURL: WEB })
  const page = await ctx.newPage()
  await watchForDobScreen(page)
  await page.goto('/')
  await expect(page.getByTestId('dob-form')).toBeVisible()
  await page.getByTestId('nav-sign-in').click()
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
  await page.evaluate(() => sessionStorage.removeItem('dobSeen'))
  await signInWithPassword(page, creds.username, creds.password)
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
  expect((await ctx.cookies()).map((c) => c.name)).not.toContain('age_ok')

  await page.goto('/play')
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()

  // 1. The API goes down under the open page; the page refetches (focus) while it is down.
  await stopApi()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(1500)
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()

  // 2. A full reload while the API is still down (Vite reloads the page when it comes back
  //    before the API): a spinner or "can't reach the server", never the age screen.
  await page.reload()
  await expect(page.getByTestId('server-unreachable')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('dob-form')).toHaveCount(0)

  // 3. The API comes back: the same page recovers by itself, still signed in.
  await startApi()
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('nav-account')).toContainText(creds.username)

  // 4. A restart while the page is open, then a reload and a visit to the landing page.
  await stopApi()
  await startApi()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)

  expect(await dobSeen(page)).toBeNull()
  await ctx.close()
})

test('an account signed in where the age screen was passed keeps working across restarts', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const creds = await registeredAccount(browser)
  const ctx = await browser.newContext({ baseURL: WEB })
  const page = await ctx.newPage()
  await page.goto('/')
  await passAgeScreen(page)
  await watchForDobScreen(page)
  await signInWithPassword(page, creds.email, creds.password)
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
  await page.goto('/play')
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()

  // The age cookie disappears (expired, cleared, or signed with an older secret): the account's
  // own confirmation still counts, before and after a restart.
  await ctx.clearCookies({ name: 'age_ok' })
  await stopApi()
  await startApi()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Lobbies' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByTestId('display-name')).toHaveText(creds.username)
  expect(await dobSeen(page)).toBeNull()

  // Signed out, this browser is a new visitor again: the age screen comes back.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByTestId('dob-form')).toBeVisible()
  await ctx.close()
})
