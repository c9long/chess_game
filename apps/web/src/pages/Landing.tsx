import { APP_NAME, CIVILIZATIONS } from '@game/config'
import { Bot, ChevronRight, Globe, History, Settings, Trophy, UserPlus } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import type { DemoTable } from '../components/landing/DemoBoard.tsx'
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
      // The first frame is on its way: deferred work starts after this mark (the E2E check).
      performance.mark?.('landing:first-frame')
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

const SEAT_ORDER = ['south', 'west', 'north', 'east'] as const
type SeatName = (typeof SEAT_ORDER)[number]
const SEAT_LABEL: Record<SeatName, string> = {
  south: 'South',
  west: 'West',
  north: 'North',
  east: 'East',
}
const SEAT_DOT: Record<SeatName, string> = {
  south: 'bg-seat-south',
  west: 'bg-seat-west',
  north: 'bg-seat-north',
  east: 'bg-seat-east',
}

/** The steps of a game, in order (this list is a real sequence). */
const STEPS: { title: string; text: string }[] = [
  {
    title: 'Four armies take the edges',
    text: 'Each player picks a civilization and sets up on one side of a 16×16 board. Bots fill any empty seat.',
  },
  {
    title: 'Turns go clockwise',
    text: 'South, then West, North and East. Anyone can attack anyone, so watch all three rivals.',
  },
  {
    title: 'Lose your leader and you’re out',
    text: 'There is no checkmate: a king left under attack can simply be taken. Stalemate is a loss too.',
  },
  {
    title: 'The last civ standing wins',
    text: 'In Teams, partners sit opposite each other and win or lose together.',
  },
]

