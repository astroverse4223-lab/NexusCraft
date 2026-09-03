import { useCallback, useEffect, useRef, useState } from 'react'
import { Map as MapIcon, X, Loader } from 'lucide-react'
import type { LauncherErrorPayload, WorldMapData } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView } from './ui'

/**
 * A map of a world, drawn from its region files.
 *
 * Shaded relief rather than block colours: heights are cheap to read and colour
 * would mean decoding every chunk's palette. At map scale the trade barely
 * shows — terrain, coastlines, cliffs and anything built all read clearly,
 * because a wall is a sharp change in height and that is exactly what shading
 * picks out.
 */

/** Anything at or below this is drawn as water rather than land. */
const SEA_LEVEL = 62

export function WorldAtlas({
  instanceId,
  folderName,
  worldName,
  onClose
}: {
  instanceId: string
  folderName: string
  worldName: string
  onClose: () => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [map, setMap] = useState<WorldMapData | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.worlds
      .map(instanceId, folderName)
      .then((data) => {
        if (!cancelled) setMap(data)
      })
      .catch((err) => {
        if (!cancelled) setError(toPayload(err))
      })
    return () => {
      cancelled = true
    }
  }, [instanceId, folderName])

  /** The int16 heights arrive as raw bytes; read them back as a typed array. */
  const heightsOf = useCallback((data: WorldMapData): Int16Array => {
    const bytes = data.heights instanceof Uint8Array ? data.heights : new Uint8Array(data.heights)
    return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !map) return
    const context = canvas.getContext('2d')
    if (!context) return

    const heights = heightsOf(map)
    canvas.width = map.width
    canvas.height = map.height

    const image = context.createImageData(map.width, map.height)
    const span = Math.max(1, map.high - map.low)

    for (let z = 0; z < map.height; z += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const index = z * map.width + x
        const value = heights[index]
        const pixel = index * 4

        if (value < 0) {
          // Ungenerated: leave it as the page's own dark ground.
          image.data[pixel] = 12
          image.data[pixel + 1] = 16
          image.data[pixel + 2] = 22
          image.data[pixel + 3] = 255
          continue
        }

        /*
         * Slope shading. Comparing each column with its northern neighbour is
         * what turns a flat height field into something readable — without it
         * the map is a smooth gradient with no features at all.
         */
        const north = z > 0 ? heights[index - map.width] : value
        const slope = Math.max(-6, Math.min(6, value - (north < 0 ? value : north)))
        const lift = slope * 9

        if (value <= SEA_LEVEL) {
          const depth = (SEA_LEVEL - value) / 24
          image.data[pixel] = Math.max(0, 30 - depth * 20)
          image.data[pixel + 1] = Math.max(0, 70 - depth * 40)
          image.data[pixel + 2] = Math.max(40, 150 - depth * 60)
        } else {
          const t = (value - map.low) / span
          // Green lowlands through to pale rock and snow at height.
          const base = 70 + t * 150
          image.data[pixel] = Math.max(0, Math.min(255, base * (0.55 + t * 0.5) + lift))
          image.data[pixel + 1] = Math.max(0, Math.min(255, base * (0.85 + t * 0.2) + lift))
          image.data[pixel + 2] = Math.max(0, Math.min(255, base * (0.45 + t * 0.6) + lift))
        }
        image.data[pixel + 3] = 255
      }
    }

    context.putImageData(image, 0, 0)
  }, [map, heightsOf])

  function describeAt(event: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas || !map) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * map.width)
    const z = Math.floor(((event.clientY - rect.top) / rect.height) * map.height)
    if (x < 0 || z < 0 || x >= map.width || z >= map.height) return setHover(null)

    const value = heightsOf(map)[z * map.width + x]
    const blockX = map.minX + x * map.step
    const blockZ = map.minZ + z * map.step
    setHover(value < 0 ? `${blockX}, ?, ${blockZ} — not generated` : `${blockX}, ${value}, ${blockZ}`)
  }

  return (
    <div className="panel panel-pad col gap-12">
      <div className="row gap-8">
        <MapIcon size={16} className="dim" />
        <strong className="flex-1">{worldName}</strong>
        {map && (
          <span className="tiny dim">
            {map.regions} regions · {map.chunks.toLocaleString()} chunks · {map.step} blocks/px
          </span>
        )}
        <button className="btn btn-sm btn-ghost" onClick={onClose} title="Close the map">
          <X size={14} />
        </button>
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      {!map && !error && (
        <div className="row gap-8 muted" style={{ padding: 20 }}>
          <Loader size={15} className="spin" /> Reading region files…
        </div>
      )}

      {map && (
        <>
          <div style={{ overflow: 'auto', maxHeight: 560, borderRadius: 10, border: '1px solid var(--border)' }}>
            <canvas
              ref={canvasRef}
              onMouseMove={describeAt}
              onMouseLeave={() => setHover(null)}
              style={{ display: 'block', width: '100%', imageRendering: 'pixelated', cursor: 'crosshair' }}
            />
          </div>
          <div className="row gap-12 tiny dim">
            <span className="mono">{hover ?? 'Hover for coordinates'}</span>
            <span className="flex-1" />
            <span>
              surface {map.low} to {map.high}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
