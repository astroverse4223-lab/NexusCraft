import { useEffect, useState } from 'react'
import { Boxes, Clock, Cpu, HardDrive, Play, Server, Sparkles, Globe2 } from 'lucide-react'
import type { SavedServer, ServerStatus } from '@shared/types'
import { api } from '../api'
import { useStore, activeAccount, selectedInstance } from '../store/useStore'
import { Onboarding } from './Onboarding'
import { EmptyState, Spinner } from '../components/ui'
import { SkinFace } from '../components/SkinView'
import { formatDuration, formatRelative, LOADER_COLORS, LOADER_LABELS } from '../format'

export function HomeScreen(): JSX.Element {
  const settings = useStore((s) => s.settings)

  // The whole home screen becomes the first-run flow until it is completed.
  if (settings && !settings.onboardingComplete) return <Onboarding />

  return <Dashboard />
}

function Dashboard(): JSX.Element {
  const account = useStore(activeAccount)
  const instances = useStore((s) => s.instances)
  const selected = useStore(selectedInstance)
  const navigate = useStore((s) => s.navigate)
  const launches = useStore((s) => s.launches)
  const statuses = useStore((s) => s.serverStatuses)

  const [servers, setServers] = useState<SavedServer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.servers.list()
        setServers(result.servers.slice(0, 4))
      } catch {
        /* the servers screen surfaces its own errors */
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const totalPlaytime = instances.reduce((sum, instance) => sum + instance.totalPlaytimeMs, 0)
  const recent = [...instances].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)).slice(0, 4)
  const running = Object.values(launches).filter((l) => l.stage === 'running')

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Dashboard</div>
          <h1>
            {greeting}
            {account ? `, ${account.username}` : ''}
          </h1>
          <p className="subtitle">
            {running.length > 0
              ? `${running.length} instance${running.length === 1 ? ' is' : 's are'} running right now.`
              : selected
                ? `${selected.name} is ready to launch.`
                : 'Create an instance to get started.'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('play')}>
          <Play size={16} /> Go to Play
        </button>
      </div>

      <div className="card-grid mb-24">
        <StatTile icon={<Boxes size={17} />} label="Instances" value={String(instances.length)} />
        <StatTile icon={<Clock size={17} />} label="Total playtime" value={formatDuration(totalPlaytime)} />
        <StatTile
          icon={<Cpu size={17} />}
          label="Memory allocated"
          value={selected ? `${(selected.java.maxRamMb / 1024).toFixed(1)} GB` : '—'}
        />
        <StatTile icon={<Server size={17} />} label="Saved servers" value={loading ? '…' : String(servers.length)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 16, alignItems: 'start' }}>
        <section>
          <div className="section-title">Recently played</div>
          {recent.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={<Boxes size={24} />}
                title="No instances yet"
                message="An instance is a self-contained Minecraft setup with its own version, mods and worlds."
                action={
                  <button className="btn btn-primary btn-sm" onClick={() => navigate('instances')}>
                    Create your first instance
                  </button>
                }
              />
            </div>
          ) : (
            <div className="col gap-8">
              {recent.map((instance) => {
                const state = launches[instance.id]
                return (
                  <button
                    key={instance.id}
                    className="panel panel-hover row gap-12"
                    style={{ padding: 13, textAlign: 'left', width: '100%' }}
                    onClick={() => {
                      void useStore.getState().selectInstance(instance.id)
                      navigate('play')
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 11,
                        background: `linear-gradient(135deg, ${instance.iconColor}38, ${instance.iconColor}12)`,
                        border: `1px solid ${instance.iconColor}44`,
                        display: 'grid',
                        placeItems: 'center',
                        color: instance.iconColor,
                        flexShrink: 0
                      }}
                    >
                      <Sparkles size={17} />
                    </div>
                    <div className="flex-1">
                      <div className="row gap-8">
                        <span style={{ fontWeight: 600 }}>{instance.name}</span>
                        {state?.stage === 'running' && (
                          <span className="pill success">
                            <span className="dot online" /> Running
                          </span>
                        )}
                      </div>
                      <div className="row gap-8 tiny dim mt-8">
                        <span>{instance.minecraftVersion}</span>
                        <span>·</span>
                        <span style={{ color: LOADER_COLORS[instance.loader] }}>
                          {LOADER_LABELS[instance.loader]}
                        </span>
                        <span>·</span>
                        <span>{formatRelative(instance.lastPlayedAt)}</span>
                      </div>
                    </div>
                    <Play size={16} className="dim" />
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section>
          <div className="section-title">Servers</div>
          {loading ? (
            <div className="panel panel-pad row gap-12 muted">
              <Spinner /> Loading…
            </div>
          ) : servers.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={<Server size={22} />}
                title="No servers saved"
                message="Save the servers you play on to see them here."
                action={
                  <button className="btn btn-sm" onClick={() => navigate('servers')}>
                    Add a server
                  </button>
                }
              />
            </div>
          ) : (
            <div className="col gap-8">
              {servers.map((server) => (
                <ServerRow key={server.id} server={server} status={statuses[server.id]} />
              ))}
              <button className="btn btn-ghost btn-sm mt-8" onClick={() => navigate('servers')}>
                Manage servers
              </button>
            </div>
          )}

          {account && (
            <>
              <div className="section-title mt-24">Account</div>
              <button
                className="panel panel-hover row gap-12"
                style={{ padding: 13, width: '100%', textAlign: 'left' }}
                onClick={() => navigate('account')}
              >
                <SkinFace skinDataUrl={account.skinDataUrl} size={38} radius={11} />
                <div className="flex-1">
                  <div style={{ fontWeight: 600 }}>{account.username}</div>
                  <div className="tiny dim">
                    {account.ownsMinecraft
                      ? account.entitlementSource === 'game_pass'
                        ? 'Java Edition via Game Pass'
                        : 'Java Edition owned'
                      : 'No Java Edition access'}
                  </div>
                </div>
              </button>
            </>
          )}
        </section>
      </div>
    </>
  )
}

function StatTile({ icon, label, value }: { icon: JSX.Element; label: string; value: string }): JSX.Element {
  return (
    <div className="panel panel-pad">
      <div className="row gap-10 dim" style={{ fontSize: 12 }}>
        {icon}
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 650, marginTop: 6 }}>{value}</div>
    </div>
  )
}

function ServerRow({ server, status }: { server: SavedServer; status?: ServerStatus }): JSX.Element {
  const navigate = useStore((s) => s.navigate)
  return (
    <button
      className="panel panel-hover row gap-12"
      style={{ padding: 11, width: '100%', textAlign: 'left' }}
      onClick={() => navigate('servers')}
    >
      {status?.faviconDataUrl ? (
        <img
          src={status.faviconDataUrl}
          width={32}
          height={32}
          alt=""
          style={{ borderRadius: 8, imageRendering: 'pixelated' }}
        />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--panel-strong)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text-dim)'
          }}
        >
          <Globe2 size={15} />
        </div>
      )}
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>
          {server.name}
        </div>
        <div className="tiny dim truncate">
          {/* Status is only ever claimed when a real ping came back. */}
          {status?.online === true
            ? `${status.playersOnline ?? '?'} / ${status.playersMax ?? '?'} online`
            : status?.online === false
              ? 'Offline'
              : 'Not checked'}
        </div>
      </div>
      <span className={`dot ${status?.online === true ? 'online' : status?.online === false ? 'offline' : 'unknown'}`} />
    </button>
  )
}
