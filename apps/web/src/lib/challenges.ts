/**
 * Challenge wording shared by the Friends page and the challenge prompt, and the ranked
 * challenge rule the form checks before sending (the server checks it too).
 */
import { CHALLENGE_MAX_INVITEES, type Challenge, RANKED_REPEAT_MAX } from '@game/protocol'
import { MODE_LABEL, REPEAT_WINDOW_HOURS } from '../components/match/labels.ts'

/**
 * "Free-for-all, 10+0, casual." (or "…, ranked."), then for an invitee (`viewerId`) "Also
 * invited: Ada." naming the others.
 */
export function challengeLine(c: Challenge, viewerId?: string): string {
  const base = `${MODE_LABEL[c.mode] ?? c.mode}, ${c.timeControl}, ${c.ranked ? 'ranked' : 'casual'}.`
  if (viewerId === undefined) return base
  const others = c.invitees.filter((i) => i.user.userId !== viewerId).map((i) => i.user.username)
  return others.length > 0 ? `${base} Also invited: ${others.join(', ')}.` : base
}

/** Why a ranked challenge is out of reach: fewer friends than a full table needs. */
export function rankedNeedsFriends(friends: number): string | null {
  return friends < CHALLENGE_MAX_INVITEES
    ? `A ranked challenge needs ${CHALLENGE_MAX_INVITEES} friends. You have ${friends}.`
    : null
}

/**
 * Why the challenge form can't be sent yet, or null, from the friends picked and the friends
 * there are. A ranked challenge needs a full table of friends: ranked seats never take bots.
 */
export function challengeBlocker(picked: number, ranked: boolean, friends: number): string | null {
  if (ranked) {
    const tooFew = rankedNeedsFriends(friends)
    if (tooFew) return tooFew
    if (picked < CHALLENGE_MAX_INVITEES) {
      const more = CHALLENGE_MAX_INVITEES - picked
      return `Pick ${more} more friend${more === 1 ? '' : 's'}.`
    }
  }
  return picked === 0 ? 'Pick at least one friend.' : null
}

/** The challenge form's hint under a switched-on Ranked toggle. */
export const RANKED_CHALLENGE_HINT = `Counts toward Elo for up to ${RANKED_REPEAT_MAX} games in ${REPEAT_WINDOW_HOURS} hours with the same group. Bots can’t sit in.`
