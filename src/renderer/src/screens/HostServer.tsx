import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Copy,
  FolderOpen,
  HardDrive,
  Play,
  Plus,
  Send,
  Server,
  Square,
  Trash2,
  Users
} from 'lucide-react'
import type {
  Instance,
  ModInfo,
  HostedServer,
  HostedServerConsoleLine,
  HostedServerState,
  LauncherErrorPayload,
  SaveHostedServerInput,
  ServerSoftwareInfo,
  VersionSummary
} from '@shared/types'
import { api, subscribe, toPayload } from '../api'
import { activeAccount, useStore } from '../store/useStore'
import { EmptyState, ErrorView, Field, Modal, Spinner, Toggle, useAutoScroll } from '../components/ui'

const STATUS_STYLE: Record<HostedServerState['status'], { label: string; className: string }> = {
  stopped: { label: 'Stopped', className: 'pill' },
  installing: { label: 'Installing', className: 'pill warning' },
  starting: { label: 'Starting', className: 'pill warning' },
  running: { label: 'Running', className: 'pill success' },
  stopping: { label: 'Stopping', className: 'pill warning' },
  error: { label: 'Error', className: 'pill danger' }
}

function blankInput(version: string, owner?: string | null): SaveHostedServerInput {
  return {
    id: null,
    name: 'My World',
    // Seeded with the signed-in account so a fresh server has an operator —
    // without one nobody can run a single command on their own world.
    operators: owner ? [owner] : [],
    minecraftVersion: version,
    software: 'paper',
    port: 25565,
    // Verifying players is the right default; the companion case is opt-in.
    onlineMode: true,
    reachability: 'anyone' as const,
    memoryMb: 2048,
    motd: 'A NexusCraft server',
    difficulty: 'normal',
    gameMode: 'survival',
    maxPlayers: 8,
    allowCheats: false
  }
}

/**
 * Runs a Minecraft server from inside the launcher, so a persistent world — one
 * the AI companion can join — needs no separate download, no config file, and no
 * console window left open.
 */
