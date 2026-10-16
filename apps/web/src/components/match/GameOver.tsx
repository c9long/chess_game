import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { Button } from '../ui.tsx'
import { END_REASON_LABEL, ordinal, SEAT_LABEL, seatHex, seatName, teamLabel } from './seats.ts'

export function GameOver({
  feed,
  onClose,
  onLeave,
}: {
  feed: MatchFeed
  onClose: () => void
  onLeave: () => void
}) {
  const { state, gameOver, mySeat } = feed
  const result = state.result
  const placements = gameOver?.placements ?? result.placements
  const aborted = result.type === 'aborted'
  const order = [0, 1, 2, 3].sort((a, b) => (placements[a] ?? 9) - (placements[b] ?? 9))
  const myPlace = mySeat >= 0 ? placements[mySeat] : undefined

  let headline = 'Game over'
  if (aborted) headline = 'Game cancelled'
  else if (result.type === 'teams_draw') headline = 'Draw'
  else if (myPlace === 1) headline = 'Victory'
  else if (myPlace) headline = `You finished ${ordinal(myPlace)}`

  let subline = END_REASON_LABEL[result.endReason] ?? ''
  if (result.type === 'teams_winner')
    subline = `${teamLabel(result.winnerTeam === 'south_north' ? 0 : 1)} wins`
  if (result.type === 'ffa_winner' && result.winnerSeat >= 0) {
    const w = state.seats[result.winnerSeat]
    subline = `${w?.isBot ? `Bot ${w.botLevel}` : w?.displayName} (${civName(w?.civ ?? '')}) is the last civilization standing`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      data-testid="game-over"
    >
      <section className="w-full max-w-lg rounded-2xl border border-gold/30 bg-panel p-6 shadow-2xl shadow-black/60 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold/80">
          {gameOver?.rated || state.rated ? 'Rated game' : 'Casual game'}
        </p>
        <h2 id="game-over-title" className="mt-1 font-display text-4xl font-semibold">
          {headline}
        </h2>
        {subline ? <p className="mt-2 text-sm text-parchment/65">{subline}</p> : null}

        {aborted ? null : (
          <ol className="mt-6 flex flex-col gap-2">
            {order.map((i) => {
              const seat = state.seats[i]
              if (!seat) return null
              const rating = gameOver?.ratings[i]
              const delta = rating ? rating.after - rating.before : null
              return (
                <li
                  key={i}
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
                    </span>
                  </span>
                  {rating ? (
                    <span className="text-right text-sm tabular-nums">
                      <span className="block font-semibold">{rating.after}</span>
                      <span
                        className={`block text-xs ${delta && delta > 0 ? 'text-[#7fd8b7]' : delta && delta < 0 ? 'text-seat-south-light' : 'text-parchment/50'}`}
                      >
                        {delta && delta > 0 ? `+${delta}` : delta}
                      </span>
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
            Back to lobbies
          </Button>
        </div>
      </section>
    </div>
  )
}
