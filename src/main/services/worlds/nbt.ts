import { gunzip, inflate } from 'node:zlib'
import { promisify } from 'node:util'

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)

/**
 * A minimal reader for Minecraft's NBT format — enough to read level.dat.
 *
 * NBT is big-endian and self-describing: a tag id, a name, then a payload whose
 * shape depends on the id. Only the reading half is implemented; the launcher
 * never writes world data.
 */

export type NbtValue =
  | number
  | bigint
  | string
  | Buffer
  | NbtValue[]
  | { [key: string]: NbtValue }
  | Int32Array
  | BigInt64Array

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

class NbtReader {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  private need(bytes: number): void {
    if (this.offset + bytes > this.buffer.length) throw new Error('unexpected end of NBT data')
  }

  readByte(): number {
    this.need(1)
    return this.buffer.readInt8(this.offset++)
  }

  readShort(): number {
    this.need(2)
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readUShort(): number {
    this.need(2)
    const value = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readInt(): number {
    this.need(4)
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  readLong(): bigint {
    this.need(8)
    const value = this.buffer.readBigInt64BE(this.offset)
    this.offset += 8
    return value
  }

  readFloat(): number {
    this.need(4)
    const value = this.buffer.readFloatBE(this.offset)
    this.offset += 4
    return value
  }

  readDouble(): number {
    this.need(8)
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  readString(): string {
    const length = this.readUShort()
    this.need(length)
    const value = this.buffer.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return value
  }

  readPayload(type: number): NbtValue {
    switch (type) {
      case TAG_BYTE:
        return this.readByte()
      case TAG_SHORT:
        return this.readShort()
      case TAG_INT:
        return this.readInt()
      case TAG_LONG:
        return this.readLong()
      case TAG_FLOAT:
        return this.readFloat()
      case TAG_DOUBLE:
        return this.readDouble()
      case TAG_BYTE_ARRAY: {
        const length = this.readInt()
        this.need(length)
        const value = this.buffer.subarray(this.offset, this.offset + length)
        this.offset += length
        return value
      }
      case TAG_STRING:
        return this.readString()
      case TAG_LIST: {
        const itemType = this.readByte()
        const length = this.readInt()
        const items: NbtValue[] = []
        for (let i = 0; i < length; i++) {
          // A list of TAG_End carries no payload at all.
          if (itemType === TAG_END) break
          items.push(this.readPayload(itemType))
        }
        return items
      }
      case TAG_COMPOUND: {
        const compound: Record<string, NbtValue> = {}
        for (;;) {
          const childType = this.readByte()
          if (childType === TAG_END) break
          const name = this.readString()
          compound[name] = this.readPayload(childType)
        }
        return compound
      }
      case TAG_INT_ARRAY: {
        const length = this.readInt()
        const array = new Int32Array(length)
        for (let i = 0; i < length; i++) array[i] = this.readInt()
        return array
      }
      case TAG_LONG_ARRAY: {
        const length = this.readInt()
        const array = new BigInt64Array(length)
        for (let i = 0; i < length; i++) array[i] = this.readLong()
        return array
      }
      default:
        throw new Error(`unknown NBT tag type ${type}`)
    }
  }
}

/** Decompresses (gzip or zlib) and parses an NBT file into a plain object. */
export async function parseNbt(data: Buffer): Promise<Record<string, NbtValue>> {
  let raw = data
  // level.dat is gzipped; some tools write it zlib-compressed or uncompressed.
  if (data[0] === 0x1f && data[1] === 0x8b) raw = Buffer.from(await gunzipAsync(data))
  else if (data[0] === 0x78) raw = Buffer.from(await inflateAsync(data))

  const reader = new NbtReader(raw)
  const rootType = reader.readByte()
  if (rootType !== TAG_COMPOUND) throw new Error('NBT root tag is not a compound')
  reader.readString() // root name, conventionally empty
  return reader.readPayload(TAG_COMPOUND) as Record<string, NbtValue>
}

/* ------------------------------------------------------------- accessors */

export function nbtString(value: NbtValue | undefined): string | null {
  return typeof value === 'string' ? value : null
}

export function nbtNumber(value: NbtValue | undefined): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') {
    // Timestamps are longs but always well inside the safe integer range.
    const asNumber = Number(value)
    return Number.isSafeInteger(asNumber) ? asNumber : null
  }
  return null
}

export function nbtCompound(value: NbtValue | undefined): Record<string, NbtValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)
    ? (value as Record<string, NbtValue>)
    : null
}
