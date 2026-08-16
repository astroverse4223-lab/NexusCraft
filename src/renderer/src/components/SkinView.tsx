import { useEffect, useRef } from 'react'
import { User } from 'lucide-react'

/**
 * Skin rendering.
 *
 * The launcher never loads a remote image: the main process fetches the skin
 * texture and hands the renderer a data URL, which is then sliced here with
 * nearest-neighbour sampling so the pixel art stays crisp.
 */

interface Region {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

/** UV regions of the front-facing body parts on a 64x64 skin sheet. */
function bodyRegions(slim: boolean): { base: Region[]; overlay: Region[] } {
  const armWidth = slim ? 3 : 4
  // Layout is 16 units wide, 32 tall, in "skin pixels".
  const armX = slim ? 4.5 : 4

  const base: Region[] = [
    { sx: 8, sy: 8, sw: 8, sh: 8, dx: 4, dy: 0, dw: 8, dh: 8 }, // head
    { sx: 20, sy: 20, sw: 8, sh: 12, dx: 4, dy: 8, dw: 8, dh: 12 }, // body
    { sx: 44, sy: 20, sw: armWidth, sh: 12, dx: 12, dy: 8, dw: armWidth, dh: 12 }, // right arm
    { sx: 36, sy: 52, sw: armWidth, sh: 12, dx: armX - armWidth + 4 - (slim ? -0.5 : 0), dy: 8, dw: armWidth, dh: 12 }, // left arm
    { sx: 4, sy: 20, sw: 4, sh: 12, dx: 8, dy: 20, dw: 4, dh: 12 }, // right leg
    { sx: 20, sy: 52, sw: 4, sh: 12, dx: 4, dy: 20, dw: 4, dh: 12 } // left leg
  ]

  const overlay: Region[] = [
    { sx: 40, sy: 8, sw: 8, sh: 8, dx: 4, dy: 0, dw: 8, dh: 8 }, // hat
    { sx: 20, sy: 36, sw: 8, sh: 12, dx: 4, dy: 8, dw: 8, dh: 12 }, // jacket
    { sx: 44, sy: 36, sw: armWidth, sh: 12, dx: 12, dy: 8, dw: armWidth, dh: 12 },
    { sx: 52, sy: 52, sw: armWidth, sh: 12, dx: armX - armWidth + 4 - (slim ? -0.5 : 0), dy: 8, dw: armWidth, dh: 12 },
    { sx: 4, sy: 36, sw: 4, sh: 12, dx: 8, dy: 20, dw: 4, dh: 12 },
    { sx: 4, sy: 52, sw: 4, sh: 12, dx: 4, dy: 20, dw: 4, dh: 12 }
  ]

  return { base, overlay }
}

function useSkinCanvas(
  skinDataUrl: string | null | undefined,
  draw: (context: CanvasRenderingContext2D, image: HTMLImageElement, scale: number) => void,
  deps: unknown[]
): React.RefObject<HTMLCanvasElement> {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !skinDataUrl) return
    const context = canvas.getContext('2d')
    if (!context) return

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const cssWidth = canvas.clientWidth
      const cssHeight = canvas.clientHeight
      canvas.width = Math.floor(cssWidth * dpr)
      canvas.height = Math.floor(cssHeight * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, cssWidth, cssHeight)
      // Nearest-neighbour: a smoothed Minecraft skin looks broken.
      context.imageSmoothingEnabled = false
      draw(context, image, cssWidth)
    }
    image.src = skinDataUrl

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinDataUrl, ...deps])

  return ref
}

/* ----------------------------------------------------------------- face */

interface FaceProps {
  skinDataUrl: string | null | undefined
  size?: number
  radius?: number
  /** Draws the outer "hat" layer over the face. */
  overlay?: boolean
}

/** The 8x8 face crop, as used for avatars throughout the launcher. */
export function SkinFace({ skinDataUrl, size = 40, radius = 10, overlay = true }: FaceProps): JSX.Element {
  const ref = useSkinCanvas(
    skinDataUrl,
    (context, image, width) => {
      const scale = width / 8
      context.drawImage(image, 8, 8, 8, 8, 0, 0, 8 * scale, 8 * scale)
      if (overlay) context.drawImage(image, 40, 8, 8, 8, 0, 0, 8 * scale, 8 * scale)
    },
    [overlay, size]
  )

  if (!skinDataUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--panel-strong)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          flexShrink: 0
        }}
      >
        <User size={size * 0.5} />
      </div>
    )
  }

  return (
    <canvas
      ref={ref}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        border: '1px solid var(--border)',
        background: 'var(--bg-2)',
        flexShrink: 0
      }}
    />
  )
}

/* ----------------------------------------------------------------- body */

interface BodyProps {
  skinDataUrl: string | null | undefined
  variant?: 'classic' | 'slim'
  height?: number
  /** Adds a soft ground shadow and rim light. */
  dramatic?: boolean
}

/** A front-on full-body portrait assembled from the skin's UV regions. */
export function SkinBody({ skinDataUrl, variant = 'classic', height = 260, dramatic }: BodyProps): JSX.Element {
  const ref = useSkinCanvas(
    skinDataUrl,
    (context, image, width) => {
      const canvasHeight = (width / 16) * 32
      const scale = canvasHeight / 32
      const offsetX = (width - 16 * scale) / 2
      const { base, overlay } = bodyRegions(variant === 'slim')

      if (dramatic) {
        // Ground shadow anchors the figure instead of leaving it floating.
        context.save()
        context.globalAlpha = 0.34
        context.filter = 'blur(6px)'
        context.fillStyle = '#000'
        context.beginPath()
        context.ellipse(width / 2, 31.4 * scale, 5.4 * scale, 1.1 * scale, 0, 0, Math.PI * 2)
        context.fill()
        context.restore()
        context.imageSmoothingEnabled = false
      }

      const paint = (regions: Region[]): void => {
        for (const r of regions) {
          context.drawImage(
            image,
            r.sx,
            r.sy,
            r.sw,
            r.sh,
            offsetX + r.dx * scale,
            r.dy * scale,
            r.dw * scale,
            r.dh * scale
          )
        }
      }

      paint(base)
      paint(overlay)
    },
    [variant, height, dramatic]
  )

  const width = (height / 32) * 16

  if (!skinDataUrl) {
    return (
      <div
        style={{
          width,
          height,
          borderRadius: 'var(--radius)',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--panel)',
          border: '1px dashed var(--border)',
          color: 'var(--text-dim)'
        }}
      >
        <User size={44} />
      </div>
    )
  }

  return <canvas ref={ref} style={{ width, height, display: 'block' }} />
}

/* -------------------------------------------------------------- texture */

/** The raw 64x64 sheet, shown in the skin library. */
export function SkinTexture({ dataUrl, size = 96 }: { dataUrl: string; size?: number }): JSX.Element {
  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt=""
      style={{
        imageRendering: 'pixelated',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-2)'
      }}
    />
  )
}
