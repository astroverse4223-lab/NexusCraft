import { describe, expect, it } from 'vitest'
import { gzipSync, deflateSync } from 'node:zlib'
import { nbtCompound, nbtNumber, nbtString, parseNbt, type NbtValue } from '@main/services/worlds/nbt'

/**
 * NBT is a binary format, so the fixtures are built here rather than checked in
 * as blobs — a hand-written encoder keeps each test readable and makes the
 * malformed cases easy to construct deliberately.
 */

const TAG = {
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12
} as const

function str(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(bytes.length)
  return Buffer.concat([length, bytes])
}

function i8(value: number): Buffer {
  const b = Buffer.alloc(1)
  b.writeInt8(value)
  return b
}

function i16(value: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeInt16BE(value)
  return b
}

function i32(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeInt32BE(value)
  return b
}

function i64(value: bigint): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigInt64BE(value)
  return b
}

function f32(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeFloatBE(value)
  return b
}

function f64(value: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeDoubleBE(value)
  return b
}

/** A named tag: type byte, name, then payload. */
function named(type: number, name: string, payload: Buffer): Buffer {
  return Buffer.concat([i8(type), str(name), payload])
}

/** Wraps entries in a root compound with an empty name, as level.dat does. */
function root(...entries: Buffer[]): Buffer {
  return Buffer.concat([i8(TAG.COMPOUND), str(''), ...entries, i8(TAG.END)])
}

function compoundPayload(...entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, i8(TAG.END)])
}

function listPayload(itemType: number, ...items: Buffer[]): Buffer {
  return Buffer.concat([i8(itemType), i32(items.length), ...items])
}

