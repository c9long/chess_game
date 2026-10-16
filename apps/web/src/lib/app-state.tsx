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
import { api, type LegalStatus, type PublicConfig } from './api.ts'
import { authClient, type SessionData } from './auth-client.ts'

interface AppState {
  config: PublicConfig | undefined
  configError: boolean
  legal: LegalStatus | undefined
  refreshLegal: () => Promise<void>
  session: SessionData | null
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

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>()
  const [configError, setConfigError] = useState(false)
  const [legal, setLegal] = useState<LegalStatus>()
  const { data: session, isPending, refetch } = authClient.useSession()
  const [signingOut, setSigningOut] = useState(false)
  const [leaveState, setLeaveState] = useState<unknown>()
  const sawSignedOut = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    api<PublicConfig>('/api/config')
      .then(setConfig)
      .catch(() => setConfigError(true))
  }, [])

  const refreshLegal = useCallback(async () => {
    try {
      setLegal(await api<LegalStatus>('/api/legal/status'))
    } catch {
      setConfigError(true)
    }
  }, [])

  const userId = session?.user.id
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check whenever the signed-in user changes
  useEffect(() => {
    void refreshLegal()
  }, [refreshLegal, userId])

  const refreshSession = useCallback(async () => {
    await refetch()
  }, [refetch])

  const signedOut = !isPending && !session
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
        configError,
        legal,
        refreshLegal,
        session: session ?? null,
        sessionPending: isPending,
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
