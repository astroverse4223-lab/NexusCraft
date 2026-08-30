import { useCallback, useEffect, useState } from 'react'
import { Camera, GitBranch, History, Minus, Plus, RefreshCcw, Trash2 } from 'lucide-react'
import type { Instance, InstanceSnapshot, LauncherErrorPayload, SnapshotDiff } from '@shared/types'
import { api, toPayload } from '../api'
import { ConfirmDialog, EmptyState, ErrorView, Modal, Spinner } from './ui'
import { formatBytes, formatRelative } from '../format'

/**
 * Snapshots of an instance's setup.
 *
 * The workflow this exists for: snapshot, update everything, play, and either
 * keep it or put it back. That is only worth doing if taking one is instant
 * and free, which is why the panel leads with what a snapshot actually costs.
 */
export function SnapshotManager({
  instance,
  open,
  onClose
}: {
  instance: Instance
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [snapshots, setSnapshots] = useState<InstanceSnapshot[] | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<InstanceSnapshot | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<InstanceSnapshot | null>(null)
  const [diffFor, setDiffFor] = useState<string | null>(null)
  const [diff, setDiff] = useState<SnapshotDiff | null>(null)

  const load = useCallback(async () => {
    try {
      setSnapshots(await api.instances.snapshots(instance.id))
      setError(null)
    } catch (err) {
      setError(toPayload(err))
      setSnapshots([])
    }
  }, [instance.id])

  useEffect(() => {
    if (!open) return
    setSnapshots(null)
    setDiffFor(null)
    setDiff(null)
    void load()
  }, [open, load])

  async function take(): Promise<void> {
    setBusy(true)
    try {
      await api.instances.snapshot(instance.id, name.trim() || `Before changes`)
      setName('')
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
      await api.instances.restoreSnapshot(instance.id, target.id)
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
      await api.instances.deleteSnapshot(instance.id, target.id)
      await load()
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function showDiff(snapshot: InstanceSnapshot): Promise<void> {
    if (diffFor === snapshot.id) {
      setDiffFor(null)
      setDiff(null)
      return
    }
    setDiffFor(snapshot.id)
    setDiff(null)
    try {
      setDiff(await api.instances.diffSnapshot(instance.id, snapshot.id))
    } catch (err) {
      setError(toPayload(err))
      setDiffFor(null)
    }
  }

  return (
    <Modal
      open={open}
      title={`Snapshots of ${instance.name}`}
      subtitle="Mods, configs and packs — captured before a risky change and put back if it goes wrong. Worlds are never touched."
      onClose={onClose}
      width={640}
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="row gap-8 mb-16">
        <input
          className="input flex-1"
          placeholder="What is this snapshot for? e.g. before updating everything"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void take()
          }}
        />
        <button className="btn btn-primary" disabled={busy} onClick={() => void take()}>
          {busy ? <Spinner /> : <Camera size={15} />} Take one
        </button>
      </div>

      {snapshots === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Reading snapshots…
        </div>
      ) : snapshots.length === 0 ? (
        <EmptyState
          icon={<History size={24} />}
          title="No snapshots yet"
          message="Take one before updating mods or changing configs. Files are hard-linked, so a snapshot of a 3 GB mods folder costs almost nothing and takes about a second."
        />
      ) : (
        <div className="col gap-8">
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="col gap-8">
              <div className="panel panel-hover row gap-12" style={{ padding: 12 }}>
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
                  <GitBranch size={15} />
                </div>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="small truncate" style={{ fontWeight: 600 }}>
                    {snapshot.name}
                  </div>
                  <div className="tiny dim truncate">
                    {formatRelative(snapshot.createdAt)} · {snapshot.files} files · {formatBytes(snapshot.bytes)}
                    {snapshot.linked ? ' (linked)' : ' (copied)'}
                    {snapshot.loader !== instance.loader ? ` · ${snapshot.loader}` : ''}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => void showDiff(snapshot)}>
                  <RefreshCcw size={13} /> {diffFor === snapshot.id ? 'Hide' : 'Compare'}
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={() => setConfirmRestore(snapshot)}>
                  <History size={13} /> Restore
                </button>
                <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => setConfirmDelete(snapshot)}>
                  <Trash2 size={14} />
                </button>
              </div>

              {diffFor === snapshot.id && (
                <div className="panel panel-pad" style={{ background: 'var(--bg-2)', maxHeight: 240, overflowY: 'auto' }}>
                  {!diff ? (
                    <div className="row gap-10 muted small">
                      <Spinner /> Comparing…
                    </div>
                  ) : diff.added.length + diff.removed.length + diff.changed.length === 0 ? (
                    <div className="small muted">Nothing has changed since this snapshot.</div>
                  ) : (
                    <div className="col gap-6">
                      <div className="tiny dim">
                        Since this snapshot: {diff.added.length} added, {diff.removed.length} removed,{' '}
                        {diff.changed.length} changed
                      </div>
                      {diff.added.slice(0, 40).map((entry) => (
                        <DiffLine key={`a-${entry.path}`} kind="added" path={entry.path} />
                      ))}
                      {diff.removed.slice(0, 40).map((entry) => (
                        <DiffLine key={`r-${entry.path}`} kind="removed" path={entry.path} />
                      ))}
                      {diff.changed.slice(0, 40).map((entry) => (
                        <DiffLine key={`c-${entry.path}`} kind="changed" path={entry.path} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmRestore)}
        title={`Restore "${confirmRestore?.name}"?`}
        message="Mods, configs and packs go back to how they were in this snapshot. Anything added since is removed, and anything deleted since comes back. Your worlds are not touched, and the current setup is snapshotted first."
        confirmLabel="Restore this snapshot"
        busy={busy}
        onConfirm={() => void restore()}
        onCancel={() => setConfirmRestore(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`Delete "${confirmDelete?.name}"?`}
        message="This restore point is removed permanently. The instance itself is untouched."
        confirmLabel="Delete snapshot"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(null)}
      />
    </Modal>
  )
}

function DiffLine({ kind, path }: { kind: 'added' | 'removed' | 'changed'; path: string }): JSX.Element {
  const colour =
    kind === 'added' ? 'var(--success)' : kind === 'removed' ? 'var(--danger)' : 'var(--warning)'

  return (
    <div className="row gap-8 tiny mono" style={{ color: colour, minWidth: 0 }}>
      {kind === 'added' ? <Plus size={11} /> : kind === 'removed' ? <Minus size={11} /> : <RefreshCcw size={11} />}
      <span className="truncate">{path}</span>
    </div>
  )
}
