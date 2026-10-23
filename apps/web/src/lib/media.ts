import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches, kept up to date as the viewport changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  )
}

/** The `wide:` variant in index.css: wide screens, and phones held sideways. */
export const WIDE_QUERY =
  '(min-width: 64rem), (orientation: landscape) and (max-height: 31.99rem) and (min-width: 40rem)'
