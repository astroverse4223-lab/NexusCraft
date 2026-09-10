/**
 * Example prompts you can click instead of typing.
 *
 * Clicking runs the request rather than only filling the box. A chip that
 * silently drops text into a field and waits looks broken — you clicked a
 * thing that describes a banner and no banner appeared.
 *
 * The text is passed to the caller rather than read back out of state, because
 * setting state and immediately acting on it reads the value from before the
 * click.
 *
 * The suggestions themselves are built rather than listed. A written list of
 * five meant the refresh button had nothing left to show after two presses,
 * which read as the button being broken.
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

import type { Generator } from '@shared/examples'
import { promptsFor } from '@shared/promptIdeas'

export function PromptChips({
  kind,
  disabled,
  onPick
}: {
  kind: Generator
  disabled?: boolean
  onPick: (text: string) => void
}): JSX.Element {
  const [offset, setOffset] = useState(0)
  const shown = promptsFor(kind, 3, offset)

  return (
    <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
      <span className="tiny dim">Try</span>

      {shown.map((example) => (
        <button
          key={example}
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          onClick={() => onPick(example)}
          title="Use this and design it"
          style={{ fontWeight: 400 }}
        >
          {example}
        </button>
      ))}

      {/* Always offered: there is no end to the list to reach. */}
      <button
        className="btn btn-ghost btn-icon"
        disabled={disabled}
        onClick={() => setOffset((was) => was + 3)}
        title="Other suggestions"
      >
        <RefreshCw size={13} />
      </button>
    </div>
  )
}
