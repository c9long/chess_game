/**
 * The Friends page's "Add friends" panel: send a request by exact username (any case), or
 * search players by name (3+ characters, as you type) and add them from the results, or open
 * their profile. The server ranks results and leaves out anyone you can't see (players you
 * blocked, guests, deleted or suspended accounts); refusals arrive as one neutral message.
 */
import {
  PLAYER_SEARCH_MIN_CHARS,
  PLAYER_SEARCH_NEEDS,
  type PlayerSearchResponse,
  type PlayerSearchResult,
} from '@game/protocol'
import { Search, Send, X } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../../lib/api.ts'
import {
  acceptFriendRequest,
  profilePath,
  type SeatRelation,
  searchPlayers,
  sendFriendRequestByUsername,
  socialErrorMessage,
  socialNotice,
  useSocial,
} from '../../lib/social.ts'
import { MODE_LABEL } from '../match/labels.ts'
import { Button, cx, Field, linkButtonClass, Spinner } from '../ui.tsx'
import { FriendButton, Monogram } from './FriendButton.tsx'

const USERNAME_CHARS = /^[A-Za-z0-9_]*$/

/** The server's "can't add" (your caps) is shown by FriendButton from the cap flags. */
const seatRelation = (r: PlayerSearchResult['relation']): SeatRelation =>
  r === 'unavailable' ? 'none' : r

function ratingText(r: PlayerSearchResult): string {
  const games = `${r.gamesPlayed} game${r.gamesPlayed === 1 ? '' : 's'}`
  if (!r.rating) return games
  return `${r.rating.rating} Elo, ${MODE_LABEL[r.rating.mode] ?? r.rating.mode} ${r.rating.timeControl}, ${games}`
}

function AddByUsername({ primary }: { primary: boolean }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const input = useRef<HTMLInputElement>(null)

  function refuse(message: string) {
    setError(message)
    // Back to the field: it reads out with the error attached (aria-describedby).
    input.current?.focus()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const username = name.trim()
    setDone(undefined)
    if (!username) {
      refuse('Type their username.')
      return
    }
    if (!USERNAME_CHARS.test(username) || username.length > 20) {
      refuse('Usernames use letters, digits and _ (up to 20).')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const res = await sendFriendRequestByUsername(username)
      const message =
        res.relation === 'friends'
          ? `You and ${res.user.username} are now friends.`
          : `Friend request sent to ${res.user.username}.`
      setDone(message)
      socialNotice({ title: message, tone: 'success' })
      setName('')
    } catch (err) {
      refuse(socialErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={submit} noValidate>
      <Field
        ref={input}
        label="Add by username"
        name="friend-username"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={20}
        placeholder="Their exact username"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setError(undefined)
          setDone(undefined)
        }}
        error={error}
        hint={done ?? 'Capitals don’t matter.'}
        className="flex-1"
        data-testid="add-by-username"
      />
      {/* Never disabled: a disabled button would drop keyboard focus mid-request. */}
      <Button
        type="submit"
        aria-busy={busy || undefined}
        variant={primary ? 'primary' : 'secondary'}
        className={cx('sm:mt-[1.625rem]', busy && 'cursor-progress')}
        data-testid="add-by-username-send"
      >
        {busy ? <Spinner /> : <Send aria-hidden="true" className="h-4 w-4" />}
        Send request
      </Button>
      {/* Both outcomes are said aloud; the toast covers sighted users on success. */}
      <p className="sr-only" role="status" data-testid="add-by-username-status">
        {error ?? done ?? ''}
      </p>
    </form>
  )
}

function ResultRow({ r, data }: { r: PlayerSearchResult; data: PlayerSearchResponse }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-testid="player-result">
      <Monogram name={r.username} size="sm" />
      <div className="min-w-0 flex-1">
        {/* Out of the tab order: "View profile" is the same link, with a full label. */}
        <Link
          to={profilePath(r.username)}
          tabIndex={-1}
          className="block truncate font-display text-body font-semibold text-parchment underline-offset-[3px] hover:underline hover:decoration-brass"
          data-testid="player-result-name"
        >
          {r.username}
        </Link>
        <p className="text-caption text-faint lining-nums">{ratingText(r)}</p>
      </div>
      <div className="flex items-center gap-1">
        <FriendButton
          name={r.username}
          relation={seatRelation(r.relation)}
          capReached={data.capReached}
          outgoingFull={data.outgoingFull}
          onAdd={() => sendFriendRequestByUsername(r.username)}
          onAccept={() => (r.userId ? acceptFriendRequest(r.userId) : Promise.resolve())}
          shortOnPhones
          testId="player-result-add"
        />
        <Link
          to={profilePath(r.username)}
          className={linkButtonClass('quiet', 'px-2.5', 'sm')}
          aria-label={`View ${r.username}’s profile`}
        >
          Profile
        </Link>
      </div>
    </li>
  )
}

