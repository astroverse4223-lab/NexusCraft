import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUp,
  BarChart3,
  Calculator,
  Compass,
  Download,
  Eye,
  FileCode2,
  Globe2,
  Hammer,
  Home,
  LifeBuoy,
  Package,
  Pickaxe,
  Radar,
  Settings,
  Shuffle,
  Skull,
  Sparkles,
  Swords,
  Timer,
  Trash2,
  Trophy
} from 'lucide-react'
import type {
  DataPackDefinition,
  DataPackOptionValues,
  Instance,
  InstalledDataPack,
  LauncherErrorPayload,
  WorldInfo
} from '@shared/types'
import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { EmptyState, ErrorView, Modal, SettingRow, Spinner, Toggle } from '../components/ui'
import { formatBytes } from '../format'

const ICONS: Record<string, typeof Package> = {
  settings: Settings,
  compass: Compass,
  eye: Eye,
  package: Package,
  trophy: Trophy,
  skull: Skull,
  house: Home,
  shuffle: Shuffle,
  lifebuoy: LifeBuoy,
  calculator: Calculator,
  'arrow-up': ArrowUp,
  radar: Radar,
  timer: Timer,
  'bar-chart': BarChart3,
  hammer: Hammer,
  pickaxe: Pickaxe,
  swords: Swords
}

/** Starting values for a pack's options, taken from its definition. */
function defaultsFor(pack: DataPackDefinition): DataPackOptionValues {
  const values: DataPackOptionValues = {}
  for (const option of pack.options) values[option.key] = option.default
  return values
}

/**
 * Generates real Minecraft data packs into a world.
 *
 * Data packs are vanilla's own extension format — JSON and command functions —
 * so nothing here needs a mod loader or a Java compiler, and what gets written
 * is shown in full before it is installed.
 */
