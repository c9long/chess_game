import { useId } from 'react'
import { canVibrate } from '../../lib/feedback.ts'
import { useMediaQuery } from '../../lib/media.ts'
import { isNative } from '../../lib/platform.ts'
import { usePrefs } from '../../lib/prefs.ts'

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm text-parchment/75 hover:text-parchment">
      {label}
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--color-gold)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

/** What the board's screen-reader announcements read (moves live region). */
function AnnounceSetting() {
  const prefs = usePrefs()
  const id = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <div className="flex items-center justify-between gap-3 text-sm text-parchment/75">
        <label htmlFor={id} className="cursor-pointer hover:text-parchment">
          Read out moves
        </label>
        <select
          id={id}
          value={prefs.announceMoves}
          onChange={(e) => prefs.set({ announceMoves: e.target.value === 'own' ? 'own' : 'all' })}
          aria-describedby={hintId}
          className="h-8 rounded-md border border-parchment/20 bg-ink/60 px-2 text-sm text-parchment"
          data-testid="announce-moves"
        >
          <option value="all">Every move</option>
          <option value="own">Only mine</option>
        </select>
      </div>
      <p id={hintId} className="text-[11px] text-parchment/50">
        For screen readers. “Only mine” still reads checks, captures of your pieces and results.
      </p>
    </div>
  )
}

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-parchment/25 border-b-2 bg-ink/60 px-1 font-mono text-[11px] leading-none text-parchment/85">
      {children}
    </kbd>
  )
}

/** The board's keyboard controls (BoardView handles them on the focused canvas). */
export function KeyboardHints({ compact = false }: { compact?: boolean }) {
  const rows: [string[], string][] = [
    [['←', '↑', '→', '↓'], 'Move the cursor (its square is read out)'],
    [['Enter', 'Space'], 'Pick up / place a piece'],
    [['Esc'], 'Cancel'],
    [['+', '−'], 'Zoom in / out'],
    [['0'], 'Show the whole board'],
  ]
  if (compact) {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1">
          <Kbd>←↑→↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> select
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> cancel
        </span>
        <span className="flex items-center gap-1">
          <Kbd>+</Kbd>
          <Kbd>−</Kbd> zoom
        </span>
      </span>
    )
  }
  return (
    <dl className="flex flex-col gap-1.5 text-xs text-parchment/65">
      {rows.map(([keys, what]) => (
        <div key={what} className="flex items-center justify-between gap-3">
          <dt className="flex gap-1">
            {keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  )
}

/** How to zoom and pan the board with fingers (BoardView handles the gestures). */
export function TouchHints() {
  const rows: [string, string][] = [
    ['Pinch, or double-tap an empty square', 'Zoom in / out'],
    ['Drag with one finger off your pieces', 'Move the zoomed board'],
    ['Magnifier button (board corner)', 'Zoom in / out with one hand'],
  ]
  return (
    <dl className="flex flex-col gap-1.5 text-xs text-parchment/65">
      {rows.map(([how, what]) => (
        <div key={what} className="flex items-baseline justify-between gap-3">
          <dt className="text-parchment/80">{how}</dt>
          <dd className="shrink-0 text-right">{what}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Board preferences and keyboard help, opened from the gear button. */
export function BoardSettings({ id }: { id: string }) {
  const prefs = usePrefs()
  const touch = useMediaQuery('(pointer: coarse)')
  return (
    <section
      id={id}
      aria-label="Board settings"
      className="rounded-xl border border-parchment/10 bg-ink/40 p-3.5"
      data-testid="board-settings"
    >
      <h2 className="mb-1.5 text-[11px] font-semibold tracking-[0.2em] text-parchment/50 uppercase">
        Board settings
      </h2>
      <div className="flex flex-col">
        <Toggle label="Sound" checked={prefs.sound} onChange={(v) => prefs.set({ sound: v })} />
        {/* Only on touch devices that can vibrate (Android; iPhone Safari has no vibration). */}
        {canVibrate() && (touch || isNative()) ? (
          <Toggle
            label="Vibration"
            checked={prefs.vibration}
            onChange={(v) => prefs.set({ vibration: v })}
          />
        ) : null}
        <Toggle
          label="Colour-blind markers"
          checked={prefs.colorblindPatterns}
          onChange={(v) => prefs.set({ colorblindPatterns: v })}
        />
        <Toggle
          label="Reduced motion"
          checked={prefs.reducedMotion}
          onChange={(v) => prefs.set({ reducedMotion: v })}
        />
        <AnnounceSetting />
      </div>
      <h2 className="mt-3 mb-2 border-t border-parchment/10 pt-3 text-[11px] font-semibold tracking-[0.2em] text-parchment/50 uppercase">
        Keyboard
      </h2>
      <KeyboardHints />
      {touch ? (
        <>
          <h2 className="mt-3 mb-2 border-t border-parchment/10 pt-3 text-[11px] font-semibold tracking-[0.2em] text-parchment/50 uppercase">
            Touch
          </h2>
          <TouchHints />
        </>
      ) : null}
    </section>
  )
}
