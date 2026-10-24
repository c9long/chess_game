/**
 * The recent games on a public profile (opt-in public match history): the day each game was
 * played, and who played with and against the owner. Text only, so it is unit-tested; the
 * result and game line are shared with the History page (`components/match/labels.ts`).
 */
import type { ProfileGame, ProfileGamePlayer } from '@game/protocol'

/** "Oct 24, 2026" from the game's `YYYY-MM-DD` (a UTC day, so it is shown as that day). */
export function playedOnLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })
}

/** Teams games: the owner's partner and the other team. Free-for-all: everyone is against. */
export function sidesOf(g: ProfileGame): {
  partners: ProfileGamePlayer[]
  opponents: ProfileGamePlayer[]
} {
  if (g.mode !== 'teams' || g.team === null) return { partners: [], opponents: g.others }
  return {
    partners: g.others.filter((o) => o.team === g.team),
    opponents: g.others.filter((o) => o.team !== g.team),
  }
}
