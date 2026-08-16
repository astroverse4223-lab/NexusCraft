import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  FolderOpen,
  Image as ImageIcon,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react'
import type { ContentPack, Instance, LauncherErrorPayload, ModInfo } from '@shared/types'
import { api, toPayload, type Screenshot } from '../api'
import { useStore, focusedInstance } from '../store/useStore'
import { ConfirmDialog, EmptyState, ErrorView, Spinner, Toggle } from '../components/ui'
import { formatBytes, formatRelative, LOADER_COLORS, LOADER_LABELS } from '../format'

type Tab = 'mods' | 'resourcepacks' | 'shaderpacks' | 'screenshots'

export function ModsScreen(): JSX.Element {
  const instance = useStore(focusedInstance)
  const instances = useStore((s) => s.instances)
  const navigate = useStore((s) => s.navigate)
  const [tab, setTab] = useState<Tab>('mods')

  if (!instance) {
    return (
      <div className="panel">
        <EmptyState
          icon={<Package size={24} />}
          title="No instance selected"
          message="Mods, resource packs and shaders belong to a specific instance. Create one first."
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
          <div className="eyebrow">Content</div>
          <h1>Mods & packs</h1>
          <p className="subtitle">
            Everything here belongs to <strong style={{ color: 'var(--text)' }}>{instance.name}</strong> only. Other
            instances have their own separate files.
          </p>
        </div>
        <select
          className="select"
          style={{ width: 230 }}
          value={instance.id}
          onChange={(event) => navigate('mods', event.target.value)}
        >
          {instances.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>

      <div className="tabs mb-24">
        <button className={`tab ${tab === 'mods' ? 'active' : ''}`} onClick={() => setTab('mods')}>
          Mods
        </button>
        <button className={`tab ${tab === 'resourcepacks' ? 'active' : ''}`} onClick={() => setTab('resourcepacks')}>
          Resource packs
        </button>
        <button className={`tab ${tab === 'shaderpacks' ? 'active' : ''}`} onClick={() => setTab('shaderpacks')}>
          Shaders
        </button>
        <button className={`tab ${tab === 'screenshots' ? 'active' : ''}`} onClick={() => setTab('screenshots')}>
          Screenshots
        </button>
      </div>

      {tab === 'mods' && <ModsTab instance={instance} />}
      {tab === 'resourcepacks' && <ContentTab instance={instance} kind="resourcepacks" />}
      {tab === 'shaderpacks' && <ContentTab instance={instance} kind="shaderpacks" />}
      {tab === 'screenshots' && <ScreenshotsTab instance={instance} />}
    </>
  )
}

/* ----------------------------------------------------------------- mods */

function ModsTab({ instance }: { instance: Instance }): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const [mods, setMods] = useState<ModInfo[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [deleting, setDeleting] = useState<ModInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setMods(await api.mods.list(instance.id))
      setError(null)
    } catch (err) {
      setError(toPayload(err))
      setMods([])
    }
  }, [instance.id])

  useEffect(() => {
    setMods(null)
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return mods ?? []
    return (mods ?? []).filter(
      (mod) =>
        mod.name.toLowerCase().includes(term) ||
        mod.fileName.toLowerCase().includes(term) ||
        (mod.modId ?? '').toLowerCase().includes(term)
    )
  }, [mods, search])

  const problems = (mods ?? []).filter((mod) => mod.enabled && mod.issues.some((i) => i.severity === 'error'))

  async function toggle(mod: ModInfo, enabled: boolean): Promise<void> {
    try {
      await api.mods.setEnabled(instance.id, mod.fileName, enabled)
      await load()
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function importMods(): Promise<void> {
    try {
      const files = await api.app.pickFiles({ title: 'Choose mod .jar files', extensions: ['jar'], multi: true })
      if (files.length === 0) return
      const result = await api.mods.import(instance.id, files)
      pushToast({
        kind: result.imported > 0 ? 'success' : 'warning',
        title: result.imported > 0 ? `${result.imported} mod${result.imported === 1 ? '' : 's'} added` : 'Nothing imported',
        message: result.imported > 0 ? undefined : 'Only .jar files can be installed as mods.'
      })
      await load()
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function remove(): Promise<void> {
    if (!deleting) return
    setBusy(true)
    try {
      await api.mods.remove(instance.id, deleting.fileName)
      setDeleting(null)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  if (instance.loader === 'vanilla') {
    return (
      <div className="panel">
        <EmptyState
          icon={<Package size={24} />}
          title="This is a vanilla instance"
          message="Minecraft cannot load mods without a mod loader. Edit this instance and choose Fabric, Forge, NeoForge or Quilt to install mods."
        />
      </div>
    )
  }

  return (
    <>
      <div className="row between mb-16 wrap gap-12">
        <div className="row gap-8">
          <div className="row gap-8 panel" style={{ padding: '0 10px', borderRadius: 10 }}>
            <Search size={14} className="dim" />
            <input
              className="input"
              style={{ border: 'none', background: 'transparent', padding: '7px 0', width: 190 }}
              placeholder="Search mods"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <span className="pill" style={{ color: LOADER_COLORS[instance.loader] }}>
            {LOADER_LABELS[instance.loader]}
          </span>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => void importMods()}>
            <Plus size={15} /> Add mods
          </button>
          <button className="btn" onClick={() => void api.mods.openFolder(instance.id)}>
            <FolderOpen size={15} /> Open folder
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

      {problems.length > 0 && (
        <div
          className="panel panel-pad row gap-12 mb-16"
          style={{ borderColor: 'color-mix(in srgb, var(--danger) 32%, transparent)' }}
        >
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600 }}>
              {problems.length} mod{problems.length === 1 ? '' : 's'} would stop this instance from starting
            </div>
            <div className="small muted">
              NexusCraft blocks the launch while these are enabled, because Minecraft would crash on startup. Disable or
              remove them below.
            </div>
          </div>
        </div>
      )}

      {mods === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Reading the mods folder…
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Package size={24} />}
            title={mods.length === 0 ? 'No mods installed' : 'No mods match your search'}
            message={
              mods.length === 0
                ? `Drop .jar files into this instance's mods folder, or use "Add mods" to copy them in.`
                : 'Try a different search term.'
            }
            action={
              mods.length === 0 ? (
                <button className="btn btn-primary btn-sm" onClick={() => void importMods()}>
                  <Plus size={14} /> Add mods
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="col gap-8">
          {filtered.map((mod) => (
            <ModRow key={mod.fileName} mod={mod} onToggle={(value) => void toggle(mod, value)} onDelete={() => setDeleting(mod)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Remove ${deleting?.name}?`}
        message="The mod file is permanently deleted from this instance. Worlds that depend on it may not load correctly afterwards."
        confirmLabel="Delete mod"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function ModRow({
  mod,
  onToggle,
  onDelete
}: {
  mod: ModInfo
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}): JSX.Element {
  const errors = mod.issues.filter((i) => i.severity === 'error')
  const warnings = mod.issues.filter((i) => i.severity === 'warning')

  return (
    <div
      className="panel panel-hover row gap-12"
      style={{
        padding: 13,
        opacity: mod.enabled ? 1 : 0.58,
        borderColor: errors.length > 0 && mod.enabled ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : undefined
      }}
    >
      {mod.iconDataUrl ? (
        <img
          src={mod.iconDataUrl}
          width={40}
          height={40}
          alt=""
          style={{ borderRadius: 9, imageRendering: 'auto', objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 9,
            background: 'var(--panel-strong)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text-dim)',
            flexShrink: 0
          }}
        >
          <Package size={17} />
        </div>
      )}

      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="row gap-8">
          <span className="truncate" style={{ fontWeight: 600 }}>
            {mod.name}
          </span>
          {mod.version && <span className="tiny dim">{mod.version}</span>}
          {mod.loaders.map((loader) => (
            <span key={loader} className="pill" style={{ color: LOADER_COLORS[loader] }}>
              {LOADER_LABELS[loader]}
            </span>
          ))}
        </div>

        <div className="tiny dim truncate">
          {mod.fileName} · {formatBytes(mod.sizeBytes)}
          {mod.authors.length > 0 && ` · ${mod.authors.slice(0, 3).join(', ')}`}
        </div>

        {errors.map((issue, index) => (
          <div key={index} className="tiny row gap-4 mt-8" style={{ color: 'var(--danger)' }}>
            <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 2 }} />
            {issue.message}
          </div>
        ))}
        {warnings.map((issue, index) => (
          <div key={index} className="tiny row gap-4 mt-8" style={{ color: 'var(--warning)' }}>
            <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 2 }} />
            {issue.message}
          </div>
        ))}
      </div>

      <Toggle checked={mod.enabled} onChange={onToggle} />
      <button className="btn btn-ghost btn-icon" title="Delete" onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  )
}

/* -------------------------------------------------- packs and shaders */

function ContentTab({ instance, kind }: { instance: Instance; kind: 'resourcepacks' | 'shaderpacks' }): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const [packs, setPacks] = useState<ContentPack[] | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [deleting, setDeleting] = useState<ContentPack | null>(null)
  const [busy, setBusy] = useState(false)

  const label = kind === 'resourcepacks' ? 'resource pack' : 'shader pack'

  const load = useCallback(async () => {
    try {
      setPacks(await api.content.list(instance.id, kind))
      setError(null)
    } catch (err) {
      setError(toPayload(err))
      setPacks([])
    }
  }, [instance.id, kind])

  useEffect(() => {
    setPacks(null)
    void load()
  }, [load])

  async function importPacks(): Promise<void> {
    try {
      const files = await api.app.pickFiles({ title: `Choose ${label} .zip files`, extensions: ['zip'], multi: true })
      if (files.length === 0) return
      const result = await api.content.import(instance.id, kind, files)
      pushToast({
        kind: result.imported > 0 ? 'success' : 'warning',
        title: result.imported > 0 ? `${result.imported} added` : 'Nothing imported',
        message: result.imported > 0 ? undefined : 'Only .zip archives can be installed.'
      })
      await load()
    } catch (err) {
      setError(toPayload(err))
    }
  }

  return (
    <>
      <div className="row between mb-16">
        <p className="small muted" style={{ maxWidth: '60ch' }}>
          {kind === 'resourcepacks'
            ? 'Installed packs appear in Minecraft under Options → Resource Packs. Disabling one here hides it from the game entirely.'
            : 'Shader packs need a shader mod such as Iris or OptiFine installed in this instance to have any effect.'}
        </p>
        <div className="row gap-8">
          <button className="btn" onClick={() => void importPacks()}>
            <Plus size={15} /> Add
          </button>
          <button className="btn" onClick={() => void api.content.openFolder(instance.id, kind)}>
            <FolderOpen size={15} /> Open folder
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {packs === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Reading the folder…
        </div>
      ) : packs.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={kind === 'resourcepacks' ? <Palette size={24} /> : <Sparkles size={24} />}
            title={`No ${label}s installed`}
            message={`Add a ${label} .zip and it will show up here and inside the game.`}
            action={
              <button className="btn btn-primary btn-sm" onClick={() => void importPacks()}>
                <Plus size={14} /> Add a {label}
              </button>
            }
          />
        </div>
      ) : (
        <div className="card-grid">
          {packs.map((pack) => (
            <div
              key={pack.fileName}
              className="panel panel-hover"
              style={{ overflow: 'hidden', opacity: pack.enabled ? 1 : 0.55 }}
            >
              <div
                style={{
                  height: 96,
                  background: pack.iconDataUrl
                    ? `url(${pack.iconDataUrl}) center/cover`
                    : 'linear-gradient(135deg, var(--panel-strong), transparent)',
                  imageRendering: 'pixelated',
                  borderBottom: '1px solid var(--border)'
                }}
              />
              <div className="panel-pad col gap-8">
                <div className="truncate" style={{ fontWeight: 600 }}>
                  {pack.name}
                </div>
                {pack.description && (
                  <div className="tiny dim" style={{ minHeight: 30 }}>
                    {pack.description.slice(0, 90)}
                  </div>
                )}
                <div className="row between">
                  <span className="tiny dim">
                    {pack.isDirectory ? 'Folder' : formatBytes(pack.sizeBytes)}
                    {pack.packFormat != null && ` · format ${pack.packFormat}`}
                  </span>
                  <div className="row gap-8">
                    <Toggle
                      checked={pack.enabled}
                      onChange={(value) => {
                        void api.content
                          .setEnabled(instance.id, kind, pack.fileName, value)
                          .then(load)
                          .catch((err) => setError(toPayload(err)))
                      }}
                    />
                    <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => setDeleting(pack)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        message={`This permanently removes the ${label} from this instance.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => {
          if (!deleting) return
          setBusy(true)
          void api.content
            .remove(instance.id, kind, deleting.fileName)
            .then(() => {
              setDeleting(null)
              return load()
            })
            .catch((err) => setError(toPayload(err)))
            .finally(() => setBusy(false))
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

/* ---------------------------------------------------------- screenshots */

function ScreenshotsTab({ instance }: { instance: Instance }): JSX.Element {
  const [shots, setShots] = useState<Screenshot[] | null>(null)
  const [preview, setPreview] = useState<Screenshot | null>(null)

  useEffect(() => {
    setShots(null)
    void api.content.screenshots(instance.id).then(setShots).catch(() => setShots([]))
  }, [instance.id])

  return (
    <>
      <div className="row between mb-16">
        <p className="small muted">Screenshots you take in game with F2 appear here.</p>
        <button className="btn" onClick={() => void api.content.openFolder(instance.id, 'screenshots')}>
          <FolderOpen size={15} /> Open folder
        </button>
      </div>

      {shots === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Loading screenshots…
        </div>
      ) : shots.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<ImageIcon size={24} />}
            title="No screenshots yet"
            message="Press F2 while playing to capture one. It will show up here automatically."
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {shots.map((shot) => (
            <button
              key={shot.fileName}
              className="panel panel-hover"
              style={{ overflow: 'hidden', padding: 0, textAlign: 'left' }}
              onClick={() => setPreview(shot)}
            >
              <div
                style={{
                  aspectRatio: '16 / 9',
                  background: shot.dataUrl
                    ? `url(${shot.dataUrl}) center/cover`
                    : 'linear-gradient(135deg, var(--panel-strong), transparent)'
                }}
              />
              <div style={{ padding: '8px 11px' }}>
                <div className="truncate tiny">{shot.fileName}</div>
                <div className="tiny dim">{formatRelative(shot.takenAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {preview?.dataUrl && (
        <div
          className="modal-backdrop"
          onClick={() => setPreview(null)}
          style={{ cursor: 'zoom-out' }}
        >
          <img
            src={preview.dataUrl}
            alt={preview.fileName}
            style={{ maxWidth: '92vw', maxHeight: '86vh', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}
          />
        </div>
      )}
    </>
  )
}
