/**
 * Where the web app is running: a normal browser, or inside the mobile app shells (Capacitor,
 * docs/MOBILE.md). Every native-only branch goes through here.
 *
 * Capacitor injects `window.Capacitor` into its WebView before any page script runs, so no
 * dependency is needed to detect it. A native build (`pnpm --filter @game/web build:native`,
 * VITE_NATIVE=1) counts as native even before the shell's bridge is there, so the bearer-token
 * mode is on from the first request.
 */

export type Platform = 'web' | 'ios' | 'android'

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** True for a native build (VITE_NATIVE) or when running inside a Capacitor shell. */
export function isNativeBuild(): boolean {
  const flag = import.meta.env.VITE_NATIVE
  return flag === '1' || flag === 'true'
}

/** Running inside the iOS or Android app (or a native build of the web app). */
export function isNative(): boolean {
  if (isNativeBuild()) return true
  try {
    return capacitor()?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

/** 'ios' or 'android' inside the apps, else 'web'. A native build outside a shell guesses from the user agent. */
export function platform(): Platform {
  try {
    const p = capacitor()?.getPlatform?.()
    if (p === 'ios' || p === 'android') return p
  } catch {}
  if (!isNative() || typeof navigator === 'undefined') return 'web'
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios'
  }
  return 'web'
}
