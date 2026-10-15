import { APP_NAME } from '@game/config'
import { Link, useLocation } from 'react-router'
import { Alert, CenteredPage } from '../components/ui.tsx'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'

const linkButton =
  'inline-flex h-12 items-center justify-center rounded-lg px-6 text-sm font-semibold tracking-wide transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold'

export function Landing() {
  const { session } = useAppState()
  const location = useLocation()
  const deleted = (location.state as { deleted?: boolean } | null)?.deleted
  const user = session?.user

  return (
    <CenteredPage wide>
      {deleted ? (
        <div className="mb-8">
          <Alert tone="success">Your account has been deleted.</Alert>
        </div>
      ) : null}
      <div className="flex flex-col items-center justify-center py-6 text-center sm:min-h-[calc(100vh-15rem)] sm:py-12">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-gold/80">
          Four-player chess
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          {APP_NAME}
        </h1>
        <p className="mt-5 max-w-lg text-base text-parchment/70 sm:text-lg">
          Four players. Twelve by twelve. One civ left standing.
        </p>

        {user ? (
          <div className="mt-10 flex w-full max-w-md flex-col gap-4" data-testid="signed-in">
            <p className="text-parchment/85">
              {isGuest(user) ? 'You’re playing as ' : 'Welcome back, '}
              <strong className="text-parchment" data-testid="display-name">
                {displayName(user)}
              </strong>
            </p>
            <div className="rounded-2xl border border-parchment/10 bg-panel/80 p-6 text-sm text-parchment/70">
              Lobbies and live games arrive in the next update.
            </div>
            {isGuest(user) ? (
              <Link to="/sign-up" className={`${linkButton} bg-gold text-ink hover:bg-gold-bright`}>
                Create account and keep your history
              </Link>
            ) : null}
            <Link
              to="/account"
              className={`${linkButton} border border-parchment/25 hover:border-parchment/50 hover:bg-parchment/5`}
            >
              Account settings
            </Link>
          </div>
        ) : (
          <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
            <Link
              to="/guest"
              className={`${linkButton} bg-gold text-ink shadow-[0_8px_24px_-12px_rgba(212,160,23,0.7)] hover:bg-gold-bright`}
            >
              Play as Guest
            </Link>
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/sign-in"
                className={`${linkButton} border border-parchment/25 hover:border-parchment/50 hover:bg-parchment/5`}
              >
                Sign in
              </Link>
              <Link
                to="/sign-up"
                className={`${linkButton} border border-parchment/25 hover:border-parchment/50 hover:bg-parchment/5`}
              >
                Create account
              </Link>
            </div>
          </div>
        )}
      </div>
    </CenteredPage>
  )
}
