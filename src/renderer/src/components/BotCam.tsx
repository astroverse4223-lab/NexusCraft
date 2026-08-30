import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Heart, Drumstick } from 'lucide-react'
import type { CameraFrame } from '@shared/companion'
import { api, subscribe } from '../api'

/**
 * Bot cam — a live look at what the companion has around it.
 *
 * Drawn from the block data the bot navigates by rather than a rendered 3D
 * scene: a photographic view would need a GL context and a texture atlas, which
 * the sandboxed, strict-CSP renderer has no way to run. What is here is what
 * the bot actually knows, which is the more useful answer to "why is it stuck?"
 * anyway — you can see the wall it is behind.
 */

/**
 * Block colours, by longest-matching suffix or keyword.
 *
 * Matching on fragments rather than exact names means the thousand blocks
 * added since this was written still land somewhere sensible: anything ending
 * "_leaves" is green without being listed.
 */
const PALETTE: Array<[RegExp, string]> = [
  [/water|bubble/, '#2a4d8f'],
  [/lava|magma/, '#c1440e'],
  [/grass_block|moss|podzol/, '#5c8b3f'],
  [/_leaves|azalea|vine/, '#3f7a35'],
  [/_log|_wood|stem|hyphae/, '#6b4a2b'],
  [/_planks|bookshelf|barrel|crafting/, '#a3763f'],
  [/sand(?!stone)|red_sand/, '#ded3a0'],
  [/sandstone/, '#cbbd86'],
  [/gravel|clay|coarse_dirt|dirt|farmland|mud/, '#7a6247'],
  [/snow|powder_snow/, '#e9f0f5'],
  [/ice|frosted/, '#9dc6e0'],
  [/cobblestone|andesite|diorite|granite|tuff|deepslate|stone|basalt/, '#7d7f83'],
  [/obsidian|bedrock/, '#231f2e'],
  [/coal_ore/, '#3a3a3a'],
  [/iron_ore|copper/, '#b98a5e'],
  [/gold_ore|gold_block/, '#d8b34a'],
  [/diamond|emerald/, '#4fd0c0'],
  [/redstone/, '#a02323'],
  [/glass|barrier/, '#bcd8e6'],
  [/wool|carpet|concrete|terracotta/, '#b06a6a'],
  [/netherrack|nether_brick|crimson|warped|soul/, '#6d3236'],
  [/end_stone|purpur/, '#ddd8a8'],
  [/torch|lantern|glowstone|shroomlight|campfire/, '#f2c14e'],
  [/door|fence|gate|stairs|slab/, '#8a6a3f'],
  [/chest|furnace|anvil/, '#8a6f4a'],
  [/flower|tulip|poppy|dandelion|rose|lilac|peony/, '#c86fa8'],
  [/wheat|crop|carrot|potato|beetroot|melon|pumpkin/, '#c2a63c'],
  [/tall_grass|fern|bush|sapling|seagrass|kelp/, '#6fa04a']
]

const UNKNOWN_COLOUR = '#12161d'
const FALLBACK_COLOUR = '#6e737a'

const colourCache = new Map<string, string>()

function colourFor(block: string): string {
  if (!block) return UNKNOWN_COLOUR
  const cached = colourCache.get(block)
  if (cached) return cached

  let colour = FALLBACK_COLOUR
  for (const [pattern, value] of PALETTE) {
    if (pattern.test(block)) {
      colour = value
      break
    }
  }
  colourCache.set(block, colour)
  return colour
}

