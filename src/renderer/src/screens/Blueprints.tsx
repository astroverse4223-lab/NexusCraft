import { useCallback, useEffect, useState } from 'react'
import { Hammer, Upload, Package, AlertTriangle, Download, Boxes, Bot, FolderOpen } from 'lucide-react'
import type { BlueprintSummary, Companion, CompanionState } from '@shared/companion'
import type { HostedServer } from '@shared/types'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { DropZone } from '../components/DropZone'
import { EmptyState, ErrorView, Spinner } from '../components/ui'

/**
 * Structures to build — by hand with a projection mod, or by a companion.
 *
 * This lives on its own rather than inside the AI Companion screen because the
 * two audiences barely overlap: someone exporting a castle to build themselves
 * over a weekend has no bot, and should not have to make one to reach this.
 */
export function BlueprintsScreen(): JSX.Element {
  const instances = useStore((s) => s.instances)
  const settings = useStore((s) => s.settings)

  const [blueprints, setBlueprints] = useState<BlueprintSummary[] | null>(null)
  const [companions, setCompanions] = useState<Companion[]>([])
  const [states, setStates] = useState<Record<string, CompanionState['status']>>({})
  const [servers, setServers] = useState<HostedServer[]>([])

  /** Prefixed so one dropdown can hold both kinds: `i:<id>` or `s:<id>`. */
  const [target, setTarget] = useState<string>('')
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, bots, statuses, hosted] = await Promise.all([
        api.companion.blueprints(),
        api.companion.list().catch(() => [] as Companion[]),
        api.companion.states().catch(() => [] as CompanionState[]),
        api.host.list().catch(() => [] as HostedServer[])
      ])
      setBlueprints(list)
      setCompanions(bots)
      setStates(Object.fromEntries(statuses.map((s) => [s.companionId, s.status])))
      setServers(hosted)
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Default to whichever instance is selected elsewhere in the launcher.
  useEffect(() => {
    if (target) return
    const preferred = settings?.selectedInstanceId ?? instances[0]?.id ?? ''
    if (preferred) setTarget(`i:${preferred}`)
    else if (servers[0]) setTarget(`s:${servers[0].id}`)
  }, [instances, servers, settings, target])

  const targetKind = target.startsWith('s:') ? 'server' : 'instance'
  const targetId = target.slice(2)
  const instance = targetKind === 'instance' ? (instances.find((i) => i.id === targetId) ?? null) : null
  const server = targetKind === 'server' ? (servers.find((s) => s.id === targetId) ?? null) : null
  const hasTarget = Boolean(instance || server)
  const running = companions.filter((c) => states[c.id] === 'playing' || states[c.id] === 'idle')

  async function importFiles(paths: string[]): Promise<void> {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      for (const path of paths) await api.companion.importSchematic(path)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function pick(): Promise<void> {
    const paths = await api.app.pickFiles({
      title: 'Choose a schematic',
      extensions: ['schem', 'nbt'],
      multi: true
    })
    if (paths.length > 0) await importFiles(paths)
  }

  async function exportTo(blueprint: BlueprintSummary, format: 'schem' | 'nbt'): Promise<void> {
    if (!hasTarget) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const written = await api.companion.exportBlueprint(
        blueprint.id,
        instance ? { instanceId: instance.id } : { serverId: server!.id },
        format
      )
      setNote(`${blueprint.name} written to ${written.path}`)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function setupLitematica(): Promise<void> {
    if (!instance) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const result = await api.companion.setupLitematica(instance.id)
      setNote(`Installed ${result.installed.join(', ')} into ${instance.name}. Launch it and press M in game.`)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function buildWith(blueprint: BlueprintSummary, companionId: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.companion.build(companionId, blueprint.id)
      setNote(`Told ${companions.find((c) => c.id === companionId)?.username ?? 'the companion'} to build ${blueprint.name}.`)
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
          <h1>Blueprints</h1>
          <p className="subtitle">
            Structures to build. Export one into an instance and build it yourself with a projection mod, or hand it to
            a companion and watch it go up.
          </p>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => void pick()} disabled={busy}>
            {busy ? <Spinner /> : <Upload size={15} />} Import schematic
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* ------------------------------------------------- target instance */}

      <div className="panel panel-pad mb-16">
        <div className="row gap-12 wrap">
          <div className="flex-1" style={{ minWidth: 240 }}>
            <label className="tiny dim" style={{ display: 'block', marginBottom: 5 }} htmlFor="bp-instance">
              Export into
            </label>
            <select id="bp-instance" className="input" value={target} onChange={(event) => setTarget(event.target.value)}>
              {instances.length === 0 && servers.length === 0 && <option value="">Nothing to export to yet</option>}
              {instances.length > 0 && (
                <optgroup label="Instances — for Litematica">
                  {instances.map((entry) => (
                    <option key={entry.id} value={`i:${entry.id}`}>
                      {entry.name} — {entry.minecraftVersion} {entry.loader}
                    </option>
                  ))}
                </optgroup>
              )}
              {servers.length > 0 && (
                <optgroup label="Hosted servers — for structure blocks">
                  {servers.map((entry) => (
                    <option key={entry.id} value={`s:${entry.id}`}>
                      {entry.name} — {entry.minecraftVersion} {entry.software}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <button
            className="btn"
            style={{ alignSelf: 'flex-end' }}
            onClick={() => void setupLitematica()}
            disabled={busy || !instance}
            title={
              instance
                ? `Install Litematica and MaLiLib into ${instance.name}`
                : 'Pick an instance first'
            }
          >
            <Boxes size={15} /> Set up Litematica
          </button>

          <button
            className="btn"
            style={{ alignSelf: 'flex-end' }}
            disabled={!hasTarget}
            onClick={() => {
              if (instance) void api.app.openPath(`${instance.gameDir}\\schematics`).catch(() => undefined)
              else if (server) void api.host.openFolder(server.id).catch(() => undefined)
            }}
            title="Open where the exported files are written"
          >
            <FolderOpen size={15} /> Open folder
          </button>
        </div>

        {note && (
          <p className="tiny" style={{ margin: '10px 0 0', color: 'var(--success)', wordBreak: 'break-all' }}>
            {note}
          </p>
        )}

        <p className="field-hint" style={{ marginTop: 10 }}>
          {server ? (
            <>
              Exports go into <strong>{server.name}</strong>&apos;s own world, which is where a{' '}
              <strong>structure block</strong> reads from. Export as <code>.nbt</code>, then in game place a structure
              block, set it to <em>Load</em>, and type the file name. No mods needed — this is the route that works on a
              Forge server.
            </>
          ) : (
            <>
              Exports land in the instance&apos;s <code>schematics</code> folder, where Litematica&apos;s browser looks.
              Press <kbd>M</kbd> in game to load one and place it as a ghost to build along. For a structure block on a
              server, pick the server above instead — a structure block reads from the server&apos;s own world, not the
              client&apos;s.
            </>
          )}
        </p>
      </div>

      {/* ------------------------------------------------------------ list */}

      <DropZone extensions={['schem', 'nbt']} label="Drop a .schem or .nbt here" onFiles={(p) => void importFiles(p)}>
        {blueprints === null ? (
          <div className="panel panel-pad row gap-12 muted">
            <Spinner /> Loading blueprints…
          </div>
        ) : blueprints.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={<Package size={24} />}
              title="No blueprints"
              message="Import a .schem from WorldEdit, Litematica or a schematic site to get started."
            />
          </div>
        ) : (
          <div className="card-grid">
            {blueprints.map((blueprint) => (
              <div key={blueprint.id} className="panel panel-hover">
                <div className="panel-pad col gap-12">
                  <div className="row gap-12">
                    <Package size={17} className="dim" style={{ flexShrink: 0 }} />
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="row gap-8">
                        <span className="truncate" style={{ fontWeight: 650 }}>
                          {blueprint.name}
                        </span>
                        {blueprint.imported && <span className="pill">imported</span>}
                      </div>
                      <div className="tiny dim truncate">
                        {blueprint.width}×{blueprint.height}×{blueprint.depth} ·{' '}
                        {blueprint.blocks.toLocaleString()} blocks
                      </div>
                    </div>
                  </div>

                  <p className="tiny dim" style={{ margin: 0, lineHeight: 1.5, minHeight: 34 }}>
                    {blueprint.blurb}
                  </p>

                  <div className="row gap-8 wrap">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy || !hasTarget}
                      onClick={() => void exportTo(blueprint, 'schem')}
                      title="Write a .schem for Litematica or WorldEdit"
                    >
                      <Download size={14} /> Export
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy || !hasTarget}
                      onClick={() => void exportTo(blueprint, 'nbt')}
                      title="Write a vanilla structure file, for a structure block"
                    >
                      .nbt
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => setExpanded(expanded === blueprint.id ? null : blueprint.id)}
                    >
                      Materials
                    </button>
                  </div>

                  {running.length > 0 && (
                    <div className="row gap-8">
                      <Bot size={14} className="dim" style={{ flexShrink: 0 }} />
                      <select
                        className="input"
                        style={{ flex: 1, minWidth: 0 }}
                        value=""
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value) void buildWith(blueprint, event.target.value)
                        }}
                        title="Have a running companion build this"
                      >
                        <option value="">Have a companion build it…</option>
                        {running.map((companion) => (
                          <option key={companion.id} value={companion.id}>
                            {companion.username}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {expanded === blueprint.id && (
                    <div className="col gap-8">
                      <div className="row gap-8 wrap">
                        {blueprint.materials.map((material) => (
                          <span key={material.block} className="pill">
                            {material.count}× {material.block}
                          </span>
                        ))}
                      </div>
                      {blueprint.notes?.map((entry) => (
                        <div key={entry} className="row gap-8 tiny" style={{ color: 'var(--warning)' }}>
                          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                          <span>{entry}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DropZone>

      <p className="tiny dim" style={{ marginTop: 20, lineHeight: 1.6, maxWidth: '70ch' }}>
        <Hammer size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
        Imported schematics keep their shape and blocks but not block orientation, so stairs and doors come out facing
        default. Legacy MCEdit <code>.schematic</code> files are refused — open one in WorldEdit or Amulet and save it as
        a <code>.schem</code> first.
      </p>
    </>
  )
}
