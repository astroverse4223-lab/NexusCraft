import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Boxes, Check, Download, ExternalLink, Key, Package, Search, Sparkles, Palette, Users } from 'lucide-react'
import type { ContentKindId, Instance, LauncherErrorPayload, ModrinthProject, ModrinthVersion } from '@shared/types'
import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { EmptyState, ErrorView, Modal, Spinner } from '../components/ui'
import { formatBytes, formatDate, LOADER_LABELS } from '../format'

const KIND_TABS: Array<{ kind: ContentKindId; label: string; icon: typeof Package }> = [
  { kind: 'mod', label: 'Mods', icon: Package },
  { kind: 'resourcepack', label: 'Resource packs', icon: Palette },
  { kind: 'shader', label: 'Shaders', icon: Sparkles },
  { kind: 'modpack', label: 'Modpacks', icon: Boxes }
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
type Source = 'modrinth' | 'curseforge'

/**
 * Where searched content should be installed.
 *
 * Servers take the same mods instances do, from the same places, so the browser
 * works for both — it only needs to know what to match against and where to put
 * what it finds. Adding a mod to a server used to mean finding the jar yourself,
 * checking it suited the loader, and dropping it in a folder by hand.
 */
export interface BrowseDestination {
  id: string
  name: string
  minecraftVersion: string
  loader: string
  /**
   * Whether this destination is a hosted server rather than an instance.
   *
   * It changes what a modpack means as well as where mods go: browsing from a
   * server, installing a pack builds a new server to host, keeping only what a
   * dedicated server can actually use.
   */
  isServer: boolean
}

export function BrowseTab({
  instance,
  destination,
  initialKind,
  lockKind
}: {
  instance: Instance
  destination?: BrowseDestination
  /** What to search for when the browser opens. Defaults to mods. */
  initialKind?: ContentKindId
  /**
   * Hides the content-type tabs. Used where only one kind makes sense — building
   * a new server from a pack has nothing to offer under "Shaders".
   */
  lockKind?: boolean
}): JSX.Element {
  // Falls back to the instance, which is what every existing caller passes.
  const target: BrowseDestination = destination ?? {
    id: instance.id,
    name: instance.name,
    minecraftVersion: instance.minecraftVersion,
    loader: instance.loader,
    isServer: false
  }

  const navigate = useStore((s) => s.navigate)
  const [source, setSource] = useState<Source>('modrinth')
  const [cfConfigured, setCfConfigured] = useState<boolean | null>(null)
  const [kind, setKind] = useState<ContentKindId>(initialKind ?? 'mod')
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
        const input = {
          query,
          kind,
          gameVersion: matchVersion ? target.minecraftVersion : null,
          loader: matchVersion && kind !== 'modpack' ? target.loader : null,
          offset,
          limit: 20,
          /*
           * Null, not an empty string, when there is nowhere to install to yet.
           * "Host a modpack" browses before the server exists, and an empty id
           * fails validation on the way in — so every search in that modal
           * came back as an internal error instead of results.
           */
          instanceId: target.id || null
        }
        const result =
          source === 'curseforge' ? await api.curseforge.search(input) : await api.modrinth.search(input)
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
    [query, kind, source, matchVersion, instance.minecraftVersion, instance.loader, instance.id]
  )

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void search(0), query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [search, query])

  useEffect(() => {
    void api.curseforge
      .status()
      .then((s) => setCfConfigured(s.configured))
      .catch(() => setCfConfigured(false))
  }, [])

  const vanilla = instance.loader === 'vanilla'

  return (
    <>
      <div className="row between mb-16 wrap gap-12">
        {lockKind ? (
          <div />
        ) : (
          <div className="tabs">
            {KIND_TABS
              /*
               * A server runs neither resource packs nor shaders — both are
               * client-side. Offering them installed a zip into the server's
               * mods folder, where nothing would ever read it.
               */
              .filter(({ kind: k }) => !target.isServer || k === 'mod' || k === 'modpack')
              .map(({ kind: k, label, icon: Icon }) => (
                <button key={k} className={`tab ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
                  <Icon size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
                  {label}
                </button>
              ))}
          </div>
        )}

        <div className="row gap-8">
          <div className="tabs">
            <button
              className={`tab ${source === 'modrinth' ? 'active' : ''}`}
              onClick={() => setSource('modrinth')}
            >
              Modrinth
            </button>
            <button
              className={`tab ${source === 'curseforge' ? 'active' : ''}`}
              onClick={() => setSource('curseforge')}
            >
              CurseForge
            </button>
          </div>
          <div className="row gap-8 panel" style={{ padding: '0 10px', borderRadius: 10 }}>
            <Search size={14} className="dim" />
            <input
              className="input"
              style={{ border: 'none', background: 'transparent', padding: '7px 0', width: 230 }}
              placeholder={`Search ${source === 'curseforge' ? 'CurseForge' : 'Modrinth'} for ${kind === 'mod' ? 'mods' : kind === 'shader' ? 'shaders' : kind === 'modpack' ? 'modpacks' : 'resource packs'}`}
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

      {source === 'curseforge' && cfConfigured === false && (
        <div
          className="panel panel-pad row gap-12 mb-16"
          style={{ borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)' }}
        >
          <Key size={17} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <div className="flex-1">
            <div style={{ fontWeight: 600 }}>CurseForge needs an API key</div>
            <div className="small muted mt-8">
              Searching CurseForge requires a free key from their developer console. It is issued instantly and is
              stored only on this PC. Modrinth needs no key and works right now.
            </div>
            <div className="row gap-8 mt-16">
              <button className="btn btn-sm" onClick={() => navigate('settings')}>
                Add the key in Settings
              </button>
              <button
                className="btn btn-sm"
                onClick={() => void api.app.openExternal('https://console.curseforge.com')}
              >
                <ExternalLink size={13} /> Get a key
              </button>
            </div>
          </div>
        </div>
      )}

      {kind === 'modpack' && (
        <div className="panel panel-pad row gap-12 mb-16">
          <Boxes size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div className="small muted">
            {target.isServer ? (
              <>
                Installing a modpack creates a <strong style={{ color: 'var(--text)' }}>new server</strong> with its own
                Minecraft version, loader and mods. Client-only mods, such as minimaps and shaders, are turned off
                because a server cannot run them. Your existing servers are untouched.
              </>
            ) : (
              <>
                Installing a modpack creates a <strong style={{ color: 'var(--text)' }}>new instance</strong> with its
                own Minecraft version, loader and mods. Your existing instances are untouched.
              </>
            )}
          </div>
        </div>
      )}

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
          <Spinner /> Searching {source === 'curseforge' ? 'CurseForge' : 'Modrinth'}…
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
          target={target}
          kind={kind}
          source={source}
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
  target,
  kind,
  source,
  matchVersion,
  onClose,
  onInstalled
}: {
  project: ModrinthProject
  instance: Instance
  /** Where the download lands — an instance, or a hosted server. */
  target: BrowseDestination
  kind: ContentKindId
  source: Source
  matchVersion: boolean
  onClose: () => void
  onInstalled: () => void
}): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const refreshInstances = useStore((s) => s.refreshInstances)
  const selectInstance = useStore((s) => s.selectInstance)
  const navigate = useStore((s) => s.navigate)
  const [versions, setVersions] = useState<ModrinthVersion[] | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        // Match the destination, not the instance the screen happens to sit in.
        // Reading the instance here meant a server browse filtered by nothing at
        // all, and offered builds for the wrong loader and the wrong version.
        const gameVersion = matchVersion ? target.minecraftVersion : null
        const loader = matchVersion && kind !== 'modpack' ? target.loader : null
        setVersions(
          source === 'curseforge'
            ? await api.curseforge.files(project.projectId, kind, gameVersion, loader)
            : await api.modrinth.versions(project.projectId, kind, gameVersion, loader)
        )
      } catch (err) {
        setError(toPayload(err))
        setVersions([])
      }
    })()
  }, [project.projectId, kind, source, matchVersion, instance.minecraftVersion, instance.loader])

  async function install(version: ModrinthVersion): Promise<void> {
    setInstalling(version.versionId)
    setError(null)
    try {
      if (kind === 'modpack') {
        /*
         * A modpack declares its own Minecraft version and loader, so it becomes
         * something new rather than being merged into the current destination —
         * a server when browsing from one, an instance otherwise.
         */
        if (target.isServer) {
          const result =
            source === 'curseforge'
              ? await api.modpacks.serverFromCurseForge(project.projectId, version.versionId, { name: project.title })
              : await api.modpacks.serverFromModrinth(version.versionId, { name: project.title })
          setDone(true)
          onClose()
          onInstalled()
          navigate('host')
          if (result.clientOnlyMods.length > 0) {
            pushToast({
              kind: 'info',
              title: `${result.clientOnlyMods.length} client-only mod${result.clientOnlyMods.length === 1 ? '' : 's'} turned off`,
              message: `A server cannot run ${result.clientOnlyMods.slice(0, 4).join(', ')}. They are still there, switched off, if you disagree.`
            })
          }
          return
        }

        const result =
          source === 'curseforge'
            ? await api.modpacks.installFromCurseForge(project.projectId, version.versionId, project.title)
            : await api.modpacks.installFromModrinth(version.versionId, project.title)
        await refreshInstances()
        await selectInstance(result.instance.id)
        setDone(true)
        onClose()
        navigate('play')
        return
      }

      const result = target.isServer
        ? source === 'curseforge'
          ? await api.host.installCurseForge(target.id, project.projectId, version.versionId, kind)
          : await api.host.installModrinth(target.id, version.versionId, kind)
        : source === 'curseforge'
          ? await api.curseforge.install(target.id, project.projectId, version.versionId, kind)
          : await api.modrinth.install(target.id, version.versionId, kind)
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
      // Name the destination outright: the same browser fills instances and
      // servers now, and once it is open the two look identical.
      /*
       * A modpack brings its own Minecraft version and loader and becomes a new
       * instance, so naming the current destination is not just unhelpful but
       * wrong — a Fabric 1.20.1 pack was reading as "installing into AI World
       * (server, forge 1.21.11)", which describes something that never happens.
       */
      subtitle={
        kind === 'modpack'
          ? `by ${project.author} — creates its own new ${target.isServer ? 'server' : 'instance'}`
          : `by ${project.author} — installing into ${target.name} (${target.isServer ? 'server' : 'instance'}, ${target.loader} ${target.minecraftVersion})`
      }
      onClose={onClose}
      width={640}
      footer={
        <>
          <button
            className="btn"
            onClick={() =>
              void api.app.openExternal(
                project.pageUrl ?? `https://modrinth.com/${project.projectType}/${project.slug}`
              )
            }
          >
            <ExternalLink size={14} /> View on {source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
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

      {project.distributionAllowed === false && (
        <div className="row gap-8 small" style={{ color: 'var(--warning)' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            This author has turned off third-party downloads, so no launcher may fetch it automatically. Download it
            from CurseForge and add it with “Add mods”.
          </span>
        </div>
      )}

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
                disabled={installing !== null || version.downloadable === false}
                title={
                  version.downloadable === false
                    ? 'The author has disabled third-party downloads for this file'
                    : undefined
                }
                onClick={() => void install(version)}
              >
                {installing === version.versionId ? <Spinner /> : <Download size={13} />}
                {installing === version.versionId
                  ? 'Installing…'
                  : version.downloadable === false
                    ? 'Manual only'
                    : kind === 'modpack'
                      ? 'Create instance'
                      : 'Install'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
