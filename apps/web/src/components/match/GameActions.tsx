import { DRAW_VOTE, isUntimed } from '@game/protocol'
import type { MatchStateJson, SeatStateJson } from '@game/protocol/state'
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { type MatchRoom, matchApi } from '../../lib/match.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { GameButton } from '../game/GameButton.tsx'
import { FlagIcon } from '../game/icons.tsx'
import { Dialog, DialogClose, Tooltip, TooltipProvider } from '../overlay.tsx'
import { Button } from '../ui.tsx'
import { RankedBadge } from './RankedBadge.tsx'
import { SEAT_LABEL, seatHex, seatName } from './seats.ts'

/** What the panel shows for a seat: the player's name or the bot's level. */
export function seatPlayerName(seat: SeatStateJson | undefined): string {
  if (!seat) return ''
  if (seat.isBot) return `Bot · ${seat.botLevel === 'max' ? 'Max' : seat.botLevel}`
  return seat.displayName
}

/** "You" for the viewer's own seat, else the name and the seat ("Bot · 1500 (West)"). */
function who(state: MatchStateJson, seat: number, mySeat: number): string {
  if (seat === mySeat) return 'You'
  return `${seatPlayerName(state.seats[seat])} (${SEAT_LABEL[seatName(seat)]})`
}

// ---------------------------------------------------------------------------
// Resign / Offer draw buttons
// ---------------------------------------------------------------------------

/**
 * A tooltip with what a game button does, or why it is disabled. A disabled button gets no
 * pointer or focus events, so the wrapper is the trigger, and it becomes focusable while the
 * button is disabled so keyboard users can read the reason too.
 */
function HintWrap({
  hint,
  disabled,
  children,
}: {
  hint: string
  disabled: boolean
  children: ReactElement
}) {
  return (
    <Tooltip content={hint}>
      <span
        className="flex min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        {...(disabled ? { tabIndex: 0 } : {})}
        data-hint={hint}
      >
        {children}
      </span>
    </Tooltip>
  )
}

/**
 * Resign and Offer draw. `voters` comes from the rules engine (`Game.drawVoters()`); a
 * seat that is not a voter no longer takes turns, so it can't resign or offer either.
 */