const plural = (n: number) => `${n} player${n === 1 ? '' : 's'}`

function PlayerSearch() {
  const [q, setQ] = useState('')
  const [data, setData] = useState<PlayerSearchResponse>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const version = useSocial((s) => s.version)
  const seq = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const resultsId = useId()
  const listLabelId = useId()
  const query = q.trim()
  const charsOk = USERNAME_CHARS.test(query)
  // Search needs 3 letters or digits in a row (the server refuses anything else). Below 3
  // characters the "type at least 3" hint shows instead.
  const valid =
    charsOk && (query.length < PLAYER_SEARCH_MIN_CHARS || PLAYER_SEARCH_NEEDS.test(query))
  const ready = valid && query.length >= PLAYER_SEARCH_MIN_CHARS

  // Debounced search-as-you-type; `version` refreshes the states after any friend change.
  // The previous results stay on screen (dimmed) until the new ones arrive, so the page
  // below doesn't jump on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` refetches after friend changes
  useEffect(() => {
    if (!ready) {
      seq.current++
      setData(undefined)
      setLoading(false)
      setError(undefined)
      return
    }
    const mine = ++seq.current
    setLoading(true)
    const id = window.setTimeout(async () => {
      try {
        const res = await searchPlayers(query)
        if (mine === seq.current) {
          setData(res)
          setError(undefined)
        }
      } catch (err) {
        if (mine !== seq.current) return
        setError(
          err instanceof ApiError && err.status === 429
            ? 'Too many searches. Wait a moment and try again.'
            : 'Search didn’t work. Check your connection and try again.',
        )
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(id)
  }, [query, ready, version])

  const fieldError = !charsOk
    ? 'Usernames use letters, digits and _.'
    : !valid
      ? 'Include 3 letters or digits in a row.'
      : error
  const hint =
    valid && query.length > 0 && query.length < PLAYER_SEARCH_MIN_CHARS
      ? `Type at least ${PLAYER_SEARCH_MIN_CHARS} characters.`
      : undefined
  const fresh = ready && data !== undefined && data.query.toLowerCase() === query.toLowerCase()
  // Said aloud: errors first, then "Searching…", then a count that names the query (so the
  // same count for a new query is still announced).
  const status = fieldError
    ? fieldError
    : !ready
      ? ''
      : loading || !fresh
        ? 'Searching…'
        : data.results.length === 0
          ? `No players found for ${data.query}.`
          : `${plural(data.results.length)} found for ${data.query}.`

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Field
          ref={input}
          label="Search players"
          type="search"
          name="player-search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          placeholder="Part of a username"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          error={fieldError}
          hint={hint}
          aria-controls={resultsId}
          // Room for the search icon on the left and our clear button or spinner on the
          // right; the browser's own clear button is hidden so the two never overlap.
          className="[&_input]:pr-10 [&_input]:pl-9 [&_input::-webkit-search-cancel-button]:appearance-none"
          data-testid="player-search"
        />
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-[2.4rem] left-3 h-4 w-4 text-faint"
        />
        {loading ? (
          <span className="absolute top-[2.35rem] right-3 text-faint">
            <Spinner />
          </span>
        ) : q ? (
          <button
            type="button"
            className="absolute top-[1.875rem] right-1.5 flex h-8 w-8 items-center justify-center rounded-plate text-faint transition-colors duration-150 hover:bg-parchment/[0.06] hover:text-parchment"
            aria-label="Clear search"
            onClick={() => {
              setQ('')
              input.current?.focus()
            }}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite" data-testid="player-search-status">
        {status}
      </p>
      <div id={resultsId}>
        {/* After a failed search the old results go: they no longer answer what was typed. */}
        {ready && data && !error ? (
          data.results.length === 0 ? (
            <p
              className={cx('text-ui text-muted', !fresh && 'opacity-70')}
              data-testid="player-search-empty"
            >
              No players found for “{data.query}”.
            </p>
          ) : (
            <>
              <h3 id={listLabelId} className="sr-only">
                Search results for {data.query}
              </h3>
              <ul
                aria-labelledby={listLabelId}
                aria-busy={!fresh || undefined}
                className={cx(
                  'divide-y divide-rule border-y border-rule transition-opacity duration-150',
                  !fresh && 'opacity-60',
                )}
              >
                {data.results.map((r) => (
                  <ResultRow key={r.username} r={r} data={data} />
                ))}
              </ul>
            </>
          )
        ) : null}
      </div>
    </div>
  )
}

/** `primary`: Send request is the page's main action (nobody on your list yet). */
export function FindPlayers({ primary = false }: { primary?: boolean }) {
  return (
    <div
      className="grid gap-x-8 gap-y-6 rounded-panel border border-rule bg-surface-rail p-4 shadow-rim sm:p-5"
      data-testid="find-players"
    >
      <AddByUsername primary={primary} />
      <PlayerSearch />
    </div>
  )
}
