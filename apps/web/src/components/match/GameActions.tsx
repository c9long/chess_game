import { DRAW_VOTE, isUntimed } from '@game/protocol'
import type { MatchStateJson, SeatStateJson } from '@game/protocol/state'
import {
  type FocusEvent,
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
import { seatTitle } from '../game/PlayerCard.tsx'
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

/** The Teams partner of a seat (the seat opposite). */
function teammateOf(seat: number): number {
  return (seat + 2) % 4
}

/**
 * How resignation messages name a teammate: a player's name, or a bot by its civilization
 * as the player panel shows it ("the China bot"; "The China bot" to start a sentence), since
 * a bot's level alone ("Bot · 1200") doesn't say which bot.
 */
function teammateName(seat: SeatStateJson | undefined, start = false): string {
  if (!seat) return start ? 'Your teammate' : 'your teammate'
  if (!seat.isBot) return seat.displayName
  return `${start ? 'The' : 'the'} ${seatTitle(seat)}`
}

/**
 * Whether the viewer is navigating by keyboard (last input was a key, not a pointer). Focus
 * is only moved for them when a control they were on goes away, so mouse users never get
 * a tooltip popping up on a control they didn't touch.
 */
let keyboardNav = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (keyboardNav = true), true)
  window.addEventListener('pointerdown', () => (keyboardNav = false), true)
}

/** Whether focus was lost (on the body) or sits on a disabled control. */
function focusLost(): boolean {
  const el = document.activeElement
  return !el || el === document.body || (el as HTMLButtonElement).disabled === true
}

/**
 * Puts keyboard focus back on the Resign control after the card the viewer was on went away:
 * the button, or its hint wrapper while the button is disabled (focusable, so the reason
 * can be read).
 */
function focusResignControl() {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="resign"]')
  if (!button) return
  if (!button.disabled) button.focus()
  else button.parentElement?.focus()
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
  // Where the confirm dialog returns focus when it closes: the Resign button, unless the
  // Teams request already went out and disabled it; then the waiting card (or the button's
  // focusable hint wrapper), so focus never falls to the page.
  const [returnFocus] = useState<RefObject<HTMLElement | null>>(() => ({
    get current() {
      const button = resignButton.current
      if (!button?.disabled) return button
      return (
        document.querySelector<HTMLElement>('[data-testid="team-resign-waiting"]') ??
        button.parentElement
      )
    },
  }))
  const inGame = state.phase === 'in_game'
  const playing = inGame && mySeat >= 0 && voters?.[mySeat] === true
  const cooldown = mySeat >= 0 ? (state.drawCooldowns?.[mySeat] ?? 0) : 0
  const pending = (state.drawOfferSeat ?? -1) >= 0

  // Teams: a resignation is a vote with the teammate (who must still be taking turns to be
  // asked; with a teammate out, the team resigns at once).
  const teams = state.mode === 'teams'
  const partner = mySeat >= 0 ? teammateOf(mySeat) : -1
  const partnerPlaying = teams && partner >= 0 && voters?.[partner] === true
  const teamProposal = teams && mySeat >= 0 ? (state.teamResignSeat?.[mySeat % 2] ?? -1) : -1
  const resignCooldown =
    teams && partnerPlaying && mySeat >= 0 ? (state.teamResignCooldowns?.[mySeat] ?? 0) : 0
  const partnerSeat = partner >= 0 ? state.seats[partner] : undefined
  const partnerName = teammateName(partnerSeat)

  // The teammate's own request arriving while the confirm dialog is open: close it. Its
  // text promised a vote, but resigning now would agree to the teammate's request and end
  // the game at once; the request card says what pressing Resign the game does instead.
  const partnerAsked = teamProposal >= 0 && teamProposal !== mySeat
  useEffect(() => {
    if (partnerAsked) setConfirming(false)
  }, [partnerAsked])

  let resignWhy = ''
  if (!inGame) resignWhy = 'The game is over'
  else if (mySeat < 0) resignWhy = 'Only players can resign'
  else if (!playing) resignWhy = 'You are no longer taking turns'
  else if (teamProposal === mySeat) resignWhy = `Waiting for ${partnerName} to answer`
  else if (teamProposal >= 0) resignWhy = 'Your teammate asked to resign: answer their request'
  else if (resignCooldown > 0)
    resignWhy = `You can ask again after ${resignCooldown} more move${resignCooldown === 1 ? '' : 's'}`
  const resignHint = !teams
    ? 'Give up your seat in this game'
    : partnerPlaying
      ? 'Ask your teammate to resign the game with you'
      : 'Resign the game for your team'

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
        <HintWrap hint={resignWhy || resignHint} disabled={Boolean(resignWhy)}>
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
      {playing && resignCooldown > 0 && teamProposal < 0 ? (
        <p className="mt-2 text-xs text-parchment/50" data-testid="resign-hint">
          {resignWhy}.
        </p>
      ) : null}
      <ResignDialog
        state={state}
        partnerName={partnerName}
        partnerIsBot={Boolean(partnerSeat?.isBot)}
        partnerPlaying={partnerPlaying}
        open={confirming && !partnerAsked}
        onOpenChange={setConfirming}
        returnFocusTo={returnFocus}
        onConfirm={() => {
          setConfirming(false)
          // Never let a stale dialog agree to the teammate's request.
          if (!partnerAsked) send('resign', {})
        }}
      />
    </TooltipProvider>
  )
}

