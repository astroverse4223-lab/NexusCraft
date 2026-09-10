import { ICON_SIZE, type IconArt, type IconShape } from '@shared/icons'

/**
 * Turning a described picture into an actual one.
 *
 * A language model cannot draw. What it can do is say "a dark circle in the
 * middle, a yellow diamond over it", and a canvas can turn that into pixels -
 * which is the whole trick the icon maker is built on, and the reason asking
 * for a grid of palette letters never worked.
 *
 * Lifted out of the icon screen because the same description is now wanted for
 * cosmetic hat textures, and two copies of a drawing routine drift the moment
 * one of them learns a new shape.
 */

/** One shape onto a context whose fill and stroke are already set. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: IconShape): void {
  switch (shape.kind) {
    case 'rect':
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h)
      return

    case 'circle':
      ctx.beginPath()
      ctx.arc(shape.x, shape.y, Math.abs(shape.r), 0, Math.PI * 2)
      ctx.fill()
      return

    case 'triangle':
      ctx.beginPath()
      ctx.moveTo(shape.points[0][0], shape.points[0][1])
      ctx.lineTo(shape.points[1][0], shape.points[1][1])
      ctx.lineTo(shape.points[2][0], shape.points[2][1])
      ctx.closePath()
      ctx.fill()
      return

    case 'line':
      ctx.lineWidth = Math.max(1, shape.w)
      ctx.beginPath()
      ctx.moveTo(shape.x1, shape.y1)
      ctx.lineTo(shape.x2, shape.y2)
      ctx.stroke()
      return

    case 'text':
      ctx.font = `bold ${Math.max(6, shape.size)}px "Segoe UI", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(shape.text, shape.x, shape.y)
  }
}

/**
 * A described picture as a png data url.
 *
 * `transparent` is what separates a hat from an icon: a server icon wants its
 * background filled, and an item texture wants everything the shapes did not
 * cover to be see-through, or the hat arrives as a coloured square with a hat
 * drawn on it.
 */
export function renderIconArt(
  art: IconArt,
  options: { size?: number; transparent?: boolean } = {}
): string {
  const size = options.size ?? ICON_SIZE

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // The description is written against a 64 square whatever size is wanted
  // back, so everything is scaled once here rather than in every shape.
  const scale = size / ICON_SIZE
  ctx.scale(scale, scale)

  if (!options.transparent) {
    ctx.fillStyle = art.background
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE)
  }

  for (const shape of art.shapes) {
    ctx.fillStyle = shape.colour
    ctx.strokeStyle = shape.colour

    drawShape(ctx, shape)
  }

  return canvas.toDataURL('image/png')
}
