import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  RefreshCw,
  Server,
  Users,
  Signal,
  Plus,
  Play,
  Copy,
  Check,
  Wifi,
  WifiOff
} from 'lucide-react'
import type {
  DirectoryCategory,
  DirectoryCompatibility,
  DirectoryCategoryInfo,
  DirectoryServer,
  LauncherErrorPayload,
  ServerStatus
} from '@shared/types'
import { api, subscribe, toPayload } from '../api'
import { useInfiniteScroll } from '../components/useInfiniteScroll'
import { useStore } from '../store/useStore'
import { ErrorView, EmptyState, Spinner } from '../components/ui'

type Sort = 'players' | 'name' | 'latency'

/**
 * Public servers to join.
 *
 * The catalogue says who exists; the ping says what is true. Every number on
 * this screen — online or not, who is on, the version, the latency — comes from
 * the launcher speaking Server List Ping to the server itself, so a listing
 * that has moved on shows as offline rather than as an invented player count.
 */
/** Rows added per scroll. Enough to fill a wide window in one go. */
const PAGE = 24

export function DiscoverScreen(): JSX.Element {
  const navigate = useStore((s) => s.navigate)
  const instances = useStore((s) => s.instances)
  const pushToast = useStore((s) => s.pushToast)

  const [servers, setServers] = useState<DirectoryServer[] | null>(null)
  const [categories, setCategories] = useState<DirectoryCategoryInfo[]>([])
  const [statuses, setStatuses] = useState<Map<string, ServerStatus>>(new Map())
  const [source, setSource] = useState<'bundled' | 'remote'>('bundled')

  const [category, setCategory] = useState<DirectoryCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('players')
  const [onlineOnly, setOnlineOnly] = useState(false)

  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  /** Whether each pinged server can actually be joined with what is installed. */
  const [fit, setFit] = useState<Record<string, DirectoryCompatibility>>({})
  /* 'auto' matches the instance to whatever version the server answers with. */
  const [joinWith, setJoinWith] = useState<string>('auto')

  /* Live ping results stream in one at a time as each server answers. */
  useEffect(() => {
    return subscribe('directory:status', (status: ServerStatus) => {
      setStatuses((current) => {
        const next = new Map(current)
        next.set(status.serverId, status)
        return next
      })
    })
  }, [])

  const load = useCallback(async () => {
    try {
      const listing = await api.directory.list()
      setServers(listing.servers)
      setCategories(listing.categories)
      setSource(listing.source)
      setStatuses(new Map(listing.statuses.map((s) => [s.serverId, s])))
      // Ping in the background; results arrive over the event channel.
      setRefreshing(true)
      void api.directory
        .refresh(false)
        .catch(() => undefined)
        .finally(() => {
          setRefreshing(false)
          // Once the pings have landed, work out what can actually be joined.
          void api.directory.compatibility().then(setFit).catch(() => undefined)
        })
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function refreshAll(): Promise<void> {
    setRefreshing(true)
    try {
      await api.directory.refresh(true)
      setFit(await api.directory.compatibility())
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setRefreshing(false)
    }
  }

  const visible = useMemo(() => {
    if (!servers) return []
    const needle = query.trim().toLowerCase()

    const filtered = servers.filter((server) => {
      if (category !== 'all' && server.category !== category) return false
      if (onlineOnly && statuses.get(server.id)?.online !== true) return false
      if (!needle) return true
      return (
        server.name.toLowerCase().includes(needle) ||
        server.address.toLowerCase().includes(needle) ||
        server.description.toLowerCase().includes(needle) ||
        server.tags.some((tag) => tag.toLowerCase().includes(needle))
      )
    })

    return filtered.sort((a, b) => {
      const sa = statuses.get(a.id)
      const sb = statuses.get(b.id)
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'latency') {
        // Unreachable servers sort last whichever way the column is read.
        const la = sa?.online === true ? (sa.latencyMs ?? 9999) : Number.MAX_SAFE_INTEGER
        const lb = sb?.online === true ? (sb.latencyMs ?? 9999) : Number.MAX_SAFE_INTEGER
        return la - lb
      }
      const pa = sa?.online === true ? (sa.playersOnline ?? 0) : -1
      const pb = sb?.online === true ? (sb.playersOnline ?? 0) : -1
      return pb - pa
    })
  }, [servers, category, query, sort, onlineOnly, statuses])

  /*
   * Rows are added as you scroll rather than all at once.
   *
   * Each card carries a live ping result and the compatibility check for every
   * installed instance, so a full list is a lot of work up front for rows most
   * people never scroll to. The catalogue is fetched whole either way — this
   * only governs how much of it is on screen.
   */
  const [shown, setShown] = useState(PAGE)
  // Any change to the filters starts the window again from the top.
  useEffect(() => setShown(PAGE), [category, query, sort, onlineOnly])

  /*
   * A much shorter margin than the mod browser uses. There a page is a network
   * request worth starting early; here the rows are already in memory, and
   * reaching 600px ahead simply kept the sentinel in view after each batch, so
   * it cascaded through the whole list at once and deferred nothing.
   */
  const sentinel = useInfiniteScroll(() => setShown((current) => current + PAGE), {
    enabled: shown < visible.length,
    rootMargin: '80px'
  })
  const shownServers = visible.slice(0, shown)

  const totals = useMemo(() => {
    let online = 0
    let players = 0
    for (const status of statuses.values()) {
      if (status.online === true) {
        online += 1
        players += status.playersOnline ?? 0
      }
    }
    return { online, players }
  }, [statuses])

  async function join(server: DirectoryServer): Promise<void> {
    try {
      await api.directory.join(server.address, server.port, joinWith === 'auto' ? undefined : joinWith)
      navigate('play')
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function save(server: DirectoryServer): Promise<void> {
    try {
      await api.directory.add(server.name, server.address, server.port)
    } catch (err) {
      setError(toPayload(err))
    }
  }

  function copyAddress(server: DirectoryServer): void {
    const address = server.port === 25565 ? server.address : `${server.address}:${server.port}`
    void navigator.clipboard.writeText(address).then(
      () => {
        setCopied(server.id)
        setTimeout(() => setCopied((c) => (c === server.id ? null : c)), 1600)
      },
      () => pushToast({ kind: 'error', title: 'Could not copy the address' })
    )
  }

  if (!servers) {
    return (
      <>
        <div className="screen-header">
          <div>
            <div className="eyebrow">Multiplayer</div>
            <h1>Discover</h1>
          </div>
        </div>
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Loading the server list…
        </div>
      </>
    )
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Multiplayer</div>
          <h1>Discover</h1>
          <p className="subtitle">
            Public servers to join, checked live. {totals.online} online
            {totals.players > 0 ? ` · ${totals.players.toLocaleString()} players right now` : ''}
            {source === 'remote' ? ' · using your custom list' : ''}
          </p>
        </div>
        <div className="row gap-8">
          <label className="tiny dim" htmlFor="join-with">
            Join with
          </label>
          <select
            id="join-with"
            className="input"
            style={{ width: 210 }}
            value={joinWith}
            onChange={(e) => setJoinWith(e.target.value)}
            title="Which instance to launch. Automatic picks one that matches the version the server answers with."
          >
            <option value="auto">Best match (automatic)</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name} — {instance.minecraftVersion}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void refreshAll()} disabled={refreshing}>
            {refreshing ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <DirectAddress
        instances={instances.length}
        joinWith={joinWith}
        onError={setError}
        onJoined={() => navigate('play')}
      />

      {/* ---------------------------------------------------------- filters */}

      <div className="row gap-8 wrap" style={{ margin: '18px 0 14px' }}>
        <div className="flex-1" style={{ minWidth: 220 }}>
          <input
            className="input"
            placeholder="Search by name, address or type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <select className="input" style={{ width: 160 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="players">Most players</option>
          <option value="latency">Lowest ping</option>
          <option value="name">Name (A–Z)</option>
        </select>

        <button
          className={`btn ${onlineOnly ? 'btn-primary' : ''}`}
          onClick={() => setOnlineOnly((v) => !v)}
          title="Hide servers that did not answer"
        >
          {onlineOnly ? <Wifi size={15} /> : <WifiOff size={15} />}
          Online only
        </button>
      </div>

      <div className="row gap-8 wrap" style={{ marginBottom: 18 }}>
        <button
          className={`tab ${category === 'all' ? 'active' : ''}`}
          onClick={() => setCategory('all')}
        >
          All ({servers.length})
        </button>
        {categories.map((entry) => {
          const count = servers.filter((s) => s.category === entry.id).length
          if (count === 0) return null
          return (
            <button
              key={entry.id}
              className={`tab ${category === entry.id ? 'active' : ''}`}
              onClick={() => setCategory(entry.id)}
              title={entry.blurb}
            >
              {entry.label} ({count})
            </button>
          )
        })}
      </div>

      {/* ------------------------------------------------------------ list */}

      {visible.length === 0 ? (
        <EmptyState
          icon={<Server size={26} />}
          title="Nothing matches that"
          message={
            onlineOnly
              ? 'No server in this category answered. Try turning off "Online only" — a server can be down for a moment.'
              : 'Try a different search or category.'
          }
        />
      ) : (
        <div className="card-grid">
          {shownServers.map((server) => (
            <DirectoryCard
              key={server.id}
              server={server}
              status={statuses.get(server.id)}
              fit={fit[server.id]}
              copied={copied === server.id}
              onJoin={() => void join(server)}
              onSave={() => void save(server)}
              onCopy={() => copyAddress(server)}
              onPing={() => void api.directory.ping(server.id).catch(() => undefined)}
            />
          ))}
        </div>
      )}

      {shown < visible.length && (
        // Empty, below the grid: crossing the viewport pulls in the next rows.
        <div ref={sentinel} style={{ height: 1 }} aria-hidden />
      )}

      {visible.length > PAGE && (
        <div className="tiny dim center" style={{ padding: '18px 0' }}>
          {shown < visible.length
            ? `Showing ${shownServers.length} of ${visible.length}`
            : `All ${visible.length} servers shown`}
        </div>
      )}

      <p className="tiny dim" style={{ marginTop: 22, lineHeight: 1.6 }}>
        Player counts, versions and icons come from pinging each server directly, the same way the game&apos;s own
        multiplayer list does — nothing here is reported online unless it answered. This starting list ships with the
        launcher; point Settings at your own JSON feed to replace it, or use the box above to reach any address.
      </p>
    </>
  )
}

/* ------------------------------------------------------ direct address box */

/**
 * Reaching a server that is not on any list — the case that actually matters
 * when a friend sends an address in chat.
 */
function DirectAddress({
  instances,
  joinWith,
  onError,
  onJoined
}: {
  instances: number
  joinWith: string
  onError: (error: LauncherErrorPayload) => void
  onJoined: () => void
}): JSX.Element {
  const [address, setAddress] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ address: string; port: number; status: ServerStatus } | null>(null)

  async function check(): Promise<void> {
    if (!address.trim()) return
    setChecking(true)
    setResult(null)
    try {
      const found = await api.directory.lookup(address)
      setResult({ address: found.address, port: found.port, status: found.status })
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setChecking(false)
    }
  }

  async function join(): Promise<void> {
    if (!result) return
    try {
      await api.directory.join(result.address, result.port, joinWith === 'auto' ? undefined : joinWith)
      onJoined()
    } catch (err) {
      onError(toPayload(err))
    }
  }

  async function save(): Promise<void> {
    if (!result) return
    try {
      await api.directory.add(result.address, result.address, result.port)
    } catch (err) {
      onError(toPayload(err))
    }
  }

  const online = result?.status.online === true

  return (
    <div className="panel panel-pad">
      <div className="row gap-8 wrap">
        <div className="flex-1" style={{ minWidth: 240 }}>
          <label className="tiny dim" style={{ display: 'block', marginBottom: 5 }}>
            Have an address? Check any server
          </label>
          <input
            className="input"
            placeholder="play.example.com  or  192.168.1.20:25566"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void check()
            }}
          />
        </div>
        <button
          className="btn"
          style={{ alignSelf: 'flex-end' }}
          onClick={() => void check()}
          disabled={checking || !address.trim()}
        >
          {checking ? <Spinner /> : <Signal size={15} />}
          {checking ? 'Checking…' : 'Check'}
        </button>
      </div>

      {result && (
        <div className="row gap-8 wrap" style={{ marginTop: 12, alignItems: 'center' }}>
          <span
            className="pill"
            style={{
              color: online ? 'var(--success)' : 'var(--danger)',
              borderColor: online ? 'var(--success)' : 'var(--danger)'
            }}
          >
            {online ? 'Online' : 'Not reachable'}
          </span>

          {online ? (
            <span className="tiny dim truncate flex-1">
              {result.status.playersOnline ?? 0}/{result.status.playersMax ?? '?'} players
              {result.status.versionName ? ` · ${result.status.versionName}` : ''}
              {result.status.latencyMs !== null ? ` · ${result.status.latencyMs} ms` : ''}
              {result.status.motd ? ` · ${result.status.motd}` : ''}
            </span>
          ) : (
            <span className="tiny dim flex-1">{result.status.error ?? 'The server did not answer.'}</span>
          )}

          <button className="btn btn-ghost" onClick={() => void save()}>
            <Plus size={15} />
            Save
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void join()}
            disabled={instances === 0}
            title={instances === 0 ? 'Create an instance first' : 'Launch Minecraft and connect'}
          >
            <Play size={15} />
            Join
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ card */

function DirectoryCard({
  server,
  status,
  fit,
  copied,
  onJoin,
  onSave,
  onCopy,
  onPing
}: {
  server: DirectoryServer
  status?: ServerStatus
  fit?: DirectoryCompatibility
  copied: boolean
  onJoin: () => void
  onSave: () => void
  onCopy: () => void
  onPing: () => void
}): JSX.Element {
  // `online === null` means the check has not come back yet. It is shown as
  // "checking", never as online or offline.
  const checking = status !== undefined && status.online === null
  const online = status?.online === true

  return (
    <div className="panel panel-hover" style={{ overflow: 'hidden' }}>
      <div className="panel-pad col gap-12">
        <div className="row gap-12">
          {status?.faviconDataUrl ? (
            <img
              src={status.faviconDataUrl}
              width={44}
              height={44}
              alt=""
              style={{ borderRadius: 10, imageRendering: 'pixelated', flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: 'var(--panel-strong)',
                border: '1px solid var(--border)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--text-dim)',
                flexShrink: 0
              }}
            >
              <Server size={19} />
            </div>
          )}

          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="row gap-8">
              <span className="truncate" style={{ fontWeight: 650 }}>
                {server.name}
              </span>
              <span
                title={
                  checking
                    ? 'Checking…'
                    : online
                      ? 'Answered a ping just now'
                      : (status?.error ?? 'Not checked yet')
                }
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  flexShrink: 0,
                  background: checking
                    ? 'var(--text-dim)'
                    : online
                      ? 'var(--success)'
                      : status
                        ? 'var(--danger)'
                        : 'var(--border)'
                }}
              />
            </div>
            <button
              className="tiny dim truncate row gap-4"
              onClick={onCopy}
              title="Copy the address"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', maxWidth: '100%' }}
            >
              {copied ? (
                <>
                  <Check size={11} /> Copied
                </>
              ) : (
                <>
                  {server.address}
                  {server.port !== 25565 ? `:${server.port}` : ''}
                  <Copy size={11} style={{ marginLeft: 5, opacity: 0.6 }} />
                </>
              )}
            </button>
          </div>
        </div>

        <p className="tiny dim" style={{ margin: 0, lineHeight: 1.5, minHeight: 34 }}>
          {/* The server's own MOTD is better than our blurb whenever it answers. */}
          {online && status?.motd ? status.motd : server.description}
        </p>

        <div className="row gap-12 tiny dim" style={{ minHeight: 18 }}>
          {checking ? (
            <span className="row gap-8">
              <Spinner /> Checking…
            </span>
          ) : online ? (
            <>
              <span className="row gap-4">
                <Users size={12} />
                {(status?.playersOnline ?? 0).toLocaleString()}
                {status?.playersMax ? ` / ${status.playersMax.toLocaleString()}` : ''}
              </span>
              {status?.latencyMs !== null && status?.latencyMs !== undefined && (
                <span className="row gap-4">
                  <Signal size={12} />
                  {status.latencyMs} ms
                </span>
              )}
              {status?.versionName && <span className="truncate">{status.versionName}</span>}
            </>
          ) : status ? (
            <span className="truncate" style={{ color: 'var(--danger)' }}>
              {status.error ?? 'Did not answer'}
            </span>
          ) : (
            <span>Not checked yet</span>
          )}
        </div>

        {/*
          * Whether this can be joined, worked out before the click rather than
          * as a modal afterwards. Silent while unknown — an absent answer is
          * not a negative one.
          */}
        {online && fit && (
          <div className="row gap-4 tiny" style={{ color: fit.ok ? 'var(--success)' : 'var(--warning)' }}>
            {fit.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
            <span className="truncate">
              {fit.ok ? `joins with ${fit.instanceName}` : `cannot join — ${fit.reason}`}
            </span>
          </div>
        )}

        <div className="row gap-8">
          <button
            className="btn btn-primary flex-1"
            onClick={onJoin}
            disabled={!online}
            title={
              !online
                ? 'This server did not answer'
                : fit && !fit.ok
                  ? `No instance matches: ${fit.reason}. Use "Join with" to choose one anyway.`
                  : 'Launch Minecraft and connect'
            }
          >
            <Play size={15} />
            Join
          </button>
          <button className="btn btn-ghost" onClick={onSave} title="Add to my servers">
            <Plus size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={onPing} title="Check again" disabled={checking}>
            {checking ? <Spinner /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