export function Landing() {
  const { session } = useAppState()
  const location = useLocation()
  const deleted = (location.state as { deleted?: boolean } | null)?.deleted
  const user = session?.user
  const deferred = useAfterFirstPaint()
  const [boardReady, setBoardReady] = useState(false)
  const [table, setTable] = useState<DemoTable | null>(null)

  return (
    <div className="relative overflow-x-clip">
      {deleted ? (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <Alert tone="success">Your account has been deleted.</Alert>
        </div>
      ) : null}

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-6 pb-16 sm:pt-10 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-14 lg:pt-10 lg:pb-20">
        {/* The demo table: on the right from lg; on phones above the text (signed out) or below
            the play buttons (signed in). Decorative and inert. */}
        <div className={cx('min-w-0 lg:order-2', user ? 'order-2' : null)}>
          <DemoTableFrame table={table}>
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
                  <DemoBoard onReady={() => setBoardReady(true)} onTable={setTable} />
                </Suspense>
              ) : null}
            </div>
          </DemoTableFrame>
        </div>

        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <h1 className="font-display text-[clamp(3rem,2.2rem+3vw,5.25rem)] leading-[0.95] font-semibold tracking-[-0.025em] text-balance">
            {APP_NAME}
          </h1>
          <p className="mt-6 max-w-md font-display text-xl leading-snug text-pretty text-parchment/80 sm:text-2xl">
            Four players. Sixteen by sixteen. One civ left standing.
          </p>

          {user ? (
            <div className="mt-9 flex w-full max-w-xl flex-col gap-4" data-testid="signed-in">
              <p className="text-parchment/85">
                {isGuest(user) ? 'You’re playing as ' : 'Welcome back, '}
                <strong className="text-parchment" data-testid="display-name">
                  {displayName(user)}
                </strong>
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-1">
                <PlayTile
                  to="/play"
                  testId="play-vs-bots"
                  primary
                  icon={<Bot aria-hidden="true" className="h-6 w-6" />}
                  title="Play vs bots"
                  text="Three bots, from beginner to max strength."
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
                className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-sm lg:-ml-3 lg:justify-start"
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
            <div className="mt-9 flex w-full max-w-sm flex-col gap-3">
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
              <p className="text-sm text-parchment/60">
                No sign-up needed. Guests can save their games to an account later.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-parchment/10" aria-labelledby="how-heading">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-20 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-14">
          <div>
            <h2 id="how-heading" className="font-display text-title font-semibold">
              How a game goes
            </h2>
            <p className="mt-3 max-w-sm text-parchment/65">
              Chess rules for every piece. What changes is who you play against, and how you lose.
            </p>
            <TurnOrder className="mt-8 hidden w-40 lg:block" />
          </div>
          <ol className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="font-display text-3xl leading-none font-semibold text-gold/80 tabular-nums"
                >
                  {i + 1}
                </span>
                <span>
                  <span className="block text-lg font-semibold text-parchment">{step.title}</span>
                  <span className="mt-1.5 block leading-relaxed text-parchment/65">
                    {step.text}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-parchment/10" aria-labelledby="civs-heading">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 id="civs-heading" className="font-display text-title font-semibold">
              Nine civilizations
            </h2>
            <p className="mt-3 text-parchment/65">
              Pick one before each game. Most field the standard army and mark your seat with their
              emblem. England plays by its own charter.
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

/**
 * The demo board as a table: a nameplate for each seat sits along its edge (South at the
 * bottom, as the board is drawn from South's side) and follows the game: who is to move, who is
 * out. On phones the four plates sit in a row under the board. Decorative: the game is watch-only
 * and the plates repeat what the board shows.
 */
function DemoTableFrame({ table, children }: { table: DemoTable | null; children: ReactNode }) {
  const plate = (seat: SeatName) => {
    const i = SEAT_ORDER.indexOf(seat)
    const civ = table?.civs[i]
    const status = table?.statuses[i]
    const out = status !== undefined && status !== 'active'
    const toMove = !!table && !table.isOver && table.seatToMove === seat && !out
    const won = !!table && table.isOver && !out
    return (
      <span
        className={cx(
          'inline-flex items-center gap-2 text-sm whitespace-nowrap transition-colors duration-300',
          out ? 'text-parchment/60' : 'text-parchment/85',
        )}
      >
        <span
          className={cx(
            'h-2.5 w-2.5 shrink-0 rounded-full transition-opacity duration-300',
            SEAT_DOT[seat],
            out ? 'opacity-30' : null,
          )}
        />
        <span className={cx('font-semibold', out ? 'line-through decoration-1' : null)}>
          {(civ && CIVILIZATIONS.find((c) => c.slug === civ)?.name) || SEAT_LABEL[seat]}
        </span>
        <span className={cx(toMove || won ? 'text-gold' : 'text-parchment/65')}>
          {won ? 'wins' : out ? 'out' : toMove ? 'to move' : SEAT_LABEL[seat]}
        </span>
      </span>
    )
  }
  return (
    <div className="mx-auto w-full max-w-[34rem] lg:max-w-[min(100%,calc(100svh-9rem))]">
      <div aria-hidden="true" className="mb-2 hidden justify-center lg:flex">
        {plate('north')}
      </div>
      <div className="relative lg:px-9">
        <div
          aria-hidden="true"
          className="absolute top-1/2 left-0 hidden origin-center -translate-x-[calc(50%-0.75rem)] -translate-y-1/2 -rotate-90 lg:block"
        >
          {plate('west')}
        </div>
        {children}
        <div
          aria-hidden="true"
          className="absolute top-1/2 right-0 hidden origin-center translate-x-[calc(50%-0.75rem)] -translate-y-1/2 rotate-90 lg:block"
        >
          {plate('east')}
        </div>
      </div>
      <div aria-hidden="true" className="mt-2 hidden justify-center lg:flex">
        {plate('south')}
      </div>
      {/* Phones and tablets: the four plates in turn order under the board. */}
      <div
        aria-hidden="true"
        className="mt-3 grid grid-cols-2 justify-items-start gap-x-6 gap-y-2 px-2 sm:flex sm:flex-wrap sm:justify-center lg:hidden"
      >
        {SEAT_ORDER.map((seat) => (
          <span key={seat}>{plate(seat)}</span>
        ))}
      </div>
    </div>
  )
}

/** Turn order as a small diagram: the four seats around a square, clockwise arrows between them. */
function TurnOrder({ className }: { className?: string }) {
  // Seat positions (South at the bottom) and the arrows South → West → North → East → South.
  const seats: { seat: SeatName; x: number; y: number }[] = [
    { seat: 'south', x: 60, y: 104 },
    { seat: 'west', x: 16, y: 60 },
    { seat: 'north', x: 60, y: 16 },
    { seat: 'east', x: 104, y: 60 },
  ]
  const fill: Record<SeatName, string> = {
    south: 'fill-seat-south',
    west: 'fill-seat-west',
    north: 'fill-seat-north',
    east: 'fill-seat-east',
  }
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-labelledby="turn-order-title">
      <title id="turn-order-title">Turn order: South, West, North, East, then South again</title>
      <rect
        x="30"
        y="30"
        width="60"
        height="60"
        rx="3"
        className="fill-parchment/[0.04] stroke-parchment/25"
        strokeWidth="1"
      />
      <defs>
        <marker
          id="turn-arrow"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L8 4 L0 8 z" className="fill-parchment/50" />
        </marker>
      </defs>
      {/* Clockwise arcs, seen from above with South at the bottom: S → W → N → E → S. */}
      <g className="fill-none stroke-parchment/45" strokeWidth="1.5" markerEnd="url(#turn-arrow)">
        <path d="M50 102 Q22 98 18 72" markerEnd="url(#turn-arrow)" />
        <path d="M18 50 Q22 22 48 18" markerEnd="url(#turn-arrow)" />
        <path d="M72 18 Q98 22 102 48" markerEnd="url(#turn-arrow)" />
        <path d="M102 70 Q98 98 72 102" markerEnd="url(#turn-arrow)" />
      </g>
      {seats.map((s) => (
        <circle key={s.seat} cx={s.x} cy={s.y} r="7" className={fill[s.seat]} />
      ))}
    </svg>
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
