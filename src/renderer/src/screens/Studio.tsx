import { type JSX, useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, Layers, Pipette, RotateCw, Save, Send, Trash2 } from 'lucide-react'
import type { PaletteBlock } from '@shared/blocks'
import type { HostedServer, HostedServerState, Instance, LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from '../components/ui'

/**
 * A place to draw a build, block by block, in the game's own blocks.
 *
 * The launcher used to ship eight structures it had generated, and the person
 * who used them said the houses were ugly and the redstone did not work. That
 * is what comes of writing a build nobody can stand back and look at - so this
 * is the other half of the answer: the app stops making the build and makes
 * the place you make it.
 *
 * Flat layers, one at a time, with the layer below showing through. Minecraft
 * is built that way and it is the only view that can be drawn honestly in two
 * dimensions - a perspective sketch would have to guess at what is hidden.
 */

interface Cell {
  x: number
  y: number
  z: number
  block: string
}

const MAX_SIDE = 48
const MAX_LAYERS = 24

export function StudioScreen({ instance }: { instance: Instance }): JSX.Element {
  const [palette, setPalette] = useState<PaletteBlock[] | null>(null)
  const [group, setGroup] = useState('Stone')
  const [block, setBlock] = useState('stone')

  const [name, setName] = useState('My build')
  const [width, setWidth] = useState(16)
  const [depth, setDepth] = useState(16)
  const [layers, setLayers] = useState(8)
  const [layer, setLayer] = useState(0)

  const [cells, setCells] = useState<Cell[]>([])
  const [erasing, setErasing] = useState(false)

  /** Held while dragging, so a wall is one stroke rather than forty clicks. */
  const painting = useRef(false)

  const [servers, setServers] = useState<HostedServer[]>([])
  const [serverId, setServerId] = useState('')
  const [players, setPlayers] = useState<string[]>([])
  const [who, setWho] = useState('')

  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<'schem' | 'nbt' | null>(null)

  /** Whether a saved file goes to the server's world or the instance's folder. */
  const [toServer, setToServer] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setPalette(await api.blocks.palette(instance.minecraftVersion))
      } catch {
        setPalette([])
      }

      try {
        const list = await api.host.list()
        setServers(list)
        setServerId((was) => (list.some((s) => s.id === was) ? was : (list[0]?.id ?? '')))
      } catch {
        setServers([])
      }
    })()
  }, [instance.minecraftVersion])

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

  useEffect(() => {
    const up = (): void => {
      painting.current = false
    }

    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const at = useMemo(() => {
    const map = new Map<string, Cell>()
    for (const cell of cells) map.set(`${cell.x},${cell.y},${cell.z}`, cell)
    return map
  }, [cells])

  const groups = useMemo(() => [...new Set((palette ?? []).map((entry) => entry.group))], [palette])

  const faceFor = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of palette ?? []) map.set(entry.id, entry.texture)
    return map
  }, [palette])

  const put = (x: number, z: number): void => {
    const key = `${x},${layer},${z}`

    setCells((was) => {
      const without = was.filter((cell) => `${cell.x},${cell.y},${cell.z}` !== key)
      return erasing ? without : [...without, { x, y: layer, z, block }]
    })
  }

  /** Picks up whatever is under the cursor, the way an eyedropper does. */
  const pick = (x: number, z: number): void => {
    const here = at.get(`${x},${layer},${z}`)
    if (here) setBlock(here.block)
  }

  const turn = (): void => {
    setCells((was) => was.map((cell) => ({ ...cell, x: depth - 1 - cell.z, z: cell.x })))

    const wasWidth = width
    setWidth(depth)
    setDepth(wasWidth)
  }

  /*
   * The name field can be emptied, and both buttons send it somewhere that
   * requires one. Without this, clearing the box makes them do nothing at all
   * and say nothing about why - the request is refused before it is read.
   */
  const title = name.trim() || 'Build'

  const send = async (): Promise<void> => {
    if (!serverId || cells.length === 0) return

    setBusy(true)
    setSaid(null)
    setError(null)

    try {
      const result = await api.host.sendCircuit(
        serverId,
        title,
        who,
        cells.map((cell) => `${cell.x} ${cell.y} ${cell.z} minecraft:${cell.block}`)
      )

      setSaid(
        result.sent
          ? `${result.blocks} blocks are in ${who || 'your'} hands — stand where you want it and run /paste.`
          : `${result.blocks} blocks saved. Start the server, then /nexus circuit ${title.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}.`
      )
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const save = async (format: 'schem' | 'nbt'): Promise<void> => {
    if (cells.length === 0) return

    setSaving(format)
    setSaid(null)
    setError(null)

    try {
      await api.blocks.exportBuild({
        name: title,
        cells,
        width,
        depth,
        layers,
        format,
        ...(toServer && serverId ? { serverId } : { instanceId: instance.id })
      })
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setSaving(null)
    }
  }

  const shown = (palette ?? []).filter((entry) => entry.group === group)

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Your server</div>
          <h1>Build studio</h1>
          <p className="subtitle">
            Draw a build layer by layer in the game&apos;s own blocks, then send it straight into somebody&apos;s hands
            in game or keep it as a schematic. The faces are read out of Minecraft {instance.minecraftVersion} itself,
            so what is on screen is what gets placed.
          </p>
        </div>
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="row gap-24 items-start wrap">
        <div className="col gap-12" style={{ flex: '1 1 460px', minWidth: 340 }}>
          <div className="panel panel-pad col gap-12">
            <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 140px' }}>
                <label className="field-label">Called</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value.slice(0, 48))} />
              </div>

              <div className="field" style={{ width: 104 }}>
                <label className="field-label">
                  <Layers size={11} /> Layer
                </label>
                <select className="select" value={layer} onChange={(e) => setLayer(Number(e.target.value))}>
                  {Array.from({ length: layers }, (_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? 'ground' : `+${i}`}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className={`btn btn-sm${erasing ? ' btn-primary' : ''}`}
                onClick={() => setErasing(!erasing)}
                title="Click cells to clear them"
              >
                <Eraser size={14} /> Erase
              </button>

              <button className="btn btn-sm" onClick={turn} title="A quarter turn clockwise">
                <RotateCw size={14} /> Turn
              </button>

              <button className="btn btn-sm" disabled={cells.length === 0} onClick={() => setCells([])}>
                <Trash2 size={14} /> Clear
              </button>
            </div>

            {/*
              Drag to paint. A wall is forty blocks and clicking forty times is
              how a tool stops being used - so the mouse being down is enough,
              and the window-level mouseup means letting go outside the grid
              still ends the stroke.
            */}
            <div
              className="studio-grid"
              style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }}
              onMouseLeave={() => (painting.current = false)}
            >
              {Array.from({ length: depth }, (_, z) =>
                Array.from({ length: width }, (_, x) => {
                  const here = at.get(`${x},${layer},${z}`)
                  const below = layer > 0 ? at.get(`${x},${layer - 1},${z}`) : undefined
                  const face = here ? faceFor.get(here.block) : undefined
                  const under = below ? faceFor.get(below.block) : undefined

                  return (
                    <button
                      key={`${x}-${z}`}
                      className="studio-cell"
                      title={here ? here.block : `${x}, ${z}`}
                      onMouseDown={(e) => {
                        if (e.altKey) {
                          pick(x, z)
                          return
                        }
                        painting.current = true
                        put(x, z)
                      }}
                      onMouseEnter={() => {
                        if (painting.current) put(x, z)
                      }}
                      style={{
                        backgroundImage: face ? `url(${face})` : under ? `url(${under})` : undefined,
                        opacity: face ? 1 : under ? 0.28 : 1
                      }}
                    />
                  )
                })
              )}
            </div>

            <p className="tiny dim">
              {width} by {depth}, {layers} layers &middot; {cells.length} block
              {cells.length === 1 ? '' : 's'} &middot; drag to paint, alt-click to pick up a block. North is up.
            </p>
          </div>
        </div>

        <div className="col gap-12" style={{ width: 320 }}>
          <div className="panel panel-pad col gap-10">
            <div className="section-title">Blocks</div>

            {palette === null ? (
              <Spinner />
            ) : palette.length === 0 ? (
              <p className="small muted">
                No blocks could be read from Minecraft {instance.minecraftVersion}. Download that version once and they
                appear.
              </p>
            ) : (
              <>
                <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
                  {groups.map((one) => (
                    <option key={one} value={one}>
                      {one}
                    </option>
                  ))}
                </select>

                <div className="studio-palette">
                  {shown.map((entry) => (
                    <button
                      key={entry.id}
                      className={`studio-swatch${block === entry.id && !erasing ? ' chosen' : ''}`}
                      title={entry.label}
                      onClick={() => {
                        setBlock(entry.id)
                        setErasing(false)
                      }}
                      style={{ backgroundImage: `url(${entry.texture})` }}
                    />
                  ))}
                </div>

                <span className="tiny dim row gap-6">
                  <Pipette size={12} />
                  {erasing ? 'Erasing' : (palette.find((p) => p.id === block)?.label ?? block)}
                </span>
              </>
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
                    {players.map((player) => (
                      <option key={player} value={player}>
                        {player}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || cells.length === 0}
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
                  <Save size={12} /> It lands in the clipboard rather than the ground, so it goes where you stand and{' '}
                  <code>/undo</code> takes it away again.
                </p>
              </>
            )}
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Keep it as a file</div>

            <p className="small muted">
              A schematic you can load in Litematica or WorldEdit, share, or keep. The two formats are not
              interchangeable: a structure block only reads <code>.nbt</code>, and Litematica wants <code>.schem</code>.
            </p>

            <div className="row gap-8 wrap">
              <button
                className="btn btn-sm"
                disabled={saving !== null || cells.length === 0}
                onClick={() => void save('schem')}
              >
                {saving === 'schem' ? <Spinner /> : <Save size={14} />} .schem
              </button>

              <button
                className="btn btn-sm"
                disabled={saving !== null || cells.length === 0}
                onClick={() => void save('nbt')}
              >
                {saving === 'nbt' ? <Spinner /> : <Save size={14} />} .nbt
              </button>

              {servers.length > 0 && (
                <label className="row gap-6 tiny" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={toServer} onChange={(e) => setToServer(e.target.checked)} />
                  into the server&apos;s world
                </label>
              )}
            </div>

            <p className="tiny dim">
              {toServer && servers.length > 0
                ? 'Written into that server’s own world, which is where a structure block on it reads from.'
                : `Written into ${instance.name}'s schematics folder.`}
            </p>
          </div>

          <div className="panel panel-pad col gap-8">
            <div className="section-title">Size</div>

            <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
              {(
                [
                  ['Across', width, setWidth, MAX_SIDE],
                  ['Deep', depth, setDepth, MAX_SIDE],
                  ['Layers', layers, setLayers, MAX_LAYERS]
                ] as [string, number, (n: number) => void, number][]
              ).map(([label, value, set, cap]) => (
                <div key={label} className="field" style={{ width: 82 }}>
                  <label className="field-label">{label}</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={cap}
                    value={value}
                    onChange={(e) => {
                      const next = Math.max(1, Math.min(cap, Number(e.target.value) || 1))
                      set(next)

                      /*
                       * Shrinking drops what falls outside rather than hiding
                       * it. A block you cannot see but that still gets pasted
                       * is the worst of both.
                       */
                      setCells((was) =>
                        was.filter(
                          (cell) =>
                            cell.x < (label === 'Across' ? next : width) &&
                            cell.z < (label === 'Deep' ? next : depth) &&
                            cell.y < (label === 'Layers' ? next : layers)
                        )
                      )

                      if (label === 'Layers' && layer >= next) setLayer(next - 1)
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
