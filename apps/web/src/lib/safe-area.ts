/**
 * The phone's safe-area insets (notch, home indicator, rounded corners) in px, read from the
 * `--safe-*` CSS variables (index.css). For code that positions things itself, e.g. Radix
 * popovers' collision padding, which is measured from the viewport edge. All 0 elsewhere.
 */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

export function safeAreaInsets(): Insets {
  if (typeof document === 'undefined' || !document.body) return NONE
  try {
    // Custom properties compute to their text (`env(...)`); padding resolves it to px.
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const px = (v: string) => Number.parseFloat(v) || 0
    const insets = {
      top: px(cs.paddingTop),
      right: px(cs.paddingRight),
      bottom: px(cs.paddingBottom),
      left: px(cs.paddingLeft),
    }
    probe.remove()
    return insets
  } catch {
    return NONE
  }
}

/** Radix `collisionPadding`: `base` px from each edge, plus that edge's safe-area inset. */
export function safeCollisionPadding(base: number): Insets {
  const i = safeAreaInsets()
  return { top: base + i.top, right: base + i.right, bottom: base + i.bottom, left: base + i.left }
}
