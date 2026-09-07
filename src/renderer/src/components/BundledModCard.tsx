import { useCallback, useEffect, useState } from 'react'
import { Flame, Ghost } from 'lucide-react'
import type { Instance, LauncherErrorPayload } from '@shared/types'
import { api, toPayload, type BundledModStatus } from '../api'
import { ErrorView, Spinner } from './ui'

/**
 * The mods this launcher ships, and installing one into an instance.
 *
 * This was written for Hollow alone and grew a second mod, which is why it
 * takes a status rather than a name: everything on the card — the icon, the
 * blurb, whether a model is worth mentioning — comes from the descriptor the
 * main process sends, so a third mod needs no change here at all.
 */
function iconFor(icon: BundledModStatus['icon'], size: number): JSX.Element {
  return icon === 'flame' ? (
    <Flame size={size} className="dim" />
  ) : (
    <Ghost size={size} className="dim" />
  )
}

export function BundledModCard({
  instance,
  status,
  onChanged
}: {
  instance: Instance
  status: BundledModStatus
  onChanged: () => void
}): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  if (!status.available) return null

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
          {iconFor(status.icon, 16)}
          <strong className="flex-1">{status.name}</strong>
          <span className="pill">{status.requires}</span>
        </div>
        <p className="small muted" style={{ margin: 0, maxWidth: '68ch' }}>
          Ships with this launcher. {status.reason}
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
      await api.mods.installBundled(instance.id, status.id)
      onChanged()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel panel-pad col gap-12">
      <div className="row gap-8">
        {iconFor(status.icon, 16)}
        <strong className="flex-1">{status.name}</strong>
        {status.installed && <span className="pill">installed</span>}
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <p className="small muted" style={{ maxWidth: '68ch', margin: 0 }}>
        {status.blurb}
      </p>

      <div className="row gap-12">
        <button className="btn btn-primary" disabled={busy} onClick={() => void install()}>
          {busy ? <Spinner /> : iconFor(status.icon, 15)}{' '}
          {status.installed ? 'Reinstall' : 'Install into this instance'}
        </button>

        {/* Only the mod that needs a model has anything to say about one. */}
        {status.wantsModel &&
          (status.suggestedModel ? (
            <span className="small dim">will use {status.suggestedModel}</span>
          ) : (
            <span className="small dim">no local model found — start Ollama first</span>
          ))}
      </div>

      {!status.hasFabricApi && (
        <p className="field-hint" style={{ margin: 0 }}>
          Fabric API is not in this instance yet, and {status.name} needs it. Install it from the
          Browse tab.
        </p>
      )}
    </div>
  )
}

/** Every bundled mod, loaded once and drawn as a stack. */
export function BundledMods({ instance }: { instance: Instance }): JSX.Element | null {
  const [statuses, setStatuses] = useState<BundledModStatus[] | null>(null)

  const load = useCallback(async () => {
    try {
      setStatuses(await api.mods.bundledStatus(instance.id))
    } catch {
      // Not being able to say whether a bonus mod is installable is not worth
      // an error on the mods screen.
      setStatuses(null)
    }
  }, [instance.id])

  useEffect(() => {
    void load()
  }, [load])

  if (!statuses || statuses.length === 0) return null

  return (
    <div className="col gap-12">
      {statuses.map((status) => (
        <BundledModCard
          key={status.id}
          instance={instance}
          status={status}
          onChanged={() => void load()}
        />
      ))}
    </div>
  )
}
