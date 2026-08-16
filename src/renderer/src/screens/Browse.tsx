import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Download, ExternalLink, Package, Search, Sparkles, Palette, Users } from 'lucide-react'
import type { ContentKindId, Instance, LauncherErrorPayload, ModrinthProject, ModrinthVersion } from '@shared/types'
import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { EmptyState, ErrorView, Modal, Spinner } from '../components/ui'
import { formatBytes, formatDate, LOADER_LABELS } from '../format'

const KIND_TABS: Array<{ kind: ContentKindId; label: string; icon: typeof Package }> = [
  { kind: 'mod', label: 'Mods', icon: Package },
  { kind: 'resourcepack', label: 'Resource packs', icon: Palette },
  { kind: 'shader', label: 'Shaders', icon: Sparkles }
]

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(value)
}

/**
 * Search and install content from Modrinth, scoped to the instance you are
 * looking at — results are filtered to its Minecraft version and mod loader, so
 * what you see is what will actually run.
 */
export function BrowseTab({ instance }: { instance: Instance }): JSX.Element {
  const [kind, setKind] = useState<ContentKindId>('mod')
  const [query, setQuery] = useState('')
  const [projects, setProjects] = useState<ModrinthProject[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [selected, setSelected] = useState<ModrinthProject | null>(null)
  const [matchVersion, setMatchVersion] = useState(true)

  // Keeps a slow response from overwriting a newer one.
  const requestId = useRef(0)

  const search = useCallback(
    async (offset = 0) => {
      const id = ++requestId.current
      setLoading(true)
      try {
        const result = await api.modrinth.search({
          query,
          kind,
          gameVersion: matchVersion ? instance.minecraftVersion : null,
          loader: matchVersion ? instance.loader : null,
          offset,
          limit: 20,
          instanceId: instance.id
        })
        if (id !== requestId.current) return
        setProjects(result.projects)
        setTotal(result.total)
        setError(null)
      } catch (err) {
        if (id !== requestId.current) return
        setError(toPayload(err))
        setProjects([])
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [query, kind, matchVersion, instance.minecraftVersion, instance.loader, instance.id]
  )

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void search(0), query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [search, query])

  const vanilla = instance.loader === 'vanilla'

  return (
    <>
      <div className="row between mb-16 wrap gap-12">
        <div className="tabs">
          {KIND_TABS.map(({ kind: k, label, icon: Icon }) => (
            <button key={k} className={`tab ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
              <Icon size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              {label}
            </button>
          ))}
        </div>

        <div className="row gap-8">
          <div className="row gap-8 panel" style={{ padding: '0 10px', borderRadius: 10 }}>
            <Search size={14} className="dim" />
            <input
              className="input"
              style={{ border: 'none', background: 'transparent', padding: '7px 0', width: 230 }}
              placeholder={`Search Modrinth for ${kind === 'mod' ? 'mods' : kind === 'shader' ? 'shaders' : 'resource packs'}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button
            className={`btn btn-sm ${matchVersion ? 'btn-primary' : ''}`}
            title="Only show content that matches this instance"
            onClick={() => setMatchVersion((v) => !v)}
          >
            {instance.minecraftVersion}
            {!vanilla && kind === 'mod' ? ` · ${LOADER_LABELS[instance.loader]}` : ''}
          </button>
        </div>
      </div>

      {vanilla && kind === 'mod' && (
        <div
          className="panel panel-pad row gap-12 mb-16"
          style={{ borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)' }}
        >
          <Package size={17} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <div className="small">
            This is a vanilla instance, so it cannot load mods. Change its loader to Fabric, Forge, NeoForge or Quilt
            first — resource packs and shaders work either way.
          </div>
        </div>
      )}

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onRetry={() => void search(0)} onDismiss={() => setError(null)} />
        </div>
      )}

      {loading && projects === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Searching Modrinth…
        </div>
      ) : projects && projects.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Search size={22} />}
            title="Nothing found"
            message={
              matchVersion
                ? `No ${kind === 'mod' ? 'mods' : 'packs'} matched for Minecraft ${instance.minecraftVersion}${!vanilla && kind === 'mod' ? ` on ${LOADER_LABELS[instance.loader]}` : ''}. Turn off the version filter to widen the search.`
                : 'Try a different search term.'
            }
          />
        </div>
      ) : (
        <>
          <div className="row between mb-8">
            <span className="tiny dim">
              {total > 0 ? `${compactNumber(total)} result${total === 1 ? '' : 's'}` : ''}
            </span>
            {loading && <Spinner />}
          </div>

          <div className="card-grid">
            {(projects ?? []).map((project) => (
              <button
                key={project.projectId}
                className="panel panel-hover panel-pad col gap-12"
                style={{ textAlign: 'left', alignItems: 'stretch' }}
                onClick={() => setSelected(project)}
              >
                <div className="row gap-11">
                  {project.iconDataUrl ? (
                    <img
                      src={project.iconDataUrl}
                      width={44}
                      height={44}
                      alt=""
                      style={{ borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: 'var(--bg-2)' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: 'var(--panel-strong)',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--text-dim)',
                        flexShrink: 0
                      }}
                    >
                      <Package size={19} />
                    </div>
                  )}
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 650 }}>
                      {project.title}
                    </div>
                    <div className="tiny dim truncate">by {project.author}</div>
                  </div>
                  {project.installed && (
                    <span className="pill success">
                      <Check size={11} /> Installed
                    </span>
                  )}
                </div>

                <div className="tiny dim" style={{ minHeight: 32, lineHeight: 1.45 }}>
                  {project.description.slice(0, 110)}
                  {project.description.length > 110 ? '…' : ''}
                </div>

                <div className="row between">
                  <span className="tiny dim row gap-8">
                    <Download size={11} /> {compactNumber(project.downloads)}
                    <Users size={11} style={{ marginLeft: 4 }} /> {compactNumber(project.follows)}
                  </span>
                  <span className="btn btn-sm btn-primary" style={{ pointerEvents: 'none' }}>
                    View
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {selected && (
        <InstallDialog
          project={selected}
          instance={instance}
          kind={kind}
          matchVersion={matchVersion}
          onClose={() => setSelected(null)}
          onInstalled={() => void search(0)}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------- install */

function InstallDialog({
  project,
  instance,
  kind,
  matchVersion,
  onClose,
  onInstalled
}: {
  project: ModrinthProject
  instance: Instance
  kind: ContentKindId
  matchVersion: boolean
  onClose: () => void
  onInstalled: () => void
}): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const [versions, setVersions] = useState<ModrinthVersion[] | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setVersions(
          await api.modrinth.versions(
            project.projectId,
            kind,
            matchVersion ? instance.minecraftVersion : null,
            matchVersion ? instance.loader : null
          )
        )
      } catch (err) {
        setError(toPayload(err))
        setVersions([])
      }
    })()
  }, [project.projectId, kind, matchVersion, instance.minecraftVersion, instance.loader])

  async function install(version: ModrinthVersion): Promise<void> {
    setInstalling(version.versionId)
    setError(null)
    try {
      const result = await api.modrinth.install(instance.id, version.versionId, kind)
      setDone(true)
      onInstalled()
      if (result.installed.length === 0 && result.skipped.length > 0) {
        pushToast({ kind: 'info', title: 'Already installed', message: result.skipped.join(', ') })
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <Modal
      open
      title={project.title}
      subtitle={`by ${project.author}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button
            className="btn"
            onClick={() => void api.app.openExternal(`https://modrinth.com/${project.projectType}/${project.slug}`)}
          >
            <ExternalLink size={14} /> View on Modrinth
          </button>
          <div className="flex-1" />
          <button className="btn" onClick={onClose}>
            {done ? 'Done' : 'Close'}
          </button>
        </>
      }
    >
      <p className="small muted">{project.description}</p>

      <div className="row gap-8 wrap">
        {project.categories.map((category) => (
          <span key={category} className="pill">
            {category}
          </span>
        ))}
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="divider" style={{ margin: '6px 0' }} />

      <div className="section-title" style={{ margin: 0 }}>
        {matchVersion
          ? `Builds for Minecraft ${instance.minecraftVersion}${kind === 'mod' && instance.loader !== 'vanilla' ? ` · ${LOADER_LABELS[instance.loader]}` : ''}`
          : 'All builds'}
      </div>

      {versions === null ? (
        <div className="row gap-12 muted small">
          <Spinner /> Loading builds…
        </div>
      ) : versions.length === 0 ? (
        <p className="small" style={{ color: 'var(--warning)' }}>
          No build of this project matches Minecraft {instance.minecraftVersion}
          {kind === 'mod' && instance.loader !== 'vanilla' ? ` on ${LOADER_LABELS[instance.loader]}` : ''}. Installing
          it anyway would not load.
        </p>
      ) : (
        <div className="col gap-8">
          {versions.slice(0, 12).map((version) => (
            <div key={version.versionId} className="panel row gap-12" style={{ padding: 11 }}>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="row gap-8">
                  <span className="truncate" style={{ fontWeight: 600 }}>
                    {version.versionNumber}
                  </span>
                  {version.versionType !== 'release' && (
                    <span className="pill warning">{version.versionType}</span>
                  )}
                  {version.requiredDependencies > 0 && (
                    <span className="pill" title="Required dependencies are installed automatically">
                      +{version.requiredDependencies} dep{version.requiredDependencies === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="tiny dim truncate">
                  {formatDate(version.datePublished)} · {formatBytes(version.fileSizeBytes)} ·{' '}
                  {version.gameVersions.slice(0, 4).join(', ')}
                </div>
              </div>
              <button
                className="btn btn-sm btn-primary"
                disabled={installing !== null}
                onClick={() => void install(version)}
              >
                {installing === version.versionId ? <Spinner /> : <Download size={13} />}
                {installing === version.versionId ? 'Installing…' : 'Install'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