/** Lightens or darkens a hex colour by `amount` (-1..1), for height shading. */
function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift: number): number => {
    const base = (value >> shift) & 0xff
    const moved = amount >= 0 ? base + (255 - base) * amount : base * (1 + amount)
    return Math.max(0, Math.min(255, Math.round(moved)))
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

const ENTITY_COLOURS: Record<CameraFrame['entities'][number]['kind'], string> = {
  player: '#5eead4',
  hostile: '#f2555a',
  passive: '#f2c14e',
  item: '#c084fc',
  other: '#9aa3ad'
}

export function BotCam({ companionId, running }: { companionId: string; running: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [on, setOn] = useState(false)
  const [frame, setFrame] = useState<CameraFrame | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  /* Only one companion streams at a time, and only while this is open. */
  useEffect(() => {
    if (!on || !running) return
    void api.companion.camera(companionId, true).catch(() => undefined)
    return () => {
      void api.companion.camera(companionId, false).catch(() => undefined)
    }
  }, [companionId, on, running])

  // Stop streaming if the companion is stopped from elsewhere.
  useEffect(() => {
    if (!running) {
      setOn(false)
      setFrame(null)
    }
  }, [running])

  useEffect(() => {
    return subscribe('companion:camera', (payload: { companionId: string; frame: CameraFrame }) => {
      if (payload.companionId === companionId) setFrame(payload.frame)
    })
  }, [companionId])

  /* ------------------------------------------------------------- drawing */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    const context = canvas.getContext('2d')
    if (!context) return

    const { size, columns, heights } = frame
    const cell = canvas.width / size

    // Height range drives the shading, so a flat plain is not all one colour.
    let low = Infinity
    let high = -Infinity
    for (let i = 0; i < heights.length; i += 1) {
      if (!columns[i]) continue
      if (heights[i] < low) low = heights[i]
      if (heights[i] > high) high = heights[i]
    }
    const span = Math.max(1, high - low)

    context.fillStyle = UNKNOWN_COLOUR
    context.fillRect(0, 0, canvas.width, canvas.height)

    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = z * size + x
        const block = columns[index]
        if (!block) continue

        // -0.35..+0.35, so height reads without washing the colour out.
        const relative = (heights[index] - low) / span - 0.5
        context.fillStyle = shade(colourFor(block), relative * 0.7)
        context.fillRect(Math.floor(x * cell), Math.floor(z * cell), Math.ceil(cell), Math.ceil(cell))
      }
    }

    const centre = canvas.width / 2

    /*
     * Which way the bot is looking. Minecraft yaw is 0 at south (+z) and turns
     * anticlockwise, while the canvas has +z running down the screen — hence
     * the sign flip rather than a plain rotation.
     */
    const facing = -frame.yaw
    context.strokeStyle = 'rgba(94, 234, 212, 0.55)'
    context.fillStyle = 'rgba(94, 234, 212, 0.16)'
    context.beginPath()
    context.moveTo(centre, centre)
    context.arc(centre, centre, cell * 7, facing - Math.PI / 2 - 0.5, facing - Math.PI / 2 + 0.5)
    context.closePath()
    context.fill()
    context.stroke()

    for (const entity of frame.entities) {
      const x = centre + entity.dx * cell
      const z = centre + entity.dz * cell
      context.fillStyle = ENTITY_COLOURS[entity.kind]
      context.beginPath()
      context.arc(x, z, entity.kind === 'item' ? cell * 0.5 : cell * 0.9, 0, Math.PI * 2)
      context.fill()
    }

    // The bot itself, drawn last so nothing covers it.
    context.fillStyle = '#ffffff'
    context.strokeStyle = '#0b0f16'
    context.lineWidth = 1.5
    context.beginPath()
    context.arc(centre, centre, cell * 1.1, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }, [frame])

  function describeAt(event: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    const rect = canvas.getBoundingClientRect()
    const cell = rect.width / frame.size
    const x = Math.floor((event.clientX - rect.left) / cell)
    const z = Math.floor((event.clientY - rect.top) / cell)
    if (x < 0 || z < 0 || x >= frame.size || z >= frame.size) return setHover(null)

    const index = z * frame.size + x
    const block = frame.columns[index]
    const radius = Math.floor(frame.size / 2)
    setHover(
      block
        ? `${block} · ${frame.origin.x + x - radius}, ${frame.heights[index]}, ${frame.origin.z + z - radius}`
        : 'not loaded'
    )
  }

  return (
    <div className="panel panel-pad col gap-12">
      <div className="row gap-8">
        <strong className="flex-1">Bot cam</strong>
        {frame && (
          <>
            <span className="pill" title="Health">
              <Heart size={11} /> {frame.health}
            </span>
            <span className="pill" title="Food">
              <Drumstick size={11} /> {frame.food}
            </span>
          </>
        )}
        <button
          className={`btn btn-sm ${on ? '' : 'btn-primary'}`}
          disabled={!running}
          onClick={() => setOn((value) => !value)}
          title={running ? 'Stream a live view from the bot' : 'Start the companion first'}
        >
          {on ? <EyeOff size={14} /> : <Eye size={14} />}
          {on ? 'Stop' : 'Watch'}
        </button>
      </div>

      {on && frame ? (
        <>
          <canvas
            ref={canvasRef}
            width={420}
            height={420}
            onMouseMove={describeAt}
            onMouseLeave={() => setHover(null)}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              borderRadius: 10,
              border: '1px solid var(--border)',
              imageRendering: 'pixelated',
              cursor: 'crosshair',
              display: 'block'
            }}
          />
          <div className="row gap-12 tiny dim wrap">
            <span className="mono">
              {frame.origin.x}, {frame.origin.y}, {frame.origin.z}
            </span>
            {frame.holding && <span>holding {frame.holding}</span>}
            <span className="flex-1 truncate">{hover ?? `${frame.size}×${frame.size} blocks, top-down`}</span>
          </div>
        </>
      ) : (
        <p className="tiny dim" style={{ margin: 0, lineHeight: 1.6 }}>
          {running
            ? 'Press Watch for a live top-down view of what the companion has around it — terrain, players, mobs and which way it is facing. Useful for seeing why it is stuck.'
            : 'Start the companion to watch what it sees.'}
        </p>
      )}
    </div>
  )
}
