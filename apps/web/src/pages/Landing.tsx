import { APP_NAME } from '@game/config'
import {
  Bot,
  ChevronRight,
  Globe,
  Grid3x3,
  History,
  Landmark,
  Settings,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { MedallionRow } from '../components/landing/MedallionRow.tsx'
import { Alert, cx, linkButtonClass } from '../components/ui.tsx'
import { displayName, isGuest, useAppState } from '../lib/app-state.tsx'

// The board renderer (PixiJS + the rules engine) and the emblem art load after first paint, so
// the landing page's entry chunk stays small.
const DemoBoard = lazy(() => import('../components/landing/DemoBoard.tsx'))
const CivMedallions = lazy(() => import('../components/landing/CivMedallions.tsx'))

/** True once the browser has painted the page and has a moment to spare. */
function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let idle: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const raf = requestAnimationFrame(() => {
      if ('requestIdleCallback' in window) {
        idle = window.requestIdleCallback(() => setReady(true), { timeout: 1200 })
      } else {
        timer = setTimeout(() => setReady(true), 150)
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      if (idle !== undefined) window.cancelIdleCallback(idle)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  return ready
}

const ctaPrimary = linkButtonClass('primary', 'h-14 w-full px-6 text-base')
const ctaSecondary = linkButtonClass('secondary', 'h-12 w-full px-4 whitespace-nowrap')

const VALUE_PROPS: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <Users aria-hidden="true" className="h-[18px] w-[18px]" />,
    title: '4 players',
    text: 'Free-for-all or 2v2 teams',
  },
  {
    icon: <Grid3x3 aria-hidden="true" className="h-[18px] w-[18px]" />,
    title: '16×16 board',
    text: '256 squares, four armies',
  },
  {
    icon: <Landmark aria-hidden="true" className="h-[18px] w-[18px]" />,
    title: '9 civilizations',
    text: 'Lead with your emblem',
  },
  {
    icon: <Trophy aria-hidden="true" className="h-[18px] w-[18px]" />,
    title: 'Bots & ranked Elo',
    text: 'Practise, then climb',
  },
]

export function Landing() {
  const { session } = useAppState()
  const location = useLocation()
  const deleted = (location.state as { deleted?: boolean } | null)?.deleted
  const user = session?.user
  const deferred = useAfterFirstPaint()
  const [boardReady, setBoardReady] = useState(false)

  return (
    <div className="relative overflow-x-clip">
      {deleted ? (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <Alert tone="success">Your account has been deleted.</Alert>
        </div>
      ) : null}

      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pt-6 pb-14 sm:gap-10 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-12 lg:py-14 xl:grid-cols-[minmax(0,1fr)_560px] xl:gap-14">
        {/* Board: on the right from lg; on phones above the text (signed out) or below the
            play buttons (signed in). Decorative and inert. */}
        <div
          className={cx(
            'relative mx-auto w-full max-w-[420px] lg:order-2 lg:max-w-none',
            // Signed in, the way to a game comes first on phones; signed out, the board does.
            user ? 'order-2' : null,
          )}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-[8%] rounded-full bg-[radial-gradient(closest-side,rgba(212,160,23,0.20),rgba(212,160,23,0.06)_55%,transparent)] blur-2xl"
          />
          <div
            className="relative aspect-square"
            role="img"
            aria-label="A four-player game playing itself on the 16 by 16 board"
          >
            <div
              aria-hidden="true"
              className={cx(
                'board-placeholder absolute inset-[9%] rounded-[6%] transition-opacity duration-700',
                boardReady ? 'opacity-0' : 'opacity-100',
              )}
            />
            {deferred ? (
              <Suspense fallback={null}>
                <DemoBoard onReady={() => setBoardReady(true)} />
              </Suspense>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <p className="mb-4 inline-flex items-center gap-3 text-xs font-semibold tracking-[0.35em] text-gold uppercase">
            <span aria-hidden="true" className="h-px w-8 bg-gold/50" />
            Four-player chess
          </p>
          <h1 className="font-display text-display font-semibold">{APP_NAME}</h1>
          <p className="mt-5 max-w-lg text-base text-pretty text-parchment/70 sm:text-lg">
            Four players. Sixteen by sixteen. One civ left standing.
          </p>

          {user ? (
            <div className="mt-8 flex w-full max-w-xl flex-col gap-4" data-testid="signed-in">
              <p className="text-parchment/85">
                {isGuest(user) ? 'You’re playing as ' : 'Welcome back, '}
                <strong className="text-parchment" data-testid="display-name">
                  {displayName(user)}
                </strong>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <PlayTile
                  to="/play"
                  testId="play-vs-bots"
                  primary
                  icon={<Bot aria-hidden="true" className="h-6 w-6" />}
                  title="Play vs bots"
                  text="Four seats, bots from beginner to max strength."
                />
                <PlayTile
                  to="/play"
                  testId="play"
                  icon={<Globe aria-hidden="true" className="h-6 w-6" />}
                  title="Play online"
                  text="Join an open table or host your own lobby."
                />
              </div>
              <nav
                aria-label="More"
                className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-sm lg:justify-start"
              >
                <SecondaryLink to="/history" icon={<History aria-hidden="true" />}>
                  Match history
                </SecondaryLink>
                <SecondaryLink to="/leaderboard" icon={<Trophy aria-hidden="true" />}>
                  Leaderboard
                </SecondaryLink>
                <SecondaryLink to="/account" icon={<Settings aria-hidden="true" />}>
                  Account settings
                </SecondaryLink>
              </nav>
              {isGuest(user) ? (
                <Link
                  to="/sign-up"
                  className="group inline-flex items-center justify-center gap-2 self-center rounded-lg border border-gold/40 bg-gold/5 px-4 py-2.5 text-sm font-semibold text-gold transition-colors duration-150 hover:border-gold/70 hover:bg-gold/10 lg:self-start"
                >
                  <UserPlus aria-hidden="true" className="h-4 w-4" />
                  Create account and keep your history
                </Link>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mt-8 flex w-full max-w-md flex-col gap-3">
                <Link to="/guest" className={ctaPrimary}>
                  Play as Guest
                </Link>
                <div className="grid grid-cols-2 gap-3">
                  <Link to="/sign-in" className={ctaSecondary}>
                    Sign in
                  </Link>
                  <Link to="/sign-up" className={ctaSecondary}>
                    Create account
                  </Link>
                </div>
                <p className="text-xs text-parchment/65">
                  No sign-up needed to start: guests can keep their games later.
                </p>
              </div>
              <ul className="mt-10 grid w-full max-w-xl grid-cols-2 gap-x-6 gap-y-5 text-left">
                {VALUE_PROPS.map((v) => (
                  <li key={v.title} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brass/30 bg-brass/10 text-brass">
                      {v.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-parchment">{v.title}</span>
                      <span className="block text-xs leading-snug text-parchment/55">{v.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="border-t border-parchment/10 bg-linear-to-b from-ink/60 to-ink/20">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <p className="mb-3 text-xs font-semibold tracking-[0.35em] text-gold uppercase">
              Nine civilizations
            </p>
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Choose the emblem you lead
            </h2>
            <p className="mt-3 text-sm text-pretty text-parchment/60">
              Every civ fields the same standard army for now, so each game is decided on the board.
            </p>
          </div>
          {deferred ? (
            <Suspense fallback={<MedallionRow />}>
              <CivMedallions />
            </Suspense>
          ) : (
            <MedallionRow />
          )}
        </div>
      </section>
    </div>
  )
}

function PlayTile({
  to,
  testId,
  icon,
  title,
  text,
  primary = false,
}: {
  to: string
  testId: string
  icon: ReactNode
  title: string
  text: string
  primary?: boolean
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cx(
        'group relative flex items-start gap-4 rounded-2xl border p-5 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:translate-y-px',
        primary
          ? 'border-gold/70 bg-gold text-ink shadow-[0_14px_36px_-16px_rgba(212,160,23,0.75)] hover:bg-gold-bright'
          : 'border-parchment/15 bg-panel/80 text-parchment hover:border-gold/50 hover:bg-panel',
      )}
    >
      <span
        className={cx(
          'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
          primary ? 'bg-ink/10 text-ink' : 'bg-gold/10 text-gold',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-base font-semibold">
          {title}
          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 opacity-60 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </span>
        <span
          className={cx(
            'mt-1 block text-sm leading-snug',
            primary ? 'text-ink/75' : 'text-parchment/60',
          )}
        >
          {text}
        </span>
      </span>
    </Link>
  )
}

function SecondaryLink({ to, icon, children }: { to: string; icon: ReactNode; children: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-parchment/75 transition-colors duration-150 hover:bg-parchment/5 hover:text-parchment [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-parchment/50"
    >
      {icon}
      {children}
    </Link>
  )
}