describe('parseNbt', () => {
  it('reads every scalar tag type', async () => {
    const data = root(
      named(TAG.BYTE, 'b', i8(-7)),
      named(TAG.SHORT, 's', i16(-300)),
      named(TAG.INT, 'i', i32(123456)),
      named(TAG.LONG, 'l', i64(9007199254740993n)),
      named(TAG.FLOAT, 'f', f32(0.5)),
      named(TAG.DOUBLE, 'd', f64(1.25)),
      named(TAG.STRING, 'str', str('hello'))
    )
    const parsed = await parseNbt(data)
    expect(parsed.b).toBe(-7)
    expect(parsed.s).toBe(-300)
    expect(parsed.i).toBe(123456)
    expect(parsed.l).toBe(9007199254740993n)
    expect(parsed.f).toBeCloseTo(0.5)
    expect(parsed.d).toBe(1.25)
    expect(parsed.str).toBe('hello')
  })

  it('reads UTF-8 strings beyond ASCII', async () => {
    const parsed = await parseNbt(root(named(TAG.STRING, 'name', str('Мир — 世界 🌍'))))
    expect(parsed.name).toBe('Мир — 世界 🌍')
  })

  it('reads nested compounds', async () => {
    const data = root(
      named(TAG.COMPOUND, 'Data', compoundPayload(named(TAG.STRING, 'LevelName', str('My World'))))
    )
    const parsed = await parseNbt(data)
    expect(nbtCompound(parsed.Data)?.LevelName).toBe('My World')
  })

  it('reads lists of compounds', async () => {
    const entry = (name: string): Buffer => compoundPayload(named(TAG.STRING, 'Name', str(name)))
    const data = root(named(TAG.LIST, 'items', listPayload(TAG.COMPOUND, entry('a'), entry('b'))))
    const parsed = await parseNbt(data)
    const items = parsed.items as NbtValue[]
    expect(items).toHaveLength(2)
    expect(nbtCompound(items[0])?.Name).toBe('a')
    expect(nbtCompound(items[1])?.Name).toBe('b')
  })

  it('reads an empty list without consuming payload', async () => {
    const data = root(named(TAG.LIST, 'empty', listPayload(TAG.STRING)), named(TAG.INT, 'after', i32(42)))
    const parsed = await parseNbt(data)
    expect(parsed.empty).toEqual([])
    // The tag after the empty list must still line up.
    expect(parsed.after).toBe(42)
  })

  it('treats a TAG_End list as empty regardless of its declared length', async () => {
    // Older writers emit type 0 with a non-zero length for empty lists.
    const data = root(
      named(TAG.LIST, 'weird', Buffer.concat([i8(TAG.END), i32(5)])),
      named(TAG.INT, 'after', i32(7))
    )
    const parsed = await parseNbt(data)
    expect(parsed.weird).toEqual([])
    expect(parsed.after).toBe(7)
  })

  it('reads byte, int and long arrays', async () => {
    const data = root(
      named(TAG.BYTE_ARRAY, 'bytes', Buffer.concat([i32(3), Buffer.from([1, 2, 3])])),
      named(TAG.INT_ARRAY, 'ints', Buffer.concat([i32(2), i32(10), i32(-20)])),
      named(TAG.LONG_ARRAY, 'longs', Buffer.concat([i32(2), i64(1n), i64(-2n)]))
    )
    const parsed = await parseNbt(data)
    expect(Buffer.isBuffer(parsed.bytes)).toBe(true)
    expect([...(parsed.bytes as Buffer)]).toEqual([1, 2, 3])
    expect([...(parsed.ints as Int32Array)]).toEqual([10, -20])
    expect([...(parsed.longs as BigInt64Array)]).toEqual([1n, -2n])
  })

  it('reads a gzipped file, which is what level.dat actually is', async () => {
    const parsed = await parseNbt(gzipSync(root(named(TAG.STRING, 'LevelName', str('Gzipped')))))
    expect(parsed.LevelName).toBe('Gzipped')
  })

  it('reads a zlib-deflated file, which some third-party tools write', async () => {
    const parsed = await parseNbt(deflateSync(root(named(TAG.STRING, 'LevelName', str('Deflated')))))
    expect(parsed.LevelName).toBe('Deflated')
  })

  it('reads an uncompressed file', async () => {
    const parsed = await parseNbt(root(named(TAG.STRING, 'LevelName', str('Plain'))))
    expect(parsed.LevelName).toBe('Plain')
  })

  it('rejects data whose root tag is not a compound', async () => {
    await expect(parseNbt(Buffer.concat([i8(TAG.STRING), str(''), str('nope')]))).rejects.toThrow(
      /root tag is not a compound/
    )
  })

  it('rejects an unknown tag type instead of returning nonsense', async () => {
    await expect(parseNbt(root(named(99, 'bad', i32(0))))).rejects.toThrow(/unknown NBT tag type 99/)
  })

  it('rejects truncated data rather than reading past the buffer', async () => {
    const full = root(named(TAG.STRING, 'LevelName', str('Truncated')))
    await expect(parseNbt(full.subarray(0, full.length - 4))).rejects.toThrow()
  })

  it('rejects a string whose declared length runs past the end', async () => {
    const bogus = Buffer.concat([i8(TAG.COMPOUND), str(''), i8(TAG.STRING), str('k'), i16(500), Buffer.from('short')])
    await expect(parseNbt(bogus)).rejects.toThrow(/unexpected end of NBT data/)
  })

  it('parses a realistic level.dat shape', async () => {
    const data = gzipSync(
      root(
        named(
          TAG.COMPOUND,
          'Data',
          compoundPayload(
            named(TAG.STRING, 'LevelName', str('New World')),
            named(TAG.INT, 'GameType', i32(1)),
            named(TAG.LONG, 'LastPlayed', i64(1750000000000n)),
            named(TAG.BYTE, 'hardcore', i8(0)),
            named(TAG.INT, 'DataVersion', i32(4189)),
            named(TAG.COMPOUND, 'Version', compoundPayload(named(TAG.STRING, 'Name', str('1.21.4'))))
          )
        )
      )
    )
    const parsed = await parseNbt(data)
    const level = nbtCompound(parsed.Data)
    expect(level).not.toBeNull()
    expect(nbtString(level!.LevelName)).toBe('New World')
    expect(nbtNumber(level!.GameType)).toBe(1)
    expect(nbtNumber(level!.LastPlayed)).toBe(1750000000000)
    expect(nbtString(nbtCompound(level!.Version)?.Name)).toBe('1.21.4')
  })
})

describe('accessors', () => {
  it('nbtString returns strings and null for anything else', () => {
    expect(nbtString('x')).toBe('x')
    expect(nbtString(5)).toBeNull()
    expect(nbtString(undefined)).toBeNull()
    expect(nbtString({})).toBeNull()
  })

  it('nbtNumber returns numbers directly', () => {
    expect(nbtNumber(42)).toBe(42)
    expect(nbtNumber(0)).toBe(0)
    expect(nbtNumber(undefined)).toBeNull()
    expect(nbtNumber('42')).toBeNull()
  })

  it('nbtNumber narrows longs that fit the safe integer range', () => {
    expect(nbtNumber(1750000000000n)).toBe(1750000000000)
  })

  it('nbtNumber refuses longs that would lose precision', () => {
    expect(nbtNumber(9007199254740993n)).toBeNull()
  })

  it('nbtCompound accepts plain objects only', () => {
    expect(nbtCompound({ a: 1 })).toEqual({ a: 1 })
    expect(nbtCompound([])).toBeNull()
    expect(nbtCompound(Buffer.from([1]))).toBeNull()
    expect(nbtCompound('x')).toBeNull()
    expect(nbtCompound(undefined)).toBeNull()
  })
})
