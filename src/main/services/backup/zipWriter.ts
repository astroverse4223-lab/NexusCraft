import { createWriteStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { deflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { LauncherError } from '../../core/errors'

const deflate = promisify(deflateRaw)

/* --------------------------------------------------------------- crc32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/* ------------------------------------------------------------ dos time */

function toDosTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f)
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
  return { time, date: dosDate }
}

/* ---------------------------------------------------------------- zip */

interface CentralEntry {
  name: Buffer
  crc: number
  compressedSize: number
  uncompressedSize: number
  offset: number
  time: number
  date: number
  method: number
}

async function collectFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collectFiles(root, full)))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

const MAX_ENTRIES = 65534
const MAX_TOTAL_BYTES = 0xfffffffe

export interface ZipProgress {
  file: string
  completed: number
  total: number
}

/**
 * Writes a ZIP archive of `sourceDir`.
 *
 * Everything is streamed and every compression call is asynchronous, so a
 * multi-gigabyte world backup never blocks the main process and the UI stays
 * responsive throughout.
 */
export async function zipDirectory(
  sourceDir: string,
  outputFile: string,
  onProgress?: (progress: ZipProgress) => void
): Promise<{ bytes: number; entries: number }> {
  const files = await collectFiles(sourceDir)

  if (files.length > MAX_ENTRIES) {
    throw new LauncherError('UNKNOWN', `${files.length} files exceeds the archive limit`, {
      title: 'This world is too large to back up automatically',
      message: `The folder holds ${files.length.toLocaleString()} files, more than the standard ZIP format supports without extensions.`,
      actions: ['Copy the world folder manually instead', 'Or remove old region files first']
    })
  }

  const output = createWriteStream(outputFile)
  const central: CentralEntry[] = []
  let offset = 0
  let completed = 0

  /** Writes a chunk, honouring backpressure so memory stays flat. */
  const write = async (chunk: Buffer): Promise<void> => {
    if (!output.write(chunk)) await once(output, 'drain')
    offset += chunk.length
  }

  try {
    for (const file of files) {
      const name = relative(sourceDir, file).split('\\').join('/')
      const nameBuffer = Buffer.from(name, 'utf8')
      const info = await stat(file)
      const { time, date } = toDosTime(info.mtime)

      const raw = await readFile(file)
      const crc = crc32(raw)

      // Region files compress well; already-compressed data does not, so fall
      // back to storing when deflate makes the entry bigger.
      let payload = await deflate(raw, { level: 6 })
      let method = 8
      if (payload.length >= raw.length) {
        payload = raw
        method = 0
      }

      if (offset + payload.length > MAX_TOTAL_BYTES) {
        throw new LauncherError('UNKNOWN', 'archive would exceed 4 GB', {
          title: 'This world is too large to back up automatically',
          message: 'The backup would be larger than 4 GB, which the standard ZIP format cannot hold.',
          actions: ['Copy the world folder manually instead']
        })
      }

      const localHeader = Buffer.alloc(30)
      localHeader.writeUInt32LE(0x04034b50, 0)
      localHeader.writeUInt16LE(20, 4) // version needed
      localHeader.writeUInt16LE(0x0800, 6) // UTF-8 file names
      localHeader.writeUInt16LE(method, 8)
      localHeader.writeUInt16LE(time, 10)
      localHeader.writeUInt16LE(date, 12)
      localHeader.writeUInt32LE(crc, 14)
      localHeader.writeUInt32LE(payload.length, 18)
      localHeader.writeUInt32LE(raw.length, 22)
      localHeader.writeUInt16LE(nameBuffer.length, 26)
      localHeader.writeUInt16LE(0, 28)

      central.push({
        name: nameBuffer,
        crc,
        compressedSize: payload.length,
        uncompressedSize: raw.length,
        offset,
        time,
        date,
        method
      })

      await write(localHeader)
      await write(nameBuffer)
      await write(payload)

      completed++
      onProgress?.({ file: name, completed, total: files.length })
    }

    const centralStart = offset
    for (const entry of central) {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(20, 4) // version made by
      header.writeUInt16LE(20, 6) // version needed
      header.writeUInt16LE(0x0800, 8)
      header.writeUInt16LE(entry.method, 10)
      header.writeUInt16LE(entry.time, 12)
      header.writeUInt16LE(entry.date, 14)
      header.writeUInt32LE(entry.crc, 16)
      header.writeUInt32LE(entry.compressedSize, 20)
      header.writeUInt32LE(entry.uncompressedSize, 24)
      header.writeUInt16LE(entry.name.length, 28)
      header.writeUInt16LE(0, 30) // extra length
      header.writeUInt16LE(0, 32) // comment length
      header.writeUInt16LE(0, 34) // disk number
      header.writeUInt16LE(0, 36) // internal attributes
      header.writeUInt32LE(0, 38) // external attributes
      header.writeUInt32LE(entry.offset, 42)

      await write(header)
      await write(entry.name)
    }
    const centralSize = offset - centralStart

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(central.length, 8)
    eocd.writeUInt16LE(central.length, 10)
    eocd.writeUInt32LE(centralSize, 12)
    eocd.writeUInt32LE(centralStart, 16)
    eocd.writeUInt16LE(0, 20)
    await write(eocd)

    await new Promise<void>((resolve, reject) => {
      output.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })

    return { bytes: offset, entries: central.length }
  } catch (err) {
    output.destroy()
    throw err
  }
}
