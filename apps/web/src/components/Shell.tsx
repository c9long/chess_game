import { APP_NAME } from '@game/config'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'
import { authClient } from '../lib/auth-client.ts'

function Emblem() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
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

export function Shell() {
  const { session, legal } = useAppState()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = session?.user
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-parchment/10 bg-ink/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <Emblem />
            <span className="truncate font-display text-lg font-semibold tracking-tight">
              {APP_NAME}
            </span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2 text-sm">
            {user ? (
              <>
                <Link
                  to="/account"
                  className="rounded-lg px-3 py-2 text-parchment/85 hover:bg-parchment/5 hover:text-parchment"
                  data-testid="nav-account"
                >
                  <span className="hidden sm:inline">{isGuest(user) ? 'Guest · ' : ''}</span>
                  {displayName(user)}
                </Link>
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-parchment/70 hover:bg-parchment/5 hover:text-parchment"
                  onClick={async () => {
                    await authClient.signOut()
                    navigate('/')
                  }}
                >
                  Sign out
                </button>
              </>
            ) : pathname === '/' || !legal?.ageConfirmed ? null : (
              // Signed out: a way in from any page (the landing page has its own buttons).
              <>
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
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-parchment/10 py-6 text-center text-xs text-parchment/45">
        <Link to="/terms" className="hover:text-parchment">
          Terms of Service
        </Link>
        <span className="mx-2">·</span>
        <Link to="/privacy" className="hover:text-parchment">
          Privacy Policy
        </Link>
      </footer>
    </div>
  )
}
