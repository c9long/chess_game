import { APP_NAME } from '@game/config'
import { lazy, useEffect } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router'
import { BrandMark } from './components/BrandMark.tsx'
import { AcceptanceGate, AgeGate, RequireAuth, UsernameGate } from './components/Gates.tsx'
import { Shell } from './components/Shell.tsx'
import { buttonBase, buttonVariants, CenteredPage, PageTitle } from './components/ui.tsx'
import { AppStateProvider } from './lib/app-state.tsx'
import { setTwoFactorHandler } from './lib/auth-client.ts'
import { Account } from './pages/Account.tsx'
import { CheckEmail } from './pages/CheckEmail.tsx'
import { Device } from './pages/Device.tsx'
import { GuestStart } from './pages/GuestStart.tsx'
import { Landing } from './pages/Landing.tsx'
import { ForgotPassword, ResetPassword } from './pages/PasswordReset.tsx'
import { SignIn } from './pages/SignIn.tsx'
import { SignUp } from './pages/SignUp.tsx'
import { TwoFactor } from './pages/TwoFactor.tsx'
import { VerifyEmail } from './pages/VerifyEmail.tsx'

// Heavier pages load on demand: the game screen (PixiJS + rules engine), the lobby browser
// (Colyseus client), history and the Markdown legal pages.
const Match = lazy(() => import('./pages/Match.tsx').then((m) => ({ default: m.Match })))
const Play = lazy(() => import('./pages/Play.tsx').then((m) => ({ default: m.Play })))
const History = lazy(() => import('./pages/History.tsx').then((m) => ({ default: m.History })))
const Leaderboard = lazy(() =>
  import('./pages/Leaderboard.tsx').then((m) => ({ default: m.Leaderboard })),
)
// Development builds only (the dev mailbox); removed from production builds.
const DevMail = import.meta.env.DEV
  ? lazy(() => import('./pages/DevMail.tsx').then((m) => ({ default: m.DevMail })))
  : null
const LegalDoc = lazy(() => import('./pages/LegalDoc.tsx').then((m) => ({ default: m.LegalDoc })))

function NotFound() {
  // Runs after DocumentTitle's effect for this path (child effects run first, so re-apply).
  useEffect(() => {
    const id = window.setTimeout(() => {
      document.title = `Page not found · ${APP_NAME}`
    })
    return () => window.clearTimeout(id)
  }, [])
  return (
    <CenteredPage>
      <div className="flex flex-col items-center py-10 text-center" data-testid="not-found">
        <BrandMark className="mb-6 h-14 w-14" />
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-gold">404</p>
        <PageTitle
          title="Page not found"
          subtitle="This square is empty. The page may have moved, or the link may be mistyped."
        />
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/" className={`${buttonBase} ${buttonVariants.primary}`}>
            Back to the start
          </Link>
          <Link to="/play" className={`${buttonBase} ${buttonVariants.secondary}`}>
            Find a game
          </Link>
        </div>
      </div>
    </CenteredPage>
  )
}

/** Client-side navigation keeps the old scroll position by default; start pages at the top. */
function ScrollToTop() {
  const { pathname } = useLocation()
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every page change
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** Browser-tab titles per page ("Lobbies · <APP_NAME>"), so tabs and history read clearly. */
const PAGE_TITLES: [prefix: string, title: string][] = [
  ['/play', 'Lobbies'],
  ['/match/', 'Game'],
  ['/history', 'Match history'],
  ['/leaderboard', 'Leaderboard'],
  ['/account', 'Account'],
  ['/sign-in', 'Sign in'],
  ['/sign-up', 'Create account'],
  ['/guest', 'Play as guest'],
  ['/forgot-password', 'Reset your password'],
  ['/reset-password', 'Choose a new password'],
  ['/check-email', 'Check your email'],
  ['/verify-email', 'Verify your email'],
  ['/two-factor', 'Two-step verification'],
  ['/terms', 'Terms of Service'],
  ['/privacy', 'Privacy Policy'],
  ['/dev/mail', 'Dev mailbox'],
]
// Unknown paths: NotFound sets "Page not found · <APP_NAME>" itself.

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    const page = PAGE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1]
    document.title = page ? `${page} · ${APP_NAME}` : APP_NAME
  }, [pathname])
  return null
}

function TwoFactorRedirect() {
  const navigate = useNavigate()
  useEffect(() => setTwoFactorHandler(() => navigate('/two-factor')), [navigate])
  return null
}

export function App() {
  return (
    <AppStateProvider>
      <TwoFactorRedirect />
      <ScrollToTop />
      <DocumentTitle />
      <Routes>
        <Route element={<Shell />}>
          {/* Always reachable: legal documents and links that arrive by email. */}
          {DevMail ? <Route path="dev/mail" element={<DevMail />} /> : null}
          <Route path="terms" element={<LegalDoc kind="terms" />} />
          <Route path="privacy" element={<LegalDoc kind="privacy" />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="resend-verification" element={<CheckEmail />} />
          <Route path="reset-password" element={<ResetPassword />} />
          {/* Signing in to an existing account (confirmed when it was created) and recovering
              it need no age screen; only a recent under-13 answer in this browser blocks them. */}
          <Route element={<AgeGate requireAge={false} />}>
            <Route element={<AcceptanceGate />}>
              <Route element={<UsernameGate />}>
                <Route path="sign-in" element={<SignIn />} />
                <Route path="check-email" element={<CheckEmail />} />
                <Route path="forgot-password" element={<ForgotPassword />} />
                <Route path="two-factor" element={<TwoFactor />} />
              </Route>
            </Route>
          </Route>
          {/* Everything else sits behind the neutral age screen (new visitors, before playing as
              a guest or creating an account), then any re-acceptance, then (for accounts created
              through OAuth) choosing a username. */}
          <Route element={<AgeGate />}>
            <Route element={<AcceptanceGate />}>
              <Route element={<UsernameGate />}>
                <Route index element={<Landing />} />
                <Route path="guest" element={<GuestStart />} />
                <Route path="sign-up" element={<SignUp />} />
                <Route
                  path="account"
                  element={
                    <RequireAuth>
                      <Account />
                    </RequireAuth>
                  }
                />
                <Route
                  path="play"
                  element={
                    <RequireAuth>
                      <Play />
                    </RequireAuth>
                  }
                />
                <Route
                  path="match/:roomId"
                  element={
                    <RequireAuth>
                      <Match />
                    </RequireAuth>
                  }
                />
                <Route
                  path="history"
                  element={
                    <RequireAuth>
                      <History />
                    </RequireAuth>
                  }
                />
                {/* Public: anyone past the age screen can browse the leaderboard. */}
                <Route path="leaderboard" element={<Leaderboard />} />
                <Route
                  path="device"
                  element={
                    <RequireAuth>
                      <Device />
                    </RequireAuth>
                  }
                />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AppStateProvider>
  )
}