export function DataPacksTab({ instance }: { instance: Instance }): JSX.Element {
  const [packs, setPacks] = useState<DataPackDefinition[] | null>(null)
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const [world, setWorld] = useState<string>('')
  const [installed, setInstalled] = useState<InstalledDataPack[]>([])
  const [configuring, setConfiguring] = useState<DataPackDefinition | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const loadWorlds = useCallback(async () => {
    try {
      const list = await api.worlds.list(instance.id)
      setWorlds(list)
      setWorld((current) => current || list[0]?.folderName || '')
    } catch (err) {
      setError(toPayload(err))
      setWorlds([])
    }
  }, [instance.id])

  useEffect(() => {
    void api.datapacks.list().then(setPacks).catch((err) => setError(toPayload(err)))
  }, [])

  useEffect(() => {
    void loadWorlds()
  }, [loadWorlds])

  const refreshInstalled = useCallback(async () => {
    if (!world) return setInstalled([])
    try {
      setInstalled(await api.datapacks.installed(instance.id, world))
    } catch {
      setInstalled([])
    }
  }, [instance.id, world])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  return (
    <>
      <div className="panel panel-pad row gap-12 mb-16">
        <FileCode2 size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div className="small muted flex-1">
          Data packs are Minecraft's own extension format — plain JSON and command scripts that vanilla loads directly.
          No mod loader is involved, so these work on a vanilla instance. Each pack is installed into one world.
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="row between mb-16 wrap gap-12">
        <div className="row gap-8">
          <Globe2 size={15} className="dim" />
          <span className="small muted">Install into</span>
          {worlds === null ? (
            <Spinner />
          ) : worlds.length === 0 ? (
            <span className="small" style={{ color: 'var(--warning)' }}>
              no worlds yet — create one in game first
            </span>
          ) : (
            <select
              className="select"
              style={{ width: 240 }}
              value={world}
              onChange={(event) => setWorld(event.target.value)}
            >
              {worlds.map((entry) => (
                <option key={entry.folderName} value={entry.folderName}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {installed.length > 0 && (
          <span className="tiny dim">
            {installed.length} pack{installed.length === 1 ? '' : 's'} already in this world
          </span>
        )}
      </div>

      {packs === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Loading…
        </div>
      ) : (
        <div className="col gap-24">
          {[...new Set(packs.map((p) => p.category))].map((category) => (
            <div key={category}>
              <div className="section-title">{category}</div>
              <div className="card-grid">
                {packs.filter((p) => p.category === category).map((pack) => {
            const Icon = ICONS[pack.icon] ?? Sparkles
            const already = installed.find((i) => i.fileName === `${pack.id}.zip`)
            return (
              <div key={pack.id} className="panel panel-hover panel-pad col gap-12">
                <div className="row gap-11">
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Icon size={19} />
                  </div>
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="row gap-8">
                      <span className="truncate" style={{ fontWeight: 650 }}>
                        {pack.name}
                      </span>
                      {already && <span className="pill success">Installed</span>}
                    </div>
                    <div className="tiny dim">{pack.tagline}</div>
                  </div>
                </div>

                <p className="tiny dim" style={{ minHeight: 46, lineHeight: 1.5 }}>
                  {pack.description}
                </p>

                <div className="row gap-8">
                  <button
                    className="btn btn-primary btn-sm flex-1"
                    disabled={!world}
                    onClick={() => setConfiguring(pack)}
                  >
                    <Sparkles size={13} /> {already ? 'Reconfigure' : 'Set up'}
                  </button>
                  {already && (
                    <button
                      className="btn btn-ghost btn-icon"
                      title="Remove from this world"
                      onClick={() => {
                        void api.datapacks
                          .remove(instance.id, world, already.fileName)
                          .then(refreshInstalled)
                          .catch((err) => setError(toPayload(err)))
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {configuring && (
        <ConfigureDialog
          pack={configuring}
          instance={instance}
          world={world}
          onClose={() => setConfiguring(null)}
          onInstalled={() => {
            setConfiguring(null)
            void refreshInstalled()
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------ configure */

function ConfigureDialog({
  pack,
  instance,
  world,
  onClose,
  onInstalled
}: {
  pack: DataPackDefinition
  instance: Instance
  world: string
  onClose: () => void
  onInstalled: () => void
}): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const [values, setValues] = useState<DataPackOptionValues>(() => defaultsFor(pack))
  const [preview, setPreview] = useState<{
    packFormat: number
    formatSource: string
    files: Array<{ path: string; content: string }>
  } | null>(null)
  const [showFiles, setShowFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  // Re-render the pack whenever an option changes, so the preview always
  // matches exactly what would be written.
  useEffect(() => {
    let cancelled = false
    void api.datapacks
      .preview(instance.id, pack.id, values)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((err) => {
        if (!cancelled) setError(toPayload(err))
      })
    return () => {
      cancelled = true
    }
  }, [instance.id, pack.id, values])

  const functionFiles = useMemo(
    () => (preview?.files ?? []).filter((f) => f.path.endsWith('.mcfunction')),
    [preview]
  )

  async function install(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.datapacks.install(instance.id, world, pack.id, values)
      onInstalled()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function exportPack(): Promise<void> {
    const target = await api.app.pickSavePath({
      title: `Export ${pack.name}`,
      defaultName: `${pack.id}.zip`,
      extensions: ['zip']
    })
    if (!target) return
    try {
      await api.datapacks.export(instance.id, pack.id, values, target)
    } catch (err) {
      setError(toPayload(err))
    }
  }

  return (
    <Modal
      open
      title={pack.name}
      subtitle={pack.tagline}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button className="btn" onClick={() => void exportPack()} disabled={busy || !preview}>
            <Download size={14} /> Export .zip
          </button>
          <div className="flex-1" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void install()} disabled={busy || !world || !preview}>
            {busy && <Spinner />} Install into world
          </button>
        </>
      }
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <p className="small muted">{pack.description}</p>

      {pack.options.length > 0 && (
        <div>
          {pack.options.map((option) => (
            <SettingRow key={option.key} name={option.label}>
              {option.type === 'boolean' && (
                <Toggle
                  checked={Boolean(values[option.key])}
                  onChange={(next) => setValues((v) => ({ ...v, [option.key]: next }))}
                />
              )}
              {option.type === 'number' && (
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  min={option.min}
                  max={option.max}
                  value={Number(values[option.key])}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, [option.key]: Number(event.target.value) }))
                  }
                />
              )}
              {option.type === 'select' && (
                <select
                  className="select"
                  style={{ width: 280 }}
                  value={String(values[option.key])}
                  onChange={(event) => setValues((v) => ({ ...v, [option.key]: event.target.value }))}
                >
                  {(option.choices ?? []).map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
            </SettingRow>
          ))}
        </div>
      )}

      <div className="divider" style={{ margin: '4px 0' }} />

      {preview ? (
        <>
          <div className="row between">
            <span className="small muted">
              {preview.files.length} files · pack_format {preview.packFormat}
            </span>
            <button className="link small" onClick={() => setShowFiles((v) => !v)}>
              {showFiles ? 'Hide' : 'Show'} what will be written
            </button>
          </div>
          <p className="field-hint">
            Format read from {preview.formatSource}, so it matches Minecraft {instance.minecraftVersion} exactly.
          </p>

          {showFiles && (
            <div className="col gap-12 mt-8">
              {functionFiles.map((file) => (
                <div key={file.path}>
                  <div className="tiny dim mono mb-8">{file.path}</div>
                  <pre
                    className="mono selectable"
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      background: 'rgba(0,0,0,0.36)',
                      border: '1px solid var(--border)',
                      borderRadius: 9,
                      padding: 11,
                      margin: 0,
                      maxHeight: 220,
                      overflow: 'auto',
                      fontSize: 11.5,
                      color: 'var(--text-muted)'
                    }}
                  >
                    {file.content.trim()}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="row gap-12 muted small">
          <Spinner /> Building the pack…
        </div>
      )}

      <div className="row gap-8 small muted mt-8">
        <Sparkles size={15} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent)' }} />
        <span>
          Installs into <strong style={{ color: 'var(--text)' }}>{world || 'no world selected'}</strong>. Reopen the
          world, or run <code className="mono">/reload</code> in game, to activate it.
        </span>
      </div>
    </Modal>
  )
}
