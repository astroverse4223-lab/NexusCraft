import { useCallback, useEffect, useState } from 'react'
import { Ghost } from 'lucide-react'
import type { Instance, LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from './ui'

/**
 * Installing Hollow into an instance.
 *
 * Hidden entirely on instances that cannot run it. A greyed-out button that
 * explains it is for a different loader is a permanent piece of clutter on
 * every other instance, and the person reading it cannot act on it anyway.
 */
export function HollowCard({ instance }: { instance: Instance }): JSX.Element | null {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.mods.hollowStatus>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api.mods.hollowStatus(instance.id))
    } catch {
      // Not being able to say whether a bonus mod is installable is not worth
      // an error on the mods screen.
      setStatus(null)
    }
  }, [instance.id])

  useEffect(() => {
    void load()
  }, [load])

  if (!status?.available) return null

  /*
   * Shown on instances that cannot run it, rather than hidden.
   *
   * Hiding it seemed tidy and was the reason nobody found this: the selected
   * instance is whatever you last played, so on a machine with one Forge
   * favourite the card never appeared once and there was no way to learn it
   * existed. A line naming the instances that do work is not clutter — it is
   * the only place that information exists.
   */
  if (!status.compatible) {
    return (
      <div className="panel panel-pad col gap-8">
        <div className="row gap-8">
          <Ghost size={16} className="dim" />
          <strong className="flex-1">Hollow</strong>
          <span className="pill">Fabric 1.21.11</span>
        </div>
        <p className="small muted" style={{ margin: 0, maxWidth: '68ch' }}>
          A horror companion that ships with this launcher. {status.reason}
        </p>
        {status.compatibleInstances.length > 0 && (
          <p className="field-hint" style={{ margin: 0 }}>
            Switch to {status.compatibleInstances.join(', ')} to install it.
          </p>
        )}
      </div>
    )
  }

  async function install(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.mods.installHollow(instance.id)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel panel-pad col gap-12">
      <div className="row gap-8">
        <Ghost size={16} className="dim" />
        <strong className="flex-1">Hollow</strong>
        {status.installed && <span className="pill">installed</span>}
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <p className="small muted" style={{ maxWidth: '68ch', margin: 0 }}>
        A companion that is genuinely useful, and stays that way for a while. It talks, it fetches you materials,
        and it will not give you diamonds. Over a fortnight of play it stops being helpful. Runs on a model on
        this machine — nothing is sent anywhere.
      </p>

      <div className="row gap-12">
        <button className="btn btn-primary" disabled={busy} onClick={() => void install()}>
          {busy ? <Spinner /> : <Ghost size={15} />} {status.installed ? 'Reinstall' : 'Install into this instance'}
        </button>
        {status.suggestedModel ? (
          <span className="small dim">will use {status.suggestedModel}</span>
        ) : (
          <span className="small dim">no local model found — start Ollama first</span>
        )}
      </div>

      {!status.hasFabricApi && (
        <p className="field-hint" style={{ margin: 0 }}>
          Fabric API is not in this instance yet, and Hollow needs it. Install it from the Browse tab.
        </p>
      )}
    </div>
  )
}
