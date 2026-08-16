import { useEffect, useMemo, useState } from 'react'
import { Check, Coffee, Download, HardDrive, Layers, RefreshCw, Search, Trash2, WifiOff } from 'lucide-react'
import type { JavaInstallation, LauncherErrorPayload, VersionManifestInfo } from '@shared/types'
import { api, toPayload, type InstalledVersion } from '../api'
import { ConfirmDialog, EmptyState, ErrorView, Spinner, Toggle } from '../components/ui'
import { useStore } from '../store/useStore'
import { formatDate } from '../format'

type Filter = 'all' | 'release' | 'snapshot' | 'installed'

/**
 * Version and Java runtime management. Everything listed here comes from
 * Mojang's live manifests — no version information is hardcoded.
 */
export function VersionsScreen(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)

  const [manifest, setManifest] = useState<VersionManifestInfo | null>(null)
  const [installed, setInstalled] = useState<InstalledVersion[]>([])
  const [javas, setJavas] = useState<JavaInstallation[]>([])
  const [filter, setFilter] = useState<Filter>('release')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [installingJava, setInstallingJava] = useState<number | null>(null)

  async function load(refresh = false): Promise<void> {
    if (refresh) setRefreshing(true)
    try {
      const [info, local, runtimes] = await Promise.all([
        api.versions.manifest(refresh),
        api.versions.installed(),
        api.java.list(refresh)
      ])
      setManifest(info)
      setInstalled(local)
      setJavas(runtimes)
      setError(null)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const installedIds = useMemo(() => new Set(installed.map((v) => v.id)), [installed])

  const rows = useMemo(() => {
    const list = manifest?.versions ?? []
    const term = search.trim().toLowerCase()
    return list
      .filter((version) => {
        if (filter === 'release' && version.type !== 'release') return false
        if (filter === 'snapshot' && version.type !== 'snapshot') return false
        if (filter === 'installed' && !installedIds.has(version.id)) return false
        if (term && !version.id.toLowerCase().includes(term)) return false
        return true
      })
      .slice(0, 300)
  }, [manifest, filter, search, installedIds])

  const loaderProfiles = installed.filter((v) => v.isLoaderProfile)

  async function handleDelete(): Promise<void> {
    if (!deleting) return
    setBusy(true)
    try {
      await api.versions.remove(deleting)
      pushToast({ kind: 'success', title: 'Version removed', message: deleting })
      setDeleting(null)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function installJava(major: number): Promise<void> {
    setInstallingJava(major)
    try {
      await api.java.installRuntime(major)
      setJavas(await api.java.list(true))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setInstallingJava(null)
    }
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Library</div>
          <h1>Versions & runtimes</h1>
          <p className="subtitle">
            Minecraft versions come straight from Mojang's official manifest. Java runtimes are the same ones the
            official launcher uses.
          </p>
        </div>
        <button className="btn" disabled={refreshing} onClick={() => void load(true)}>
          {refreshing ? <Spinner /> : <RefreshCw size={15} />} Refresh
        </button>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onRetry={() => void load(true)} onDismiss={() => setError(null)} />
        </div>
      )}

      {manifest?.fromCache && (
        <div className="panel panel-pad row gap-12 mb-16" style={{ borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)' }}>
          <WifiOff size={17} style={{ color: 'var(--warning)' }} />
          <div className="flex-1">
            <div style={{ fontWeight: 600 }}>Showing a cached version list</div>
            <div className="small muted">
              Mojang's manifest could not be reached, so this list is from {formatDate(manifest.fetchedAt)}. Versions you
              have already installed still work offline.
            </div>
          </div>
        </div>
      )}

      {/* Java runtimes */}
      <section className="mb-24">
        <div className="section-title">Java runtimes</div>
        <div className="panel panel-pad">
          {javas.length === 0 ? (
            <p className="muted small">
              No Java runtime found yet. NexusCraft will download the correct one automatically the first time you
              launch, or you can install one now.
            </p>
          ) : (
            <div className="col gap-8">
              {javas.map((java) => (
                <div key={java.path} className="row gap-12">
                  <Coffee size={16} className="dim" />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="row gap-8">
                      <span style={{ fontWeight: 600 }}>Java {java.majorVersion}</span>
                      <span className="small muted">{java.version}</span>
                      {java.managed && <span className="pill accent">Managed</span>}
                    </div>
                    <div className="tiny dim truncate">
                      {java.vendor} · {java.arch} · {java.path}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="row gap-8 mt-16 wrap">
            {[8, 17, 21].map((major) => {
              const present = javas.some((j) => j.majorVersion === major)
              return (
                <button
                  key={major}
                  className="btn btn-sm"
                  disabled={present || installingJava !== null}
                  onClick={() => void installJava(major)}
                >
                  {installingJava === major ? <Spinner /> : present ? <Check size={13} /> : <Download size={13} />}
                  {present ? `Java ${major} installed` : `Install Java ${major}`}
                </button>
              )
            })}
          </div>
          <p className="field-hint mt-8">
            Minecraft 1.20.5 and newer need Java 21, 1.17–1.20.4 need Java 17, and versions before 1.17 need Java 8.
          </p>
        </div>
      </section>

      {/* loader profiles */}
      {loaderProfiles.length > 0 && (
        <section className="mb-24">
          <div className="section-title">Installed mod loader profiles</div>
          <div className="panel panel-pad col gap-8">
            {loaderProfiles.map((profile) => (
              <div key={profile.id} className="row gap-12">
                <Layers size={15} className="dim" />
                <span className="flex-1 truncate small">{profile.id}</span>
                <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => setDeleting(profile.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* version list */}
      <section>
        <div className="row between mb-16 wrap gap-12">
          <div className="section-title" style={{ margin: 0 }}>
            Minecraft versions
            {manifest && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> — latest release {manifest.latestRelease}</span>}
          </div>
          <div className="row gap-8">
            <div className="row gap-8 panel" style={{ padding: '0 10px', borderRadius: 10 }}>
              <Search size={14} className="dim" />
              <input
                className="input"
                style={{ border: 'none', background: 'transparent', padding: '7px 0', width: 150 }}
                placeholder="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="tabs">
              {(['release', 'snapshot', 'installed', 'all'] as Filter[]).map((entry) => (
                <button
                  key={entry}
                  className={`tab ${filter === entry ? 'active' : ''}`}
                  onClick={() => setFilter(entry)}
                >
                  {entry === 'all' ? 'All' : entry[0].toUpperCase() + entry.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="panel panel-pad row gap-12 muted">
            <Spinner /> Loading Mojang's version manifest…
          </div>
        ) : rows.length === 0 ? (
          <div className="panel">
            <EmptyState icon={<Layers size={22} />} title="No versions match" message="Try a different filter or search term." />
          </div>
        ) : (
          <div className="panel" style={{ overflow: 'hidden' }}>
            {rows.map((version, index) => {
              const local = installed.find((v) => v.id === version.id)
              return (
                <div
                  key={version.id}
                  className="row gap-12"
                  style={{
                    padding: '11px 16px',
                    borderTop: index === 0 ? 'none' : '1px solid var(--border)'
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: version.type === 'release' ? 'var(--accent)' : 'var(--text-dim)',
                      flexShrink: 0
                    }}
                  />
                  <span style={{ fontWeight: 600, minWidth: 110 }}>{version.id}</span>
                  <span className="pill" style={{ minWidth: 78, justifyContent: 'center' }}>
                    {version.type === 'old_beta' ? 'beta' : version.type === 'old_alpha' ? 'alpha' : version.type}
                  </span>
                  <span className="small dim flex-1">{formatDate(version.releaseTime)}</span>

                  {local?.javaMajor && <span className="tiny dim">Java {local.javaMajor}</span>}

                  {version.installed ? (
                    <>
                      <span className="pill success">
                        <HardDrive size={11} /> Installed
                      </span>
                      <button
                        className="btn btn-ghost btn-icon"
                        title="Delete this version's files"
                        onClick={() => setDeleting(version.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <span className="tiny dim">Downloads when an instance uses it</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete version ${deleting}?`}
        message="This removes the downloaded files for this version. Instances that use it will download it again on the next launch. Your worlds and mods are not touched."
        confirmLabel="Delete files"
        danger
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
