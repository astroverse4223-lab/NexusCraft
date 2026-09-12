import { type JSX, useEffect, useState } from 'react'
import { Globe, HardDrive, Play, Server, Square, Users } from 'lucide-react'
import type { HostedServer, HostedServerState } from '@shared/types'
import type { PackHostStatus } from '@shared/resourcePacks'
import { api, subscribe } from '../api'
import { useStore } from '../store/useStore'
import { Spinner } from '../components/ui'

/**
 * The server you run, on the screen you open first.
 *
 * Home knew about instances and about other people's servers, and nothing at
 * all about the one thing this launcher exists to host - so the answer to "is
 * it up, and is anybody on it" was three clicks away on a screen you had to
 * remember to visit. Everything here was already being broadcast; none of it
 * was being shown anywhere you would see it without looking.
 */
export function ServerCard(): JSX.Element | null {
  const navigate = useStore((s) => s.navigate)

  const [servers, setServers] = useState<HostedServer[]>([])
  const [states, setStates] = useState<Record<string, HostedServerState>>({})
  const [pack, setPack] = useState<PackHostStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [list, live] = await Promise.all([api.host.list(), api.host.states()])

        setServers(list)
        setStates(Object.fromEntries(live.map((state) => [state.id, state])))
      } catch {
        /* the host screen reports its own troubles */
      }

      try {
        setPack(await api.resourcePack.hostStatus())
      } catch {
        setPack(null)
      }
    })()

    /*
     * The same broadcasts the host screen listens to.
     *
     * Without them this card is right when it loads and wrong a minute later,
     * which is worse than not showing it: a dashboard nobody trusts is a
     * dashboard nobody reads.
     */
    const offState = subscribe('host:state', (state: HostedServerState) => {
      setStates((was) => ({ ...was, [state.id]: state }))
    })

    const offList = subscribe('host:changed', (list: HostedServer[]) => setServers(list))

    return () => {
      offState()
      offList()
    }
  }, [])

  if (servers.length === 0) return null

  const run = async (id: string, what: 'start' | 'stop'): Promise<void> => {
    setBusy(id)
    try {
      if (what === 'start') await api.host.start(id)
      else await api.host.stop(id)
    } catch {
      /* the host screen is where the reason belongs */
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="col gap-8">
      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <div className="section-title" style={{ flex: 1, marginBottom: 0 }}>
          Your server
        </div>

        {pack?.running && (
          <span className="tiny dim row gap-6">
            <Globe size={12} /> pack on {pack.port}
          </span>
        )}

        <button className="btn btn-ghost btn-sm" onClick={() => navigate('host')}>
          <HardDrive size={13} /> Manage
        </button>
      </div>

      {servers.map((server) => {
        const state = states[server.id]
        const up = state?.status === 'running'
        const busyHere = busy === server.id || state?.status === 'starting' || state?.status === 'stopping'

        return (
          <div key={server.id} className="panel panel-pad col gap-10">
            <div className="row gap-10 wrap" style={{ alignItems: 'center' }}>
              <Server size={16} style={{ color: up ? 'var(--accent)' : 'var(--text-dim)' }} />

              <div className="col gap-2" style={{ flex: '1 1 160px', minWidth: 0 }}>
                <strong className="truncate">{server.name}</strong>
                <span className="tiny dim">
                  Minecraft {server.minecraftVersion} &middot; port {server.port}
                  {state?.detail ? ` · ${state.detail}` : ''}
                </span>
              </div>

              <span className={up ? 'pill success tiny' : 'pill tiny dim'}>
                {up && <span className="dot online" />}
                {state?.status ?? 'stopped'}
              </span>

              {up && (
                <button className="btn btn-primary btn-sm" onClick={() => void api.host.join(server.id)}>
                  <Play size={13} /> Join
                </button>
              )}

              <button
                className={up ? 'btn btn-sm danger' : 'btn btn-sm'}
                disabled={busyHere}
                onClick={() => void run(server.id, up ? 'stop' : 'start')}
              >
                {busyHere ? <Spinner /> : up ? <Square size={13} /> : <Play size={13} />}
                {up ? 'Stop' : 'Start'}
              </button>
            </div>

            {/*
              Named, not counted. "3 online" tells you the server is busy;
              their names tell you whether to go and join them.
            */}
            {up && (
              <div className="row gap-6 tiny dim">
                <Users size={12} />
                {state?.players.length ? state.players.join(', ') : 'nobody on yet'}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
