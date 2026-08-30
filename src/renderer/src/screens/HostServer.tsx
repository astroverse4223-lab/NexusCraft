import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Copy,
  Boxes,
  FolderOpen,
  HardDrive,
  Link2,
  Play,
  Plus,
  Send,
  Globe,
  Search,
  Server,
  Share2,
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
  ServerShareDetails,
  ServerSoftwareInfo,
  VersionSummary
} from '@shared/types'
import type { Companion } from '@shared/companion'
import { api, subscribe, toPayload } from '../api'
import { BrowseTab } from './Browse'
import { ServerBackups } from '../components/ServerBackups'
import { RelayTunnel } from '../components/RelayTunnel'
import { activeAccount, useStore } from '../store/useStore'
import {
  ConfirmDialog,
  EmptyState,
  ErrorView,
  Field,
  Modal,
  Spinner,
  Toggle,
  useAutoScroll
} from '../components/ui'

/** Splits `host:port`, tolerating a bare host. */
function splitAddress(address: string): [string, number] {
  const at = address.lastIndexOf(':')
  if (at === -1) return [address, 25565]
  const port = Number(address.slice(at + 1))
  return [address.slice(0, at), Number.isFinite(port) && port > 0 ? port : 25565]
}

/** The human name for a server's software, for headings. */
function softwareLabelFor(software: string): string {
  const names: Record<string, string> = {
    vanilla: 'Vanilla',
    paper: 'Paper',
    purpur: 'Purpur',
    fabric: 'Fabric',
    forge: 'Forge',
    neoforge: 'NeoForge'
  }
  return names[software] ?? software
}

/**
 * What each server software loads, in the terms the content sites use.
 *
 * Paper and Purpur take Bukkit-style plugins rather than mods, so they need
 * their own names here — searching as "forge" offered a Paper owner mods that
 * their server would never load.
 */
