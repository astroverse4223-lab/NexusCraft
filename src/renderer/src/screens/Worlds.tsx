import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  Globe2,
  HardDrive,
  Play,
  RefreshCw,
  Shield,
  Trash2
} from 'lucide-react'
import type { BackupInfo, Instance, LauncherErrorPayload, WorldInfo } from '@shared/types'
import { api, toPayload } from '../api'
import { useStore, focusedInstance } from '../store/useStore'
import { ConfirmDialog, EmptyState, ErrorView, Spinner } from '../components/ui'
import { formatBytes, formatRelative } from '../format'

export function WorldsScreen(): JSX.Element {
  const instance = useStore(focusedInstance)
  const instances = useStore((s) => s.instances)
  const navigate = useStore((s) => s.navigate)

  if (!instance) {
    return (
      <div className="panel">
        <EmptyState
          icon={<Globe2 size={24} />}
          title="No instance selected"
          message="Worlds live inside an instance. Create one to start playing."
          action={
            <button className="btn btn-primary btn-sm" onClick={() => navigate('instances')}>
              Go to instances
            </button>
          }
        />
      </div>
    )
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Library</div>
          <h1>Worlds</h1>
          <p className="subtitle">
            Single-player worlds saved in <strong style={{ color: 'var(--text)' }}>{instance.name}</strong>. Back one up
            before you install mods that change world generation.
          </p>
        </div>
        <select
          className="select"
          style={{ width: 230 }}
          value={instance.id}
          onChange={(event) => navigate('worlds', event.target.value)}
        >
          {instances.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>

      <WorldsList instance={instance} />
    </>
  )
}

function WorldsList({ instance }: { instance: Instance }): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const launches = useStore((s) => s.launches)
  const navigate = useStore((s) => s.navigate)
  const selectInstance = useStore((s) => s.selectInstance)

  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [backingUp, setBackingUp] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<WorldInfo | null>(null)
  const [deletingBackup, setDeletingBackup] = useState<BackupInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [showBackups, setShowBackups] = useState(false)

  const isRunning = launches[instance.id]?.stage === 'running'

  const load = useCallback(async () => {
    try {
      const [worldList, backupList] = await Promise.all([
        api.worlds.list(instance.id),
        api.worlds.listBackups(instance.id)
      ])
      setWorlds(worldList)
      setBackups(backupList)
      setError(null)
    } catch (err) {
      setError(toPayload(err))
      setWorlds([])
    }
  }, [instance.id])

  useEffect(() => {
    setWorlds(null)
    void load()
  }, [load])

  async function backup(world: WorldInfo): Promise<void> {
    setBackingUp(world.folderName)
    try {
      await api.worlds.backup(instance.id, world.folderName)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBackingUp(null)
    }
  }

  async function remove(): Promise<void> {
    if (!deleting) return
    setBusy(true)
    try {
      await api.worlds.remove(instance.id, deleting.folderName)
      setDeleting(null)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="row between mb-16 wrap gap-12">
        <div className="row gap-8">
          <button className={`btn btn-sm ${showBackups ? '' : 'btn-primary'}`} onClick={() => setShowBackups(false)}>
            Worlds {worlds ? `(${worlds.length})` : ''}
          </button>
          <button className={`btn btn-sm ${showBackups ? 'btn-primary' : ''}`} onClick={() => setShowBackups(true)}>
            Backups ({backups.length})
          </button>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => void api.worlds.openFolder(instance.id)}>
            <FolderOpen size={15} /> Open saves folder
          </button>
          <button className="btn btn-ghost btn-icon" title="Refresh" onClick={() => void load()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {isRunning && (
        <div className="panel panel-pad row gap-12 mb-16" style={{ borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)' }}>
          <Shield size={17} style={{ color: 'var(--warning)' }} />
          <div className="small">
            Minecraft is running for this instance. Backing up or deleting a world now could capture a half-written
            save, so those actions are disabled until you quit the game.
          </div>
        </div>
      )}

      {showBackups ? (
        backups.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={<Archive size={24} />}
              title="No backups yet"
              message="Back up a world and the archive will be listed here. Backups are plain .zip files you can open anywhere."
            />
          </div>
        ) : (
          <div className="col gap-8">
            {backups.map((entry) => (
              <div key={entry.fileName} className="panel panel-hover row gap-12" style={{ padding: 13 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: 'var(--panel-strong)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--accent)',
                    flexShrink: 0
                  }}
                >
                  <ArchiveRestore size={17} />
                </div>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600 }}>
                    {entry.worldName}
                  </div>
                  <div className="tiny dim truncate">
                    {formatRelative(entry.createdAt)} · {formatBytes(entry.sizeBytes)} · {entry.fileName}
                  </div>
                </div>
                <button className="btn btn-ghost btn-icon" title="Delete backup" onClick={() => setDeletingBackup(entry)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )
      ) : worlds === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Reading level data…
        </div>
      ) : worlds.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Globe2 size={24} />}
            title="No worlds yet"
            message="Worlds you create in game appear here, with their icon, version and last played time."
            action={
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  void selectInstance(instance.id)
                  navigate('play')
                }}
              >
                <Play size={14} /> Launch the game
              </button>
            }
          />
        </div>
      ) : (
        <div className="card-grid">
          {worlds.map((world) => (
            <div key={world.folderName} className="panel panel-hover" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  height: 110,
                  background: world.iconDataUrl
                    ? `url(${world.iconDataUrl}) center/cover`
                    : 'linear-gradient(135deg, rgba(94,234,212,0.12), transparent)',
                  imageRendering: world.iconDataUrl ? 'auto' : undefined,
                  borderBottom: '1px solid var(--border)',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                {!world.iconDataUrl && <Globe2 size={30} className="dim" />}
              </div>

              <div className="panel-pad col gap-8">
                <div className="row gap-8">
                  <span className="truncate flex-1" style={{ fontWeight: 650 }}>
                    {world.name}
                  </span>
                  {world.hardcore && <span className="pill danger">Hardcore</span>}
                  {world.corrupt && <span className="pill warning">Unreadable</span>}
                </div>

                <div className="row gap-8 tiny dim wrap">
                  {world.gameVersion && <span>{world.gameVersion}</span>}
                  {world.gameMode && <span>· {world.gameMode}</span>}
                  <span>· {formatBytes(world.sizeBytes)}</span>
                </div>

                <div className="tiny dim">Last played {formatRelative(world.lastPlayed)}</div>

                {world.corrupt && (
                  <div className="tiny" style={{ color: 'var(--warning)' }}>
                    level.dat could not be read. The world may be from a newer Minecraft version, or it may be damaged.
                  </div>
                )}

                <div className="row gap-8 mt-8">
                  <button
                    className="btn btn-sm flex-1"
                    disabled={isRunning || backingUp === world.folderName}
                    onClick={() => void backup(world)}
                  >
                    {backingUp === world.folderName ? <Spinner /> : <Archive size={13} />}
                    {backingUp === world.folderName ? 'Backing up…' : 'Back up'}
                  </button>
                  <button
                    className="btn btn-sm"
                    title="Open folder"
                    onClick={() => void api.worlds.openFolder(instance.id, world.folderName)}
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Delete world"
                    disabled={isRunning}
                    onClick={() => setDeleting(world)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete "${deleting?.name}"?`}
        message="A backup is created automatically before the world is deleted, so you can always restore it from the Backups tab."
        confirmLabel="Back up and delete"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={Boolean(deletingBackup)}
        title="Delete this backup?"
        message={`${deletingBackup?.fileName} will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete backup"
        danger
        busy={busy}
        onConfirm={() => {
          if (!deletingBackup) return
          setBusy(true)
          void api.worlds
            .deleteBackup(instance.id, deletingBackup.fileName)
            .then(() => {
              setDeletingBackup(null)
              return load()
            })
            .catch((err) => setError(toPayload(err)))
            .finally(() => setBusy(false))
        }}
        onCancel={() => setDeletingBackup(null)}
      />
    </>
  )
}
