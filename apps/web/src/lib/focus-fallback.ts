/**
 * Keeps keyboard focus on the page when an action removes the control it came from (blocking
 * from a Friends row, Unblock, resolving a report in the review queue). Without this, focus
 * falls to <body> and keyboard and screen-reader users start again at the top of the page.
 */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusEl(target: HTMLElement): boolean {
  if (!target.isConnected) return false
  if (!target.matches(FOCUSABLE) && !target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus({ preventScroll: false })
  return document.activeElement === target
}

function focusHeadingOf(el: HTMLElement): boolean {
  return focusEl(
    el.querySelector<HTMLElement>('[data-focus-fallback-target]') ??
      el.querySelector<HTMLElement>('h1, h2, h3') ??
      el,
  )
}

const lost = () => document.activeElement === null || document.activeElement === document.body

/**
 * Call before an action that may remove `el`; call the returned function once the action has
 * succeeded. For about two seconds afterwards, if `el` is gone and focus fell to <body>, focus
 * moves to `pick()` when given and it returns an element (e.g. the next item of a list), else
 * to the nearest ancestor marked `data-focus-fallback` that is still on the page (its
 * `data-focus-fallback-target`, or its heading), or else to the page's first heading.
 */
export function keepFocusNear(
  el: HTMLElement | null | undefined,
  pick?: () => HTMLElement | null | undefined,
): () => void {
  const anchors: HTMLElement[] = []
  for (let n = el?.parentElement; n; n = n.parentElement) {
    if (n.hasAttribute('data-focus-fallback')) anchors.push(n)
  }
  return () => {
    let tries = 0
    const tick = () => {
      tries++
      if (el?.isConnected === false && lost()) {
        const picked = pick?.()
        if (picked && focusEl(picked)) return
        for (const a of anchors) if (a.isConnected && focusHeadingOf(a)) return
        const h1 = document.querySelector<HTMLElement>('main h1, h1')
        if (h1 && focusHeadingOf(h1)) return
      }
      if (tries < 20) window.setTimeout(tick, 100)
    }
    window.setTimeout(tick, 0)
  }
}
