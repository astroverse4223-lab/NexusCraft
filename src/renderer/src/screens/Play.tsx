import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  Cpu,
  FolderOpen,
  Gauge,
  Layers,
  Pause,
  Play as PlayIcon,
  Power,
  RefreshCw,
  Server,
  Square,
  Terminal,
  Wrench,
  X
} from 'lucide-react'
import type { GameLogLine, LauncherErrorPayload, SavedServer } from '@shared/types'
import { api, isCancellation, toPayload } from '../api'
import { useStore, activeAccount, selectedInstance } from '../store/useStore'
import { ErrorView, Modal, ProgressBar, Spinner, useAutoScroll } from '../components/ui'
import { SkinBody } from '../components/SkinView'
import { DeviceCodePanel } from '../components/DeviceCodePanel'
import { CrashAutopsyPanel } from '../components/CrashAutopsyPanel'
import { MicrosoftMark } from './Onboarding'
import { formatBytes, formatDuration, formatEta, formatRam, formatRelative, formatSpeed, LOADER_COLORS, LOADER_LABELS } from '../format'

export function PlayScreen(): JSX.Element {
  const account = useStore(activeAccount)
  const instance = useStore(selectedInstance)
  const instances = useStore((s) => s.instances)
  const launches = useStore((s) => s.launches)
  const downloads = useStore((s) => s.downloads)
  const navigate = useStore((s) => s.navigate)
  const selectInstance = useStore((s) => s.selectInstance)
  const signingIn = useStore((s) => s.signingIn)
  const setSigningIn = useStore((s) => s.setSigningIn)
  const deviceCode = useStore((s) => s.deviceCode)
  const settings = useStore((s) => s.settings)

  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [servers, setServers] = useState<SavedServer[]>([])

  const state = instance ? launches[instance.id] : undefined
  const running = state?.stage === 'running'
  const preparing = state ? ['preparing', 'verifying', 'downloading', 'resolving-java', 'building-args', 'starting'].includes(state.stage) : false

  const download = useMemo(
    () => Object.values(downloads).find((d) => d.active || d.paused || d.phase === 'error') ?? null,
    [downloads]
  )

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.servers.list()
        setServers(result.servers.slice(0, 5))
      } catch {
        /* handled on the servers screen */
      }
    })()
  }, [])

  async function handlePlay(serverAddress?: string): Promise<void> {
    if (!instance) return
    setError(null)
    setBusy(true)
    try {
      await api.launch.start(instance.id, serverAddress)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSignIn(): Promise<void> {
    setError(null)
    setSigningIn(true)
    try {
      await api.auth.begin()
    } catch (err) {
      // A cancelled or superseded sign-in is not a failure worth alarming over.
      if (!isCancellation(err)) setError(toPayload(err))
    } finally {
      setSigningIn(false)
    }
  }

  /* ------------------------------------------------------- signed out */

  if (!account) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '80%' }}>
        <div style={{ width: '100%', maxWidth: 620 }}>
          <div className="panel panel-pad col gap-20" style={{ textAlign: 'center', padding: 40 }}>
            <h1>Sign in to play</h1>
            <p className="muted">
              Minecraft: Java Edition needs a Microsoft account that owns the game. You will sign in on Microsoft's own
              page — NexusCraft never sees your password.
            </p>

            {!settings?.clientId && (
              <p className="small" style={{ color: 'var(--warning)' }}>
                No Azure client ID is configured yet, so sign-in is disabled. Add one in Settings → Sign-in.
              </p>
            )}

            <button
              className="btn btn-primary"
              disabled={signingIn || !settings?.clientId}
              onClick={() => void handleSignIn()}
            >
              {signingIn ? <Spinner /> : <MicrosoftMark />}
              {signingIn ? 'Waiting for Microsoft…' : 'Sign in with Microsoft'}
            </button>
          </div>

          {/* Without this the sign-in polls invisibly and the app looks frozen. */}
          {deviceCode && (
            <div className="mt-16">
              <DeviceCodePanel prompt={deviceCode} />
            </div>
          )}

          {error && (
            <div className="mt-16">
              <ErrorView error={error} onDismiss={() => setError(null)} />
            </div>
          )}
        </div>
      </div>
    )
  }

  /* --------------------------------------------------------- no instance */

  if (!instance) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '80%' }}>
        <div className="panel panel-pad col gap-16" style={{ maxWidth: 470, textAlign: 'center', padding: 40 }}>
          <h1>No instance yet</h1>
          <p className="muted">
            An instance holds one Minecraft version with its own mods, worlds and settings. Create one to start playing.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('instances')}>
            Create an instance
          </button>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------- main */

  return (
    <>
      {/* hero */}
      <motion.div
        className="panel"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative',
          overflow: 'hidden',
          padding: '34px 36px',
          marginBottom: 18,
          background: `linear-gradient(125deg, ${instance.iconColor}1c 0%, rgba(12,17,26,0.72) 46%, rgba(8,11,18,0.86) 100%)`,
          borderColor: `${instance.iconColor}2e`
        }}
      >
        {/* soft key light behind the character */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: '7%',
            top: '-30%',
            width: 460,
            height: 460,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${instance.iconColor}26 0%, transparent 66%)`,
            pointerEvents: 'none'
          }}
        />

        <div className="row gap-24 items-start" style={{ position: 'relative' }}>
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="row gap-8 mb-8">
              <span className="pill accent">{instance.minecraftVersion}</span>
              <span className="pill" style={{ color: LOADER_COLORS[instance.loader] }}>
                {LOADER_LABELS[instance.loader]}
                {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}
              </span>
              {running && (
                <span className="pill success">
                  <span className="dot online" /> Running
                </span>
              )}
            </div>

            <h1 style={{ fontSize: 40, lineHeight: 1.05 }}>{instance.name}</h1>

            <div className="row gap-8 mt-8 muted small">
              <span>
                Playing as <strong style={{ color: 'var(--text)' }}>{account.username}</strong>
              </span>
              {account.gamertag && (
                <>
                  <span className="dim">·</span>
                  <span>{account.gamertag}</span>
                </>
              )}
              <span className="dim">·</span>
              <span>Last played {formatRelative(instance.lastPlayedAt)}</span>
            </div>

            {/* primary actions */}
            <div className="row gap-12 mt-24 wrap">
              {running ? (
                <button className="btn btn-danger" style={PLAY_BUTTON} onClick={() => void api.launch.stop(instance.id)}>
                  <Square size={18} /> Stop Minecraft
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  style={PLAY_BUTTON}
                  disabled={busy || preparing || !account.ownsMinecraft}
                  onClick={() => void handlePlay()}
                >
                  {busy || preparing ? <Spinner /> : <PlayIcon size={20} fill="currentColor" />}
                  {preparing ? state?.message ?? 'Preparing…' : busy ? 'Starting…' : 'PLAY'}
                </button>
              )}

              <button className="btn" onClick={() => setPickerOpen(true)}>
                Change instance <ChevronDown size={15} />
              </button>

              <button className="btn btn-ghost btn-icon" title="Open the game folder" onClick={() => void api.instances.openFolder(instance.id)}>
                <FolderOpen size={17} />
              </button>
              <button className="btn btn-ghost btn-icon" title="View the launch log" onClick={() => setLogsOpen(true)}>
                <Terminal size={17} />
              </button>
              <button
                className="btn btn-ghost btn-icon"
                title="Verify and repair this instance"
                disabled={busy || running}
                onClick={() => {
                  setBusy(true)
                  void api.instances
                    .repair(instance.id)
                    .catch((err) => setError(toPayload(err)))
                    .finally(() => setBusy(false))
                }}
              >
                <Wrench size={17} />
              </button>
            </div>

            {!account.ownsMinecraft && (
              <div className="row gap-8 mt-16 small" style={{ color: 'var(--warning)' }}>
                <AlertTriangle size={15} />
                This account does not have Minecraft: Java Edition, so the game cannot be launched.
              </div>
            )}
          </div>

          <SkinBody skinDataUrl={account.skinDataUrl} variant={account.skinVariant} height={240} dramatic />
        </div>
      </motion.div>

      {/* live download */}
      {download && <DownloadCard download={download} />}

      {/* launch error */}
      {error && (
        <div className="mb-16">
          <ErrorView error={error} onRetry={() => void handlePlay()} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* crash notice — driven by Minecraft's own report when it wrote one */}
      {state?.stage === 'exited' && state.exitCode !== 0 && state.exitCode !== null && (
        <div className="mb-16">
          <ErrorView
            error={{
              code: 'GAME_CRASHED',
              title: state.crash?.description
                ? `Minecraft crashed: ${state.crash.description}`
                : 'Minecraft closed unexpectedly',
              message:
                state.crash?.explanation ??
                (state.crash?.cause
                  ? `Minecraft reported: ${state.crash.cause}`
                  : `The game exited with code ${state.exitCode}. Mods are the most common cause, followed by not enough memory.`),
              actions:
                state.crash?.actions.length
                  ? state.crash.actions
                  : [
                      'Open the log to read the final lines',
                      'Disable recently added mods on the Mods screen',
                      'Try increasing the memory for this instance'
                    ],
              detail: state.crash?.excerpt ?? state.crashReport
            }}
            onRetry={() => void handlePlay()}
            onDismiss={() =>
              useStore.setState((prev) => ({
                launches: {
                  ...prev.launches,
                  [instance.id]: { ...state, stage: 'preparing', exitCode: null, crash: null }
                }
              }))
            }
          />
          <CrashAutopsyPanel instance={instance} />
          {state.crash?.reportPath && (
            <button
              className="btn btn-ghost btn-sm mt-8"
              onClick={() => void api.instances.openFolder(instance.id, 'crash-reports')}
            >
              <FolderOpen size={14} /> Open the crash report folder
            </button>
          )}
        </div>
      )}

      {/* stats */}
      <div className="card-grid mb-24">
        <InfoTile icon={<Layers size={16} />} label="Version" value={instance.minecraftVersion} hint={instance.resolvedVersionId && instance.resolvedVersionId !== instance.minecraftVersion ? instance.resolvedVersionId : undefined} />
        <InfoTile icon={<Cpu size={16} />} label="Memory" value={formatRam(instance.java.maxRamMb)} hint={`min ${formatRam(instance.java.minRamMb)}`} />
        <InfoTile icon={<Gauge size={16} />} label="Mod loader" value={LOADER_LABELS[instance.loader]} hint={instance.loaderVersion ?? undefined} />
        <InfoTile icon={<PlayIcon size={16} />} label="Playtime" value={formatDuration(instance.totalPlaytimeMs)} />
      </div>

      {/* recent servers */}
      {servers.length > 0 && (
        <section>
          <div className="row between mb-16">
            <div className="section-title" style={{ margin: 0 }}>
              Quick join
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('servers')}>
              All servers
            </button>
          </div>
          <div className="card-grid">
            {servers.map((server) => (
              <QuickJoinCard
                key={server.id}
                server={server}
                disabled={running || busy || preparing}
                onJoin={() => void handlePlay(`${server.address}:${server.port}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* instance picker */}
      <Modal open={pickerOpen} title="Choose an instance" onClose={() => setPickerOpen(false)} width={520}>
        <div className="col gap-8">
          {instances.map((entry) => (
            <button
              key={entry.id}
              className="panel panel-hover row gap-12"
              style={{
                padding: 12,
                textAlign: 'left',
                borderColor: entry.id === instance.id ? 'var(--accent)' : undefined
              }}
              onClick={() => {
                void selectInstance(entry.id)
                setPickerOpen(false)
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: `${entry.iconColor}22`,
                  border: `1px solid ${entry.iconColor}44`,
                  flexShrink: 0
                }}
              />
              <div className="flex-1">
                <div style={{ fontWeight: 600 }}>{entry.name}</div>
                <div className="tiny dim">
                  {entry.minecraftVersion} · {LOADER_LABELS[entry.loader]}
                </div>
              </div>
              {launches[entry.id]?.stage === 'running' && <span className="dot online" />}
            </button>
          ))}
        </div>
      </Modal>

      <LogModal open={logsOpen} instanceId={instance.id} onClose={() => setLogsOpen(false)} />
    </>
  )
}

