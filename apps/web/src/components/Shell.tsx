import { APP_NAME } from '@game/config'
import { MotionConfig, useAnimate, useReducedMotion } from 'motion/react'
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { usePrefs } from '../lib/prefs.ts'
import { useSocial } from '../lib/social.ts'
import { BrandMark } from './BrandMark.tsx'
import { MenuIcon } from './game/icons.tsx'
import { cx, linkButtonClass, Spinner } from './ui.tsx'

// Friends' presence, notifications and challenge prompts (Colyseus client + overlays): loaded
// only for signed-in registered players.
const SocialLayer = lazy(() =>
  import('./social/SocialLayer.tsx').then((m) => ({ default: m.SocialLayer })),
)

/** Friend requests and challenges waiting for your answer. */
function useSocialBadge(): number {
  return useSocial((s) => (s.friends?.incoming.length ?? 0) + s.challenges.incoming.length)
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[11px] leading-none font-bold text-ink tabular-nums"
      data-testid="friends-badge"
    >
      {count > 9 ? '9+' : count}
      <span className="sr-only"> waiting</span>
    </span>
  )
}

/**
 * The play routes, where the page sits on the table's baize instead of the room's ink: a live
 * game or lobby (/match/*), watching one (/watch/*) and a replay (/history/:matchId).
 */
export function isPlaySurface(pathname: string): boolean {
  return /^\/(match|watch)\/./.test(pathname) || /^\/history\/[^/]+/.test(pathname)
}

/**
 * Sets data-surface="baize" on <html> while a play route is open, so the body, the header and
 * portalled overlays (all reading --surface) take the baize. Shell's root div carries the same
 * attribute for code that checks its ancestors.
 */
function useSurface(baize: boolean) {
  useEffect(() => {
    const root = document.documentElement
    if (baize) root.dataset.surface = 'baize'
    else delete root.dataset.surface
    return () => {
      delete root.dataset.surface
    }
  }, [baize])
}

/** Whether a nav item is the current page ('page'), the section of it ('true'), or neither. */
function currentFor(pathname: string, to: string): 'page' | 'true' | undefined {
  if (pathname === to) return 'page'
  if (pathname.startsWith(`${to}/`)) return 'true'
  // A game, a lobby and watching one all belong to Play.
  if (to === '/play' && /^\/(match|watch)\//.test(pathname)) return 'true'
  return undefined
}

/** Header link: muted until hovered; the current page is parchment with a brass bar under it. */
const navItem =
  'relative h-10 items-center rounded-control px-3 text-ui font-medium text-muted transition-colors duration-150 ' +
  'hover:bg-parchment/[0.06] hover:text-parchment ' +
  'aria-[current]:text-parchment after:absolute after:inset-x-3 after:h-0.5 after:rounded-full after:bg-brass after:opacity-0 aria-[current]:after:opacity-100'

/** Display per breakpoint (kept out of `navItem`: a later `inline-flex` would beat `hidden`). */
const SHOW_FROM = {
  always: 'inline-flex',
  md: 'hidden md:inline-flex',
  lg: 'hidden lg:inline-flex',
}

function NavItem({
  to,
  children,
  from = 'always',
  testId,
}: {
  to: string
  children: ReactNode
  /** Hide the item below this breakpoint (the mobile menu lists it instead). */
  from?: keyof typeof SHOW_FROM
  testId?: string
}) {
  const { pathname } = useLocation()
  return (
    <Link
      to={to}
      aria-current={currentFor(pathname, to)}
      className={cx(navItem, SHOW_FROM[from], 'after:-bottom-[13px]')}
      data-testid={testId}
    >
      {children}
    </Link>
  )
}

/**
 * A quick fade-in of each new page (enter only: routes never wait for an exit, and nothing
 * remounts, so the layout doesn't jump). Query changes (filters, tabs) don't re-animate.
 * Opacity only: a transform would make this wrapper the containing block of the pages'
 * position:fixed bars and dialogs while it runs.
 */
function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const systemReduced = useReducedMotion()
  const prefReduced = usePrefs((s) => s.reducedMotion)
  const first = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every page change
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (systemReduced || prefReduced || !scope.current) return
    animate(scope.current, { opacity: [0, 1] }, { duration: 0.14, ease: 'easeOut' })
  }, [pathname])
  return <div ref={scope}>{children}</div>
}

