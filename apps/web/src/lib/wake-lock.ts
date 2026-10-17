import { useEffect } from 'react'

/** The parts of the Screen Wake Lock API used here (not in every TS DOM lib yet). */
interface Sentinel {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', cb: () => void): void
}
interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>
}

function wakeLockApi(): WakeLockApi | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
}

/**
 * Keeps the screen on while `active` (a live game), with the Screen Wake Lock API where the
 * browser has it; otherwise nothing happens. The browser drops the lock whenever the page is
 * hidden, so it is requested again each time the page becomes visible. Released when `active`
 * turns false or the component unmounts. (The app shells will use a keep-awake plugin.)
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const api = wakeLockApi()
    if (!active || !api) return
    let sentinel: Sentinel | null = null
    let disposed = false
    let pending = false

    const acquire = async () => {
      if (disposed || pending || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      pending = true
      try {
        const s = await api.request('screen')
        if (disposed) void s.release().catch(() => {})
        else sentinel = s
      } catch {
        // Refused (battery saver, no user activation yet, permissions policy): try again on
        // the next visibility change.
      } finally {
        pending = false
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}
