import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router'
import {
  type AgeGateState,
  ageGateState,
  isTransientSessionError,
  retryDelayMs,
  UNREACHABLE_AFTER_FAILURES,
} from './age-gate.ts'
import { api, type LegalStatus, type PublicConfig } from './api.ts'
import { authClient, type SessionData } from './auth-client.ts'

interface AppState {
  config: PublicConfig | undefined
  /** The public config hasn't loaded and the server keeps failing (it is still retried). */
  configError: boolean
  /** The latest legal status (kept across refetches and failures). */
  legal: LegalStatus | undefined
  /**
   * Whom `legal` describes, as the server saw it: a user id, null when signed out, undefined
   * before the first answer. Compare with the session before trusting `legal`.
   */
  legalFor: string | null | undefined
  /** Too many failed legal-status attempts in a row: stop waiting for it. */
  legalUnreachable: boolean
  /** Fetch the legal status again; false when it failed (the previous answer is kept). */
  refreshLegal: () => Promise<boolean>
  /** What the age screen should do on this page (see lib/age-gate.ts). */
  ageGate: (requireAge: boolean) => AgeGateState
  session: SessionData | null
  /** True until the client knows whether anyone is signed in (including while retrying). */
  sessionPending: boolean
  refreshSession: () => Promise<void>
  /**
   * True from the start of `leaveSession` until the next sign-in (or a failed sign-out).
   * Meanwhile RequireAuth sends a missing session to the landing page (with `leaveState`)
   * instead of to sign-in. It stays set after the landing page shows, because a route change
   * started mid-sign-out (say, the header's Play link) can still be suspended on its lazy chunk
   * and commit after the session is gone.
   */
  signingOut: boolean
  /** The navigation state `leaveSession` was given (e.g. `{ deleted: true }`). */
  leaveState: unknown
  /**
   * Leave the signed-in area: go to the landing page first (replacing the current entry), then
   * run `end` (sign out, or refresh after deleting the account). Without the ordering and the
   * `signingOut` flag, a RequireAuth page could see the session vanish before the navigation
   * commits and send the player to /sign-in instead.
   */
  leaveSession: (end: () => Promise<unknown>, state?: unknown) => Promise<void>
  /** Sign out from anywhere and land on the landing page. */
  signOut: () => Promise<void>
}

const Ctx = createContext<AppState | undefined>(undefined)

/** Waits (up to `timeoutMs`) until no session fetch is in flight. */
function sessionSettled(timeoutMs = 10_000): Promise<void> {
  const atom = authClient.$store.atoms.session
  if (!atom) return Promise.resolve()
  const settled = () => {
    const v = atom.get() as { isPending: boolean; isRefetching: boolean }
    return !v.isPending && !v.isRefetching
  }
  if (settled()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    const timer = window.setTimeout(done, timeoutMs)
    const unsubscribe = atom.listen(() => {
      if (settled()) done()
    })
  })
}