/** Phones and tablets: the pages that don't fit in the header, in a dropdown. */
function MobileMenu({ onSignOut }: { onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const badge = useSocialBadge()
  const { pathname } = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every page change
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const item =
    'relative flex h-11 items-center rounded-control px-3 text-ui text-muted hover:bg-parchment/[0.06] hover:text-parchment ' +
    'aria-[current]:bg-parchment/[0.06] aria-[current]:font-semibold aria-[current]:text-parchment ' +
    'before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-brass before:opacity-0 aria-[current]:before:opacity-100'
  return (
    <div ref={ref} className="relative lg:hidden">
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-control text-muted hover:bg-parchment/[0.06] hover:text-parchment aria-expanded:bg-parchment/[0.06] aria-expanded:text-parchment"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={badge > 0 ? `Menu (${badge} waiting)` : 'Menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="relative">
          <MenuIcon />
          {badge > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-gold"
            />
          ) : null}
        </span>
      </button>
      {open ? (
        <div
          id="mobile-menu"
          className="absolute top-12 right-0 z-50 flex w-56 origin-top-right animate-pop-in flex-col rounded-panel border border-rule-brass bg-panel p-1.5 shadow-lift"
        >
          <Link to="/history" className={item} aria-current={currentFor(pathname, '/history')}>
            History
          </Link>
          <Link
            to="/friends"
            className={item}
            aria-current={currentFor(pathname, '/friends')}
            data-testid="menu-friends"
          >
            Friends
            <Badge count={badge} />
          </Link>
          <Link
            to="/leaderboard"
            className={item}
            aria-current={currentFor(pathname, '/leaderboard')}
          >
            Leaderboard
          </Link>
          <Link to="/account" className={item} aria-current={currentFor(pathname, '/account')}>
            Account
          </Link>
          <div className="my-1 border-t border-rule" />
          <button type="button" className={`${item} text-left`} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function Shell() {
  const { session, ageGate, signOut } = useAppState()
  const badge = useSocialBadge()
  const { pathname } = useLocation()
  const user = session?.user
  const age = ageGate(true)
  const reducedPref = usePrefs((st) => st.reducedMotion)
  // The game screen fits the viewport: no footer under the board.
  const inMatch = pathname.startsWith('/match/')
  const baize = isPlaySurface(pathname)
  useSurface(baize)
  return (
    <MotionConfig reducedMotion={reducedPref ? 'always' : 'user'}>
      {/* safe-x: clear a landscape notch; the header and footer clear the top and bottom. */}
      <div className="safe-x flex min-h-full flex-col" data-surface={baize ? 'baize' : 'ink'}>
        {/* Keyboard users can jump past the header; visible only when focused. */}
        <a
          href="#main-content"
          className="sr-only rounded-control bg-gold px-4 py-2 text-ui font-semibold text-ink focus:not-sr-only focus:fixed focus:top-[calc(0.75rem+var(--safe-top))] focus:left-[calc(0.75rem+var(--safe-left))] focus:z-[60]"
        >
          Skip to content
        </a>
        {/* Above the page (its menu drops over the content). */}
        <header className="safe-top relative z-40 border-b border-rule bg-surface/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
            <Link
              to="/"
              className="-ml-1 flex min-w-0 items-center gap-2.5 rounded-control p-1 text-parchment"
            >
              <BrandMark className="h-8 w-8 shrink-0" />
              <span className="sr-only">{APP_NAME}</span>
              <span
                aria-hidden="true"
                className="hidden truncate font-display text-lead font-semibold tracking-tight sm:block"
              >
                {APP_NAME}
              </span>
            </Link>
            <nav aria-label="Main" className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
              {user ? (
                <>
                  <NavItem to="/play" testId="nav-play">
                    Play
                  </NavItem>
                  <NavItem to="/history" from="lg">
                    History
                  </NavItem>
                  <NavItem to="/friends" from="lg" testId="nav-friends">
                    Friends
                    <Badge count={badge} />
                  </NavItem>
                  <NavItem to="/leaderboard" from="lg" testId="nav-leaderboard">
                    Leaderboard
                  </NavItem>
                  <span aria-hidden="true" className="mx-2 hidden h-6 w-px bg-rule lg:block" />
                  <AccountLink
                    name={displayName(user)}
                    guest={isGuest(user)}
                    current={currentFor(pathname, '/account')}
                  />
                  <button
                    type="button"
                    className="hidden h-10 rounded-control px-3 text-ui text-faint transition-colors duration-150 hover:bg-parchment/[0.06] hover:text-parchment lg:inline-block"
                    onClick={signOut}
                  >
                    Sign out
                  </button>
                  <MobileMenu onSignOut={signOut} />
                </>
              ) : age === 'ask' ? (
                // Before the age screen: signing in to an existing account doesn't need it.
                pathname === '/sign-in' ? null : (
                  <NavItem to="/sign-in" testId="nav-sign-in">
                    Sign in
                  </NavItem>
                )
              ) : pathname === '/' || age !== 'ok' ? null : (
                // Signed out: a way in from any page (the landing page has its own buttons).
                <>
                  {/* Phones too: signed out there is no menu, so this is the way to it. */}
                  <NavItem to="/leaderboard" testId="nav-leaderboard">
                    Leaderboard
                  </NavItem>
                  <NavItem to="/sign-in">Sign in</NavItem>
                  <span className="hidden sm:contents">
                    {/* On its own page it is a nav item marked as current, like Sign in. */}
                    {pathname === '/sign-up' ? (
                      <NavItem to="/sign-up">Create account</NavItem>
                    ) : (
                      <Link to="/sign-up" className={linkButtonClass('secondary', undefined, 'sm')}>
                        Create account
                      </Link>
                    )}
                  </span>
                </>
              )}
            </nav>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
          <PageTransition>
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-24 text-ui text-faint">
                  <Spinner /> Loading…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </PageTransition>
        </main>
        {user && !isGuest(user) ? (
          <Suspense fallback={null}>
            <SocialLayer userId={user.id} />
          </Suspense>
        ) : null}
        {inMatch ? null : (
          <footer className="safe-bottom-6 border-t border-rule pt-6">
            <nav
              aria-label="Legal"
              className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 text-caption text-faint"
            >
              <Link to="/terms" className="rounded-[2px] hover:text-parchment">
                Terms of Service
              </Link>
              <Link to="/privacy" className="rounded-[2px] hover:text-parchment">
                Privacy Policy
              </Link>
            </nav>
          </footer>
        )}
      </div>
    </MotionConfig>
  )
}

/**
 * The signed-in player's name, set like a small nameplate: the name in Fraunces, and for a
 * guest a second line saying so (instead of a "Guest · name" string). Phones show the name only.
 */
function AccountLink({
  name,
  guest,
  current,
}: {
  name: string
  guest: boolean
  current: 'page' | 'true' | undefined
}) {
  return (
    <Link
      to="/account"
      aria-current={current}
      data-testid="nav-account"
      className={cx(
        navItem,
        'inline-flex h-12 max-w-36 flex-col items-start justify-center gap-0 leading-tight sm:max-w-56',
        'after:-bottom-[9px]',
      )}
    >
      <span className="block max-w-full truncate font-display text-body font-semibold text-parchment">
        {name}
      </span>
      {guest ? (
        <span className="hidden text-caption font-normal text-faint sm:block">Guest account</span>
      ) : null}
    </Link>
  )
}
