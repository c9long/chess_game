import type { ReactNode } from 'react'
import { SwitchRow } from '../ui.tsx'

/** The "Ranked" switch of the lobby form and the challenge form. */
export function RankedToggle({
  ranked,
  disabled = false,
  caption,
  hint,
  onChange,
}: {
  ranked: boolean
  disabled?: boolean
  caption: string
  /** What the choice means, or why it is unavailable. */
  hint: ReactNode
  onChange: (ranked: boolean) => void
}) {
  return (
    <SwitchRow
      label="Ranked"
      caption={caption}
      hint={hint}
      checked={ranked}
      disabled={disabled}
      onChange={onChange}
      testId="ranked-toggle"
      hintTestId="ranked-hint"
    />
  )
}