/** Marker for "don't know who the visitor is yet": no legal-status request is keyed to it. */
const UNKNOWN = Symbol('unknown visitor')

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>()
  const [configFailures, setConfigFailures] = useState(0)
  const [legalState, setLegalState] = useState<{
    status: LegalStatus | undefined
    failures: number
    /** The visitor the failures were counted for. */
    failedFor: string | null | typeof UNKNOWN
  }>({ status: undefined, failures: 0, failedFor: UNKNOWN })
  const {
    data: session,
    isPending,
    isRefetching,
    error: sessionError,
    refetch,
  } = authClient.useSession()
  const [sessionFailures, setSessionFailures] = useState(0)
  const lastSessionError = useRef<unknown>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [leaveState, setLeaveState] = useState<unknown>()
  const sawSignedOut = useRef(false)
  const navigate = useNavigate()

  // The public config, retried with backoff while the server is unreachable (a restart).
  useEffect(() => {
    if (config) return
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        api<PublicConfig>('/api/config')
          .then((c) => {
            if (!cancelled) setConfig(c)
          })
          .catch(() => {
            if (!cancelled) setConfigFailures((f) => f + 1)
          })
      },
      configFailures === 0 ? 0 : retryDelayMs(configFailures),
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [config, configFailures])

  // The session. Better Auth keeps the signed-in user through a failed refetch and clears it
  // on a 401; a failure with no user yet (say the page loaded while the API restarted) means
  // "unknown", not "signed out": retry with backoff instead of treating the visitor as new.
  const sessionUnknown = !session && (isPending || isTransientSessionError(sessionError))
  useEffect(() => {
    if (sessionError && sessionError !== lastSessionError.current) {
      lastSessionError.current = sessionError
      if (!session && isTransientSessionError(sessionError)) setSessionFailures((f) => f + 1)
    } else if (!sessionError && !isPending && !isRefetching) {
      setSessionFailures(0)
    }
  }, [sessionError, session, isPending, isRefetching])
  useEffect(() => {
    if (session || isPending || !isTransientSessionError(sessionError)) return
    const timer = window.setTimeout(() => void refetch(), retryDelayMs(sessionFailures))
    return () => window.clearTimeout(timer)
  }, [session, isPending, sessionError, sessionFailures, refetch])

  // The legal status, keyed to the visitor the server saw (`userId`). It is fetched at once on
  // load (alongside the session), again whenever the visitor changes, and retried with backoff
  // while there is no answer for the current visitor. A failed or superseded request never
  // replaces an answer that arrived.
  const key: string | null | typeof UNKNOWN = sessionUnknown ? UNKNOWN : (session?.user.id ?? null)
  const keyRef = useRef(key)
  keyRef.current = key
  const legalSeq = useRef(0)
  const legalInFlight = useRef(false)
  const legal = legalState.status
  const legalFor = legal ? (legal.userId ?? null) : undefined
  const legalFailures = legalState.failedFor === key ? legalState.failures : 0

  const fetchLegal = useCallback(async (): Promise<boolean> => {
    const mine = ++legalSeq.current
    const startedFor = keyRef.current
    legalInFlight.current = true
    try {
      const status = await api<LegalStatus>('/api/legal/status')
      if (mine !== legalSeq.current) return true
      legalInFlight.current = false
      const now = keyRef.current
      const matches = now === UNKNOWN || (status.userId ?? null) === now
      if (!matches && startedFor !== now) {
        // The visitor changed while this was in flight (a sign-in): ask again for the new one.
        setLegalState((s) => ({ ...s, status }))
        void fetchLegal()
        return true
      }
      setLegalState((s) =>
        matches
          ? { status, failures: 0, failedFor: now }
          : // The server and the client disagree on who is signed in (one of them is stale):
            // keep asking, with backoff, until they agree.
            { status, failures: (s.failedFor === now ? s.failures : 0) + 1, failedFor: now },
      )
      return matches
    } catch {
      if (mine === legalSeq.current) {
        legalInFlight.current = false
        const now = keyRef.current
        setLegalState((s) => ({
          ...s,
          failures: (s.failedFor === now ? s.failures : 0) + 1,
          failedFor: now,
        }))
      }
      return false
    }
  }, [])

  // On load, in parallel with the session fetch.
  useEffect(() => {
    void fetchLegal()
  }, [fetchLegal])
  // A new visitor (sign-in, sign-out), or no answer yet for this one: (re)fetch, with backoff
  // after failures.
  useEffect(() => {
    if (key === UNKNOWN || legalFor === key || legalInFlight.current) return
    const timer = window.setTimeout(
      () => void fetchLegal(),
      legalFailures === 0 ? 0 : retryDelayMs(legalFailures),
    )
    return () => window.clearTimeout(timer)
  }, [key, legalFor, legalFailures, fetchLegal])

  const refreshLegal = fetchLegal

  const failures = Math.max(legalFailures, sessionFailures)
  const user = session?.user as { id: string; ageConfirmed?: boolean | null } | undefined
  const ageGate = useCallback(
    (requireAge: boolean) =>
      ageGateState({
        user: user ?? null,
        sessionUnsettled: sessionUnknown,
        legal,
        legalFor,
        failures,
        requireAge,
      }),
    [user, sessionUnknown, legal, legalFor, failures],
  )

  // Resolves once the session store has the new answer. A refetch that another session fetch
  // supersedes (Better Auth refetches by itself right after a sign-in) resolves early; without
  // waiting, a page navigated to next would still see the signed-out state, and briefly show
  // the age screen to an account that never needs it.
  const refreshSession = useCallback(async () => {
    await refetch()
    await sessionSettled()
  }, [refetch])

  const signedOut = !sessionUnknown && !session
  // Over once the session has ended and a new one starts (the next sign-in, or a guest).
  useEffect(() => {
    if (!signingOut) return
    if (signedOut) sawSignedOut.current = true
    else if (sawSignedOut.current && session) setSigningOut(false)
  }, [signingOut, signedOut, session])

  const leaveSession = useCallback(
    async (end: () => Promise<unknown>, state?: unknown) => {
      sawSignedOut.current = false
      setLeaveState(state)
      setSigningOut(true)
      navigate('/', { replace: true, ...(state === undefined ? {} : { state }) })
      try {
        await end()
      } catch (err) {
        setSigningOut(false)
        throw err
      }
    },
    [navigate],
  )

  const signOut = useCallback(
    () =>
      leaveSession(async () => {
        const res = await authClient.signOut()
        if (res?.error) throw new Error(res.error.message ?? 'sign-out failed')
      }).catch(() => {
        // Still signed in (the landing page shows it); leaveSession has cleared the flag.
      }),
    [leaveSession],
  )

  return (
    <Ctx.Provider
      value={{
        config,
        configError: !config && configFailures >= UNREACHABLE_AFTER_FAILURES,
        legal,
        legalFor,
        legalUnreachable: legalFailures >= UNREACHABLE_AFTER_FAILURES,
        refreshLegal,
        ageGate,
        session: session ?? null,
        sessionPending: sessionUnknown,
        refreshSession,
        signingOut,
        leaveState,
        leaveSession,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAppState(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppStateProvider missing')
  return v
}

/** Display name: username for accounts, generated name for guests. */
export function displayName(user: SessionData['user']): string {
  const u = user as SessionData['user'] & {
    displayUsername?: string | null
    username?: string | null
  }
  return u.displayUsername || u.username || u.name
}

export function isGuest(user: SessionData['user'] | undefined): boolean {
  return Boolean((user as { isAnonymous?: boolean | null } | undefined)?.isAnonymous)
}
