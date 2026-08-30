import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Camera, Trash2 } from 'lucide-react'
import type { BackupInfo, LauncherErrorPayload } from '@shared/types'
import { api, toPayload, type ServerBackupSettings } from '../api'
import { ConfirmDialog, ErrorView, Spinner, Toggle } from './ui'
import { formatBytes, formatRelative } from '../format'

/**
 * Restore points for a hosted server's world.
 *
 * Snapshots are taken through the server console while it runs, so this offers
 * "Snapshot now" whether or not the server is up — but restoring is only
 * offered when it is stopped, because replacing files under a running server
 * corrupts the world.
 */
export function ServerBackups({
  serverId,
  serverName,
  running
}: {
  serverId: string
  serverName: string
  running: boolean
}): JSX.Element {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [settings, setSettings] = useState<ServerBackupSettings | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<BackupInfo | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BackupInfo | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, config] = await Promise.all([api.host.backups(serverId), api.host.backupSettings(serverId)])
      setBackups(list)
      setSettings(config)
      setError(null)
    } catch (err) {
      setError(toPayload(err))
      setBackups([])
    }
  }, [serverId])

  useEffect(() => {
    setBackups(null)
    void load()
  }, [load])

  async function patch(next: Partial<ServerBackupSettings>): Promise<void> {
    try {
      setSettings(await api.host.setBackupSettings(serverId, next))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function snapshotNow(): Promise<void> {
    setBusy(true)
    try {
      await api.host.backup(serverId)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function restore(): Promise<void> {
    if (!confirmRestore) return
    const target = confirmRestore
    setConfirmRestore(null)
    setBusy(true)
    try {
      await api.host.restoreBackup(serverId, target.fileName)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (!confirmDelete) return
    const target = confirmDelete
    setConfirmDelete(null)
    try {
      await api.host.deleteBackup(serverId, target.fileName)
      await load()
    } catch (err) {
      setError(toPayload(err))
    }
  }

  return (
    <div className="col gap-12">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="panel panel-pad col gap-12">
        <div className="row between wrap gap-12">
          <div>
            <div style={{ fontWeight: 600 }}>Automatic snapshots</div>
            <div className="tiny dim">
              Taken through the server console, so the world is flushed and held still while it is copied.
            </div>
          </div>
          <Toggle
            checked={settings?.enabled ?? false}
            onChange={(value) => void patch({ enabled: value })}
          />
        </div>

        {settings?.enabled && (
          <div className="row gap-16 wrap">
            <label className="col gap-6">
              <span className="tiny dim">Every</span>
              <select
                className="input"
                style={{ width: 150 }}
                value={settings.intervalMinutes}
                onChange={(event) => void patch({ intervalMinutes: Number(event.target.value) })}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>hour</option>
                <option value={180}>3 hours</option>
                <option value={360}>6 hours</option>
                <option value={1440}>day</option>
              </select>
            </label>

            <label className="col gap-6">
              <span className="tiny dim">Keep the newest</span>
              <select
                className="input"
                style={{ width: 130 }}
                value={settings.keep}
                onChange={(event) => void patch({ keep: Number(event.target.value) })}
              >
                {[3, 5, 8, 12, 20, 50].map((count) => (
                  <option key={count} value={count}>
                    {count} snapshots
                  </option>
                ))}
              </select>
            </label>

            <label className="col gap-6" style={{ justifyContent: 'flex-end' }}>
              <span className="tiny dim">When the server stops</span>
              <div className="row gap-8">
                <Toggle checked={settings.onStop} onChange={(value) => void patch({ onStop: value })} />
                <span className="tiny dim">Take one final snapshot</span>
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="row between wrap gap-12">
        <span className="small muted">
          {backups === null
            ? 'Reading snapshots…'
            : backups.length === 0
              ? `No snapshots of ${serverName} yet.`
              : `${backups.length} restore point${backups.length === 1 ? '' : 's'}.`}
        </span>
        <button className="btn btn-sm" disabled={busy} onClick={() => void snapshotNow()}>
          {busy ? <Spinner /> : <Camera size={14} />} Snapshot now
        </button>
      </div>

      {backups && backups.length > 0 && (
        <div className="col gap-8">
          {backups.map((entry) => (
            <div key={entry.fileName} className="panel panel-hover row gap-12" style={{ padding: 12 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: 'var(--panel-strong)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--accent)',
                  flexShrink: 0
                }}
              >
                <Archive size={15} />
              </div>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="small truncate" style={{ fontWeight: 600 }}>
                  {formatRelative(entry.createdAt)}
                </div>
                <div className="tiny dim truncate">
                  {formatBytes(entry.sizeBytes)} · {entry.fileName}
                </div>
              </div>
              <button
                className="btn btn-sm"
                disabled={running || busy}
                title={running ? 'Stop the server before restoring' : 'Replace the world with this snapshot'}
                onClick={() => setConfirmRestore(entry)}
              >
                <ArchiveRestore size={13} /> Restore
              </button>
              <button
                className="btn btn-ghost btn-icon"
                title="Delete this snapshot"
                onClick={() => setConfirmDelete(entry)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmRestore)}
        title="Restore this snapshot?"
        message={`The world as it stands is snapshotted first, then replaced with the ${
          confirmRestore ? formatRelative(confirmRestore.createdAt) : ''
        } copy. Everything built since then survives only in that new snapshot.`}
        confirmLabel="Restore the world"
        busy={busy}
        onConfirm={() => void restore()}
        onCancel={() => setConfirmRestore(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this snapshot?"
        message={`${confirmDelete?.fileName} is removed permanently. This cannot be undone.`}
        confirmLabel="Delete snapshot"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
