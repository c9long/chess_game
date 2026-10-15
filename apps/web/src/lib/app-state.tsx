import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
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
}

const Ctx = createContext<AppState | undefined>(undefined)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>()
  const [configError, setConfigError] = useState(false)
  const [legal, setLegal] = useState<LegalStatus>()
  const { data: session, isPending, refetch } = authClient.useSession()

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
