/**
 * CurseForge's file fingerprint.
 *
 * The updater identifies an installed jar by hashing it and asking the site
 * what it is. Modrinth takes a plain SHA-1; CurseForge wants a Murmur2 hash of
 * the file with certain bytes removed first, and there is no second option — a
 * plain hash of the same file matches nothing.
 *
 * The two details that make or break it:
 *
 *   - Whitespace is stripped before hashing. Tab, newline, carriage return and
 *     space (9, 10, 13, 32) are dropped from the byte stream entirely, and the
 *     length used by the algorithm is the length *after* stripping.
 *   - The seed is 1, not 0 and not 0xdeadbeef.
 *
 * Get either wrong and every lookup returns no match, which looks exactly like
 * "this mod is not on CurseForge" rather than like a bug. That failure mode is
 * why this lives in its own file with its own tests.
 */

/** Bytes CurseForge removes before hashing. */
const WHITESPACE = new Set([9, 10, 13, 32])

/**
 * Murmur2 (32-bit), the variant CurseForge uses.
 *
 * Written out rather than pulled from a package because the packaged versions
 * differ in exactly the ways that matter here — signedness of the final value,
 * and how they handle the trailing bytes.
 */
export function murmur2(data: Buffer, seed = 1): number {
  const m = 0x5bd1e995
  const r = 24

  // Strip first: the length the algorithm works from is the stripped length.
  const bytes = Buffer.alloc(data.length)
  let length = 0
  for (const byte of data) {
    if (!WHITESPACE.has(byte)) bytes[length++] = byte
  }

  let h = (seed ^ length) >>> 0
  let index = 0
  let remaining = length

  while (remaining >= 4) {
    let k =
      (bytes[index] |
        (bytes[index + 1] << 8) |
        (bytes[index + 2] << 16) |
        (bytes[index + 3] << 24)) >>>
      0

    k = Math.imul(k, m) >>> 0
    k = (k ^ (k >>> r)) >>> 0
    k = Math.imul(k, m) >>> 0

    h = Math.imul(h, m) >>> 0
    h = (h ^ k) >>> 0

    index += 4
    remaining -= 4
  }

  // The tail, one byte at a time, in this order.
  if (remaining === 3) h = (h ^ (bytes[index + 2] << 16)) >>> 0
  if (remaining >= 2) h = (h ^ (bytes[index + 1] << 8)) >>> 0
  if (remaining >= 1) {
    h = (h ^ bytes[index]) >>> 0
    h = Math.imul(h, m) >>> 0
  }

  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, m) >>> 0
  h = (h ^ (h >>> 15)) >>> 0

  return h >>> 0
}
