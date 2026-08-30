import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Globe, Radio, Square } from 'lucide-react'
import type { LauncherErrorPayload } from '@shared/types'
import { api, subscribe, toPayload, type TunnelSettings, type TunnelState } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, Spinner } from './ui'

/**
 * The way in when the router will not open a port.
 *
 * Shown as the second option rather than the first: forwarding a port is
 * faster, free and involves nobody else, so it is worth trying before routing
 * everyone's traffic through a stranger's machine. This is for the homes where
 * it simply cannot work — carrier-grade NAT, a router that is not yours — and
 * it says so, because a player who does not know which of those they have will
 * otherwise reach for whichever button is first.
 */
export function RelayTunnel({
  serverId,
  onlineMode
}: {
  serverId: string
  /** The port comes from the server record in the main process, not from here. */
  onlineMode: boolean
}): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const [settings, setSettings] = useState<TunnelSettings | null>(null)
  const [state, setState] = useState<TunnelState | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [config, current] = await Promise.all([
        api.host.tunnelSettings(serverId),
        api.host.tunnelState(serverId)
      ])
      setSettings(config)
      setState(current)
    } catch (err) {
      setError(toPayload(err))
    }
  }, [serverId])

  useEffect(() => {
    void load()
    return subscribe('tunnel:state', (payload: TunnelState) => {
      if (payload.serverId === serverId) setState(payload)
    })
  }, [load, serverId])

  async function chooseAgent(): Promise<void> {
    try {
      const files = await api.app.pickFiles({
        title: 'Choose the relay agent',
        extensions: window.nexus.platform === 'win32' ? ['exe'] : undefined,
        multi: false
      })
      if (!files[0]) return
      setSettings(await api.host.setTunnelSettings(serverId, { agentPath: files[0] }))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function toggle(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      if (state?.status === 'running' || state?.status === 'starting') {
        setState(await api.host.stopTunnel(serverId))
      } else {
        setState(await api.host.startTunnel(serverId))
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const live = state?.status === 'running' || state?.status === 'starting'

  return (
    <div className="col gap-12">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="row gap-10">
        <Radio size={16} style={{ color: live ? 'var(--accent)' : 'var(--text-dim)' }} />
        <div className="flex-1">
          <div style={{ fontWeight: 600 }}>Relay, for when the router will not forward</div>
          <div className="tiny dim">
            Try &ldquo;Play with friends online&rdquo; first — it is faster and involves nobody else. Use a relay when
            that fails because your connection shares one public address with the whole neighbourhood.
          </div>
        </div>
      </div>

      {!settings?.agentPath ? (
        <div className="panel panel-pad col gap-10" style={{ background: 'var(--bg-2)' }}>
          <p className="small muted" style={{ margin: 0 }}>
            NexusCraft drives a relay agent you install yourself rather than downloading and running one for you.
            Install the playit.gg agent, sign in to it once, then point the launcher at it — after that, starting and
            stopping it happens with the server.
          </p>
          <div className="row gap-8">
            <button className="btn btn-sm" onClick={() => void api.app.openExternal('https://playit.gg/download')}>
              <ExternalLink size={13} /> Get the agent
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void chooseAgent()}>
              Choose the agent
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="row gap-8 wrap">
            <span className="tiny dim truncate flex-1" style={{ minWidth: 0 }} title={settings.agentPath}>
              {settings.agentPath}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => void chooseAgent()}>
              Change
            </button>
            <button
              className={`btn btn-sm ${live ? 'btn-danger' : 'btn-primary'}`}
              disabled={busy || !onlineMode}
              title={onlineMode ? undefined : 'Turn "Verify players with Mojang" on before opening this up'}
              onClick={() => void toggle()}
            >
              {busy ? <Spinner /> : live ? <Square size={13} /> : <Globe size={13} />}
              {live ? 'Stop the relay' : 'Start the relay'}
            </button>
          </div>

          {state && state.status !== 'stopped' && (
            <div className="panel panel-pad col gap-8" style={{ background: 'var(--bg-2)' }}>
              <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                {state.status === 'starting' && <Spinner />}
                {state.address ? (
                  <>
                    <span className="host-address">{state.address}</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(state.address as string)
                        pushToast({ kind: 'success', title: 'Address copied' })
                      }}
                    >
                      <Copy size={13} /> Copy
                    </button>
                  </>
                ) : (
                  <span className="small muted">{state.detail}</span>
                )}
              </div>

              {state.output.length > 0 && (
                <div
                  className="tiny mono dim"
                  style={{ maxHeight: 110, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}
                >
                  {state.output.slice(-8).join('\n')}
                </div>
              )}
            </div>
          )}

          {!onlineMode && (
            <p className="field-hint">
              This server does not verify players with Mojang, so anyone with the address could join under any name.
              Turn that back on before putting it behind a relay.
            </p>
          )}
        </>
      )}
    </div>
  )
}
