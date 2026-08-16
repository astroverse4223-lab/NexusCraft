import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Copy,
  Download,
  FolderOpen,
  Globe2,
  HardDrive,
  Image,
  Package,
  Play,
  Plus,
  Settings2,
  Trash2,
  Wrench
} from 'lucide-react'
import type { Instance, InstanceStats, LauncherErrorPayload, LoaderId, LoaderVersion, VersionSummary } from '@shared/types'
import { api, toPayload, type MemoryInfo } from '../api'
import { useStore, selectedInstance } from '../store/useStore'
import { ConfirmDialog, EmptyState, ErrorView, Modal, SettingRow, Spinner, Toggle } from '../components/ui'
import { formatBytes, formatDuration, formatRam, formatRelative, LOADER_COLORS, LOADER_LABELS } from '../format'

const ACCENTS = ['#5eead4', '#818cf8', '#f472b6', '#fbbf24', '#4ade80', '#60a5fa', '#f87171', '#c084fc']

export function InstancesScreen(): JSX.Element {
  const instances = useStore((s) => s.instances)
  const selected = useStore(selectedInstance)
  const selectInstance = useStore((s) => s.selectInstance)
  const refreshInstances = useStore((s) => s.refreshInstances)
  const navigate = useStore((s) => s.navigate)
  const launches = useStore((s) => s.launches)
  const pushToast = useStore((s) => s.pushToast)

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Instance | null>(null)
  const [deleting, setDeleting] = useState<Instance | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  async function handleDelete(): Promise<void> {
    if (!deleting) return
    setBusy(true)
    try {
      await api.instances.remove(deleting.id, deleteFiles)
      await refreshInstances()
      pushToast({ kind: 'success', title: 'Instance deleted', message: deleting.name })
      setDeleting(null)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Library</div>
          <h1>Instances</h1>
          <p className="subtitle">
            Each instance is a completely separate Minecraft install — its own version, mods, worlds, resource packs and
            settings. Files are never shared between them.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> New instance
        </button>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {instances.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Boxes size={24} />}
            title="No instances yet"
            message="Create your first instance to choose a Minecraft version and, optionally, a mod loader."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                <Plus size={15} /> Create an instance
              </button>
            }
          />
        </div>
      ) : (
        <div className="card-grid">
          {instances.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              isSelected={selected?.id === instance.id}
              isRunning={launches[instance.id]?.stage === 'running'}
              onSelect={() => void selectInstance(instance.id)}
              onPlay={() => {
                void selectInstance(instance.id)
                navigate('play')
              }}
              onEdit={() => setEditing(instance)}
              onDelete={() => {
                setDeleteFiles(true)
                setDeleting(instance)
              }}
              onError={setError}
            />
          ))}
        </div>
      )}

      <CreateInstanceModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {editing && <EditInstanceModal instance={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete "${deleting?.name}"?`}
        message={
          deleteFiles
            ? 'This permanently deletes the instance and everything inside it — mods, worlds, screenshots and settings. This cannot be undone.'
            : 'The instance will be removed from the launcher, but its folder and files stay on disk.'
        }
        confirmLabel={deleteFiles ? 'Delete everything' : 'Remove instance'}
        danger
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

/* ----------------------------------------------------------------- card */

function InstanceCard({
  instance,
  isSelected,
  isRunning,
  onSelect,
  onPlay,
  onEdit,
  onDelete,
  onError
}: {
  instance: Instance
  isSelected: boolean
  isRunning: boolean
  onSelect: () => void
  onPlay: () => void
  onEdit: () => void
  onDelete: () => void
  onError: (error: LauncherErrorPayload) => void
}): JSX.Element {
  const navigate = useStore((s) => s.navigate)
  const [stats, setStats] = useState<InstanceStats | null>(null)
  const [working, setWorking] = useState<'install' | 'repair' | 'duplicate' | null>(null)

  useEffect(() => {
    void api.instances.stats(instance.id).then(setStats).catch(() => setStats(null))
  }, [instance.id, instance.installed])

  async function run(kind: 'install' | 'repair', action: Promise<unknown>): Promise<void> {
    setWorking(kind)
    try {
      await action
      setStats(await api.instances.stats(instance.id))
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setWorking(null)
    }
  }

  return (
    <div
      className="panel panel-hover"
      style={{
        overflow: 'hidden',
        borderColor: isSelected ? `${instance.iconColor}88` : undefined,
        boxShadow: isSelected ? `0 0 0 1px ${instance.iconColor}44, 0 10px 30px rgba(0,0,0,0.35)` : undefined
      }}
    >
      {/* header band carries the instance's colour identity */}
      <div
        style={{
          height: 62,
          background: `linear-gradient(120deg, ${instance.iconColor}42, ${instance.iconColor}0d)`,
          borderBottom: `1px solid ${instance.iconColor}2a`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 11
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'rgba(0,0,0,0.35)',
            border: `1px solid ${instance.iconColor}55`,
            display: 'grid',
            placeItems: 'center',
            color: instance.iconColor,
            flexShrink: 0
          }}
        >
          <Boxes size={17} />
        </div>
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="truncate" style={{ fontWeight: 650, fontSize: 14.5 }}>
            {instance.name}
          </div>
          <div className="tiny" style={{ color: 'rgba(255,255,255,0.62)' }}>
            {instance.minecraftVersion} · {LOADER_LABELS[instance.loader]}
          </div>
        </div>
        {isRunning && <span className="pill success"><span className="dot online" /> Running</span>}
      </div>

      <div className="panel-pad col gap-12">
        <div className="row gap-8 wrap">
          {instance.installed ? (
            <span className="pill success">Installed</span>
          ) : (
            <span className="pill warning">Not installed</span>
          )}
          <span className="pill">{formatRam(instance.java.maxRamMb)} RAM</span>
          {isSelected && <span className="pill accent">Selected</span>}
        </div>

        <div className="row between tiny dim">
          <span>Last played {formatRelative(instance.lastPlayedAt)}</span>
          <span>{formatDuration(instance.totalPlaytimeMs)} played</span>
        </div>

        {stats && (
          <div className="row gap-12 tiny dim wrap">
            <span className="row gap-4"><Package size={12} /> {stats.mods} mods</span>
            <span className="row gap-4"><Globe2 size={12} /> {stats.worlds} worlds</span>
            <span className="row gap-4"><Image size={12} /> {stats.screenshots}</span>
            <span className="row gap-4"><HardDrive size={12} /> {formatBytes(stats.diskBytes)}</span>
          </div>
        )}

        <div className="row gap-8 wrap">
          <button className="btn btn-primary btn-sm flex-1" onClick={onPlay}>
            <Play size={13} /> Play
          </button>
          {!isSelected && (
            <button className="btn btn-sm" onClick={onSelect}>
              Select
            </button>
          )}
          {!instance.installed && (
            <button
              className="btn btn-sm"
              disabled={working !== null}
              onClick={() => void run('install', api.instances.install(instance.id))}
            >
              {working === 'install' ? <Spinner /> : <Download size={13} />} Install
            </button>
          )}
        </div>

        <div className="row gap-4 wrap">
          <IconAction title="Mods and packs" onClick={() => navigate('mods', instance.id)}><Package size={15} /></IconAction>
          <IconAction title="Worlds" onClick={() => navigate('worlds', instance.id)}><Globe2 size={15} /></IconAction>
          <IconAction title="Open folder" onClick={() => void api.instances.openFolder(instance.id)}><FolderOpen size={15} /></IconAction>
          <IconAction
            title="Verify and repair"
            disabled={working !== null || isRunning}
            onClick={() => void run('repair', api.instances.repair(instance.id))}
          >
            {working === 'repair' ? <Spinner /> : <Wrench size={15} />}
          </IconAction>
          <IconAction title="Edit" onClick={onEdit}><Settings2 size={15} /></IconAction>
          <div className="flex-1" />
          <IconAction title="Delete" danger disabled={isRunning} onClick={onDelete}><Trash2 size={15} /></IconAction>
        </div>
      </div>
    </div>
  )
}

function IconAction({
  children,
  title,
  onClick,
  danger,
  disabled
}: {
  children: JSX.Element
  title: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      className={`btn btn-ghost btn-icon ${danger ? 'btn-danger' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={danger ? { borderColor: 'transparent', background: 'transparent' } : undefined}
    >
      {children}
    </button>
  )
}

/* --------------------------------------------------------------- create */

export function CreateInstanceModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const refreshInstances = useStore((s) => s.refreshInstances)
  const selectInstance = useStore((s) => s.selectInstance)
  const pushToast = useStore((s) => s.pushToast)
  const settings = useStore((s) => s.settings)

  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [showSnapshots, setShowSnapshots] = useState(settings?.showSnapshots ?? false)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [loader, setLoader] = useState<LoaderId>('vanilla')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null)
  const [loaderVersion, setLoaderVersion] = useState<string>('')
  const [color, setColor] = useState(ACCENTS[0])
  const [installNow, setInstallNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    void (async () => {
      try {
        const info = await api.versions.manifest()
        setVersions(info.versions)
        setVersion((current) => current || info.latestRelease)
        setName((current) => current || `Minecraft ${info.latestRelease}`)
      } catch (err) {
        setError(toPayload(err))
      }
    })()
  }, [open])

  /* Loader builds depend on the chosen Minecraft version. */
  useEffect(() => {
    if (loader === 'vanilla' || !version) {
      setLoaderVersions(null)
      setLoaderVersion('')
      return
    }
    let cancelled = false
    setLoaderVersions(null)
    void (async () => {
      const list = await api.versions.loaderVersions(loader, version).catch(() => [])
      if (cancelled) return
      setLoaderVersions(list)
      setLoaderVersion(list.find((v) => v.recommended)?.version ?? list[0]?.version ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [loader, version])

  const visible = useMemo(() => {
    const list = versions ?? []
    return showSnapshots ? list.slice(0, 400) : list.filter((v) => v.type === 'release').slice(0, 200)
  }, [versions, showSnapshots])

  async function create(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const instance = await api.instances.create({
        name: name.trim() || `Minecraft ${version}`,
        minecraftVersion: version,
        loader,
        loaderVersion: loader === 'vanilla' ? null : loaderVersion || null,
        iconColor: color
      })
      await refreshInstances()
      await selectInstance(instance.id)
      pushToast({ kind: 'success', title: 'Instance created', message: instance.name })
      onClose()

      if (installNow) {
        // Runs in the background: progress shows on the Play screen.
        void api.instances.install(instance.id).catch((err) => {
          useStore.getState().showError(err)
        })
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="New instance"
      subtitle="Pick a Minecraft version and, if you want mods, a loader."
      onClose={onClose}
      width={580}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !version} onClick={() => void create()}>
            {busy && <Spinner />} Create instance
          </button>
        </>
      }
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="field">
        <label className="field-label">Name</label>
        <input
          className="input"
          value={name}
          maxLength={64}
          placeholder="Fabric Survival"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="field">
        <div className="row between">
          <label className="field-label">Minecraft version</label>
          <label className="row gap-8 tiny dim" style={{ cursor: 'pointer' }}>
            <Toggle checked={showSnapshots} onChange={setShowSnapshots} />
            Show snapshots
          </label>
        </div>
        {!versions ? (
          <div className="row gap-8 muted small">
            <Spinner /> Loading versions from Mojang…
          </div>
        ) : (
          <select className="select" value={version} onChange={(event) => setVersion(event.target.value)}>
            {visible.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
                {entry.type !== 'release' ? `  (${entry.type})` : ''}
                {entry.installed ? '  ✓' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="field">
        <label className="field-label">Mod loader</label>
        <div className="row gap-8 wrap">
          {(['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'] as LoaderId[]).map((entry) => (
            <button
              key={entry}
              className="btn btn-sm"
              style={
                loader === entry
                  ? {
                      borderColor: LOADER_COLORS[entry],
                      color: LOADER_COLORS[entry],
                      background: `${LOADER_COLORS[entry]}18`
                    }
                  : undefined
              }
              onClick={() => setLoader(entry)}
            >
              {LOADER_LABELS[entry]}
            </button>
          ))}
        </div>
      </div>

      {loader !== 'vanilla' && (
        <div className="field">
          <label className="field-label">{LOADER_LABELS[loader]} version</label>
          {loaderVersions === null ? (
            <div className="row gap-8 muted small">
              <Spinner /> Looking up builds for {version}…
            </div>
          ) : loaderVersions.length === 0 ? (
            <p className="field-hint" style={{ color: 'var(--warning)' }}>
              No {LOADER_LABELS[loader]} build has been published for Minecraft {version}. Choose another version or
              loader.
            </p>
          ) : (
            <select className="select" value={loaderVersion} onChange={(event) => setLoaderVersion(event.target.value)}>
              {loaderVersions.slice(0, 60).map((entry) => (
                <option key={entry.version} value={entry.version}>
                  {entry.version}
                  {entry.recommended ? '  (recommended)' : entry.stable ? '' : '  (beta)'}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="field">
        <label className="field-label">Colour</label>
        <div className="row gap-8">
          {ACCENTS.map((entry) => (
            <button
              key={entry}
              aria-label={`Colour ${entry}`}
              onClick={() => setColor(entry)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: entry,
                border: color === entry ? '2px solid var(--text)' : '2px solid transparent',
                boxShadow: color === entry ? `0 0 12px ${entry}88` : undefined
              }}
            />
          ))}
        </div>
      </div>

      <SettingRow name="Download files now" description="Fetch the client, libraries, assets and Java runtime straight away.">
        <Toggle checked={installNow} onChange={setInstallNow} />
      </SettingRow>
    </Modal>
  )
}

/* ----------------------------------------------------------------- edit */

function EditInstanceModal({ instance, onClose }: { instance: Instance; onClose: () => void }): JSX.Element {
  const refreshInstances = useStore((s) => s.refreshInstances)
  const pushToast = useStore((s) => s.pushToast)

  const [name, setName] = useState(instance.name)
  const [notes, setNotes] = useState(instance.notes)
  const [color, setColor] = useState(instance.iconColor)
  const [minRam, setMinRam] = useState(instance.java.minRamMb)
  const [maxRam, setMaxRam] = useState(instance.java.maxRamMb)
  const [jvmArgs, setJvmArgs] = useState(instance.java.jvmArgs)
  const [javaPath, setJavaPath] = useState(instance.java.javaPath ?? '')
  const [width, setWidth] = useState(instance.window.width)
  const [height, setHeight] = useState(instance.window.height)
  const [fullscreen, setFullscreen] = useState(instance.window.fullscreen)
  const [memory, setMemory] = useState<MemoryInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  useEffect(() => {
    void api.app.memory().then(setMemory).catch(() => setMemory(null))
  }, [])

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.instances.update(instance.id, {
        name,
        notes,
        iconColor: color,
        java: { minRamMb: minRam, maxRamMb: maxRam, jvmArgs, javaPath: javaPath.trim() || null },
        window: { width, height, fullscreen }
      })
      await refreshInstances()
      pushToast({ kind: 'success', title: 'Instance updated' })
      onClose()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function duplicate(): Promise<void> {
    setDuplicating(true)
    try {
      await api.instances.duplicate(instance.id, `${instance.name} copy`)
      await refreshInstances()
      pushToast({ kind: 'success', title: 'Instance duplicated' })
      onClose()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setDuplicating(false)
    }
  }

  const ceiling = memory?.ceiling ?? 8192

  return (
    <Modal
      open
      title={`Edit ${instance.name}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={() => void duplicate()} disabled={busy || duplicating}>
            {duplicating ? <Spinner /> : <Copy size={14} />} Duplicate
          </button>
          <div className="flex-1" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy && <Spinner />} Save changes
          </button>
        </>
      }
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="field">
        <label className="field-label">Name</label>
        <input className="input" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
      </div>

      <div className="field">
        <label className="field-label">Notes</label>
        <textarea
          className="textarea"
          value={notes}
          maxLength={2000}
          placeholder="What is this instance for?"
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label">Colour</label>
        <div className="row gap-8">
          {ACCENTS.map((entry) => (
            <button
              key={entry}
              aria-label={`Colour ${entry}`}
              onClick={() => setColor(entry)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: entry,
                border: color === entry ? '2px solid var(--text)' : '2px solid transparent'
              }}
            />
          ))}
        </div>
      </div>

      <div className="divider" />

      <div className="field">
        <div className="row between">
          <label className="field-label">Maximum memory</label>
          <span className="small bold" style={{ color: 'var(--accent)' }}>
            {formatRam(maxRam)}
          </span>
        </div>
        <input
          className="slider"
          type="range"
          min={1024}
          max={ceiling}
          step={512}
          value={maxRam}
          onChange={(event) => {
            const value = Number(event.target.value)
            setMaxRam(value)
            if (minRam > value) setMinRam(value)
          }}
        />
        <p className="field-hint">
          {memory
            ? `Your PC has ${formatRam(memory.systemMb)}. NexusCraft caps allocation at ${formatRam(memory.ceiling)} so Windows keeps enough to stay responsive. ${formatRam(memory.max)} is recommended for this machine — more than about 8 GB usually makes Minecraft stutter, not run faster.`
            : 'More is not always better: beyond about 8 GB, Java garbage collection pauses tend to get worse.'}
        </p>
      </div>

      <div className="field">
        <div className="row between">
          <label className="field-label">Minimum memory</label>
          <span className="small muted">{formatRam(minRam)}</span>
        </div>
        <input
          className="slider"
          type="range"
          min={512}
          max={maxRam}
          step={256}
          value={minRam}
          onChange={(event) => setMinRam(Number(event.target.value))}
        />
      </div>

      <div className="field">
        <label className="field-label">Java executable</label>
        <div className="row gap-8">
          <input
            className="input"
            value={javaPath}
            placeholder="Automatic — NexusCraft picks a matching runtime"
            onChange={(event) => setJavaPath(event.target.value)}
          />
          <button
            className="btn"
            onClick={() => {
              void api.app
                .pickFiles({ title: 'Select java.exe', extensions: ['exe'], multi: false })
                .then((files) => files[0] && setJavaPath(files[0]))
            }}
          >
            Browse
          </button>
        </div>
        <p className="field-hint">Leave empty to let NexusCraft choose the runtime this version needs.</p>
      </div>

      <div className="field">
        <label className="field-label">JVM arguments</label>
        <textarea className="textarea" value={jvmArgs} onChange={(event) => setJvmArgs(event.target.value)} />
        <p className="field-hint">Memory flags are managed by the sliders above and are ignored here.</p>
      </div>

      <div className="divider" />

      <SettingRow name="Start in fullscreen">
        <Toggle checked={fullscreen} onChange={setFullscreen} />
      </SettingRow>

      {!fullscreen && (
        <div className="row gap-12">
          <div className="field flex-1">
            <label className="field-label">Window width</label>
            <input
              className="input"
              type="number"
              min={320}
              max={7680}
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
            />
          </div>
          <div className="field flex-1">
            <label className="field-label">Window height</label>
            <input
              className="input"
              type="number"
              min={240}
              max={4320}
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