const PLAY_BUTTON = {
  padding: '15px 44px',
  fontSize: 17,
  fontWeight: 750,
  letterSpacing: '0.06em',
  borderRadius: 13
} as const

function InfoTile({
  icon,
  label,
  value,
  hint
}: {
  icon: JSX.Element
  label: string
  value: string
  hint?: string
}): JSX.Element {
  return (
    <div className="panel panel-pad">
      <div className="row gap-8 dim tiny">
        {icon}
        {label}
      </div>
      <div className="truncate" style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, marginTop: 5 }}>
        {value}
      </div>
      {hint && <div className="tiny dim truncate">{hint}</div>}
    </div>
  )
}

/* ------------------------------------------------------------- downloads */

function DownloadCard({ download }: { download: import('@shared/types').DownloadProgress }): JSX.Element {
  const ratio = download.totalBytes > 0 ? download.downloadedBytes / download.totalBytes : 0
  const failed = download.errors.length > 0

  return (
    <div className="panel panel-pad mb-16">
      <div className="row between mb-8">
        <div className="row gap-10">
          {download.paused ? <Pause size={16} className="dim" /> : <Spinner />}
          <span style={{ fontWeight: 600 }}>{download.label || 'Downloading'}</span>
          {failed && (
            <span className="pill danger">
              {download.errors.length} failed
            </span>
          )}
        </div>
        <div className="row gap-8">
          {download.paused ? (
            <button className="btn btn-sm" onClick={() => void api.downloads.resume(download.taskId)}>
              <PlayIcon size={13} /> Resume
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => void api.downloads.pause(download.taskId)}>
              <Pause size={13} /> Pause
            </button>
          )}
          {failed && (
            <button className="btn btn-sm" onClick={() => void api.downloads.retry(download.taskId)}>
              <RefreshCw size={13} /> Retry failed
            </button>
          )}
          <button className="btn btn-ghost btn-icon" title="Cancel" onClick={() => void api.downloads.cancel(download.taskId)}>
            <X size={15} />
          </button>
        </div>
      </div>

      <ProgressBar value={ratio} indeterminate={download.totalBytes === 0 && !download.paused} />

      <div className="row between tiny dim mt-8">
        <span className="truncate" style={{ maxWidth: '46%' }}>
          {download.currentFile || '—'}
        </span>
        <span>
          {download.completedFiles}/{download.totalFiles} files · {formatBytes(download.downloadedBytes)} of{' '}
          {formatBytes(download.totalBytes)} · {formatSpeed(download.speedBps)} · {formatEta(download.etaSeconds)} left
        </span>
      </div>

      {failed && (
        <div className="col gap-4 mt-8">
          {download.errors.slice(0, 3).map((err, index) => (
            <div key={index} className="tiny" style={{ color: 'var(--danger)' }}>
              {err.file}: {err.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ quick join */

function QuickJoinCard({
  server,
  disabled,
  onJoin
}: {
  server: SavedServer
  disabled: boolean
  onJoin: () => void
}): JSX.Element {
  const status = useStore((s) => s.serverStatuses[server.id])

  useEffect(() => {
    // Only ping if we have no reading yet; the servers screen owns refreshes.
    if (!status) void api.servers.ping(server.id).catch(() => undefined)
  }, [server.id, status])

  return (
    <div className="panel panel-pad panel-hover">
      <div className="row gap-10 mb-8">
        {status?.faviconDataUrl ? (
          <img src={status.faviconDataUrl} width={34} height={34} alt="" style={{ borderRadius: 8, imageRendering: 'pixelated' }} />
        ) : (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: 'var(--panel-strong)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--text-dim)'
            }}
          >
            <Server size={15} />
          </div>
        )}
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="truncate" style={{ fontWeight: 600 }}>
            {server.name}
          </div>
          <div className="tiny dim truncate">
            {server.address}
            {server.port !== 25565 ? `:${server.port}` : ''}
          </div>
        </div>
      </div>

      <div className="row between">
        <span className="tiny dim row gap-8">
          <span
            className={`dot ${status?.online === true ? 'online' : status?.online === false ? 'offline' : 'unknown'}`}
          />
          {status === undefined
            ? 'Checking…'
            : status.online === true
              ? `${status.playersOnline ?? '?'}/${status.playersMax ?? '?'} · ${status.latencyMs ?? '?'} ms`
              : status.online === false
                ? 'Offline'
                : 'Checking…'}
        </span>
        <button className="btn btn-sm" disabled={disabled} onClick={onJoin}>
          <Power size={13} /> Join
        </button>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- logs */

function LogModal({
  open,
  instanceId,
  onClose
}: {
  open: boolean
  instanceId: string
  onClose: () => void
}): JSX.Element {
  // Select the array itself and filter in a memo. Filtering inside the selector
  // returns a new array on every read, and zustand reads through
  // useSyncExternalStore — an unstable snapshot makes React re-render forever
  // ("Maximum update depth exceeded") the moment the store starts changing.
  const allLogs = useStore((s) => s.logs)
  const logs = useMemo(() => allLogs.filter((line) => line.instanceId === instanceId), [allLogs, instanceId])
  const [initial, setInitial] = useState<GameLogLine[]>([])
  const scrollRef = useAutoScroll(logs.length)

  useEffect(() => {
    if (!open) return
    void api.launch.logs(instanceId, 800).then(setInitial).catch(() => setInitial([]))
  }, [open, instanceId])

  // Live lines replace the fetched history once they start arriving.
  const lines = logs.length > 0 ? logs : initial

  return (
    <Modal open={open} title="Launch log" subtitle="Access tokens are stripped from every line." onClose={onClose} width={860}>
      <div
        ref={scrollRef}
        className="mono selectable"
        style={{
          background: 'rgba(0,0,0,0.44)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 12,
          height: 420,
          overflowY: 'auto',
          fontSize: 11.5,
          lineHeight: 1.62
        }}
      >
        {lines.length === 0 ? (
          <div className="dim">No output yet. Launch the instance to see its log here.</div>
        ) : (
          lines.map((line, index) => (
            <div
              key={index}
              style={{
                color:
                  line.stream === 'stderr'
                    ? 'var(--danger)'
                    : line.stream === 'launcher'
                      ? 'var(--accent)'
                      : 'var(--text-muted)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {line.line}
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
