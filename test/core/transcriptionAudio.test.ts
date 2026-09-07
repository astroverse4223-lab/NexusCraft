import { describe, expect, it } from 'vitest'
import { parseMultipart } from '../../src/main/services/voice/speechServer'
import { resample, wavToFloats } from '../../src/main/services/voice/whisper'

/**
 * The audio path between the mod and the launcher.
 *
 * Ember records a microphone through Simple Voice Chat at 48kHz, wraps it in a
 * WAV by hand, and posts it as multipart. Whisper wants 16kHz floats. Neither
 * end can be checked in a game, but the format handling can be checked exactly
 * — and format handling is where audio bugs live: an off-by-one in a header
 * produces confident transcriptions of noise rather than an error.
 */

/** The same 44-byte RIFF header the mod writes, built the same way. */
function wav(samples: Int16Array, rate = 48000, channels = 1): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, i) => data.writeInt16LE(sample, i * 2))

  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2 * channels, 28)
  header.writeUInt16LE(2 * channels, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)

  return Buffer.concat([header, data])
}

describe('reading the WAV the mod sends', () => {
  it('recovers the samples and the rate', () => {
    const source = new Int16Array([0, 16384, -16384, 32767, -32768])
    const { samples, rate } = wavToFloats(wav(source))

    expect(rate).toBe(48000)
    expect(samples.length).toBe(5)
    expect(samples[0]).toBeCloseTo(0, 5)
    expect(samples[1]).toBeCloseTo(0.5, 3)
    expect(samples[2]).toBeCloseTo(-0.5, 3)
    expect(samples[3]).toBeCloseTo(1, 2)
  })

  it('walks the chunks rather than assuming audio starts at byte 44', () => {
    // Some writers put a LIST chunk before the data. Transcribing metadata as
    // audio produces fluent nonsense rather than an error, so this matters.
    const base = wav(new Int16Array([1000, 2000, 3000]))
    const list = Buffer.alloc(8 + 4)
    list.write('LIST', 0, 'ascii')
    list.writeUInt32LE(4, 4)
    list.write('INFO', 8, 'ascii')

    const withList = Buffer.concat([base.subarray(0, 36), list, base.subarray(36)])
    withList.writeUInt32LE(withList.length - 8, 4)

    const { samples } = wavToFloats(withList)
    expect(samples.length).toBe(3)
    expect(samples[1]).toBeCloseTo(2000 / 32768, 4)
  })

  it('averages stereo rather than dropping a channel', () => {
    const interleaved = new Int16Array([1000, 3000, 2000, 4000])
    const { samples } = wavToFloats(wav(interleaved, 48000, 2))

    expect(samples.length).toBe(2)
    expect(samples[0]).toBeCloseTo(2000 / 32768, 4)
    expect(samples[1]).toBeCloseTo(3000 / 32768, 4)
  })

  it('refuses something that is not a WAV', () => {
    expect(() => wavToFloats(Buffer.from('not audio at all'))).toThrow(/not a WAV/i)
  })
})

describe('resampling to what Whisper wants', () => {
  it('takes 48kHz down to 16kHz', () => {
    const source = new Float32Array(48000).fill(0.5)
    const out = resample(source, 48000, 16000)

    expect(out.length).toBe(16000)
    expect(out[0]).toBeCloseTo(0.5, 5)
  })

  it('averages rather than dropping samples', () => {
    // Decimation would alias; averaging each group of three is a crude
    // low-pass. A signal that alternates should average toward its mean.
    const source = new Float32Array(9)
    for (let i = 0; i < 9; i += 1) source[i] = i % 2 === 0 ? 1 : -1

    const out = resample(source, 48000, 16000)
    expect(out.length).toBe(3)
    for (const value of out) expect(Math.abs(value)).toBeLessThan(0.5)
  })

  it('leaves audio already at the right rate alone', () => {
    const source = new Float32Array([0.1, 0.2, 0.3])
    expect(resample(source, 16000, 16000)).toBe(source)
  })
})

describe('the multipart body the mod posts', () => {
  it('finds the file and the fields', () => {
    const boundary = '----ember123'
    const audio = wav(new Int16Array([500, -500]))

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\n` +
          `Content-Type: audio/wav\r\n\r\n`
      ),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])

    const { file, fields } = parseMultipart(body, `multipart/form-data; boundary=${boundary}`)

    expect(fields.model).toBe('whisper-1')
    expect(fields.language).toBe('en')
    expect(file).not.toBeNull()
    // Byte-identical: decoding audio as text would corrupt it silently.
    expect(Buffer.compare(file!, audio)).toBe(0)
  })

  it('survives a quoted boundary', () => {
    const body = Buffer.from(
      '--abc\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--abc--\r\n'
    )
    const { fields } = parseMultipart(body, 'multipart/form-data; boundary="abc"')
    expect(fields.model).toBe('whisper-1')
  })

  it('returns nothing rather than throwing when there is no boundary', () => {
    const { file, fields } = parseMultipart(Buffer.from('x'), 'application/json')
    expect(file).toBeNull()
    expect(fields).toEqual({})
  })
})
