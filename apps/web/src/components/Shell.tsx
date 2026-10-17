import { APP_NAME } from '@game/config'
import { MotionConfig, useAnimate, useReducedMotion } from 'motion/react'
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { usePrefs } from '../lib/prefs.ts'
import { MenuIcon } from './game/icons.tsx'
import { Spinner } from './ui.tsx'

function Emblem() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        className="fill-gold/15 stroke-gold/60"
        strokeWidth="1.5"
      />
      <rect x="6" y="6" width="5" height="5" className="fill-seat-south" />
      <rect x="21" y="6" width="5" height="5" className="fill-seat-north" />
      <rect x="6" y="21" width="5" height="5" className="fill-seat-west" />
      <rect x="21" y="21" width="5" height="5" className="fill-seat-east" />
      <path
        d="M16 9l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"
        className="fill-parchment"
      />
    </svg>
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
    'flex h-11 items-center rounded-lg px-3 text-sm text-parchment/85 hover:bg-parchment/5 hover:text-parchment'
  return (
    <div ref={ref} className="relative lg:hidden">
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-parchment/80 hover:bg-parchment/5 hover:text-parchment"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label="Menu"
        onClick={() => setOpen((o) => !o)}
      >
        <MenuIcon />
      </button>
      {open ? (
        <div
          id="mobile-menu"
          className="absolute top-12 right-0 z-50 flex w-52 flex-col rounded-xl border border-parchment/15 bg-panel p-1.5 shadow-2xl shadow-black/60"
        >
          <Link to="/history" className={item}>
            History
          </Link>
          <Link to="/leaderboard" className={item}>
            Leaderboard
          </Link>
          <Link to="/account" className={item}>
            Account
          </Link>
          <div className="my-1 border-t border-parchment/10" />
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
  const { pathname } = useLocation()
  const user = session?.user
  const age = ageGate(true)
  const reducedPref = usePrefs((st) => st.reducedMotion)
  // The game screen fits the viewport: no footer under the board.
  const inMatch = pathname.startsWith('/match/')
  return (
    <MotionConfig reducedMotion={reducedPref ? 'always' : 'user'}>
      <div className="flex min-h-full flex-col">
        {/* Keyboard users can jump past the header; visible only when focused. */}
        <a
          href="#main-content"
          className="sr-only rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
        >
          Skip to content
        </a>
        <header className="border-b border-parchment/10 bg-ink/70 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
            <Link to="/" className="flex min-w-0 items-center gap-3">
              <Emblem />
              <span className="sr-only">{APP_NAME}</span>
              <span
                aria-hidden="true"
                className="hidden truncate font-display text-lg font-semibold tracking-tight sm:block"
              >
                {APP_NAME}
              </span>
            </Link>
            <nav className="flex min-w-0 shrink-0 items-center gap-1 text-sm sm:gap-2">
              {user ? (
                <>
                  <Link
                    to="/play"
                    className="rounded-lg px-3 py-2 font-semibold text-gold hover:bg-parchment/5"
                    data-testid="nav-play"
                  >
                    Play
                  </Link>
                  <Link
                    to="/history"
                    className="hidden rounded-lg px-3 py-2 text-parchment/85 hover:bg-parchment/5 hover:text-parchment lg:inline-block"
                  >
                    History
                  </Link>
                  <Link
                    to="/leaderboard"
                    className="hidden rounded-lg px-3 py-2 text-parchment/85 hover:bg-parchment/5 hover:text-parchment lg:inline-block"
                    data-testid="nav-leaderboard"
                  >
                    Leaderboard
                  </Link>
                  <Link
                    to="/account"
                    className="max-w-36 truncate rounded-lg px-3 py-2 text-parchment/85 hover:bg-parchment/5 hover:text-parchment sm:max-w-none"
                    data-testid="nav-account"
                  >
                    <span className="hidden sm:inline">{isGuest(user) ? 'Guest · ' : ''}</span>
                    {displayName(user)}
                  </Link>
                  <button
                    type="button"
                    className="hidden rounded-lg px-3 py-2 text-parchment/70 hover:bg-parchment/5 hover:text-parchment lg:inline-block"
                    onClick={signOut}
                  >
                    Sign out
                  </button>
                  <MobileMenu onSignOut={signOut} />
                </>
              ) : age === 'ask' ? (
                // Before the age screen: signing in to an existing account doesn't need it.
                pathname === '/sign-in' ? null : (
                  <Link
                    to="/sign-in"
                    className="rounded-lg px-3 py-2 text-parchment/85 hover:bg-parchment/5 hover:text-parchment"
                    data-testid="nav-sign-in"
                  >
                    Sign in
                  </Link>
                )
              ) : pathname === '/' || age !== 'ok' ? null : (
                // Signed out: a way in from any page (the landing page has its own buttons).
                <>
                  <Link
                    to="/leaderboard"
                    className="hidden rounded-lg px-3 py-2 text-parchment/85 hover:bg-parchment/5 hover:text-parchment md:inline-block"
                    data-testid="nav-leaderboard"
                  >
                    Leaderboard
                  </Link>
                  <Link
                    to="/sign-in"
                    className="rounded-lg px-3 py-2 text-parchment/85 hover:bg-parchment/5 hover:text-parchment"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/sign-up"
                    className="hidden rounded-lg border border-parchment/25 px-3 py-2 text-parchment/85 hover:border-parchment/50 hover:text-parchment sm:inline-block"
                  >
                    Create account
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
          <PageTransition>
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-3 py-24 text-parchment/60">
                  <Spinner /> Loading…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </PageTransition>
        </main>
        {inMatch ? null : (
          <footer className="border-t border-parchment/10 py-6 text-center text-xs text-parchment/65">
            <Link to="/terms" className="hover:text-parchment">
              Terms of Service
            </Link>
            <span className="mx-2">·</span>
            <Link to="/privacy" className="hover:text-parchment">
              Privacy Policy
            </Link>
          </footer>
        )}
      </div>
    </MotionConfig>
  )
}
