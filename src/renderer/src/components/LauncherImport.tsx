import { useState } from 'react'
import { Boxes, Download, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import type { ForeignInstanceInfo, LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Modal, Spinner } from './ui'

/**
 * Bringing instances over from another launcher.
 *
 * The reason someone stays on a launcher they dislike is rarely the launcher —
 * it is the twenty modpacks they would have to rebuild by hand. This scans the
 * usual install locations and copies the parts that are theirs.
 */

const LAUNCHER_NAMES: Record<ForeignInstanceInfo['launcher'], string> = {
  curseforge: 'CurseForge',
  prism: 'Prism Launcher',
  multimc: 'MultiMC',
  modrinth: 'Modrinth App',
  gdlauncher: 'GDLauncher',
  vanilla: 'Official launcher'
}

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function LauncherImport({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: () => void
}): JSX.Element {
  const [found, setFound] = useState<ForeignInstanceInfo[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  async function scan(): Promise<void> {
    setScanning(true)
    setError(null)
    try {
      setFound(await api.instances.findForeign())
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setScanning(false)
    }
  }

  async function importOne(entry: ForeignInstanceInfo): Promise<void> {
    setBusy(entry.id)
    setError(null)
    try {
      await api.instances.importForeign(entry.id)
      setDone((current) => new Set(current).add(entry.id))
      onImported()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      title="Import from another launcher"
      subtitle="Scans this machine for CurseForge, Prism, MultiMC, Modrinth and the official launcher."
      onClose={onClose}
      width={720}
    >
      <div className="col gap-12">
        {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

        <div className="row gap-8">
          <button className="btn btn-primary" onClick={() => void scan()} disabled={scanning}>
            {scanning ? <Spinner /> : <RefreshCw size={15} />}
            {found === null ? 'Scan this machine' : 'Scan again'}
          </button>
          {found !== null && (
            <span className="tiny dim">
              {found.length} instance{found.length === 1 ? '' : 's'} found
            </span>
          )}
        </div>

        {found !== null && found.length === 0 && (
          <p className="tiny dim" style={{ margin: 0 }}>
            Nothing found. That means no other launcher is installed where its installer normally puts it — if yours
            lives somewhere unusual, export an instance from it and use <strong>Import instance</strong> instead.
          </p>
        )}

        {found && found.length > 0 && (
          <div className="col gap-8" style={{ maxHeight: 380, overflowY: 'auto' }}>
            {found.map((entry) => (
              <div key={entry.id} className="panel panel-pad row gap-12" style={{ padding: 12 }}>
                <Boxes size={16} className="dim" style={{ flexShrink: 0 }} />
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600 }}>
                    {entry.name}
                  </div>
                  <div className="tiny dim truncate">
                    {LAUNCHER_NAMES[entry.launcher]} · {entry.minecraftVersion} {entry.loader}
                    {entry.mods > 0 ? ` · ${entry.mods} mods` : ''}
                    {entry.worlds > 0 ? ` · ${entry.worlds} worlds` : ''}
                    {entry.sizeBytes > 0 ? ` · ${sizeText(entry.sizeBytes)}` : ''}
                  </div>
                </div>
                {done.has(entry.id) ? (
                  <span className="pill success">
                    <Check size={12} /> imported
                  </span>
                ) : (
                  <button
                    className="btn btn-sm"
                    disabled={busy !== null}
                    onClick={() => void importOne(entry)}
                    title="Copy its mods, configs, worlds and packs into a new instance"
                  >
                    {busy === entry.id ? <Spinner /> : <Download size={13} />} Import
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="row gap-8 tiny" style={{ color: 'var(--text-dim)', alignItems: 'flex-start' }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 3 }} />
          <span>
            Nothing is moved — the original install is left exactly as it is. Mods, configs, worlds, packs and your
            options are copied; game files are not, because the launcher downloads and verifies its own rather than
            inheriting another launcher&apos;s cache.
          </span>
        </div>
      </div>
    </Modal>
  )
}
