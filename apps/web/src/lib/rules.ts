import { initRules } from '@game/rules'
import { useEffect, useState } from 'react'

/** Loads the WebAssembly rules engine once; true when it is ready to use. */
export function useRulesReady(): { ready: boolean; error: boolean } {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    let live = true
    initRules()
      .then(() => live && setReady(true))
      .catch(() => live && setError(true))
    return () => {
      live = false
    }
  }, [])
  return { ready, error }
}
