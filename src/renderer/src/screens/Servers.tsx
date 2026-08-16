import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Star,
  Trash2,
  Users,
  Wifi
} from 'lucide-react'
import type { LauncherErrorPayload, SavedServer, ServerStatus } from '@shared/types'
import { api, toPayload } from '../api'
import { useStore, selectedInstance } from '../store/useStore'
import { ConfirmDialog, EmptyState, ErrorView, Modal, Spinner } from '../components/ui'
import { formatRelative } from '../format'

export function ServersScreen(): JSX.Element {
  const statuses = useStore((s) => s.serverStatuses)
  const instance = useStore(selectedInstance)
  const instances = useStore((s) => s.instances)
  const navigate = useStore((s) => s.navigate)
  const pushToast = useStore((s) => s.pushToast)

  const [servers, setServers] = useState<SavedServer[] | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [editing, setEditing] = useState<SavedServer | 'new' | null>(null)
  const [deleting, setDeleting] = useState<SavedServer | null>(null)
  const [busy, setBusy] = useState(false)
  const [pinging, setPinging] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await api.servers.list()
      setServers(result.servers)
      setError(null)
      return result.servers
    } catch (err) {
      setError(toPayload(err))
      setServers([])
      return []
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const list = await load()
      // Check every saved server once on arrival so cards are not blank.
      if (list.length > 0) void api.servers.pingAll().catch(() => undefined)
    })()
  }, [load])

  async function pingAll(): Promise<void> {
    setPinging(true)
    try {
      await api.servers.pingAll()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setPinging(false)
    }
  }

  async function importFromInstance(): Promise<void> {
    if (!instance) return
    try {
      await api.servers.import(instance.id)
      await load()
      void api.servers.pingAll().catch(() => undefined)
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function join(server: SavedServer): Promise<void> {
    const target = server.preferredInstanceId
      ? instances.find((i) => i.id === server.preferredInstanceId)
      : instance
    if (!target) {
      setError({
        code: 'NOT_FOUND',
        title: 'No instance to join with',
        message: 'Create an instance first, then pick it as the one to join this server with.',
        actions: ['Go to the Instances screen and create one'],
        detail: null
      })
      return
    }
    try {
      await api.launch.start(target.id, `${server.address}:${server.port}`)
      navigate('play')
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function remove(): Promise<void> {
    if (!deleting) return
    setBusy(true)
    try {
      await api.servers.remove(deleting.id)
      setDeleting(null)
      await load()
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
          <div className="eyebrow">Multiplayer</div>
          <h1>Servers</h1>
          <p className="subtitle">
            Save the servers you play on. Status, player counts and ping are read live from each server — nothing is
            shown unless the server actually answered.
          </p>
        </div>
        <div className="row gap-8">
          {instance && (
            <button className="btn" onClick={() => void importFromInstance()} title="Import from this instance's servers.dat">
              <Download size={15} /> Import
            </button>
          )}
          <button className="btn" disabled={pinging} onClick={() => void pingAll()}>
            {pinging ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add server
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {servers === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Loading saved servers…
        </div>
      ) : servers.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Server size={24} />}
            title="No servers saved"
            message="Add a server address to save it here, or import the list Minecraft already keeps for an instance."
            action={
              <div className="row gap-8">
                <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
                  <Plus size={14} /> Add a server
                </button>
                {instance && (
                  <button className="btn btn-sm" onClick={() => void importFromInstance()}>
                    <Download size={14} /> Import from {instance.name}
                  </button>
                )}
              </div>
            }
          />
        </div>
      ) : (
        <div className="card-grid">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              status={statuses[server.id]}
              copied={copiedId === server.id}
              onCopy={() => {
                const address = server.port === 25565 ? server.address : `${server.address}:${server.port}`
                void navigator.clipboard.writeText(address)
                setCopiedId(server.id)
                setTimeout(() => setCopiedId(null), 1600)
                pushToast({ kind: 'success', title: 'Address copied', message: address })
              }}
              onPing={() => void api.servers.ping(server.id).catch(() => undefined)}
              onJoin={() => void join(server)}
              onEdit={() => setEditing(server)}
              onDelete={() => setDeleting(server)}
              onFavorite={() => {
                void api.servers.favorite(server.id, !server.favorite).then(load).catch((err) => setError(toPayload(err)))
              }}
            />
          ))}
        </div>
      )}

      {editing && (
        <ServerEditor
          server={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load().then(() => void api.servers.pingAll().catch(() => undefined))
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Remove "${deleting?.name}"?`}
        message="This only removes the server from your saved list. Nothing on the server itself is affected."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

/* ----------------------------------------------------------------- card */

function ServerCard({
  server,
  status,
  copied,
  onCopy,
  onPing,
  onJoin,
  onEdit,
  onDelete,
  onFavorite
}: {
  server: SavedServer
  status?: ServerStatus
  copied: boolean
  onCopy: () => void
  onPing: () => void
  onJoin: () => void
  onEdit: () => void
  onDelete: () => void
  onFavorite: () => void
}): JSX.Element {
  // `online === null` means "we genuinely do not know yet" and is rendered as
  // such — never as online.
  const state = status?.online
  const checking = status !== undefined && status.online === null

  return (
    <div className="panel panel-hover" style={{ overflow: 'hidden' }}>
      <div className="panel-pad col gap-12">
        <div className="row gap-11">
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
              {server.favorite && <Star size={13} fill="var(--warning)" style={{ color: 'var(--warning)' }} />}
            </div>
            <div className="tiny dim truncate">
              {server.address}
              {server.port !== 25565 ? `:${server.port}` : ''}
            </div>
          </div>

          <button
            className="btn btn-ghost btn-icon"
            title={server.favorite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={onFavorite}
          >
            <Star size={15} fill={server.favorite ? 'var(--warning)' : 'none'} style={server.favorite ? { color: 'var(--warning)' } : undefined} />
          </button>
        </div>

        {/* live status strip */}
        <div
          className="row gap-12 wrap"
          style={{
            padding: '9px 11px',
            borderRadius: 10,
            background: 'rgba(0,0,0,0.26)',
            border: '1px solid var(--border)'
          }}
        >
          {checking ? (
            <span className="row gap-8 tiny muted">
              <Spinner /> Checking…
            </span>
          ) : state === true ? (
            <>
              <span className="row gap-4 tiny" style={{ color: 'var(--success)' }}>
                <span className="dot online" /> Online
              </span>
              {status?.playersOnline != null && (
                <span className="row gap-4 tiny muted">
                  <Users size={11} /> {status.playersOnline}
                  {status.playersMax != null ? ` / ${status.playersMax}` : ''}
                </span>
              )}
              {status?.latencyMs != null && (
                <span className="row gap-4 tiny muted">
                  <Wifi size={11} /> {status.latencyMs} ms
                </span>
              )}
              {status?.versionName && <span className="tiny dim truncate">{status.versionName}</span>}
            </>
          ) : state === false ? (
            <span className="row gap-4 tiny" style={{ color: 'var(--danger)' }}>
              <span className="dot offline" /> {status?.error ?? 'Offline'}
            </span>
          ) : (
            <span className="row gap-4 tiny dim">
              <span className="dot unknown" /> Not checked yet
            </span>
          )}
        </div>

        {status?.motd && (
          <div className="tiny dim" style={{ minHeight: 17 }}>
            {status.motd.split('\n')[0].slice(0, 90)}
          </div>
        )}

        {server.description && !status?.motd && <div className="tiny dim">{server.description.slice(0, 90)}</div>}

        <div className="row between">
          <span className="tiny dim">
            {server.lastJoinedAt ? `Joined ${formatRelative(server.lastJoinedAt)}` : 'Never joined'}
          </span>
          {server.notedVersion && <span className="pill">{server.notedVersion}</span>}
        </div>

        <div className="row gap-8">
          <button className="btn btn-primary btn-sm flex-1" onClick={onJoin}>
            <Play size={13} /> Join
          </button>
          <button className="btn btn-sm" title="Copy address" onClick={onCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button className="btn btn-ghost btn-icon" title="Check status" onClick={onPing}>
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-ghost btn-icon" title="Edit" onClick={onEdit}>
            <Pencil size={14} />
          </button>
          <button className="btn btn-ghost btn-icon" title="Remove" onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- editor */

function ServerEditor({
  server,
  onClose,
  onSaved
}: {
  server: SavedServer | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const instances = useStore((s) => s.instances)

  const [name, setName] = useState(server?.name ?? '')
  const [address, setAddress] = useState(server?.address ?? '')
  const [port, setPort] = useState(server?.port ?? 25565)
  const [version, setVersion] = useState(server?.notedVersion ?? '')
  const [description, setDescription] = useState(server?.description ?? '')
  const [preferred, setPreferred] = useState(server?.preferredInstanceId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.servers.save({
        id: server?.id ?? null,
        name: name.trim() || address.trim(),
        address: address.trim(),
        port,
        notedVersion: version.trim() || null,
        description: description.trim() || null,
        preferredInstanceId: preferred || null
      })
      onSaved()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={server ? 'Edit server' : 'Add a server'}
      subtitle="Paste an address like play.example.com — a port is only needed if the server uses a non-standard one."
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !address.trim()}>
            {busy && <Spinner />} {server ? 'Save changes' : 'Add server'}
          </button>
        </>
      }
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="field">
        <label className="field-label">Server address</label>
        <input
          className="input"
          value={address}
          placeholder="play.example.com"
          onChange={(event) => setAddress(event.target.value)}
        />
      </div>

      <div className="row gap-12">
        <div className="field flex-1">
          <label className="field-label">Display name</label>
          <input
            className="input"
            value={name}
            placeholder="My server"
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label className="field-label">Port</label>
          <input
            className="input"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(Number(event.target.value) || 25565)}
          />
        </div>
      </div>

      <div className="field">
        <label className="field-label">Version note</label>
        <input
          className="input"
          value={version}
          placeholder="1.21.4"
          maxLength={64}
          onChange={(event) => setVersion(event.target.value)}
        />
        <p className="field-hint">Just a note for yourself. The real version is read from the server when it responds.</p>
      </div>

      <div className="field">
        <label className="field-label">Join with</label>
        <select className="select" value={preferred} onChange={(event) => setPreferred(event.target.value)}>
          <option value="">The currently selected instance</option>
          {instances.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.minecraftVersion})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label">Notes</label>
        <textarea
          className="textarea"
          value={description}
          maxLength={512}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
    </Modal>
  )
}
