/**
 * Turning a picture into map art.
 *
 * A map item is 128 by 128 coloured squares, so a picture becomes map art by
 * choosing, for each of those squares, the nearest colour the game has. Several
 * maps hung side by side in item frames make a bigger picture; the grid below
 * decides how many.
 *
 * The image is read here rather than in the main process for the same reason
 * the icon maker reads it here: a file input hands the browser the file, where
 * a native picker would hand back a path the sandboxed renderer cannot open.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Trash2, Upload } from 'lucide-react'

import { MAP_SIZE, swatchOf, tiles, toMapBytes } from '@shared/mapArt'
import type { Instance, LauncherErrorPayload, SavedCreation } from '@shared/types'

import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, Spinner } from '../components/ui'

/** Somewhere maps can be written: a hosted server, or one of this instance's saves. */
interface MapTarget {
  id: string
  label: string
  kind: 'server' | 'world'
  serverId?: string
  worldFolder?: string
}

export function MapArtTab({ instance }: { instance: Instance }): JSX.Element {
  /*
   * Servers as well as saves.
   *
   * This listed only the instance's own worlds, which is the one place
   * somebody with a server they run from this launcher would not want it.
   */
  const [targets, setTargets] = useState<MapTarget[]>([])
  const [targetId, setTargetId] = useState('')

  const kept = useStore((state) => state.mapArt)
  const setKept = useStore((state) => state.setMapArt)

  const across = kept.across
  const down = kept.down
  const dither = kept.dither
  const commands = kept.commands

  const setAcross = (n: number): void => setKept({ across: n })
  const setDown = (n: number): void => setKept({ down: n })
  const setDither = (on: boolean): void => setKept({ dither: on })
  const setCommands = (list: string[]): void => setKept({ commands: list })

  const [source, setSource] = useState<HTMLImageElement | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)

  const [saved, setSaved] = useState<SavedCreation[]>([])
  const [name, setName] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const preview = useRef<HTMLCanvasElement>(null)

  /*
   * The picture comes back from the data url it was kept as.
   *
   * An Image is a browser object and does not belong in a store, so what is
   * kept is the encoded picture and this turns it back into one whenever the
   * tab is opened again.
   */
  useEffect(() => {
    if (!kept.image) {
      setSource(null)
      return
    }

    let stale = false
    const image = new Image()
    image.src = kept.image

    void image
      .decode()
      .then(() => {
        if (!stale) setSource(image)
      })
      .catch(() => {
        /* A picture that will not decode is one we cannot show. */
      })

    return () => {
      stale = true
    }
  }, [kept.image])

  const width = across * MAP_SIZE
  const height = down * MAP_SIZE

  useEffect(() => {
    void (async () => {
      const found: MapTarget[] = []

      try {
        for (const server of await api.host.list()) {
          found.push({
            id: `server:${server.id}`,
            label: `${server.name} (server)`,
            kind: 'server',
            serverId: server.id
          })
        }
      } catch {
        /* No servers set up is not an error worth showing here. */
      }

      try {
        for (const entry of await api.worlds.list(instance.id)) {
          found.push({
            id: `world:${entry.folderName}`,
            label: `${entry.name} (${instance.name})`,
            kind: 'world',
            worldFolder: entry.folderName
          })
        }
      } catch (err) {
        setError(toPayload(err))
      }

      setTargets(found)
      setTargetId((was) => (found.some((t) => t.id === was) ? was : (found[0]?.id ?? '')))

      try {
        setSaved(await api.creations.list('mapart'))
      } catch {
        setSaved([])
      }
    })()
  }, [instance.id, instance.name])

  /**
   * Redraws whenever the picture or the shape of the wall changes.
   *
   * The image is scaled to the wall rather than cropped, so what you picked is
   * what goes up - a crop would quietly throw away the edges of somebody's
   * logo and give no sign it had.
   */
  const convert = useCallback(() => {
    if (!source) return

    const scratch = document.createElement('canvas')
    scratch.width = width
    scratch.height = height

    const ctx = scratch.getContext('2d')
    if (!ctx) return

    ctx.drawImage(source, 0, 0, width, height)

    const rgba = ctx.getImageData(0, 0, width, height).data
    const converted = toMapBytes(rgba, width, height, { dither })
    setBytes(converted)

    // And paint what the game will show, colour for colour.
    const canvas = preview.current
    if (!canvas) return

    canvas.width = width
    canvas.height = height

    const out = canvas.getContext('2d')
    if (!out) return

    const picture = out.createImageData(width, height)

    for (let i = 0; i < converted.length; i++) {
      const colour = swatchOf(converted[i])

      picture.data[i * 4] = colour?.r ?? 0
      picture.data[i * 4 + 1] = colour?.g ?? 0
      picture.data[i * 4 + 2] = colour?.b ?? 0
      picture.data[i * 4 + 3] = colour ? 255 : 0
    }

    out.putImageData(picture, 0, 0)
  }, [source, width, height, dither])

  useEffect(() => convert(), [convert])

  const load = async (file: File): Promise<void> => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('that file could not be read'))
        reader.readAsDataURL(file)
      })

      const image = new Image()
      image.src = dataUrl
      await image.decode()

      setSource(image)
      setKept({ image: dataUrl, commands: [] })
    } catch (err) {
      setError(toPayload(err))
    }
  }

  const target = targets.find((t) => t.id === targetId) ?? null

  const install = async (): Promise<void> => {
    if (!bytes || !target) return

    setBusy(true)
    try {
      const cut = tiles(bytes, width, across, down).map((tile) => Array.from(tile))

      const result =
        target.kind === 'server'
          ? await api.mapArt.writeServer(target.serverId as string, cut, across, down)
          : await api.mapArt.write(instance.id, target.worldFolder as string, cut, across, down)

      setCommands(result.commands)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Runs every give on the server, in order.
   *
   * One at a time rather than pasted, because a console line is a command and
   * a list of commands is not one.
   */
  const handOver = async (): Promise<void> => {
    if (target?.kind !== 'server') return

    setBusy(true)
    try {
      for (const command of commands) {
        await api.host.command(target.serverId as string, command.replace(/^\//, ''))
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  /*
   * Frames you cannot see.
   *
   * A filled map fills the whole face of an item frame, so a grid of them is
   * one picture - but an ordinary frame draws a wooden border round every
   * tile, which puts a lattice across the middle of the art. An invisible one
   * shows the map and nothing else, and the seams disappear.
   */
  const frameCommand = `/give @p item_frame[entity_data={id:"minecraft:item_frame",Invisible:1b}] ${across * down}`

  const handFrames = async (): Promise<void> => {
    if (target?.kind !== 'server') return

    setBusy(true)
    try {
      await api.host.command(target.serverId as string, frameCommand.replace(/^\//, ''))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Keeps the picture and the settings, not the converted blocks.
   *
   * The bytes are 16384 numbers a map and would be most of a megabyte for a
   * wall of sixteen; the picture that made them is a few kilobytes and can be
   * rendered again at any size. Saving the source also means a piece kept as
   * one map can be put up as four later.
   */
  const keep = async (): Promise<void> => {
    const canvas = preview.current
    if (!canvas || !source) return

    // Stored at the size it was converted at, so a photograph does not go into
    // the library at its original twelve megapixels.
    const shrunk = document.createElement('canvas')
    shrunk.width = width
    shrunk.height = height

    const ctx = shrunk.getContext('2d')
    if (!ctx) return

    ctx.drawImage(source, 0, 0, width, height)

    try {
      await api.creations.save({
        kind: 'mapart',
        name: name.trim() || 'Map art',
        data: { image: shrunk.toDataURL('image/png'), across, down, dither },
        thumbnail: canvas.toDataURL('image/png')
      })

      setSaved(await api.creations.list('mapart'))
      setName('')
    } catch (err) {
      setError(toPayload(err))
    }
  }

  const openSaved = async (entry: SavedCreation): Promise<void> => {
    const body = entry.data as {
      image?: string
      across?: number
      down?: number
      dither?: boolean
    }

    if (!body?.image) return

    const image = new Image()
    image.src = body.image

    try {
      await image.decode()
    } catch (err) {
      setError(toPayload(err))
      return
    }

    setKept({
      image: body.image,
      across: body.across ?? 1,
      down: body.down ?? 1,
      dither: body.dither !== false,
      commands: []
    })

    setSource(image)
  }

  const maps = across * down

  return (
    <div className="col gap-16">
      <div className="panel panel-pad col gap-8">
        <p className="small muted">
          A picture becomes one or more maps you hang in item frames. Each map is{' '}
          {MAP_SIZE}x{MAP_SIZE} blocks of colour, and the wall below is {width}x{height}.
        </p>
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="row gap-16 items-start wrap">
        <div className="panel panel-pad col gap-12" style={{ flex: '2 1 420px' }}>
          <div
            style={{
              borderRadius: 10,
              padding: 12,
              border: '1px solid var(--border)',
              background: '#15161c',
              display: 'grid',
              placeItems: 'center',
              minHeight: 220
            }}
          >
            {source ? (
              <canvas
                ref={preview}
                style={{
                  width: '100%',
                  maxWidth: 520,
                  display: 'block',
                  imageRendering: 'pixelated'
                }}
              />
            ) : (
              <div className="col gap-8" style={{ alignItems: 'center' }}>
                <ImageIcon size={28} className="dim" />
                <span className="small muted">Choose a picture to see it in map colours</span>
              </div>
            )}
          </div>

          <label className="btn btn-primary btn-sm" style={{ width: 'fit-content' }}>
            <Upload size={14} /> Choose a picture
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void load(file)
              }}
            />
          </label>
        </div>

        <div className="col gap-12" style={{ flex: '1 1 280px' }}>
          <div className="panel panel-pad col gap-12">
            <div className="field">
              <label className="field-label">Maps across</label>
              <select
                className="select"
                value={across}
                onChange={(e) => setAcross(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Maps down</label>
              <select
                className="select"
                value={down}
                onChange={(e) => setDown(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <label className="row gap-8" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={dither}
                onChange={(e) => setDither(e.target.checked)}
              />
              <span className="small">Dither</span>
            </label>

            <p className="tiny dim">
              Dithering mixes nearby colours so a sky reads as a gradient rather than as
              bands. Turn it off for flat artwork and logos.
            </p>
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="field">
              <label className="field-label">Where it goes</label>
              <select
                className="select"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {targets.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !bytes || !target}
              onClick={() => void install()}
            >
              {busy && <Spinner />} Write {maps} map{maps === 1 ? '' : 's'}
            </button>

            <p className="tiny dim">
              {target?.kind === 'server'
                ? 'Written into the server\u2019s world. Stop the server first, then start it again \u2014 a running server holds its map data in memory and would write over this on its next save.'
                : 'Written straight into the world\u2019s data folder. The world must be closed, and the maps appear once you open it again.'}
            </p>
          </div>
        </div>
      </div>

      {source && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Keep it</div>

          <div className="row gap-8 wrap">
            <input
              className="input"
              style={{ flex: '1 1 220px' }}
              value={name}
              placeholder="What to call it"
              onChange={(e) => setName(e.target.value.slice(0, 60))}
            />
            <button className="btn btn-primary btn-sm" onClick={() => void keep()}>
              Save
            </button>
          </div>

          <p className="tiny dim">
            Kept as the picture and the grid, so the same art can go on another server
            later - or up at a different size.
          </p>
        </div>
      )}

      {saved.length > 0 && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Saved</div>

          <div className="row gap-12 wrap">
            {saved.map((entry) => (
              <div key={entry.id} className="col gap-8" style={{ width: 140 }}>
                <button
                  className="btn btn-ghost"
                  title="Open this one"
                  style={{ padding: 4, height: 'auto' }}
                  onClick={() => void openSaved(entry)}
                >
                  {entry.thumbnail ? (
                    <img
                      src={entry.thumbnail}
                      alt={entry.name}
                      style={{
                        width: '100%',
                        borderRadius: 6,
                        display: 'block',
                        imageRendering: 'pixelated'
                      }}
                    />
                  ) : (
                    <span className="tiny">{entry.name}</span>
                  )}
                </button>

                <div className="row gap-8" style={{ alignItems: 'center' }}>
                  <span className="tiny dim truncate" style={{ flex: 1 }}>
                    {entry.name}
                  </span>
                  <button
                    className="btn btn-sm"
                    title="Forget it"
                    onClick={() => {
                      void (async () => {
                        await api.creations.remove(entry.id)
                        setSaved(await api.creations.list('mapart'))
                      })()
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {commands.length > 0 && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Now get them in game</div>

          <p className="small muted">
            Each map goes in an item frame. Place them left to right, top to bottom, in a{' '}
            {across} by {down} grid on a wall. A map in a frame is drawn across the whole
            block face, so the {maps} of them together are one picture.
          </p>

          <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
            {target?.kind === 'server' && (
              <button className="btn btn-sm" disabled={busy} onClick={() => void handFrames()}>
                Give me {maps} invisible frame{maps === 1 ? '' : 's'}
              </button>
            )}
            <button
              className="btn btn-sm"
              title="Copy the frame command"
              onClick={() => void navigator.clipboard.writeText(frameCommand)}
            >
              Copy frame command
            </button>
          </div>

          <p className="tiny dim">
            Ordinary frames draw a wooden border round every tile, which puts a grid across
            the middle of the picture. Invisible ones show the map and nothing else.
          </p>

          {target?.kind === 'server' && (
            <>
              <button
                className="btn btn-primary btn-sm"
                style={{ width: 'fit-content' }}
                disabled={busy}
                onClick={() => void handOver()}
              >
                {busy && <Spinner />} Give me all {commands.length} in game
              </button>

              <p className="tiny dim">
                Runs them on the server console, one at a time. The server has to be
                running and you have to be on it.
              </p>
            </>
          )}

          {/*
            * One button each, not one for all of them.
            *
            * "Copy all" put every command on the clipboard separated by
            * newlines, and Minecraft's chat box is a single line - so pasting
            * it produced "...map_id=4]/give @p..." with the commands run
            * together, and the game refused the lot.
            */}
          <div className="col gap-4">
            {commands.map((command, at) => (
              <div key={command} className="row gap-8" style={{ alignItems: 'center' }}>
                <span className="tiny dim" style={{ width: 18 }}>
                  {at + 1}
                </span>
                <code
                  className="tiny selectable"
                  style={{ flex: 1, wordBreak: 'break-all' }}
                >
                  {command}
                </code>
                <button
                  className="btn btn-sm"
                  title="Copy this one"
                  onClick={() => void navigator.clipboard.writeText(command)}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>

          <p className="tiny dim">
            Copy them one at a time - Minecraft&apos;s chat takes a single command.
          </p>
        </div>
      )}
    </div>
  )
}