export function HostServerScreen(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useStore((s) => s.navigate)
  const account = useStore(activeAccount)

  const [servers, setServers] = useState<HostedServer[]>([])
  const [states, setStates] = useState<Record<string, HostedServerState>>({})
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [software, setSoftware] = useState<ServerSoftwareInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lines, setLines] = useState<HostedServerConsoleLine[]>([])
  const [command, setCommand] = useState('')
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SaveHostedServerInput | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<HostedServer | null>(null)
  const [eulaUrl, setEulaUrl] = useState('https://aka.ms/MinecraftEULA')
  const [mods, setMods] = useState<ModInfo[]>([])
  const [joinTargets, setJoinTargets] = useState<Instance[]>([])

  const consoleRef = useAutoScroll(lines.length)

  const load = useCallback(async () => {
    try {
      const [list, stateList, manifest, url, softwareList] = await Promise.all([
        api.host.list(),
        api.host.states(),
        api.versions.manifest(),
        api.host.eulaUrl(),
        api.host.software()
      ])
      setServers(list)
      setStates(Object.fromEntries(stateList.map((s) => [s.id, s])))
      setVersions(manifest.versions.filter((v) => v.type === 'release'))
      setEulaUrl(url)
      setSoftware(softwareList)
      setSelectedId((current) => current ?? list[0]?.id ?? null)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const offChanged = subscribe('host:changed', (list: HostedServer[]) => {
      setServers(list)
      setSelectedId((current) => (current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null)))
    })
    const offState = subscribe('host:state', (state: HostedServerState) => {
      setStates((current) => ({ ...current, [state.id]: state }))
    })
    const offConsole = subscribe('host:console', (line: HostedServerConsoleLine) => {
      setLines((current) => [...current, line].slice(-500))
    })
    return () => {
      offChanged()
      offState()
      offConsole()
    }
  }, [])

  // Mods and joinable instances belong to the selected server.
  const refreshMods = useCallback(async (id: string) => {
    try {
      const [list, targets] = await Promise.all([api.host.mods(id), api.host.joinTargets(id)])
      setMods(list)
      setJoinTargets(targets)
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setMods([])
      setJoinTargets([])
      return
    }
    void refreshMods(selectedId)
  }, [selectedId, refreshMods])

  // The console is per-server, so switching selection reloads it.
  useEffect(() => {
    if (!selectedId) {
      setLines([])
      return
    }
    void api.host
      .console(selectedId)
      .then(setLines)
      .catch(() => setLines([]))
  }, [selectedId])

  const selected = useMemo(() => servers.find((s) => s.id === selectedId) ?? null, [servers, selectedId])
  const state = selected ? (states[selected.id] ?? { status: 'stopped' as const, detail: '', players: [], id: selected.id, pid: null, startedAt: null }) : null
  const live = state?.status === 'running' || state?.status === 'starting' || state?.status === 'stopping'

  const softwareInfo = software.find((entry) => entry.id === editing?.software) ?? null

  const visibleLines = useMemo(
    () => (selectedId ? lines.filter((l) => l.serverId === selectedId) : []),
    [lines, selectedId]
  )

  async function run(action: () => Promise<unknown>, successMessage?: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (successMessage) pushToast({ kind: 'success', title: successMessage })
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!editing) return
    await run(async () => {
      const saved = await api.host.save(editing)
      setSelectedId(saved.id)
      setEditing(null)
    })
  }

  function sendCommand(): void {
    const text = command.trim()
    if (!text || !selected) return
    setCommand('')
    void run(() => api.host.command(selected.id, text))
  }

  /** Launches a compatible instance straight into this server. */
  async function join(): Promise<void> {
    if (!selected) return
    if (joinTargets.length === 0) {
      setError({
        code: 'NOT_FOUND',
        title: 'No instance can join this server',
        message: `You need an instance running ${softwareInfo?.label ?? selected.software} on Minecraft ${selected.minecraftVersion}. A vanilla client cannot join a modded server, and the versions have to match.`,
        actions: ['Create a matching instance from the Instances screen'],
        detail: null
      })
      return
    }
    await run(() => api.host.join(selected.id, joinTargets[0].id), `Launching ${joinTargets[0].name}`)
  }

  /**
   * Points every companion at this server so they need not be wired by hand.
   * They all join the same world, so there is nothing to choose between them.
   */
  async function useForCompanion(): Promise<void> {
    if (!selected) return
    await run(async () => {
      const list = await api.companion.list()
      for (const companion of list) {
        await api.companion.updateSettings(companion.id, {
          host: '127.0.0.1',
          port: selected.port,
          auth: selected.onlineMode ? 'microsoft' : 'offline'
        })
      }
    }, 'Companions now point at this server')
    navigate('companion')
  }

  if (loading) {
    return (
      <div className="panel panel-pad row gap-12 muted">
        <Spinner /> Loading your servers…
      </div>
    )
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Library</div>
          <h1>Host a Server</h1>
          <p className="subtitle" style={{ maxWidth: '54ch' }}>
            Run a real Minecraft server from the launcher. It stays on the same port every time, keeps your world
            between sessions, and gives the AI companion somewhere permanent to join.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setEditing(blankInput(versions[0]?.id ?? '1.21.11', account?.username))}
          disabled={busy}
        >
          <Plus size={15} /> New server
        </button>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {servers.length === 0 ? (
        <EmptyState
          icon={<Server size={30} />}
          title="No servers yet"
          message="Create one and the launcher downloads the official server from Mojang, sets it up, and runs it for you."
          action={
            <button className="btn btn-primary" onClick={() => setEditing(blankInput(versions[0]?.id ?? '1.21.11', account?.username))}>
              <Plus size={15} /> Create a server
            </button>
          }
        />
      ) : (
        <div className="split-2">
          {/* ------------------------------------------------------ list */}
          <div className="col gap-8">
            <div className="host-aside-label">
              {servers.length} {servers.length === 1 ? 'server' : 'servers'}
            </div>
            {servers.map((server) => {
              const s = states[server.id]
              const style = STATUS_STYLE[s?.status ?? 'stopped']
              return (
                <button
                  key={server.id}
                  className={`panel panel-hover panel-pad col gap-6 ${server.id === selectedId ? 'selected' : ''}`}
                  style={{ textAlign: 'left', width: '100%' }}
                  onClick={() => setSelectedId(server.id)}
                >
                  <div className="row gap-8 between">
                    <strong className="truncate">{server.name}</strong>
                    <span className={style.className}>
                      {s?.status === 'running' && <span className="dot online" />}
                      {style.label}
                    </span>
                  </div>
                  <div className="row gap-10 tiny dim">
                    <span>{software.find((e) => e.id === server.software)?.label ?? server.software}</span>
                    <span>Minecraft {server.minecraftVersion}</span>
                    <span>port {server.port}</span>
                    {!server.onlineMode && <span className="pill warning tiny">offline mode</span>}
                  </div>
                  {s?.players.length ? (
                    <div className="row gap-6 tiny">
                      <Users size={12} /> {s.players.join(', ')}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>

          {/* --------------------------------------------------- detail */}
          {selected && state && (
            <div className="col gap-14">
              {/* EULA gate — the server cannot legally or technically run without it. */}
              {!selected.eulaAcceptedAt && (
                <div className="panel panel-pad col gap-10" style={{ borderColor: 'var(--warning)' }}>
                  <div className="row gap-8">
                    <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
                    <strong>Accept the Minecraft EULA to run this server</strong>
                  </div>
                  <p className="small dim" style={{ margin: 0 }}>
                    Mojang requires anyone running a Minecraft server to agree to their End User Licence Agreement.
                    The launcher will not tick this for you — read it and decide.
                  </p>
                  <div className="row gap-10">
                    <button className="btn btn-ghost" onClick={() => void api.app.openExternal(eulaUrl)}>
                      <ExternalLink size={14} /> Read the EULA
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void run(() => api.host.acceptEula(selected.id), 'EULA accepted')}
                    >
                      <CheckCircle2 size={15} /> I agree to the EULA
                    </button>
                  </div>
                </div>
              )}

              <div className="panel panel-pad col gap-12">
                <div className="row gap-8 between">
                  <div className="col gap-6" style={{ minWidth: 0 }}>
                    <div className="row gap-8" style={{ alignItems: 'center' }}>
                      <strong style={{ fontSize: 16 }}>{selected.name}</strong>
                      <span className={STATUS_STYLE[state.status].className}>
                        {state.status === 'running' && <span className="dot online" />}
                        {STATUS_STYLE[state.status].label}
                      </span>
                    </div>

                    {/*
                     * What the server is and where to reach it, on one line.
                     * The address is set apart because it is the thing anyone
                     * actually needs from this screen.
                     */}
                    <div className="row gap-8 wrap tiny dim" style={{ alignItems: 'center' }}>
                      <span>
                        {software.find((e) => e.id === selected.software)?.label ?? selected.software}
                        {selected.softwareVersion ? ` ${selected.softwareVersion}` : ''}
                      </span>
                      <span>Minecraft {selected.minecraftVersion}</span>
                      <span className="host-address">
                        {selected.reachability === 'local' ? '127.0.0.1' : 'this machine'}:{selected.port}
                      </span>
                    </div>

                    {state.detail && <span className="tiny dim truncate">{state.detail}</span>}
                  </div>
                  <div className="row gap-8">
                    {state.status === 'running' && (
                      <button className="btn btn-primary" disabled={busy} onClick={() => void join()}>
                        <Play size={15} /> Join
                      </button>
                    )}
                    {live ? (
                      <button
                        className="btn btn-danger"
                        disabled={busy || state.status === 'stopping'}
                        onClick={() => void run(() => api.host.stop(selected.id))}
                      >
                        {state.status === 'stopping' ? <Spinner /> : <Square size={15} />} Stop
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        disabled={busy || !selected.eulaAcceptedAt}
                        onClick={() => void run(() => api.host.start(selected.id))}
                      >
                        {busy ? <Spinner /> : <Play size={15} />} Start
                      </button>
                    )}
                  </div>
                </div>

                <div className="row gap-8 wrap">
                  <button className="btn btn-ghost btn-sm" onClick={() => void useForCompanion()} disabled={busy}>
                    <Bot size={14} /> Use for the AI companion
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy || live}
                    onClick={() =>
                      setEditing({
                        id: selected.id,
                        name: selected.name,
                        minecraftVersion: selected.minecraftVersion,
                        software: selected.software,
                        port: selected.port,
                        onlineMode: selected.onlineMode,
                        reachability: selected.reachability ?? 'anyone',
                        memoryMb: selected.memoryMb,
                        motd: selected.motd,
                        difficulty: selected.difficulty,
                        gameMode: selected.gameMode,
                        maxPlayers: selected.maxPlayers,
                        allowCheats: selected.allowCheats,
                        operators: selected.operators ?? []
                      })
                    }
                  >
                    <HardDrive size={14} /> Settings
                  </button>
                  <button
                    className="btn btn-ghost btn-sm danger"
                    disabled={busy || live}
                    onClick={() => setConfirmDelete(selected)}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>

                {!selected.onlineMode && (
                  <p className="tiny dim" style={{ margin: 0 }}>
                    This server does not verify who joins, which is what lets the companion connect without a second
                    Minecraft account.{' '}
                    {selected.reachability === 'local'
                      ? 'Only programs on this PC can reach it.'
                      : selected.reachability === 'network'
                        ? 'Anyone on your local network can join as any username.'
                        : 'Anyone who can reach the port can join as any username.'}
                  </p>
                )}
              </div>

              {/* ----------------------------------------------------- mods */}
              <div className="panel col">
                <div className="panel-head row gap-8 between">
                  <span className="small">
                    {softwareInfo?.plugins ? 'Plugins' : 'Mods'}
                    {mods.length > 0 && <span className="dim"> · {mods.length}</span>}
                  </span>
                  <div className="row gap-8">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.host.importMods(selected.id)
                          await refreshMods(selected.id)
                        })
                      }
                    >
                      <Plus size={14} /> Add files
                    </button>
                    {joinTargets.length > 0 && softwareInfo?.mods && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy || mods.length === 0}
                        title={`Copy these mods into ${joinTargets[0].name} so you can join`}
                        onClick={() => void run(() => api.host.syncMods(selected.id, joinTargets[0].id))}
                      >
                        <Copy size={14} /> Copy to {joinTargets[0].name}
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => void api.host.openFolder(selected.id)}>
                      <FolderOpen size={14} /> Open folder
                    </button>
                  </div>
                </div>

                <div className="col" style={{ padding: '4px 0', maxHeight: 220, overflowY: 'auto' }}>
                  {softwareInfo && !softwareInfo.mods && !softwareInfo.plugins ? (
                    <p className="tiny dim" style={{ padding: '10px 12px', margin: 0 }}>
                      Vanilla servers take neither mods nor plugins. Switch this server to Paper for plugins, or
                      Fabric, Forge or NeoForge for mods.
                    </p>
                  ) : mods.length === 0 ? (
                    <p className="tiny dim" style={{ padding: '10px 12px', margin: 0 }}>
                      Nothing here yet. Add jar files, or drop them in with Open folder. The server has to be
                      restarted before it picks anything up.
                    </p>
                  ) : (
                    mods.map((mod) => (
                      <div key={mod.fileName} className="host-mod-row row gap-10 between">
                        <div className="col gap-2" style={{ minWidth: 0 }}>
                          <span className="small truncate">{mod.name || mod.fileName}</span>
                          <span className="tiny dim truncate">
                            {mod.version ? `${mod.version} · ` : ''}
                            {mod.fileName}
                          </span>
                          {mod.issues.slice(0, 1).map((issue) => (
                            <span
                              key={issue.code}
                              className="tiny"
                              style={{ color: issue.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}
                            >
                              {issue.message}
                            </span>
                          ))}
                        </div>
                        <div className="row gap-8">
                          <Toggle
                            checked={mod.enabled}
                            onChange={(value) =>
                              void run(async () => {
                                await api.host.toggleMod(selected.id, mod.fileName, value)
                                await refreshMods(selected.id)
                              })
                            }
                          />
                          <button
                            className="btn btn-ghost btn-icon"
                            onClick={() =>
                              void run(async () => {
                                await api.host.deleteMod(selected.id, mod.fileName)
                                await refreshMods(selected.id)
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* -------------------------------------------------- console */}
              <div className="panel col" style={{ minHeight: 240 }}>
                <div className="panel-head row gap-8 between">
                  <span className="small">Console</span>
                  {state.players.length > 0 && (
                    <span className="tiny dim row gap-6">
                      <Users size={12} /> {state.players.length} online
                    </span>
                  )}
                </div>
                <div ref={consoleRef} className="log-feed flex-1" style={{ padding: '8px 12px' }}>
                  {visibleLines.length === 0 ? (
                    <div className="tiny dim">Nothing yet. Start the server to see its output here.</div>
                  ) : (
                    visibleLines.map((line) => (
                      <div
                        key={line.id}
                        className="tiny mono"
                        style={{
                          color:
                            line.stream === 'err'
                              ? 'var(--danger)'
                              : line.stream === 'in'
                                ? 'var(--accent)'
                                : 'var(--text-dim)',
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {line.text}
                      </div>
                    ))
                  )}
                </div>
                <div className="panel-foot row gap-8">
                  <input
                    className="input flex-1"
                    placeholder={live ? 'Send a command, e.g. time set day' : 'Start the server to send commands'}
                    value={command}
                    disabled={!live}
                    onChange={(event) => setCommand(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') sendCommand()
                    }}
                  />
                  <button className="btn btn-ghost btn-icon" disabled={!live || !command.trim()} onClick={sendCommand}>
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------- settings */}
      <Modal
        open={Boolean(editing)}
        title={editing?.id ? 'Server settings' : 'New server'}
        subtitle={editing?.id ? undefined : 'The launcher downloads the official server from Mojang.'}
        onClose={() => setEditing(null)}
        width={520}
        footer={
          <div className="row gap-10 end">
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? <Spinner /> : null} {editing?.id ? 'Save' : 'Create'}
            </button>
          </div>
        }
      >
        {editing && (
          <div className="form-fields">
            <Field label="Name" hint="Only used to tell your servers apart in the launcher.">
              <input
                className="input"
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </Field>

            <Field label="Server software" hint={softwareInfo?.blurb}>
              <select
                className="input"
                value={editing.software}
                onChange={(event) =>
                  setEditing({ ...editing, software: event.target.value as SaveHostedServerInput['software'] })
                }
              >
                {software.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                    {entry.plugins ? ' — plugins' : entry.mods ? ' — mods' : ''}
                  </option>
                ))}
              </select>
            </Field>

            <div className="field-grid">
              <Field label="Minecraft version" hint="The AI companion supports 1.21.x and 26.1.">
                <select
                  className="input"
                  value={editing.minecraftVersion}
                  onChange={(event) => setEditing({ ...editing, minecraftVersion: event.target.value })}
                >
                  {versions.slice(0, 80).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Port" hint="25565 is the default.">
                <input
                  className="input"
                  type="number"
                  value={editing.port}
                  onChange={(event) => setEditing({ ...editing, port: Number(event.target.value) })}
                />
              </Field>
            </div>

            <Field
              label="Verify players own Minecraft"
              hint={
                editing.onlineMode
                  ? 'On: Mojang checks every player. The companion then needs its own Microsoft account that owns the game.'
                  : 'Off: the server trusts whatever name a client gives, so the companion can join without a second account. Use "Who can connect" below to decide who can reach it.'
              }
              inline
            >
              <Toggle
                checked={editing.onlineMode}
                onChange={(value) => setEditing({ ...editing, onlineMode: value })}
              />
            </Field>

            <Field
              label="Who can connect"
              hint={
                editing.reachability === 'local'
                  ? 'Only programs on this PC. Safe to pair with verification turned off.'
                  : editing.reachability === 'network'
                    ? 'Anyone on your home network. Not reachable from the internet.'
                    : 'Every network interface. What you want if you forward a port for friends.'
              }
            >
              <select
                className="input"
                value={editing.reachability}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    reachability: event.target.value as SaveHostedServerInput['reachability']
                  })
                }
              >
                <option value="local">This PC only</option>
                <option value="network">My local network</option>
                <option value="anyone">Anyone who can reach the port</option>
              </select>
            </Field>

            {!editing.onlineMode && editing.reachability !== 'local' && (
              <div
                className="panel panel-pad row gap-10"
                style={{ borderColor: 'var(--warning)', alignItems: 'flex-start' }}
              >
                <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
                <div className="col gap-4">
                  <strong className="small">This server will not check who joins</strong>
                  <span className="tiny dim">
                    With verification off, anyone who can reach {editing.port} may join using any username — including
                    an operator&apos;s, which would hand them full command access. Fine on a network you trust; choose
                    &quot;This PC only&quot; if you are not sure.
                  </span>
                </div>
              </div>
            )}

            <Field label="Message of the day" hint="Shown in your multiplayer server list.">
              <input
                className="input"
                value={editing.motd}
                maxLength={59}
                onChange={(event) => setEditing({ ...editing, motd: event.target.value })}
              />
            </Field>

            <div className="field-grid">
              <Field label="Memory" hint="2 GB suits a small world.">
                <select
                  className="input"
                  value={editing.memoryMb}
                  onChange={(event) => setEditing({ ...editing, memoryMb: Number(event.target.value) })}
                >
                  <option value={1024}>1 GB</option>
                  <option value={2048}>2 GB</option>
                  <option value={4096}>4 GB</option>
                  <option value={6144}>6 GB</option>
                  <option value={8192}>8 GB</option>
                </select>
              </Field>

              <Field label="Max players">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={editing.maxPlayers}
                  onChange={(event) => setEditing({ ...editing, maxPlayers: Number(event.target.value) })}
                />
              </Field>
            </div>

            <div className="field-grid">
              <Field label="Difficulty">
                <select
                  className="input"
                  value={editing.difficulty}
                  onChange={(event) =>
                    setEditing({ ...editing, difficulty: event.target.value as SaveHostedServerInput['difficulty'] })
                  }
                >
                  <option value="peaceful">Peaceful</option>
                  <option value="easy">Easy</option>
                  <option value="normal">Normal</option>
                  <option value="hard">Hard</option>
                </select>
              </Field>

              <Field label="Game mode">
                <select
                  className="input"
                  value={editing.gameMode}
                  onChange={(event) =>
                    setEditing({ ...editing, gameMode: event.target.value as SaveHostedServerInput['gameMode'] })
                  }
                >
                  <option value="survival">Survival</option>
                  <option value="creative">Creative</option>
                  <option value="adventure">Adventure</option>
                </select>
              </Field>
            </div>

            <Field
              label="Operators"
              hint="Player names that get full command access — /gamemode, /time, /tp and the rest. Separate several with commas. Without an operator, nobody can run any command on this server."
            >
              <input
                className="input"
                value={editing.operators.join(', ')}
                placeholder="YourUsername"
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    operators: event.target.value
                      .split(',')
                      .map((name) => name.trim())
                      .filter(Boolean)
                  })
                }
              />
            </Field>

            <Field
              label="Enable command blocks"
              hint="Lets command blocks run. Player-run commands come from being an operator above, not from this."
              inline
            >
              <Toggle
                checked={editing.allowCheats}
                onChange={(value) => setEditing({ ...editing, allowCheats: value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        title={`Delete "${confirmDelete?.name ?? ''}"?`}
        subtitle="Choose whether the world files go with it."
        onClose={() => setConfirmDelete(null)}
        width={470}
        footer={
          <div className="row gap-10 end">
            <button className="btn" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (target) void run(() => api.host.remove(target.id, false))
              }}
            >
              Keep the world files
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (target) void run(() => api.host.remove(target.id, true))
              }}
            >
              Delete everything
            </button>
          </div>
        }
      >
        <p className="muted">
          Removing the server from the launcher is always safe. Deleting the world files cannot be undone — the world,
          player data, and server settings all go.
        </p>
      </Modal>

    </>
  )
}
