import { isUntimed } from '@game/protocol'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { Button } from '../ui.tsx'
import { EloDelta } from './RankedBadge.tsx'
import {
  DEFEAT_REASON_LABEL,
  END_REASON_LABEL,
  ordinal,
  SEAT_LABEL,
  seatHex,
  seatName,
  teamLabel,
} from './seats.ts'

export function GameOver({
  feed,
  defeatReasons,
  onClose,
  onLeave,
}: {
  feed: MatchFeed
  /** Per seat: how it was knocked out (rules defeat reason), or null. */
  defeatReasons: (string | null)[] | null
  onClose: () => void
  onLeave: () => void
}) {
  const { state, gameOver, mySeat } = feed
  const result = state.result
  const placements = gameOver?.placements ?? result.placements
  const aborted = result.type === 'aborted'
  const order = [0, 1, 2, 3].sort((a, b) => (placements[a] ?? 9) - (placements[b] ?? 9))
  const myPlace = mySeat >= 0 ? placements[mySeat] : undefined

  // Ratings arrive with gameOver (after the result is saved); until then, the room state.
  const rated = gameOver ? gameOver.rated : state.rated
  const myRating = mySeat >= 0 ? (gameOver?.ratings[mySeat] ?? null) : null
  const agreedDraw = result.type === 'ffa_agreed_draw' || result.type === 'teams_agreed_draw'
  // A player knocked out before an agreed draw didn't share it: they see their own place.
  const inDraw = agreedDraw && (myPlace === undefined || myPlace === 1)
  let headline = 'Game over'
  if (aborted) headline = 'Game cancelled'
  else if (inDraw) headline = 'Draw agreed'
  else if (result.type === 'teams_draw') headline = 'Draw'
  else if (myPlace === 1) headline = 'Victory'
  else if (myPlace) headline = `You finished ${ordinal(myPlace)}`

  const parts = [END_REASON_LABEL[result.endReason] ?? '']
  if (agreedDraw && !inDraw) parts[0] = 'The remaining players agreed to a draw'
  if (inDraw && myPlace === 1 && placements.filter((p) => p === 1).length > 1) {
    parts.push('You share 1st place')
  }
  if (result.type === 'teams_winner')
    parts[0] = `${teamLabel(result.winnerTeam === 'south_north' ? 0 : 1)} wins`
  if (result.type === 'ffa_winner' && result.winnerSeat >= 0) {
    const w = state.seats[result.winnerSeat]
    parts[0] = `${w?.isBot ? `Bot ${w.botLevel}` : w?.displayName} (${civName(w?.civ ?? '')}) is the last civilization standing`
  }
  // Each part reads as a sentence, so the line is punctuated the same however it's built.
  const subline = parts
    .filter(Boolean)
    .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`))
    .join(' ')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      data-testid="game-over"
    >
      <section className="w-full max-w-lg rounded-2xl border border-gold/30 bg-panel p-6 shadow-2xl shadow-black/60 sm:p-8">
        <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-gold/80">
          {isUntimed(state.timeControl)
            ? 'Untimed game vs bots'
            : state.ranked
              ? rated
                ? 'Ranked game'
                : 'Ranked game · not rated'
              : 'Casual game'}
        </p>
        <h2 id="game-over-title" className="mt-1 font-display text-4xl font-semibold">
          {headline}
        </h2>
        {subline ? <p className="mt-2 text-sm text-parchment/65">{subline}</p> : null}
        {myRating ? (
          <p
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/[0.07] px-3 py-1.5 text-sm tabular-nums"
            data-testid="my-elo-change"
          >
            <span className="text-parchment/65">
              {state.timeControl} {state.mode === 'ffa' ? 'Free-for-all' : 'Teams'} Elo
            </span>
            <span className="font-semibold">
              {myRating.before} → {myRating.after}
            </span>
            <EloDelta delta={myRating.after - myRating.before} className="font-semibold" />
          </p>
        ) : null}

        {aborted ? null : (
          <ol className="mt-6 flex flex-col gap-2">
            {order.map((i) => {
              const seat = state.seats[i]
              if (!seat) return null
              const rating = gameOver?.ratings[i]
              const reason = defeatReasons?.[i] ?? null
              const delta = rating ? rating.after - rating.before : null
              return (
                <li
                  key={i}
                  data-testid={`placement-${seatName(i)}`}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    i === mySeat ? 'border-gold/50 bg-gold/5' : 'border-parchment/10'
                  }`}
                >
                  <span className="w-10 text-center font-display text-lg font-semibold text-parchment/80">
                    {placements[i] ? ordinal(placements[i]) : '—'}
                  </span>
                  <span style={{ color: seatHex(i) }}>
                    <CivEmblem civ={seat.civ} className="h-7 w-7" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {seat.isBot ? `Bot · ${seat.botLevel}` : seat.displayName}
                    </span>
                    <span className="block text-xs text-parchment/50">
                      {civName(seat.civ)} · {SEAT_LABEL[seatName(i)]}
                      {reason ? (
                        <span
                          className={reason === 'resign' ? 'text-seat-south-light/90' : ''}
                          data-testid={`defeat-${seatName(i)}`}
                        >
                          {' · '}
                          {DEFEAT_REASON_LABEL[reason] ?? reason}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {rating && delta !== null ? (
                    <span
                      className="text-right text-sm tabular-nums"
                      data-testid={`elo-${seatName(i)}`}
                      title={`Elo ${rating.before} → ${rating.after}`}
                    >
                      <span className="block font-semibold">
                        {rating.after}
                        <span className="ml-1 text-[11px] font-medium text-parchment/45">Elo</span>
                      </span>
                      <EloDelta delta={delta} className="block text-xs font-semibold" />
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}

        <div className="mt-7 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            View board
          </Button>
          <Button onClick={onLeave} data-testid="back-to-lobbies">
            {isUntimed(state.timeControl) ? 'Back to Play' : 'Back to lobbies'}
          </Button>
        </div>
      </section>
    </div>
  )
}
