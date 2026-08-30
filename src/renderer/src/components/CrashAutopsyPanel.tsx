import { useEffect, useState } from 'react'
import { Bug, CheckCircle2, Stethoscope, TriangleAlert } from 'lucide-react'
import type { CrashAutopsy, CrashFix, Instance, LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from './ui'

/**
 * Asks a model to read the crash, and offers what it finds as buttons.
 *
 * Only shown once a model is actually configured — offering a feature that
 * always answers "set something up first" is worse than not offering it. The
 * answer is presented as an opinion, with the model named and its own
 * confidence shown, because that is what it is.
 */
export function CrashAutopsyPanel({ instance }: { instance: Instance }): JSX.Element | null {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [autopsy, setAutopsy] = useState<CrashAutopsy | null>(null)
  const [reading, setReading] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [applied, setApplied] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  useEffect(() => {
    void api.launch
      .autopsyAvailable()
      .then((result) => setAvailable(result.available))
      .catch(() => setAvailable(false))
  }, [])

  // A different instance is a different crash.
  useEffect(() => {
    setAutopsy(null)
    setApplied(new Set())
    setError(null)
  }, [instance.id])

  if (available === false || available === null) return null

  async function read(): Promise<void> {
    setReading(true)
    setError(null)
    try {
      setAutopsy(await api.launch.autopsy(instance.id))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setReading(false)
    }
  }

  async function applyFix(fix: CrashFix, key: string): Promise<void> {
    setApplying(key)
    setError(null)
    try {
      await api.launch.applyFix(instance.id, fix)
      setApplied((current) => new Set(current).add(key))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setApplying(null)
    }
  }

  const confidenceColor = (level: 'high' | 'medium' | 'low'): string =>
    level === 'high' ? 'var(--success)' : level === 'medium' ? 'var(--warning)' : 'var(--text-dim)'

  return (
    <div className="panel panel-pad mt-8 col gap-12">
      {!autopsy ? (
        <div className="row between wrap gap-12">
          <div className="row gap-10">
            <Stethoscope size={17} style={{ color: 'var(--accent)' }} />
            <div>
              <div style={{ fontWeight: 600 }}>Not sure what broke?</div>
              <div className="tiny dim">
                Your companion&apos;s model can read the crash report and the log, and name the likely culprit.
              </div>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={reading} onClick={() => void read()}>
            {reading ? <Spinner /> : <Stethoscope size={14} />}
            {reading ? 'Reading the crash…' : 'Explain this crash'}
          </button>
        </div>
      ) : (
        <>
          <div className="row between wrap gap-12">
            <div className="row gap-10">
              <Stethoscope size={17} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 650 }}>What probably went wrong</span>
              <span className="pill tiny" style={{ color: confidenceColor(autopsy.confidence) }}>
                {autopsy.confidence} confidence
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" disabled={reading} onClick={() => void read()}>
              {reading ? <Spinner /> : null} Ask again
            </button>
          </div>

          <p className="small" style={{ lineHeight: 1.6 }}>
            {autopsy.summary}
          </p>

          {autopsy.suspects.length > 0 && (
            <div className="col gap-8">
              <span className="tiny dim">Most likely culprits</span>
              {autopsy.suspects.map((suspect, index) => (
                <div key={`${suspect.modFileName ?? suspect.modName}-${index}`} className="row gap-10">
                  <Bug size={14} style={{ color: confidenceColor(suspect.confidence), flexShrink: 0, marginTop: 3 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 600 }}>
                      {suspect.modName}
                    </div>
                    <div className="tiny dim">{suspect.why}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {autopsy.fixes.length > 0 && (
            <div className="col gap-8">
              <span className="tiny dim">Worth trying</span>
              {autopsy.fixes.map((fix, index) => {
                const key = `${fix.kind}-${fix.modFileName ?? index}`
                const done = applied.has(key)

                return (
                  <div key={key} className="row gap-12">
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="small" style={{ fontWeight: 600 }}>
                        {fix.label}
                      </div>
                      <div className="tiny dim">{fix.detail}</div>
                    </div>
                    {fix.kind === 'manual' ? (
                      <span className="tiny dim" style={{ alignSelf: 'center' }}>
                        do this yourself
                      </span>
                    ) : done ? (
                      <span className="row gap-6 tiny" style={{ color: 'var(--success)', alignSelf: 'center' }}>
                        <CheckCircle2 size={13} /> done
                      </span>
                    ) : (
                      <button
                        className="btn btn-sm"
                        disabled={applying !== null}
                        onClick={() => void applyFix(fix, key)}
                      >
                        {applying === key ? <Spinner /> : null} Do it
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="row gap-8 tiny dim" style={{ alignItems: 'flex-start' }}>
            <TriangleAlert size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Read by {autopsy.model}. It is an opinion from a language model, not a certainty — check before deleting
              anything.
            </span>
          </div>
        </>
      )}

      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}
    </div>
  )
}
