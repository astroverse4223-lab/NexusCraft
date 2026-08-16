import { useEffect, useRef } from 'react'

interface BackgroundProps {
  animated: boolean
  particles: boolean
}

interface Particle {
  x: number
  y: number
  z: number
  size: number
  speed: number
  drift: number
  alpha: number
}

/**
 * The ambient backdrop: three slowly drifting light pools plus a field of
 * rising motes.
 *
 * Everything is drawn on one canvas at a capped frame rate, and the whole loop
 * stops when the window is hidden — an idle launcher should not spin a GPU.
 */
export function Background({ animated, particles }: BackgroundProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    let width = 0
    let height = 0
    let dpr = 1
    let items: Particle[] = []
    let frame = 0
    let lastDraw = 0
    let running = true

    const accent = (): string =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5eead4'

    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Particle count scales with area so a large window is not sparse and a
      // small one is not a blizzard.
      const target = particles ? Math.min(90, Math.floor((width * height) / 22000)) : 0
      items = Array.from({ length: target }, () => spawn(true))
    }

    const spawn = (initial: boolean): Particle => ({
      x: Math.random() * width,
      y: initial ? Math.random() * height : height + 12,
      z: Math.random(),
      size: 0.7 + Math.random() * 1.9,
      speed: 0.12 + Math.random() * 0.45,
      drift: (Math.random() - 0.5) * 0.16,
      alpha: 0.14 + Math.random() * 0.4
    })

    const draw = (time: number): void => {
      if (!running) return
      frame = requestAnimationFrame(draw)

      // ~40fps is plenty for ambient motion and leaves headroom for the game.
      if (time - lastDraw < 25) return
      const delta = Math.min((time - lastDraw) / 16.67, 3)
      lastDraw = time

      context.clearRect(0, 0, width, height)
      const color = accent()
      const t = time / 1000

      /* light pools */
      const pools = [
        { x: 0.18, y: 0.12, r: 0.55, c: color, a: 0.1, sx: 0.05, sy: 0.03 },
        { x: 0.86, y: 0.28, r: 0.45, c: '#818cf8', a: 0.09, sx: -0.04, sy: 0.05 },
        { x: 0.55, y: 0.95, r: 0.6, c: '#c084fc', a: 0.06, sx: 0.03, sy: -0.02 }
      ]

      for (const pool of pools) {
        const cx = (pool.x + (animated ? Math.sin(t * 0.12 + pool.x * 8) * pool.sx : 0)) * width
        const cy = (pool.y + (animated ? Math.cos(t * 0.1 + pool.y * 8) * pool.sy : 0)) * height
        const radius = pool.r * Math.max(width, height) * 0.7

        const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius)
        gradient.addColorStop(0, withAlpha(pool.c, pool.a))
        gradient.addColorStop(1, withAlpha(pool.c, 0))
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
      }

      /* motes */
      if (particles) {
        for (const item of items) {
          if (animated) {
            item.y -= item.speed * delta * (0.5 + item.z)
            item.x += item.drift * delta
            if (item.y < -12) Object.assign(item, spawn(false))
            if (item.x < -12) item.x = width + 12
            if (item.x > width + 12) item.x = -12
          }

          context.beginPath()
          context.arc(item.x, item.y, item.size * (0.6 + item.z * 0.7), 0, Math.PI * 2)
          context.fillStyle = withAlpha(color, item.alpha * (0.35 + item.z * 0.65))
          context.fill()
        }
      }

      /* vignette keeps the edges from competing with the UI chrome */
      const vignette = context.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.35,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.78
      )
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, 'rgba(0,0,0,0.55)')
      context.fillStyle = vignette
      context.fillRect(0, 0, width, height)
    }

    const onVisibility = (): void => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(frame)
      } else if (!running) {
        running = true
        lastDraw = 0
        frame = requestAnimationFrame(draw)
      }
    }

    resize()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    frame = requestAnimationFrame(draw)

    return () => {
      running = false
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [animated, particles])

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background: 'radial-gradient(ellipse at 30% 0%, #0b1220 0%, #05070c 55%, #04060a 100%)',
        pointerEvents: 'none'
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}

/** Accepts hex or a CSS colour and returns it at the requested alpha. */
function withAlpha(color: string, alpha: number): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.trim())
  if (match) {
    const [, r, g, b] = match
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`
  }
  return `rgba(94, 234, 212, ${alpha})`
}
