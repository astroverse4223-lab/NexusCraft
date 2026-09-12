import { type JSX, useEffect, useMemo, useState } from 'react'
import { Eraser, RotateCw, Send, Server, Trash2 } from 'lucide-react'
import {
  COMPONENTS,
  MAX_LAYERS,
  MAX_SIDE,
  blockDataFor,
  componentFor,
  emptyCircuit,
  piecesOf,
  rotate,
  type Circuit,
  type Face,
  type Facing,
  type Placed
} from '@shared/redstone'
import type { HostedServer, HostedServerState, LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from '../components/ui'

/**
 * Laying out redstone, layer by layer, and sending it to a server.
 *
 * Deliberately a designer rather than a generator. A circuit that is nearly
 * right does nothing at all while looking exactly like one that works, so a
 * model inventing them would produce confident rubbish that costs an evening
 * to disbelieve - and I cannot test a circuit in a running game to know the
 * difference. What the app can do properly is carry a layout across without
 * losing a single facing or delay, which is the part that is fiddly by hand.
 *
 * Flat layers rather than a 3D view, because redstone is built in flat layers:
 * a floor of blocks, the wiring on top of it, and a lid where one is needed.
 */
export function RedstoneScreen(): JSX.Element {
  const [circuit, setCircuit] = useState<Circuit>(emptyCircuit)
  const [layer, setLayer] = useState(0)
  const [tool, setTool] = useState('dust')

  const [facing, setFacing] = useState<Facing>('north')
  const [delay, setDelay] = useState(1)
  const [face, setFace] = useState<Face>('floor')
  const [subtract, setSubtract] = useState(false)

  const [servers, setServers] = useState<HostedServer[]>([])
  const [serverId, setServerId] = useState('')
  const [players, setPlayers] = useState<string[]>([])
  const [who, setWho] = useState('')

  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.host.list()
        setServers(list)
        setServerId((was) => (list.some((s) => s.id === was) ? was : (list[0]?.id ?? '')))
      } catch {
        setServers([])
      }
    })()
  }, [])

  useEffect(() => {
    if (!serverId) return

    void (async () => {
      try {
        const states: HostedServerState[] = await api.host.states()
        setPlayers(states.find((state) => state.id === serverId)?.players ?? [])
      } catch {
        setPlayers([])
      }
    })()
  }, [serverId])

  const at = useMemo(() => {
    const map = new Map<string, Placed>()
    for (const placed of circuit.placed) map.set(`${placed.x},${placed.y},${placed.z}`, placed)
    return map
  }, [circuit.placed])

  const put = (x: number, z: number): void => {
    const key = `${x},${layer},${z}`
    const without = circuit.placed.filter((p) => `${p.x},${p.y},${p.z}` !== key)

    if (tool === 'air') {
      setCircuit({ ...circuit, placed: without })
      return
    }

    setCircuit({
      ...circuit,
      placed: [...without, { x, y: layer, z, component: tool, facing, delay, face, subtract }]
    })
  }

  const chosen = componentFor(tool)
  const pieces = piecesOf(circuit)

  const send = async (): Promise<void> => {
    if (!serverId || pieces.length === 0) return

    setBusy(true)
    setSaid(null)
    setError(null)

    try {
      const result = await api.host.sendCircuit(
        serverId,
        circuit.name,
        who,
        pieces.map((piece) => `${piece.dx} ${piece.dy} ${piece.dz} ${piece.data}`)
      )

      setSaid(
        result.sent
          ? `${result.blocks} blocks are in ${who || 'your'} hands in game — stand where you want it and run /paste.`
          : `${result.blocks} blocks saved. Start the server, then /nexus circuit ${circuit.name.toLowerCase()}.`
      )
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
          <div className="eyebrow">Your server</div>
          <h1>Redstone</h1>
          <p className="subtitle">
            Lay a circuit out flat, layer by layer, and send it straight into somebody&apos;s hands in game. Every
            facing and every repeater delay crosses over exactly as set &mdash; which is the part that is tedious to
            rebuild by hand and the part that breaks a circuit when it is wrong.
          </p>
        </div>
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="row gap-24 items-start wrap">
        <div className="col gap-12" style={{ flex: '1 1 420px', minWidth: 340 }}>
          <div className="panel panel-pad col gap-12">
            <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 150px' }}>
                <label className="field-label">Called</label>
                <input
                  className="input"
                  value={circuit.name}
                  onChange={(e) => setCircuit({ ...circuit, name: e.target.value.slice(0, 48) })}
                />
              </div>

              <div className="field" style={{ width: 96 }}>
                <label className="field-label">Layer</label>
                <select className="select" value={layer} onChange={(e) => setLayer(Number(e.target.value))}>
                  {Array.from({ length: circuit.layers }, (_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? 'floor' : `+${i}`}
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn btn-sm" onClick={() => setCircuit(rotate(circuit))}>
                <RotateCw size={14} /> Turn
              </button>

              <button
                className="btn btn-sm"
                disabled={circuit.placed.length === 0}
                onClick={() => setCircuit({ ...circuit, placed: [] })}
              >
                <Trash2 size={14} /> Clear
              </button>
            </div>

            {/*
              The layer below shown faintly under the one being edited.
              Redstone is stacked - dust on a floor, a repeater feeding a lamp
              overhead - and editing a layer blind to what it sits on is how a
              circuit ends up wired through a wall.
            */}
            <div className="redstone-grid" style={{ gridTemplateColumns: `repeat(${circuit.width}, 1fr)` }}>
              {Array.from({ length: circuit.depth }, (_, z) =>
                Array.from({ length: circuit.width }, (_, x) => {
                  const here = at.get(`${x},${layer},${z}`)
                  const below = layer > 0 ? at.get(`${x},${layer - 1},${z}`) : undefined
                  const part = here ? componentFor(here.component) : undefined
                  const under = below ? componentFor(below.component) : undefined

                  return (
                    <button
                      key={`${x}-${z}`}
                      className="redstone-cell"
                      title={here ? blockDataFor(here) : `${x}, ${z}`}
                      onClick={() => put(x, z)}
                      style={{
                        color: part?.colour ?? (under ? 'var(--text-dim)' : 'transparent'),
                        opacity: part ? 1 : under ? 0.35 : 1
                      }}
                    >
                      {part?.mark ?? under?.mark ?? ''}
                      {part?.aim && (
                        <span className="redstone-aim">
                          {here?.facing === 'north'
                            ? '↑'
                            : here?.facing === 'south'
                              ? '↓'
                              : here?.facing === 'east'
                                ? '→'
                                : '←'}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>

            <p className="tiny dim">
              {circuit.width} by {circuit.depth}, {circuit.layers} layers &middot; {pieces.length} block
              {pieces.length === 1 ? '' : 's'} placed. North is up.
            </p>
          </div>
        </div>

        <div className="col gap-12" style={{ width: 300 }}>
          <div className="panel panel-pad col gap-12">
            <div className="section-title">Parts</div>

            <div className="row gap-6 wrap">
              {COMPONENTS.map((component) => (
                <button
                  key={component.id}
                  className={`btn btn-sm${tool === component.id ? ' btn-primary' : ''}`}
                  title={component.label}
                  onClick={() => setTool(component.id)}
                >
                  {component.id === 'air' ? <Eraser size={13} /> : component.mark} {component.label}
                </button>
              ))}
            </div>

            {/*
              Only the settings the chosen part actually has. Offering a delay
              on a piece of dust is a control that does nothing, and a control
              that does nothing is one somebody will assume is broken.
            */}
            {chosen?.aim && !chosen.face && (
              <div className="field">
                <label className="field-label">Points</label>
                <select className="select" value={facing} onChange={(e) => setFacing(e.target.value as Facing)}>
                  <option value="north">north ↑</option>
                  <option value="south">south ↓</option>
                  <option value="east">east →</option>
                  <option value="west">west ←</option>
                </select>
              </div>
            )}

            {chosen?.delay && (
              <div className="field">
                <label className="field-label">Delay (ticks)</label>
                <select className="select" value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {chosen?.mode && (
              <label className="row gap-6 small" style={{ alignItems: 'center' }}>
                <input type="checkbox" checked={subtract} onChange={(e) => setSubtract(e.target.checked)} />
                Subtract mode
              </label>
            )}

            {chosen?.face && (
              <div className="field">
                <label className="field-label">Stuck to</label>
                <select className="select" value={face} onChange={(e) => setFace(e.target.value as Face)}>
                  <option value="floor">the floor</option>
                  <option value="wall">a wall</option>
                  <option value="ceiling">the ceiling</option>
                </select>
              </div>
            )}
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Send it over</div>

            {servers.length === 0 ? (
              <p className="small muted">No server set up here yet.</p>
            ) : (
              <>
                <div className="field">
                  <label className="field-label">Server</label>
                  <select className="select" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                    {servers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field-label">Into whose hands</label>
                  <select className="select" value={who} onChange={(e) => setWho(e.target.value)}>
                    <option value="">whoever runs the command</option>
                    {players.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || pieces.length === 0}
                  onClick={() => void send()}
                >
                  {busy ? <Spinner /> : <Send size={14} />} Send to the server
                </button>

                {said && (
                  <p className="small" style={{ color: 'var(--good, #6ee7a0)', margin: 0 }}>
                    {said}
                  </p>
                )}

                <p className="tiny dim row gap-6">
                  <Server size={12} /> It goes into the clipboard, not the ground &mdash; so it lands where you stand,
                  and <code>/undo</code> takes it away again.
                </p>
              </>
            )}
          </div>

          <div className="panel panel-pad col gap-8">
            <div className="section-title">Size</div>

            <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
              {(
                [
                  ['width', 'Across'],
                  ['depth', 'Deep'],
                  ['layers', 'Layers']
                ] as [keyof Circuit & ('width' | 'depth' | 'layers'), string][]
              ).map(([key, label]) => (
                <div key={key} className="field" style={{ width: 82 }}>
                  <label className="field-label">{label}</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={key === 'layers' ? MAX_LAYERS : MAX_SIDE}
                    value={circuit[key]}
                    onChange={(e) => {
                      const cap = key === 'layers' ? MAX_LAYERS : MAX_SIDE
                      const next = Math.max(1, Math.min(cap, Number(e.target.value) || 1))

                      /*
                       * Shrinking drops what falls outside rather than hiding
                       * it. A block you cannot see but that still gets pasted
                       * is the worst of both.
                       */
                      setCircuit((was) => ({
                        ...was,
                        [key]: next,
                        placed: was.placed.filter(
                          (p) =>
                            p.x < (key === 'width' ? next : was.width) &&
                            p.z < (key === 'depth' ? next : was.depth) &&
                            p.y < (key === 'layers' ? next : was.layers)
                        )
                      }))

                      if (key === 'layers' && layer >= next) setLayer(next - 1)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