/**
 * Confirms a resignation and says what it means in this mode. In Teams it asks the teammate
 * (who must agree), or resigns the team at once when the teammate is already out.
 */
function ResignDialog({
  state,
  partnerName,
  partnerIsBot,
  partnerPlaying,
  open,
  onOpenChange,
  onConfirm,
  returnFocusTo,
}: {
  state: MatchStateJson
  partnerName: string
  partnerIsBot: boolean
  partnerPlaying: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  returnFocusTo: RefObject<HTMLElement | null>
}) {
  const teams = state.mode === 'teams'
  const solo = isUntimed(state.timeControl)
  const ranked = Boolean(state.ranked)
  const vote = teams && partnerPlaying
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      returnFocusTo={returnFocusTo}
      title={vote ? 'Ask your teammate to resign?' : 'Resign this game?'}
      testId="resign-dialog"
      className="border-seat-south/40"
      actions={
        <>
          <DialogClose>
            <Button variant="ghost">Keep playing</Button>
          </DialogClose>
          <Button variant="danger" onClick={onConfirm} data-testid="resign-confirm">
            {vote ? 'Ask to resign' : 'Resign'}
          </Button>
        </>
      }
    >
      <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-seat-south-light/90">
        {teams ? 'Teams 2v2' : 'Free-for-all'}
        {ranked ? <RankedBadge /> : null}
      </p>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-parchment/75">
        {vote ? (
          <>
            <li data-testid="resign-vote-note">
              Your teammate must agree. If they agree, your team loses. If they decline, you both
              play on.
            </li>
            {partnerIsBot ? null : (
              <li>If {partnerName} doesn’t answer within a full round, your request lapses.</li>
            )}
          </>
        ) : teams ? (
          <li data-testid="resign-vote-note">
            Your teammate is out of the game, so there is nobody to ask: your team{' '}
            <strong className="text-parchment">resigns now and loses</strong>.
          </li>
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
            {teams ? (
              <>
                This is a ranked game: if your team resigns, it counts as a loss in{' '}
                <strong className="text-parchment">Elo</strong> for both of you.
              </>
            ) : (
              <>
                This is a ranked game: your <strong className="text-parchment">Elo</strong> changes
                by the place you finish in.
              </>
            )}
          </li>
        ) : null}
        {teams ? null : (
          <li>
            {solo
              ? 'You can stay and watch the bots finish, or leave at any time.'
              : 'You can stay and watch the rest of the game, or leave at any time.'}
          </li>
        )}
      </ul>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Teams resignation vote card
// ---------------------------------------------------------------------------

/** How long the proposer's card stays after a decline or a lapse, saying what happened. */
const RESIGN_OUTCOME_LINGER_MS = 3500

/**
 * The text for a `voters_changed` lapse, from the viewer's side. `outSeat` comes with the
 * event (the state patch marking the seat out may not have arrived yet).
 */
function droppedText(
  state: MatchStateJson,
  mySeat: number,
  proposer: number,
  outSeat: number | undefined,
): string {
  const partner = teammateOf(mySeat)
  const name = teammateName(state.seats[partner], true)
  const mine = proposer === mySeat
  if (outSeat === mySeat) {
    return mine
      ? 'Your request to resign was dropped: you are out of the game.'
      : `${name}’s request to resign was dropped: you are out of the game.`
  }
  if (outSeat === partner) {
    return mine
      ? `${name} is out of the game, so your request to resign was dropped. You can now resign for your team without a vote.`
      : `${name} is out of the game, so their request to resign was dropped. You can now resign for your team without a vote.`
  }
  return 'The request to resign was dropped: a player on your team is out of the game.'
}

/**
 * Teams: your team's pending resignation vote. The proposer sees "Waiting for <teammate>…",
 * and the answer in the same card for a moment (a decline or a lapse); the teammate sees the
 * request with "Resign the game" and "Keep playing". Opponents see nothing (the vote is
 * between teammates). Also turns `resignEvent` messages into toasts (the request arriving,
 * declines and lapses the card doesn't show), which screen readers announce.
 */
export function TeamResignCard({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const { state, mySeat, lastResign, notify } = feed
  const handled = useRef(0)
  const [outcome, setOutcome] = useState<string | null>(null)
  const card = useRef<HTMLElement>(null)
  const focusInCard = useRef(false)
  const teams = state.mode === 'teams'
  const partner = mySeat >= 0 ? teammateOf(mySeat) : -1
  const proposer = teams && mySeat >= 0 ? (state.teamResignSeat?.[mySeat % 2] ?? -1) : -1
  const partnerSeat = partner >= 0 ? state.seats[partner] : undefined
  const partnerName = teammateName(partnerSeat)

  useEffect(() => {
    if (!lastResign || lastResign.id === handled.current) return
    handled.current = lastResign.id
    if (mySeat < 0 || lastResign.team !== mySeat % 2) return
    const Partner = teammateName(state.seats[teammateOf(mySeat)], true)
    if (lastResign.type === 'proposed') {
      if (lastResign.seat !== mySeat) {
        notify(`${Partner} asks to resign for your team. Answer in the game panel.`, 'info')
      }
    } else if (lastResign.type === 'declined') {
      if (lastResign.seat === mySeat) notify('You chose to keep playing.', 'info')
      else setOutcome(`${Partner} declined to resign. You both play on.`)
    } else if (lastResign.type === 'lapsed') {
      if (lastResign.reason === 'voters_changed') {
        notify(droppedText(state, mySeat, lastResign.seat, lastResign.outSeat), 'info')
      } else if (lastResign.seat === mySeat) {
        setOutcome(`${Partner} didn’t answer within a full round. You both play on.`)
      } else {
        notify(
          `${Partner}’s request to resign lapsed: you didn’t answer within a full round. You both play on.`,
          'info',
        )
      }
    }
  }, [lastResign, mySeat, notify, state])

  // The outcome stays in the proposer's card for a moment, then the card goes.
  useEffect(() => {
    if (!outcome) return
    const t = window.setTimeout(() => setOutcome(null), RESIGN_OUTCOME_LINGER_MS)
    return () => window.clearTimeout(t)
  }, [outcome])

  const active = teams && state.phase === 'in_game'
  const mode = !active
    ? 'none'
    : proposer === mySeat
      ? 'waiting'
      : proposer >= 0
        ? 'request'
        : outcome
          ? 'outcome'
          : 'none'

  // A new proposal replaces a lingering outcome.
  useEffect(() => {
    if (proposer >= 0) setOutcome(null)
  }, [proposer])

  // Keyboard focus: the proposer's Resign button is disabled once the request is sent, so
  // focus moves to the waiting card instead of falling to the page; when a card the viewer
  // was on goes away, focus goes back to the Resign control.
  useEffect(() => {
    if (mode === 'waiting' && keyboardNav && focusLost()) card.current?.focus()
    if (mode === 'none' && focusInCard.current) {
      focusInCard.current = false
      if (keyboardNav && focusLost()) focusResignControl()
    }
  }, [mode])

  if (mode === 'none') return null
  const send = matchApi(room).send
  const focusProps = {
    ref: card,
    onFocus: () => {
      focusInCard.current = true
    },
    onBlur: (e: FocusEvent) => {
      if (!card.current?.contains(e.relatedTarget as Node | null)) focusInCard.current = false
    },
  }

  if (mode === 'waiting' || mode === 'outcome') {
    return (
      <section
        {...focusProps}
        tabIndex={-1}
        className="mb-3 rounded-xl border border-parchment/15 bg-ink/45 p-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        aria-live="polite"
        aria-labelledby="team-resign-waiting-title"
        data-testid="team-resign-waiting"
        data-state={mode}
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-seat-south/15 text-seat-south-light"
          >
            <FlagIcon />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-seat-south-light/90">
              {mode === 'waiting' ? 'You asked to resign' : 'Your request to resign'}
            </p>
            {mode === 'waiting' ? (
              <p
                id="team-resign-waiting-title"
                className="flex items-center gap-2 text-sm leading-snug font-semibold break-words"
              >
                Waiting for {partnerName}…
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
                />
              </p>
            ) : (
              <p
                id="team-resign-waiting-title"
                className="text-sm leading-snug font-semibold break-words"
                data-testid="team-resign-outcome"
              >
                {outcome}
              </p>
            )}
          </div>
        </div>
        {mode === 'waiting' ? (
          <p className="mt-2 text-xs leading-relaxed text-parchment/55">
            If they agree, your team loses. If they decline, you both play on.
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section
      {...focusProps}
      className="mb-3 rounded-xl border border-seat-south/55 bg-seat-south/[0.09] p-3 shadow-[0_0_0_1px_rgba(214,92,92,0.12)]"
      aria-labelledby="team-resign-title"
      aria-describedby="team-resign-desc"
      data-testid="team-resign-request"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-seat-south/20 text-seat-south-light"
        >
          <FlagIcon />
        </span>
        <p
          id="team-resign-title"
          className="min-w-0 text-sm leading-snug font-semibold break-words"
        >
          {teammateName(partnerSeat, true)} wants to resign for your team
        </p>
      </div>
      <p id="team-resign-desc" className="mt-1.5 text-xs leading-relaxed text-parchment/65">
        If you agree, your team loses the game now. If you decline, you both play on.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          variant="danger"
          className="h-9 !px-2 whitespace-nowrap"
          onClick={() => send('respondResign', { accept: true })}
          data-testid="team-resign-accept"
        >
          Resign the game
        </Button>
        <Button
          variant="secondary"
          className="h-9 !px-2 whitespace-nowrap"
          onClick={() => send('respondResign', { accept: false })}
          data-testid="team-resign-decline"
        >
          Keep playing
        </Button>
      </div>
    </section>
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
