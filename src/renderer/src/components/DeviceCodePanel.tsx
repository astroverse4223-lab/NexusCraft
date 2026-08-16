import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import type { DeviceCodePrompt, LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { Spinner } from './ui'
import { useStore } from '../store/useStore'

/**
 * The device code step, shared by every screen that can start a sign-in.
 *
 * Two things here are deliberate:
 *   - the browser is opened automatically, because the user already asked to
 *     sign in and a code with no page to type it into looks like a dead app;
 *   - if opening fails, the failure is shown with the URL in copyable form
 *     rather than swallowed.
 */
export function DeviceCodePanel({ prompt }: { prompt: DeviceCodePrompt }): JSX.Element {
  const authProgress = useStore((s) => s.authProgress)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [openError, setOpenError] = useState<LauncherErrorPayload | null>(null)
  const [opening, setOpening] = useState(false)
  const autoOpened = useRef<string | null>(null)

  async function openPage(): Promise<void> {
    setOpening(true)
    setOpenError(null)
    try {
      await api.app.openExternal(prompt.verificationUri)
    } catch (err) {
      setOpenError(toPayload(err))
    } finally {
      setOpening(false)
    }
  }

  // Open once per issued code, not on every re-render.
  useEffect(() => {
    if (autoOpened.current === prompt.userCode) return
    autoOpened.current = prompt.userCode
    void openPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt.userCode])

  const minutesLeft = Math.max(0, Math.round((prompt.expiresAt - Date.now()) / 60000))

  return (
    <div className="panel panel-pad" style={{ borderColor: 'var(--accent)' }}>
      <div className="row gap-24 items-start wrap">
        <div className="flex-1" style={{ minWidth: 260 }}>
          <div className="field-label">Finish signing in</div>
          <p className="small muted mt-8">
            Your browser should have opened Microsoft's sign-in page. Enter this code there — this window updates
            automatically once you are done.
          </p>

          <div className="row gap-12 mt-16">
            <code
              className="selectable"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 27,
                fontWeight: 700,
                letterSpacing: '0.16em',
                color: 'var(--accent)'
              }}
            >
              {prompt.userCode}
            </code>
            <button
              className="btn btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(prompt.userCode)
                setCopiedCode(true)
                setTimeout(() => setCopiedCode(false), 1600)
              }}
            >
              {copiedCode ? <Check size={14} /> : <Copy size={14} />} {copiedCode ? 'Copied' : 'Copy code'}
            </button>
          </div>

          {minutesLeft > 0 && (
            <div className="tiny dim mt-8">This code expires in about {minutesLeft} minute{minutesLeft === 1 ? '' : 's'}.</div>
          )}
        </div>

        <div className="col gap-8" style={{ minWidth: 210 }}>
          <button className="btn btn-primary" disabled={opening} onClick={() => void openPage()}>
            {opening ? <Spinner /> : <ExternalLink size={15} />} Open Microsoft sign-in
          </button>

          <div className="row gap-8 tiny muted">
            <Spinner /> {authProgress.message || 'Waiting for you to finish signing in'}
          </div>

          <button className="btn btn-ghost btn-sm" onClick={() => void api.auth.cancel()}>
            Cancel
          </button>
        </div>
      </div>

      {/* Manual fallback: always available, and the only route if opening fails. */}
      <div className="divider" style={{ margin: '16px 0 12px' }} />
      <div className="row gap-8 wrap">
        <span className="tiny dim">Or open this address yourself:</span>
        <code className="mono selectable tiny" style={{ color: 'var(--text-muted)' }}>
          {prompt.verificationUri}
        </code>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void navigator.clipboard.writeText(prompt.verificationUri)
            setCopiedUrl(true)
            setTimeout(() => setCopiedUrl(false), 1600)
          }}
        >
          {copiedUrl ? <Check size={13} /> : <Copy size={13} />} {copiedUrl ? 'Copied' : 'Copy link'}
        </button>
      </div>

      {openError && (
        <div className="tiny mt-8" style={{ color: 'var(--warning)' }}>
          NexusCraft could not open your browser ({openError.title}). Copy the address above and open it manually.
        </div>
      )}
    </div>
  )
}