export function GameActions({
  room,
  feed,
  voters,
  myDefeatReason = null,
  children,
}: {
  room: MatchRoom
  feed: MatchFeed
  voters: readonly boolean[] | null
  /** How the viewer's own seat was knocked out (rules defeat reason), if it was. */
  myDefeatReason?: string | null
  /** More buttons for the same row (Leave, settings). */
  children?: ReactNode
}) {
  const { state, mySeat } = feed
  const [confirming, setConfirming] = useState(false)
  const resignButton = useRef<HTMLButtonElement>(null)
  const inGame = state.phase === 'in_game'
  const playing = inGame && mySeat >= 0 && voters?.[mySeat] === true
  const cooldown = mySeat >= 0 ? (state.drawCooldowns?.[mySeat] ?? 0) : 0
  const pending = (state.drawOfferSeat ?? -1) >= 0

  let resignWhy = ''
  if (!inGame) resignWhy = 'The game is over'
  else if (mySeat < 0) resignWhy = 'Only players can resign'
  else if (!playing) resignWhy = 'You are no longer taking turns'

  let drawWhy = ''
  if (!inGame) drawWhy = 'The game is over'
  else if (mySeat < 0) drawWhy = 'Only players can offer a draw'
  else if (!playing) drawWhy = 'You are no longer taking turns'
  else if (pending)
    drawWhy =
      state.drawOfferSeat === mySeat
        ? 'Your draw offer is waiting for answers'
        : 'A draw offer is waiting for answers'
  else if (cooldown > 0)
    drawWhy = `You can offer again after ${cooldown} more move${cooldown === 1 ? '' : 's'}`

  const send = matchApi(room).send
  const mine = mySeat >= 0 ? state.seats[mySeat] : undefined
  const imOut = inGame && (mine?.status === 'removed' || mine?.status === 'frozen')
  return (
    <TooltipProvider>
      {imOut ? (
        <p
          className="mb-3 rounded-lg border border-parchment/10 bg-ink/45 px-3 py-2 text-xs leading-relaxed text-parchment/70"
          data-testid="out-note"
        >
          {myDefeatReason === 'resign' ? 'You resigned.' : 'You are out of this game.'} You can keep
          watching or leave.
        </p>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 lg:grid-cols-2">
        <HintWrap
          hint={resignWhy || 'Give up your seat in this game'}
          disabled={Boolean(resignWhy)}
        >
          <GameButton
            ref={resignButton}
            className="w-full hover:!border-seat-south-light/70 hover:!text-seat-south-light disabled:pointer-events-none"
            disabled={Boolean(resignWhy)}
            onClick={() => setConfirming(true)}
            data-testid="resign"
          >
            <FlagIcon /> Resign
          </GameButton>
        </HintWrap>
        <HintWrap
          hint={drawWhy || 'Offer a draw to every player still in the game'}
          disabled={Boolean(drawWhy)}
        >
          <GameButton
            className="w-full disabled:pointer-events-none"
            disabled={Boolean(drawWhy)}
            aria-describedby={drawWhy && playing ? 'draw-why' : undefined}
            onClick={() => send('offerDraw', {})}
            data-testid="offer-draw"
          >
            <span aria-hidden="true" className="font-display text-base leading-none">
              ½
            </span>
            <span className="sm:hidden">Draw</span>
            <span className="hidden sm:inline">Offer draw</span>
          </GameButton>
        </HintWrap>
        {children}
      </div>
      {playing && cooldown > 0 && !pending ? (
        <p id="draw-why" className="mt-2 text-xs text-parchment/50" data-testid="draw-hint">
          {drawWhy}.
        </p>
      ) : null}
      <ResignDialog
        state={state}
        open={confirming}
        onOpenChange={setConfirming}
        returnFocusTo={resignButton}
        onConfirm={() => {
          setConfirming(false)
          send('resign', {})
        }}
      />
    </TooltipProvider>
  )
}

/** Confirms a resignation and says what it means in this mode. */
function ResignDialog({
  state,
  open,
  onOpenChange,
  onConfirm,
  returnFocusTo,
}: {
  state: MatchStateJson
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  returnFocusTo: RefObject<HTMLElement | null>
}) {
  const teams = state.mode === 'teams'
  const solo = isUntimed(state.timeControl)
  const ranked = Boolean(state.ranked)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      returnFocusTo={returnFocusTo}
      title="Resign this game?"
      testId="resign-dialog"
      className="border-seat-south/40"
      actions={
        <>
          <DialogClose>
            <Button variant="ghost">Keep playing</Button>
          </DialogClose>
          <Button variant="danger" onClick={onConfirm} data-testid="resign-confirm">
            Resign
          </Button>
        </>
      }
    >
      <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-seat-south-light/90">
        {teams ? 'Teams 2v2' : 'Free-for-all'}
        {ranked ? <RankedBadge /> : null}
      </p>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-parchment/75">
        {teams ? (
          <>
            <li>
              Only you resign: your pieces <strong className="text-parchment">freeze</strong> in
              place. They still block squares and can be captured.
            </li>
            <li>Your partner plays on alone. If your partner is already out, your team loses.</li>
          </>
        ) : (
          <>
            <li>
              Your army is <strong className="text-parchment">removed from the board</strong> and
              you are out of the game.
            </li>
            <li>You finish in the place of a player knocked out now.</li>
          </>
        )}
        {ranked ? (
          <li data-testid="resign-ranked-note">
            This is a ranked game: your <strong className="text-parchment">Elo</strong> changes by
            the place you finish in.
          </li>
        ) : null}
        <li>
          {solo
            ? 'You can stay and watch the bots finish, or leave at any time.'
            : 'You can stay and watch the rest of the game, or leave at any time.'}
        </li>
      </ul>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Draw offer card
// ---------------------------------------------------------------------------

interface ShownOffer {
  offerSeat: number
  votes: number[]
  /** Set while a declined offer stays on screen for a moment. */
  declinedSeat: number
}

/** How long a declined offer stays on screen, with the decline shown. */
const DECLINED_LINGER_MS = 3500

/**
 * The pending draw offer, for everyone: who offered and each voter's answer, with Accept and
 * Decline for a voter still pending. A declined offer stays a moment to show who declined.
 * Also turns `drawEvent` messages into toasts (declines and lapses).
 */
export function DrawOfferCard({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const { state, mySeat, lastDraw, notify } = feed
  const [declined, setDeclined] = useState<ShownOffer | null>(null)
  const lastOffer = useRef<ShownOffer | null>(null)
  const handled = useRef(0)
  const offerSeat = state.drawOfferSeat ?? -1
  const live: ShownOffer | null =
    offerSeat >= 0 ? { offerSeat, votes: [...(state.drawVotes ?? [])], declinedSeat: -1 } : null
  if (live) lastOffer.current = live

  useEffect(() => {
    if (!lastDraw || lastDraw.id === handled.current) return
    handled.current = lastDraw.id
    if (lastDraw.type === 'declined') {
      const votes =
        lastOffer.current?.offerSeat === lastDraw.offerSeat
          ? [...lastOffer.current.votes]
          : [0, 1, 2, 3].map((i) => (i === lastDraw.offerSeat ? DRAW_VOTE.accepted : -1))
      setDeclined({ offerSeat: lastDraw.offerSeat, votes, declinedSeat: lastDraw.seat })
      notify(
        lastDraw.seat === mySeat
          ? 'You declined the draw.'
          : `${who(state, lastDraw.seat, mySeat)} declined the draw.`,
        'info',
      )
    } else if (lastDraw.type === 'lapsed') {
      const offer =
        lastDraw.offerSeat === mySeat
          ? 'Your draw offer'
          : `The draw offer from ${who(state, lastDraw.offerSeat, mySeat)}`
      // Who left the voters: a voter of the offer whose seat no longer takes turns (the
      // state may lag the event by a moment, so fall back to a general wording).
      const prior = lastOffer.current?.offerSeat === lastDraw.offerSeat ? lastOffer.current : null
      const gone = prior
        ? [0, 1, 2, 3].find(
            (i) =>
              prior.votes[i] !== DRAW_VOTE.notVoter &&
              (state.seats[i]?.status === 'removed' || state.seats[i]?.status === 'frozen'),
          )
        : undefined
      const goneText =
        gone === undefined
          ? 'a player is out of the game'
          : gone === mySeat
            ? 'you are out of the game'
            : `${who(state, gone, mySeat)} is out of the game`
      notify(
        lastDraw.reason === 'voters_changed'
          ? `${offer} lapsed: ${goneText}.`
          : `${offer} lapsed after a full round without everyone accepting.`,
        'info',
      )
    } else if (lastDraw.type === 'offered') {
      setDeclined(null)
    }
  }, [lastDraw, mySeat, notify, state])

  useEffect(() => {
    if (!declined) return
    const t = window.setTimeout(() => setDeclined(null), DECLINED_LINGER_MS)
    return () => window.clearTimeout(t)
  }, [declined])

  const shown = live ?? (state.phase === 'in_game' ? declined : null)
  if (!shown) return null
  const isDeclined = shown.declinedSeat >= 0
  const myVote = mySeat >= 0 ? shown.votes[mySeat] : undefined
  const canAnswer = !isDeclined && myVote === DRAW_VOTE.pending
  const send = matchApi(room).send
  const offerer = shown.offerSeat === mySeat ? 'You' : seatPlayerName(state.seats[shown.offerSeat])

  return (
    <section
      className={`mb-3 rounded-xl border p-3 transition ${
        isDeclined
          ? 'border-seat-south/40 bg-seat-south/[0.06]'
          : 'border-gold/45 bg-gold/[0.07] shadow-[0_0_0_1px_rgba(212,160,23,0.08)]'
      }`}
      aria-live="polite"
      aria-labelledby="draw-offer-title"
      data-testid="draw-offer"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-base ${
            isDeclined ? 'bg-seat-south/20 text-seat-south-light' : 'bg-gold/15 text-gold'
          }`}
        >
          ½
        </span>
        <div className="min-w-0">
          <p
            className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${
              isDeclined ? 'text-seat-south-light/90' : 'text-gold/85'
            }`}
          >
            {isDeclined ? 'Draw declined' : 'Draw offer'}
          </p>
          <p id="draw-offer-title" className="text-sm leading-snug font-semibold break-words">
            {offerer} offered a draw
          </p>
        </div>
      </div>
      <ul className="mt-2.5 flex flex-col gap-1" data-testid="draw-votes">
        {shown.votes.map((vote, i) => {
          if (vote === DRAW_VOTE.notVoter) return null
          const status =
            i === shown.declinedSeat
              ? 'declined'
              : vote === DRAW_VOTE.accepted
                ? 'accepted'
                : 'pending'
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: seats are fixed positions
              key={i}
              className="flex items-center justify-between gap-2 rounded-lg bg-ink/45 px-2.5 py-1 text-sm"
              data-testid={`draw-vote-${seatName(i)}`}
              data-status={status}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: seatHex(i) }}
                />
                <span className="truncate">
                  {seatPlayerName(state.seats[i])}
                  {i === mySeat ? (
                    <span className="text-xs text-gold"> (you)</span>
                  ) : (
                    <span className="text-xs text-parchment/45"> · {SEAT_LABEL[seatName(i)]}</span>
                  )}
                </span>
              </span>
              <VoteChip status={isDeclined && status === 'pending' ? 'none' : status} />
            </li>
          )
        })}
      </ul>
      {canAnswer ? (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Button
            className="h-10"
            onClick={() => send('respondDraw', { accept: true })}
            data-testid="draw-accept"
          >
            Accept draw
          </Button>
          <Button
            variant="secondary"
            className="h-10"
            onClick={() => send('respondDraw', { accept: false })}
            data-testid="draw-decline"
          >
            Decline
          </Button>
        </div>
      ) : (
        <p
          className="mt-2 text-xs leading-relaxed text-parchment/55"
          title={
            isDeclined
              ? undefined
              : 'The offer lapses if anyone declines, a player is knocked out, or after a full round.'
          }
        >
          {isDeclined ? 'The game goes on.' : 'Everyone still in the game must accept.'}
        </p>
      )}
    </section>
  )
}

function VoteChip({ status }: { status: 'accepted' | 'pending' | 'declined' | 'none' }) {
  if (status === 'none') return <span className="text-xs text-parchment/35">—</span>
  const styles = {
    accepted: 'bg-seat-east/20 text-[#7fd8b7]',
    pending: 'bg-parchment/10 text-parchment/65',
    declined: 'bg-seat-south/25 text-seat-south-light',
  }
  const label = { accepted: 'Accepted', pending: 'Waiting', declined: 'Declined' }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}
    >
      {status === 'pending' ? (
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {label[status]}
    </span>
  )
}
