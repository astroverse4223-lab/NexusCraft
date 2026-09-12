import { type JSX, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { Trouble } from '@shared/types'
import { api } from '../api'
import { Spinner } from '../components/ui'

/**
 * What the launcher has complained about lately.
 *
 * Every silent failure this app has had wrote a line to its log first. A
 * resource pack that would not build said exactly why - the payload was too
 * big for the channel it was sent down - and that line sat unread for hours
 * because the only copy was in a file nobody knew to open. The information was
 * never missing; it was somewhere nobody could reach.
 *
 * So this is not new diagnostics. It is the diagnostics that already existed,
 * put somewhere a person can look.
 */
export function TroublePanel(): JSX.Element {
  const [lines, setLines] = useState<Trouble[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setLines(await api.app.recentTrouble(100))
    } catch {
      setLines([])
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="panel panel-pad col gap-12">
      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <div className="section-title" style={{ flex: 1 }}>
          Recent warnings
        </div>

        <button className="btn btn-sm" disabled={busy} onClick={() => void load()}>
          {busy ? <Spinner /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <p className="small muted">
        Anything the launcher decided was worth writing down. Most of it is harmless and none of it is sent anywhere
        &mdash; but when something quietly does nothing, the reason is usually already here.
      </p>

      {lines === null ? (
        <Spinner />
      ) : lines.length === 0 ? (
        <p className="small muted">Nothing has gone wrong since this log was started.</p>
      ) : (
        <div className="col gap-2" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {lines.map((line, at) => (
            <div key={at} className="trouble-line row gap-8">
              <span
                className="tiny"
                style={{
                  minWidth: 42,
                  flexShrink: 0,
                  color: line.level === 'ERROR' ? 'var(--danger)' : 'var(--warning)'
                }}
              >
                {line.level}
              </span>

              <span className="tiny dim" style={{ minWidth: 62, flexShrink: 0 }}>
                {line.at.slice(11, 19)}
              </span>

              <span className="tiny dim" style={{ minWidth: 82, flexShrink: 0 }}>
                {line.scope}
              </span>

              <span className="tiny mono" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {line.message}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="tiny dim row gap-6">
        <AlertTriangle size={12} /> A line here does not mean something is broken. An action that did nothing, though,
        almost always has one.
      </p>
    </div>
  )
}
