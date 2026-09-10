/**
 * A 64x64 server icon, drawn, stamped or described.
 *
 * Minecraft reads `server-icon.png` and insists on exactly 64x64, so that is
 * the size worked at throughout — what is on screen is the file, magnified,
 * rather than something that gets resized on the way out and looks different
 * when it arrives.
 *
 * Three ways in, because they suit different people: paint it a pixel at a
 * time, stamp a logo you already have, or describe it and let the AI lay it
 * out. The AI route asks for shapes rather than pixels; asking for a grid of
 * pixels failed every single attempt across both providers, while shapes
 * succeeded on every one.
 *
 * The pixels live in the store, not in this component, so switching tabs and
 * coming back does not throw the work away.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  Eraser,
  Pipette,
  ZoomIn,
  ZoomOut,
  Grid3x3,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  Upload,
  Wand2
} from 'lucide-react'

import type { HostedServer, LauncherErrorPayload } from '@shared/types'
import type { BannerBrain } from '@shared/banners'
import { ICON_PALETTE, ICON_SIZE, type IconArt } from '@shared/icons'
import { drawShape } from '../lib/iconArt'

import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, Spinner } from '../components/ui'
import { PromptChips } from '../components/PromptChips'
import { DesignTools } from '../components/DesignTools'

/**
 * How big one icon pixel is on screen.
 *
 * Nine fits the whole icon in 576 pixels, which is the comfortable default.
 * The rest exist because touching up a stamped photograph at nine pixels to
 * the pixel is guesswork - past twelve the canvas is larger than its box and
 * scrolls, which is the point.
 */
const ZOOM_STEPS = [4, 6, 9, 12, 16, 24, 32]
const DEFAULT_ZOOM = 9

/** How big the canvas's window stays, whatever the zoom inside it. */
const VIEWPORT = 576

/* ---------------------------------------------------------------- drawing */

function blank(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4)
  for (let i = 0; i < ICON_SIZE * ICON_SIZE; i++) {
    pixels[i * 4] = 29
    pixels[i * 4 + 1] = 29
    pixels[i * 4 + 2] = 33
    pixels[i * 4 + 3] = 255
  }
  return pixels
}

function rgb(hexish: string): [number, number, number] {
  return [
    parseInt(hexish.slice(1, 3), 16),
    parseInt(hexish.slice(3, 5), 16),
    parseInt(hexish.slice(5, 7), 16)
  ]
}

/** Paints one pixel, with a brush that can be wider than one. */
function dab(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  colour: string | null,
  size: number
): void {
  const half = Math.floor(size / 2)

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = x + dx
      const py = y + dy
      if (px < 0 || py < 0 || px >= ICON_SIZE || py >= ICON_SIZE) continue

      const at = (py * ICON_SIZE + px) * 4
      if (!colour) {
        /*
         * Erasing clears the pixel rather than painting the background over it.
         *
         * It used to write #1D1D21, which is fine on an empty canvas and wrong
         * everywhere else: over a stamped picture it is indistinguishable from
         * painting with black, which is exactly what it looked like. Minecraft
         * reads the icon's alpha channel, so a cleared pixel really is clear.
         */
        pixels[at] = 0
        pixels[at + 1] = 0
        pixels[at + 2] = 0
        pixels[at + 3] = 0
        continue
      }
      const [r, g, b] = rgb(colour)
      pixels[at] = r
      pixels[at + 1] = g
      pixels[at + 2] = b
      pixels[at + 3] = 255
    }
  }
}

/** Flood fill from a point, so large areas are not painted a pixel at a time. */
function flood(pixels: Uint8ClampedArray, x: number, y: number, colour: string): void {
  const at = (px: number, py: number): number => (py * ICON_SIZE + px) * 4
  const start = at(x, y)

  /*
   * Alpha counts as part of the colour here.
   *
   * Comparing only red, green and blue meant every cleared pixel matched every
   * other pixel that happened to be black, so filling next to an erased area
   * bled straight through it.
   */
  const was = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]]
  const [r, g, b] = rgb(colour)
  if (was[0] === r && was[1] === g && was[2] === b && was[3] === 255) return

  const queue: [number, number][] = [[x, y]]
  while (queue.length) {
    const [cx, cy] = queue.pop() as [number, number]
    if (cx < 0 || cy < 0 || cx >= ICON_SIZE || cy >= ICON_SIZE) continue

    const here = at(cx, cy)
    if (
      pixels[here] !== was[0] ||
      pixels[here + 1] !== was[1] ||
      pixels[here + 2] !== was[2] ||
      pixels[here + 3] !== was[3]
    ) {
      continue
    }

    pixels[here] = r
    pixels[here + 1] = g
    pixels[here + 2] = b
    pixels[here + 3] = 255

    queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
}