const SERVER_LOADERS: Record<string, string> = {
  vanilla: 'vanilla',
  paper: 'paper',
  purpur: 'purpur',
  fabric: 'fabric',
  forge: 'forge',
  neoforge: 'neoforge'
}

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
    allowCheats: false,

    // The same defaults a fresh Minecraft server would use.
    levelSeed: '',
    pvp: true,
    hardcore: false,
    allowFlight: false,
    spawnProtection: 16,
    viewDistance: 10,
    simulationDistance: 10,
    spawnMonsters: true,
    spawnAnimals: true,
    whitelist: false
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
  /** Open when building a whole new server from a modpack. */
  const [packBrowsing, setPackBrowsing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<HostedServer | null>(null)
  const [forwarding, setForwarding] = useState<{
    available: boolean
    open: boolean
    externalAddress: string | null
    router: string | null
    reason: string | null
  } | null>(null)
  const [checkingRouter, setCheckingRouter] = useState(false)
  const [share, setShare] = useState<ServerShareDetails | null>(null)
  const [gathering, setGathering] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [confirmExpose, setConfirmExpose] = useState(false)
  const [eulaUrl, setEulaUrl] = useState('https://aka.ms/MinecraftEULA')
  const [mods, setMods] = useState<ModInfo[]>([])
  const [joinTargets, setJoinTargets] = useState<Instance[]>([])
  /** Companions living on the selected server. */
  const [stewards, setStewards] = useState<Companion[]>([])
  const [deploying, setDeploying] = useState(false)
  const [inviting, setInviting] = useState(false)

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
      const [list, targets, residents] = await Promise.all([
        api.host.mods(id),
        api.host.joinTargets(id),
        api.host.stewards(id)
      ])
      setMods(list)
      setJoinTargets(targets)
      setStewards(residents)
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setMods([])
      setJoinTargets([])
      setStewards([])
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
    /*
     * No matching instance is no longer a dead end — the main process makes one
     * and copies the server's mods into it, which is the only reliable way to
     * have the two agree on what is installed.
     */
    const target = joinTargets[0]
    await run(
      () => api.host.join(selected.id, target?.id),
      target ? `Launching ${target.name}` : 'Setting up a client for this server'
    )
  }

  /**
   * Points every companion at this server so they need not be wired by hand.
   * They all join the same world, so there is nothing to choose between them.
   */
  /**
   * Collects everything a server listing asks for, and tests the address.
   *
   * Takes a moment: it looks for the router, asks it for the external address,
   * then pings that address to see whether anything answers.
   */
  async function gatherShareDetails(): Promise<void> {
    if (!selected) return
    setGathering(true)
    try {
      setShare(await api.host.share(selected.id))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setGathering(false)
    }
  }

  /** Asks the router what it will do, without changing anything. */
  async function checkRouter(): Promise<void> {
    if (!selected) return
    setCheckingRouter(true)
    try {
      setForwarding(await api.host.forwardStatus(selected.id))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setCheckingRouter(false)
    }
  }

  /**
   * Opens the port, or explains why it will not.
   *
   * The refusal for a server that does not verify players comes back from the
   * main process as an ordinary error with the reasoning in it, and is shown as
   * a confirmation rather than a dead end — it is the owner's network.
   */
  async function openToInternet(acceptUnverified = false): Promise<void> {
    if (!selected) return
    setCheckingRouter(true)
    try {
      setForwarding(await api.host.openPort(selected.id, acceptUnverified))
      pushToast({ kind: 'success', title: 'Port opened on the router' })
    } catch (err) {
      if (!selected.onlineMode && !acceptUnverified) {
        setConfirmExpose(true)
      } else {
        setError(toPayload(err))
      }
    } finally {
      setCheckingRouter(false)
    }
  }

  async function closeToInternet(): Promise<void> {
    if (!selected) return
    setCheckingRouter(true)
    try {
      await api.host.closePort(selected.id)
      setForwarding(await api.host.forwardStatus(selected.id))
      pushToast({ kind: 'success', title: 'Port closed' })
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setCheckingRouter(false)
    }
  }

  /**
   * Copies a one-click invite for this server.
   *
   * The friend gets a `nexuscraft://` link: opening it saves the server, builds
   * or picks a matching client, and joins — instead of them being told an IP,
   * a version and a loader over voice chat and getting one of the three wrong.
   */
  async function copyInvite(): Promise<void> {
    if (!selected) return
    setInviting(true)
    try {
      const invite = await api.host.inviteLink(selected.id)
      await navigator.clipboard.writeText(invite.link)
      pushToast({
        kind: invite.isPublic ? 'success' : 'info',
        title: 'Invite link copied',
        message:
          invite.note ??
          `Send it to a friend who has NexusCraft — it points at ${invite.address} and sets up a matching client.`
      })
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setInviting(false)
    }
  }

  /**
   * Gives this server a resident companion, then keeps it in step with the
   * server: it joins on start and leaves on stop, handled in the main process.
   */
  async function deploySteward(): Promise<void> {
    if (!selected) return
    setDeploying(true)
    try {
      const result = await api.host.deploySteward(selected.id)
      setStewards(await api.host.stewards(selected.id))
      if (result.created) {
        pushToast({
          kind: 'info',
          title: `${result.companion.username} needs a model`,
          message: 'Open the Companion screen to give it one — until then it can join but not talk.'
        })
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setDeploying(false)
    }
  }

  async function dismissSteward(companionId: string): Promise<void> {
    if (!selected) return
    try {
      await api.host.dismissSteward(companionId)
      setStewards(await api.host.stewards(selected.id))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function applyToCompanion(): Promise<void> {
    if (!selected) return
    await run(async () => {
      /*
       * Point the companions at the address the server is actually listening
       * on. Loopback was assumed here, and a server bound to the local network
       * does not answer on it — the companions failed to connect for the same
       * reason the Join button did.
       */
      const [host, port] = splitAddress(state?.address || `127.0.0.1:${selected.port}`)

      const list = await api.companion.list()
      for (const companion of list) {
        await api.companion.updateSettings(companion.id, {
          host,
          port,
          auth: selected.onlineMode ? 'microsoft' : 'offline'
        })
      }
    }, 'Companions now point at this server')

    /*
     * Say straight away that they will not get in.
     *
     * Pointing the companions at a server that verifies players with Mojang
     * quietly sets them to sign in as real accounts, which they have no way to
     * do on their own — so the settings looked applied and the first sign of
     * trouble was being kicked seconds later for an "unverified username".
     */
    if (selected.onlineMode) {
      pushToast({
        kind: 'error',
        title: 'This server will not let a companion in',
        message:
          'It verifies players with Mojang, and a companion has no Minecraft account of its own. Turn off ' +
          '"Verify players with Mojang" in this server\'s settings, or sign this companion in with a ' +
          'Microsoft account that owns the game.'
      })
    }

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
        <div className="row gap-8">
          <button
            className="btn"
            onClick={() => setPackBrowsing(true)}
            disabled={busy}
            title="Build a server from a modpack, with its mods and config already set up"
          >
            <Boxes size={15} /> From a modpack
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setEditing(blankInput(versions[0]?.id ?? '1.21.11', account?.username))}
            disabled={busy}
          >
            <Plus size={15} /> New server
          </button>
        </div>
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
            <div className="row gap-8">
              <button className="btn btn-primary" onClick={() => setEditing(blankInput(versions[0]?.id ?? '1.21.11', account?.username))}>
                <Plus size={15} /> Create a server
              </button>
              <button className="btn" onClick={() => setPackBrowsing(true)}>
                <Boxes size={15} /> From a modpack
              </button>
            </div>
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
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void deploySteward()}
                    disabled={busy || deploying}
                  >
                    {deploying ? <Spinner /> : <Bot size={14} />} Put a companion on this server
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void applyToCompanion()} disabled={busy}>
                    <Bot size={14} /> Point every companion here
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void checkRouter()}
                    disabled={busy || checkingRouter}
                  >
                    <Globe size={14} /> {checkingRouter ? 'Asking the router…' : 'Play with friends online'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void copyInvite()}
                    disabled={busy || inviting}
                  >
                    <Link2 size={14} /> {inviting ? 'Building the link…' : 'Copy invite link'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void gatherShareDetails()}
                    disabled={busy || gathering}
                  >
                    <Share2 size={14} /> {gathering ? 'Checking…' : 'Share / list this server'}
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
                        operators: selected.operators ?? [],

                        // Carried in so the panel shows this server's settings
                        // rather than the defaults for a new one.
                        levelSeed: selected.levelSeed ?? '',
                        pvp: selected.pvp ?? true,
                        hardcore: selected.hardcore ?? false,
                        allowFlight: selected.allowFlight ?? false,
                        spawnProtection: selected.spawnProtection ?? 16,
                        viewDistance: selected.viewDistance ?? 10,
                        simulationDistance: selected.simulationDistance ?? 10,
                        spawnMonsters: selected.spawnMonsters ?? true,
                        spawnAnimals: selected.spawnAnimals ?? true,
                        whitelist: selected.whitelist ?? false
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

                {stewards.length > 0 && (
                  <div className="panel panel-pad col gap-10" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="row gap-8">
                      <Bot size={15} style={{ color: 'var(--accent)' }} />
                      <strong className="small">Lives on this server</strong>
                    </div>
                    {stewards.map((steward) => (
                      <div key={steward.id} className="row gap-12">
                        <div className="flex-1" style={{ minWidth: 0 }}>
                          <div className="small truncate" style={{ fontWeight: 600 }}>
                            {steward.username}
                          </div>
                          <div className="tiny dim truncate">
                            {steward.hasApiKey || steward.routine
                              ? 'Joins when the server starts, leaves when it stops'
                              : 'Needs a model on the Companion screen before it can talk'}
                          </div>
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => void dismissSteward(steward.id)}>
                          Remove from server
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {share && (
                  <div className="panel panel-pad col gap-10" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="row gap-8 between">
                      <strong className="small">Share this server</strong>
                      <button className="btn btn-ghost btn-icon" onClick={() => setShare(null)} title="Close">
                        ×
                      </button>
                    </div>

                    {/* Where people connect, indoors and out. */}
                    <div className="col gap-6">
                      <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                        <span className="tiny dim" style={{ minWidth: 96 }}>
                          In your house
                        </span>
                        <span className="host-address">{share.localAddress}</span>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void navigator.clipboard.writeText(share.localAddress)}
                        >
                          <Copy size={13} /> Copy
                        </button>
                      </div>

                      <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                        <span className="tiny dim" style={{ minWidth: 96 }}>
                          Everyone else
                        </span>
                        {share.publicAddress ? (
                          <>
                            <span className="host-address">{share.publicAddress}</span>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => void navigator.clipboard.writeText(share.publicAddress as string)}
                            >
                              <Copy size={13} /> Copy
                            </button>
                            {share.reachable === true && (
                              <span className="pill success tiny">
                                <span className="dot online" /> answering
                              </span>
                            )}
                            {share.reachable === false && <span className="pill warning tiny">no answer</span>}
                          </>
                        ) : (
                          <span className="tiny dim">not available yet</span>
                        )}
                      </div>
                    </div>

                    {share.note && (
                      <p className="tiny dim" style={{ margin: 0 }}>
                        {share.note}
                      </p>
                    )}

                    {/*
                     * A description in the shape every listing site asks for, so
                     * it is one paste rather than ten fields typed by hand.
                     */}
                    <Field
                      label="Ready to paste"
                      hint="Most listing sites want an address, a version and a line about the server."
                    >
                      <textarea
                        className="input mono"
                        rows={4}
                        readOnly
                        value={
                          `${selected.name}\n` +
                          `Address: ${share.publicAddress ?? share.localAddress}\n` +
                          `Version: Minecraft ${share.minecraftVersion} (${share.software})\n` +
                          `Slots: ${share.maxPlayers}\n` +
                          `${share.motd}`
                        }
                      />
                    </Field>

                    <div className="row gap-8 wrap">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            `${selected.name}\n` +
                              `Address: ${share.publicAddress ?? share.localAddress}\n` +
                              `Version: Minecraft ${share.minecraftVersion} (${share.software})\n` +
                              `Slots: ${share.maxPlayers}\n` +
                              `${share.motd}`
                          )
                        }
                      >
                        <Copy size={13} /> Copy all of it
                      </button>
                    </div>

                    {/*
                     * Links, not submissions. Every one of these wants an account
                     * of your own and most forbid posting by machine, so the
                     * honest help is to carry the details to the door.
                     */}
                    <div className="col gap-6">
                      <span className="tiny dim">
                        Listing sites — each needs a free account of your own, then paste the details above:
                      </span>
                      <div className="row gap-8 wrap">
                        {[
                          ['minecraft-server-list.com', 'https://minecraft-server-list.com'],
                          ['minecraftservers.org', 'https://minecraftservers.org'],
                          ['topminecraftservers.org', 'https://topminecraftservers.org'],
                          ['minecraft-mp.com', 'https://minecraft-mp.com'],
                          ['planetminecraft.com', 'https://www.planetminecraft.com/servers/']
                        ].map(([label, url]) => (
                          <button
                            key={url}
                            className="btn btn-ghost btn-sm"
                            onClick={() => void api.app.openExternal(url)}
                          >
                            <ExternalLink size={13} /> {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {!selected.onlineMode && (
                      <p className="tiny" style={{ margin: 0, color: 'var(--warning)' }}>
                        This server does not verify players with Mojang. Listing it publicly means anyone who reads
                        the listing can join under any name they type — turn verification on before advertising it.
                      </p>
                    )}
                  </div>
                )}

                {forwarding && (
                  <div className="panel panel-pad col gap-8" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    {!forwarding.available ? (
                      <>
                        <strong className="small">Your router will not forward ports</strong>
                        <p className="tiny dim" style={{ margin: 0 }}>{forwarding.reason}</p>
                      </>
                    ) : forwarding.open ? (
                      <>
                        <div className="row gap-8" style={{ alignItems: 'center' }}>
                          <span className="pill success tiny">
                            <span className="dot online" /> Open to the internet
                          </span>
                          <span className="tiny dim">via {forwarding.router}</span>
                        </div>
                        {forwarding.externalAddress && (
                          <div className="row gap-8" style={{ alignItems: 'center' }}>
                            <span className="tiny dim">Friends connect to</span>
                            <span className="host-address">
                              {forwarding.externalAddress}:{selected.port}
                            </span>
                          </div>
                        )}
                        <p className="tiny dim" style={{ margin: 0 }}>
                          The router is asked to keep this for twelve hours, and it is closed again when you stop
                          the server.
                        </p>
                        <div className="row gap-8">
                          <button
                            className="btn btn-ghost btn-sm danger"
                            onClick={() => void closeToInternet()}
                            disabled={checkingRouter}
                          >
                            Close the port
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <strong className="small">Your router can open the port</strong>
                        <p className="tiny dim" style={{ margin: 0 }}>
                          {forwarding.router} answered. Port {selected.port} is not open yet.
                        </p>
                        <div className="row gap-8">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => void openToInternet()}
                            disabled={checkingRouter}
                          >
                            Open port {selected.port}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

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
                      className="btn btn-primary btn-sm"
                      /*
                       * Only disabled once we know the software takes neither.
                       * Written the other way round, an unloaded `softwareInfo`
                       * made both halves true and greyed the button out on a
                       * server that accepts mods perfectly well.
                       */
                      disabled={busy || softwareInfo?.mods === false && softwareInfo?.plugins === false}
                      onClick={() => setBrowsing(true)}
                      title="Search Modrinth and CurseForge, and install straight into this server"
                    >
                      <Search size={14} /> Browse mods
                    </button>
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

              {/* --------------------------------------------------- relay */}
              <div className="panel col">
                <div className="panel-head row gap-8 between">
                  <span className="small">Reaching your friends</span>
                </div>
                <div className="panel-pad">
                  <RelayTunnel serverId={selected.id} onlineMode={selected.onlineMode} />
                </div>
              </div>

              {/* ------------------------------------------------- backups */}
              <div className="panel col">
                <div className="panel-head row gap-8 between">
                  <span className="small">World snapshots</span>
                  <span className="tiny dim">Restore points for {selected.name}</span>
                </div>
                <div className="panel-pad">
                  <ServerBackups serverId={selected.id} serverName={selected.name} running={live} />
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
        width={640}
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
            <div className="settings-group-label">The server itself</div>

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

            {/*
             * Changing this changes who the world thinks you are.
             *
             * A verified server identifies players by the account number Mojang
             * issued them; an unverified one has nothing to go on but the name,
             * so it makes a number up from it. Those are different players as far
             * as the world is concerned — different inventories, different places
             * to stand, no skin. Nothing is lost, but it certainly looks like it,
             * and the first anyone knows of it is standing at spawn with empty
             * hands wondering where their things went.
             */}
            {selected && editing.id && editing.onlineMode !== selected.onlineMode && (
              <div
                className="panel panel-pad col gap-6"
                style={{ borderColor: 'var(--warning)', background: 'rgba(251,191,36,0.06)' }}
              >
                <div className="row gap-8" style={{ alignItems: 'center' }}>
                  <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />
                  <strong className="small">Everyone gets a new identity in this world</strong>
                </div>
                <p className="tiny dim" style={{ margin: 0 }}>
                  {editing.onlineMode
                    ? 'Turning verification on means players are known by their Mojang account again. Anything built or collected while it was off belongs to the temporary identity and will not be in your inventory — turn it back off to reach that character.'
                    : 'Turning verification off means the server no longer knows your Mojang account and identifies you by name alone. You will arrive as a brand new player: empty inventory, back at spawn, no skin. Your real character is kept and comes back the moment verification is turned on again.'}
                </p>
              </div>
            )}

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

            <div className="settings-group-label">The world</div>

            <Field
              label="World seed"
              hint="Leave empty for a random world. Only used the first time the world is generated — changing it later does nothing."
            >
              <input
                className="input mono"
                placeholder="random"
                value={editing.levelSeed ?? ''}
                onChange={(event) => setEditing({ ...editing, levelSeed: event.target.value })}
              />
            </Field>

            <div className="field-grid">
              <Field label="Spawn protection" hint="Blocks around spawn only operators can build in. 0 disables it.">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={256}
                  value={editing.spawnProtection ?? 16}
                  onChange={(event) =>
                    setEditing({ ...editing, spawnProtection: Number(event.target.value) })
                  }
                />
              </Field>

              <Field label="View distance" hint="Chunks sent to players. The biggest lever on performance.">
                <input
                  className="input"
                  type="number"
                  min={3}
                  max={32}
                  value={editing.viewDistance ?? 10}
                  onChange={(event) => setEditing({ ...editing, viewDistance: Number(event.target.value) })}
                />
              </Field>
            </div>

            <Field
              label="Simulation distance"
              hint="Chunks that actually tick — where crops grow and mobs move. Held at or below the view distance, which is all the server will honour."
            >
              <input
                className="input"
                type="number"
                min={3}
                max={32}
                value={editing.simulationDistance ?? 10}
                onChange={(event) => setEditing({ ...editing, simulationDistance: Number(event.target.value) })}
              />
            </Field>

            <Field label="Hostile mobs spawn" hint="Turn off for a peaceful build server without changing difficulty." inline>
              <Toggle
                checked={editing.spawnMonsters ?? true}
                onChange={(value) => setEditing({ ...editing, spawnMonsters: value })}
              />
            </Field>

            <Field label="Animals spawn" hint="Cows, sheep, chickens and the rest." inline>
              <Toggle
                checked={editing.spawnAnimals ?? true}
                onChange={(value) => setEditing({ ...editing, spawnAnimals: value })}
              />
            </Field>

            <div className="settings-group-label">Players</div>

            <Field label="Players can hurt each other" hint="Turn off so nobody can be killed by another player." inline>
              <Toggle checked={editing.pvp ?? true} onChange={(value) => setEditing({ ...editing, pvp: value })} />
            </Field>

            <Field
              label="Hardcore"
              hint="One life each: a player who dies is banned from the world. Difficulty is forced to hard."
              inline
            >
              <Toggle
                checked={editing.hardcore ?? false}
                onChange={(value) => setEditing({ ...editing, hardcore: value })}
              />
            </Field>

            <Field
              label="Allow flight"
              hint="Stops the server kicking survival players for flying. Needed for mods that grant it — it does not grant flight by itself."
              inline
            >
              <Toggle
                checked={editing.allowFlight ?? false}
                onChange={(value) => setEditing({ ...editing, allowFlight: value })}
              />
            </Field>

            <Field
              label="Whitelist"
              hint="Only players on the whitelist may join. The operators above are added to it automatically."
              inline
            >
              <Toggle
                checked={editing.whitelist ?? false}
                onChange={(value) => setEditing({ ...editing, whitelist: value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/*
        * The same browser instances use, pointed at the server.
        *
        * Adding a mod to a server used to mean finding the jar yourself,
        * checking it matched the loader and version, and dropping it in the
        * right folder. It is the same content from the same places either way,
        * so it may as well be the same two clicks.
        */}
      <Modal
        open={browsing && Boolean(selected)}
        title={`Add mods to ${selected?.name ?? ''}`}
        subtitle={
          selected
            ? `Matching ${softwareLabelFor(selected.software)} on Minecraft ${selected.minecraftVersion}. The server must be restarted before it loads anything new.`
            : undefined
        }
        onClose={() => {
          setBrowsing(false)
          if (selected) void refreshMods(selected.id)
        }}
        width={900}
      >
        {selected && (
          <BrowseTab
            instance={{ id: selected.id, name: selected.name } as never}
            destination={{
              id: selected.id,
              name: selected.name,
              minecraftVersion: selected.minecraftVersion,
              // Paper and Purpur take plugins, not Forge mods; naming them
              // correctly is what makes this browser show usable results.
              loader: SERVER_LOADERS[selected.software] ?? 'vanilla',
              isServer: true
            }}
          />
        )}
      </Modal>

      {/*
        * Building a new server from a pack. There is no server to point at yet,
        * so the destination is a placeholder that only carries `isServer` — the
        * pack supplies the version and loader, and the browser is locked to
        * modpacks because nothing else here would create anything.
        */}
      <Modal
        open={packBrowsing}
        title="Host a modpack"
        subtitle="Pick a pack and the launcher builds a server for it: the right loader, its mods, and its config. Client-only mods are turned off, since a server cannot run them."
        onClose={() => setPackBrowsing(false)}
        width={900}
      >
        <BrowseTab
          instance={{ id: '', name: 'a new server', minecraftVersion: '', loader: 'vanilla' } as never}
          destination={{
            id: '',
            name: 'a new server',
            minecraftVersion: '',
            loader: 'vanilla',
            isServer: true
          }}
          initialKind="modpack"
          lockKind
        />
      </Modal>

      <ConfirmDialog
        open={confirmExpose}
        title="Open an unverified server to the internet?"
        message={
          `"${selected?.name ?? 'This server'}" does not check that players own Minecraft — that is what lets ` +
          'an AI companion join without an account of its own. Opening it to the internet as well means anyone ' +
          "who finds the address can join under any name they type, including yours or an operator's."
        }
        confirmLabel="I understand, open it"
        danger
        onCancel={() => setConfirmExpose(false)}
        onConfirm={() => {
          setConfirmExpose(false)
          void openToInternet(true)
        }}
      />

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
