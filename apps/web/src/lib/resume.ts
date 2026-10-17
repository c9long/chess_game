/**
 * "The app is back": the tab or app became visible again, a page was restored from the
 * back/forward cache, or the network came back. Mobile OSes freeze or kill background
 * WebViews, so a live connection may have died while away.
 */
export function onResume(cb: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') cb()
  }
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) cb()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('online', cb)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('online', cb)
  }
}