/** Draws a described icon onto a 64x64 canvas and reads the pixels back. */
function paintArt(art: IconArt): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return blank()

  ctx.fillStyle = art.background
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE)

  for (const shape of art.shapes) {
    ctx.fillStyle = shape.colour
    ctx.strokeStyle = shape.colour

    drawShape(ctx, shape)
  }

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data
}

/** The pixels as a PNG data URL, which is what both outputs want. */
function toPng(pixels: Uint8ClampedArray): string {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const image = ctx.createImageData(ICON_SIZE, ICON_SIZE)
  image.data.set(pixels)
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/** The same as toPng, named for use where a variable is not in scope. */
const pngOf = toPng

/* ------------------------------------------------------------------ screen */

export function IconMakerScreen(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const stored = useStore((s) => s.iconPixels)
  const setIconPixels = useStore((s) => s.setIconPixels)
  const name = useStore((s) => s.iconName)
  const setIconName = useStore((s) => s.setIconName)

  const pixels = useMemo(() => stored ?? blank(), [stored])

  const [colour, setColour] = useState(ICON_PALETTE[7])
  const [tool, setTool] = useState<'paint' | 'erase' | 'fill' | 'pick'>('paint')
  const [brush, setBrush] = useState(1)
  const [grid, setGrid] = useState(true)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  const [brains, setBrains] = useState<BannerBrain[] | null>(null)
  const [brainId, setBrainId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [designing, setDesigning] = useState(false)

  const [servers, setServers] = useState<HostedServer[]>([])
  const [serverId, setServerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const painting = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [available, hosted] = await Promise.all([api.banners.brains(), api.host.list()])
        setBrains(available)
        setServers(hosted)
        const usable = available.find((b) => b.ready)
        if (usable) setBrainId(usable.id)
        if (hosted.length) setServerId(hosted[0].id)
      } catch (err) {
        setError(toPayload(err))
        setBrains([])
      }
    })()
  }, [])

  /* Redraw whenever the pixels change. */
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return

    const buffer = document.createElement('canvas')
    buffer.width = ICON_SIZE
    buffer.height = ICON_SIZE
    const inner = buffer.getContext('2d')
    if (!inner) return

    const image = inner.createImageData(ICON_SIZE, ICON_SIZE)
    image.data.set(pixels)
    inner.putImageData(image, 0, 0)

    const size = ICON_SIZE * zoom
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, size, size)

    /*
     * A chequerboard under the icon, so a cleared pixel reads as cleared.
     *
     * Without it there is no way to tell an erased pixel from a black one -
     * which is the same confusion the eraser itself used to cause.
     */
    const tile = Math.max(4, zoom)
    for (let y = 0; y < size; y += tile) {
      for (let x = 0; x < size; x += tile) {
        const dark = ((x / tile) + (y / tile)) % 2 === 1
        ctx.fillStyle = dark ? '#2a2a2e' : '#3a3a40'
        ctx.fillRect(x, y, tile, tile)
      }
    }

    ctx.drawImage(buffer, 0, 0, size, size)

    if (!grid) return

    const rule = (every: number, ink: string): void => {
      ctx.strokeStyle = ink
      ctx.lineWidth = 1
      for (let i = 0; i <= ICON_SIZE; i += every) {
        ctx.beginPath()
        ctx.moveTo(i * zoom + 0.5, 0)
        ctx.lineTo(i * zoom + 0.5, size)
        ctx.moveTo(0, i * zoom + 0.5)
        ctx.lineTo(size, i * zoom + 0.5)
        ctx.stroke()
      }
    }

    /*
     * A line between every pixel, but only once they are big enough to see
     * between. Below twelve the lines are a larger share of the pixel than the
     * pixel is, and the icon disappears behind its own grid.
     */
    if (zoom >= 12) rule(1, 'rgba(255, 255, 255, 0.06)')
    rule(8, 'rgba(255, 255, 255, 0.14)')
  }, [pixels, grid, zoom])

  /*
   * Ctrl and the wheel, as every other pixel editor does it.
   *
   * Attached by hand rather than with onWheel because React's wheel listener
   * is passive, and a passive listener may not call preventDefault - so the
   * page scrolls behind the zoom.
   */
  useEffect(() => {
    const box = viewportRef.current
    if (!box) return

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      setZoom((was) => {
        const at = ZOOM_STEPS.indexOf(was)
        const to = event.deltaY < 0 ? at + 1 : at - 1
        return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, to))]
      })
    }

    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [])

  /** The colour of one pixel, as the swatches and the colour input want it. */
  const colourAt = useCallback(
    (x: number, y: number): string => {
      const at = (y * ICON_SIZE + x) * 4
      const hex = (v: number): string => v.toString(16).padStart(2, '0')
      return `#${hex(pixels[at])}${hex(pixels[at + 1])}${hex(pixels[at + 2])}`
    },
    [pixels]
  )

  /** Applies a change and pushes the new pixels into the store. */
  const change = useCallback(
    (apply: (next: Uint8ClampedArray) => void) => {
      const next = new Uint8ClampedArray(pixels)
      apply(next)
      setIconPixels(next)
    },
    [pixels, setIconPixels]
  )

  const at = (event: React.MouseEvent<HTMLCanvasElement>): [number, number] | null => {
    const box = canvasRef.current?.getBoundingClientRect()
    if (!box) return null
    const x = Math.floor(((event.clientX - box.left) / box.width) * ICON_SIZE)
    const y = Math.floor(((event.clientY - box.top) / box.height) * ICON_SIZE)
    if (x < 0 || y < 0 || x >= ICON_SIZE || y >= ICON_SIZE) return null
    return [x, y]
  }

  const touch = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const spot = at(event)
    if (!spot) return
    const [x, y] = spot

    /*
     * Holding alt picks a colour whatever tool is selected.
     *
     * The same shortcut every pixel editor uses, and the reason the eyedropper
     * is quick to use rather than a third thing to keep switching to: sample,
     * carry on painting, without the round trip through the toolbar.
     */
    if (tool === 'pick' || event.altKey) {
      setColour(colourAt(x, y))
      if (tool === 'pick') setTool('paint')
      return
    }

    if (tool === 'fill') change((next) => flood(next, x, y, colour))
    else change((next) => dab(next, x, y, tool === 'erase' ? null : colour, brush))
  }

  /*
   * Read in the renderer through a file input rather than through the main
   * process.
   *
   * The native picker hands back a path, and the sandboxed renderer cannot open
   * a path - it would need a new IPC channel whose whole job is to read an
   * arbitrary file off the disk and hand back its bytes, which is a wider door
   * than this feature needs. A file input gives the browser the file directly.
   */
  const stamp = async (file: File): Promise<void> => {
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

      const canvas = document.createElement('canvas')
      canvas.width = ICON_SIZE
      canvas.height = ICON_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#1D1D21'
      ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE)

      // Fit rather than stretch: a squashed logo is worse than a bordered one.
      const scale = Math.min(ICON_SIZE / image.width, ICON_SIZE / image.height)
      const w = image.width * scale
      const h = image.height * scale
      ctx.drawImage(image, (ICON_SIZE - w) / 2, (ICON_SIZE - h) / 2, w, h)

      setIconPixels(ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data)
    } catch (err) {
      setError(toPayload(err))
    }
  }

  /* The text is a parameter so a suggestion chip does not ask with the last one. */
  /** Puts a saved PNG back on the canvas. */
  const loadPng = useCallback(
    (dataUrl: string) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = ICON_SIZE
        canvas.height = ICON_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE)
        setIconPixels(ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data)
      }
      image.src = dataUrl
    },
    [setIconPixels]
  )

  const ask = async (text?: string): Promise<void> => {
    const wanted = (text ?? prompt).trim()
    if (!wanted || !brainId) return
    if (text) setPrompt(text)

    setDesigning(true)
    setError(null)
    try {
      const result = await api.banners.designIcon(wanted, brainId)
      setIconPixels(paintArt(result.art))
      setIconName(result.art.name)
      if (result.dropped > 0) {
        pushToast({
          kind: 'info',
          title: 'Some shapes were skipped',
          message: `${result.model} described ${result.dropped} shape${
            result.dropped === 1 ? '' : 's'
          } that could not be drawn. The rest was kept.`
        })
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setDesigning(false)
    }
  }

  const apply = async (): Promise<void> => {
    if (!serverId) return
    setBusy(true)
    try {
      await api.banners.icon(serverId, toPng(pixels))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await api.app.pickSavePath({
        title: 'Save the server icon',
        defaultName: 'server-icon.png',
        extensions: ['png']
      })
      if (path) await api.banners.save(path, toPng(pixels))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = brains?.filter((b) => b.ready) ?? []

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Your server</div>
          <h1>Server Icon Maker</h1>
          <p className="subtitle">
            Make the 64x64 icon your server shows in the multiplayer list. Draw it a pixel at a
            time, stamp a logo you already have, or describe it and let the AI lay it out — then
            put it straight onto the server.
          </p>
        </div>
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="row gap-24 items-start wrap">
        {/* ------------------------------------------------------- canvas */}
        <div className="col gap-12">
          <div className="panel panel-pad col gap-12">
            {/*
              * A fixed window onto a canvas that grows with the zoom.
              *
              * The canvas keeps one screen pixel per canvas pixel at every
              * zoom - no CSS scaling - so what is drawn is what is stored, and
              * the box scrolls once the canvas outgrows it.
              */}
            <div
              ref={viewportRef}
              style={{
                width: '100%',
                maxWidth: VIEWPORT,
                maxHeight: VIEWPORT,
                overflow: 'auto',
                borderRadius: 8
              }}
            >
              <canvas
                ref={canvasRef}
                width={ICON_SIZE * zoom}
                height={ICON_SIZE * zoom}
                onMouseDown={(e) => {
                  painting.current = true
                  touch(e)
                }}
                onMouseMove={(e) => {
                  if (painting.current && tool !== 'fill') touch(e)
                }}
                onMouseUp={() => (painting.current = false)}
                onMouseLeave={() => (painting.current = false)}
                style={{
                  display: 'block',
                  cursor: 'crosshair',
                  imageRendering: 'pixelated',
                  width: ICON_SIZE * zoom,
                  height: ICON_SIZE * zoom
                }}
              />
            </div>

            <div className="row gap-8" style={{ alignItems: 'center' }}>
              <button
                className="btn btn-sm"
                disabled={zoom === ZOOM_STEPS[0]}
                onClick={() => setZoom(ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(zoom) - 1)])}
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="tiny dim" style={{ minWidth: 54, textAlign: 'center' }}>
                {zoom}x
              </span>
              <button
                className="btn btn-sm"
                disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                onClick={() =>
                  setZoom(
                    ZOOM_STEPS[
                      Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(zoom) + 1)
                    ]
                  )
                }
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
              <button
                className="btn btn-sm"
                disabled={zoom === DEFAULT_ZOOM}
                onClick={() => setZoom(DEFAULT_ZOOM)}
                title="Back to the whole icon"
              >
                Fit
              </button>
              <span className="tiny dim">Ctrl and the wheel zooms too.</span>
            </div>

            <div className="row gap-8 wrap">
              <button
                className={tool === 'paint' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setTool('paint')}
              >
                Paint
              </button>
              <button
                className={tool === 'fill' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setTool('fill')}
              >
                Fill
              </button>
              <button
                className={tool === 'erase' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setTool('erase')}
              >
                <Eraser size={14} /> Erase
              </button>
              <button
                className={tool === 'pick' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setTool('pick')}
                title="Take a colour from the icon — or hold Alt and click"
              >
                <Pipette size={14} /> Pick
              </button>

              <span className="tiny dim" style={{ marginLeft: 8 }}>
                Brush
              </span>
              {[1, 3, 5].map((size) => (
                <button
                  key={size}
                  className={brush === size ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                  onClick={() => setBrush(size)}
                >
                  {size}
                </button>
              ))}

              <button
                className={grid ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setGrid((g) => !g)}
                title="Show an eight-pixel grid"
              >
                <Grid3x3 size={14} />
              </button>
              <button className="btn btn-sm" onClick={() => setIconPixels(blank())} title="Clear">
                <Trash2 size={14} />
              </button>
            </div>

            <div className="row gap-8 wrap">
              {ICON_PALETTE.map((swatch) => (
                <button
                  key={swatch}
                  title={swatch}
                  onClick={() => {
                    setColour(swatch)
                    if (tool === 'erase') setTool('paint')
                  }}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 5,
                    background: swatch,
                    cursor: 'pointer',
                    border:
                      swatch === colour
                        ? '2px solid var(--text, #fff)'
                        : '1px solid rgba(0,0,0,0.35)'
                  }}
                />
              ))}
              <span
                title={`Painting with ${colour}`}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  background: colour,
                  border: '2px solid var(--text, #fff)'
                }}
              />
              <input
                type="color"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                title="Any other colour"
                style={{
                  width: 32,
                  height: 24,
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer'
                }}
              />
            </div>
          </div>
        </div>

        {/* -------------------------------------------------------- panel */}
        {/*
          * The three panels sit beside one another and wrap when they must.
          *
          * Stacked in one narrow column they ran off the bottom of the window
          * while most of the width sat empty, so reaching "Use it" meant
          * scrolling past everything else.
          */}
        <div className="row gap-12 wrap items-start" style={{ flex: '1 1 340px' }}>
          <div className="panel panel-pad col gap-12" style={{ flex: '1 1 300px' }}>
            <div className="section-title">
              <Wand2 size={15} /> Describe it
            </div>

            {brains === null ? (
              <Spinner />
            ) : ready.length === 0 ? (
              <p className="small muted">
                No AI is set up yet. Add one on the AI Companion tab — Ollama runs on this PC for
                free — or draw the icon yourself.
              </p>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="a glowing blue crystal on a dark background"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void ask()
                  }}
                />
                <select
                  className="input"
                  value={brainId}
                  onChange={(e) => setBrainId(e.target.value)}
                >
                  {ready.map((brain) => (
                    <option key={brain.id} value={brain.id}>
                      {brain.label} — {brain.model}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  disabled={designing || !prompt.trim()}
                  onClick={() => void ask()}
                >
                  {designing ? <Spinner /> : <Sparkles size={15} />} Design it
                </button>
                <PromptChips kind="icon" disabled={designing} onPick={(text) => void ask(text)} />

                <p className="tiny dim">
                  It lays the icon out as shapes. A big model takes half a minute and is worth the
                  wait; a small local one answers in seconds but draws more crudely.
                </p>
              </>
            )}
          </div>

          {/*
            * Saved as a PNG rather than as shapes.
            *
            * What is on the canvas may have been painted, stamped from a
            * photograph, or drawn from shapes and then edited - only the
            * pixels are true of all three.
            */}
          <div style={{ flex: '1 1 300px' }}>
            <DesignTools
              kind="icon"
              design={{ png: toPng(pixels) }}
              name={name || 'Server icon'}
              prompt={prompt}
              brainId={brainId}
              busy={designing}
              thumbnail={() => toPng(pixels)}
              onLoad={(d) => {
                const art = d as { png?: string } | IconArt
                if ('png' in art && art.png) loadPng(art.png)
                else setIconPixels(paintArt(art as IconArt))
              }}
              onError={setError}
              preview={(d) => {
                const art = d as { png?: string } | IconArt
                const url =
                  'png' in art && art.png ? art.png : pngOf(paintArt(art as IconArt))
                return (
                  <img
                    src={url}
                    alt=""
                    style={{ width: 96, height: 96, imageRendering: 'pixelated', borderRadius: 6 }}
                  />
                )
              }}
            />
          </div>

          <div className="panel panel-pad col gap-12" style={{ flex: '1 1 300px' }}>
            <div className="section-title">
              <Upload size={15} /> Stamp a picture
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void stamp(file)
                // Cleared so choosing the same file twice still fires a change.
                e.target.value = ''
              }}
            />
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              <ImageIcon size={14} /> Choose a picture…
            </button>
            <p className="tiny dim">
              Scaled to fit 64x64 without squashing it. Draw over it afterwards if you like.
            </p>
          </div>

          <div className="panel panel-pad col gap-12" style={{ flex: '1 1 300px' }}>
            <div className="section-title">Use it</div>

            {name && <p className="tiny dim">{name}</p>}

            {servers.length === 0 ? (
              <p className="small muted">No server is set up here yet — you can still save it.</p>
            ) : (
              <select
                className="input"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !serverId}
              onClick={() => void apply()}
            >
              <ImageIcon size={14} /> Set as this server&apos;s icon
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void download()}>
              <Download size={14} /> Save as PNG
            </button>
            <p className="tiny dim">
              Minecraft reads server-icon.png when the server starts, so restart it to see the
              change.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
