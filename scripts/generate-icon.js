/**
 * Generates build/icon.ico (and icon.png) for the Windows installer.
 *
 * The NexusCraft mark is drawn here in code rather than shipped as a binary so
 * the artwork stays reviewable and can be regenerated at any size:
 *
 *     node scripts/generate-icon.js
 *
 * Everything is written with Node's own zlib — no image libraries involved.
 */
const { deflateSync } = require('node:zlib')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

/* ------------------------------------------------------------ rasteriser */

class Canvas {
  constructor(size) {
    this.size = size
    this.data = Buffer.alloc(size * size * 4) // RGBA, transparent
  }

  /** Alpha-blends a colour over the existing pixel. */
  blend(x, y, [r, g, b], alpha) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size || alpha <= 0) return
    const i = (y * this.size + x) * 4
    const src = Math.min(1, alpha)
    const dstA = this.data[i + 3] / 255
    const outA = src + dstA * (1 - src)
    if (outA === 0) return
    this.data[i] = Math.round((r * src + this.data[i] * dstA * (1 - src)) / outA)
    this.data[i + 1] = Math.round((g * src + this.data[i + 1] * dstA * (1 - src)) / outA)
    this.data[i + 2] = Math.round((b * src + this.data[i + 2] * dstA * (1 - src)) / outA)
    this.data[i + 3] = Math.round(outA * 255)
  }

  /**
   * Fills a convex polygon with a vertical gradient, sampling 3x3 per pixel so
   * the diagonal cube edges come out smooth rather than stair-stepped.
   */
  fillPolygon(points, colorTop, colorBottom) {
    const ys = points.map((p) => p[1])
    const xs = points.map((p) => p[0])
    const minY = Math.max(0, Math.floor(Math.min(...ys)))
    const maxY = Math.min(this.size - 1, Math.ceil(Math.max(...ys)))
    const minX = Math.max(0, Math.floor(Math.min(...xs)))
    const maxX = Math.min(this.size - 1, Math.ceil(Math.max(...xs)))
    const spanY = Math.max(1, Math.max(...ys) - Math.min(...ys))
    const topY = Math.min(...ys)

    const SAMPLES = 3
    const step = 1 / SAMPLES

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let hits = 0
        for (let sy = 0; sy < SAMPLES; sy++) {
          for (let sx = 0; sx < SAMPLES; sx++) {
            if (inside(points, x + (sx + 0.5) * step, y + (sy + 0.5) * step)) hits++
          }
        }
        if (hits === 0) continue
        const t = Math.min(1, Math.max(0, (y - topY) / spanY))
        const color = [
          Math.round(colorTop[0] + (colorBottom[0] - colorTop[0]) * t),
          Math.round(colorTop[1] + (colorBottom[1] - colorTop[1]) * t),
          Math.round(colorTop[2] + (colorBottom[2] - colorTop[2]) * t)
        ]
        this.blend(x, y, color, hits / (SAMPLES * SAMPLES))
      }
    }
  }

  fillCircle(cx, cy, radius, color) {
    const minY = Math.max(0, Math.floor(cy - radius - 1))
    const maxY = Math.min(this.size - 1, Math.ceil(cy + radius + 1))
    const minX = Math.max(0, Math.floor(cx - radius - 1))
    const maxX = Math.min(this.size - 1, Math.ceil(cx + radius + 1))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        // One-pixel feather at the edge keeps the dot from looking jagged.
        const alpha = d <= radius - 0.5 ? 1 : d >= radius + 0.5 ? 0 : radius + 0.5 - d
        this.blend(x, y, color, alpha)
      }
    }
  }
}

/** Even-odd point-in-polygon test. */
function inside(points, px, py) {
  let result = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) result = !result
  }
  return result
}

/* ------------------------------------------------------------------- png */

function crc32(buffer) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[i] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, payload) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(canvas) {
  const { size, data } = canvas
  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    data.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ------------------------------------------------------------------- ico */

/** Wraps PNG images in an ICO container (PNG-in-ICO, supported since Vista). */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32BE(0, 8)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

/* ------------------------------------------------------------------ mark */

/** Draws the NexusCraft isometric cube at the requested size. */
function drawLogo(size) {
  const canvas = new Canvas(size)
  const u = size / 48 // the mark is designed on a 48-unit grid
  const p = (x, y) => [x * u, y * u]

  const ACCENT_TOP = [122, 245, 224]
  const ACCENT_BOTTOM = [77, 214, 192]
  const LEFT_TOP = [72, 158, 172]
  const LEFT_BOTTOM = [93, 106, 190]
  const RIGHT_TOP = [129, 140, 248]
  const RIGHT_BOTTOM = [168, 108, 231]

  // top face
  canvas.fillPolygon([p(24, 4), p(42.5, 14.5), p(24, 25), p(5.5, 14.5)], ACCENT_TOP, ACCENT_BOTTOM)
  // left face
  canvas.fillPolygon([p(5.5, 14.5), p(24, 25), p(24, 45.5), p(5.5, 35)], LEFT_TOP, LEFT_BOTTOM)
  // right face
  canvas.fillPolygon([p(42.5, 14.5), p(24, 25), p(24, 45.5), p(42.5, 35)], RIGHT_TOP, RIGHT_BOTTOM)

  // nexus core: a dark well with a glowing centre
  canvas.fillCircle(24 * u, 25 * u, 3.6 * u, [8, 12, 20])
  canvas.fillCircle(24 * u, 25 * u, 2.2 * u, [126, 248, 226])

  return canvas
}

/* ------------------------------------------------------------------- run */

const outDir = join(__dirname, '..', 'build')
mkdirSync(outDir, { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map((size) => ({ size, png: encodePng(drawLogo(size)) }))

writeFileSync(join(outDir, 'icon.ico'), encodeIco(images))
writeFileSync(join(outDir, 'icon.png'), images[images.length - 1].png)

console.log(`wrote build/icon.ico (${sizes.join(', ')} px) and build/icon.png`)
