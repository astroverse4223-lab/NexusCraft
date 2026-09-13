import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Publishing the pack to a release.
 *
 * What matters here is not that a file moves. It is that the address it ends
 * up at is the same address as last time, because that address is written into
 * the server's config and nobody is going to edit it for every texture change.
 * A second asset appearing beside the first would leave the server serving a
 * pack that is quietly months old.
 */

/** Every gh invocation, in order, so the arguments can be read back. */
let calls: string[][] = []

/** What the next gh call should pretend to be. */
let behave: (args: string[]) => { fail?: boolean; out?: string } = () => ({ out: '' })

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _options: unknown,
    done: (err: Error | null, out?: { stdout: string; stderr: string }) => void
  ) => {
    calls.push(args)
    const result = behave(args)
    if (result.fail) {
      const err = new Error('gh said no') as Error & { stderr: string }
      err.stderr = result.out ?? 'gh said no'
      done(err)
      return
    }
    done(null, { stdout: result.out ?? '', stderr: '' })
  }
}))

let fetchable = true
vi.mock('../../src/main/services/content/packHost', () => ({
  canFetch: async () => fetchable
}))

const { uploadPack, githubStatus } = await import('../../src/main/services/content/packRelease')

let directory = ''
let pack = ''

beforeEach(async () => {
  calls = []
  fetchable = true

  if (!directory) {
    directory = await mkdtemp(join(tmpdir(), 'nexus-release-'))
    pack = join(directory, 'nexus-resource-pack.zip')
    await writeFile(pack, Buffer.from('PK pretend pack'))
  }

  // Signed in, with write access, and the release already there.
  behave = () => ({ out: 'Logged in to github.com account someone (keyring)\nToken scopes: \'repo\'' })
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const WHERE = { repo: 'someone/theirrepo', tag: 'resource-pack', assetName: 'pack.zip' }

describe('asking whether GitHub can be used', () => {
  it('says so plainly when the CLI is not installed', async () => {
    behave = () => ({ fail: true, out: 'not found' })

    const status = await githubStatus()

    expect(status.installed).toBe(false)
    expect(status.canWrite).toBe(false)
    expect(status.why).toContain('not installed')
  })

  it('separates "installed" from "signed in"', async () => {
    behave = (args) => (args[0] === '--version' ? { out: 'gh version 2.0.0' } : { fail: true, out: 'not logged in' })

    const status = await githubStatus()

    expect(status.installed).toBe(true)
    expect(status.canWrite).toBe(false)
    expect(status.why).toContain('not signed in')
  })

  it('reads back who it would upload as', async () => {
    const status = await githubStatus()

    expect(status.account).toBe('someone')
    expect(status.canWrite).toBe(true)
    expect(status.why).toBeNull()
  })

  it('refuses a login that cannot write to repositories', async () => {
    behave = (args) =>
      args[0] === '--version' ? { out: 'gh version 2.0.0' } : { out: "account someone\nToken scopes: 'gist'" }

    const status = await githubStatus()

    expect(status.canWrite).toBe(false)
    expect(status.why).toContain('not allowed to write')
  })
})

describe('uploading the pack', () => {
  it('always replaces the asset rather than adding beside it', async () => {
    /*
     * The single most important argument in this file. Without --clobber the
     * upload succeeds, a second asset appears under a slightly different name,
     * and the url in the server config keeps serving the original for ever.
     */
    await uploadPack(pack, WHERE)

    const upload = calls.find((args) => args[0] === 'release' && args[1] === 'upload')
    expect(upload).toBeDefined()
    expect(upload).toContain('--clobber')
  })

  it('gives back the address a player will fetch, not the release page', async () => {
    const sent = await uploadPack(pack, WHERE)

    expect(sent.url).toBe('https://github.com/someone/theirrepo/releases/download/resource-pack/pack.zip')
  })

  it('hashes what it actually uploaded', async () => {
    const { createHash } = await import('node:crypto')
    const { readFile } = await import('node:fs/promises')
    const expected = createHash('sha1').update(await readFile(pack)).digest('hex')

    expect((await uploadPack(pack, WHERE)).sha1).toBe(expected)
  })

  it('makes the release when it is not there yet, and not when it is', async () => {
    // Present: `release view` answers.
    await uploadPack(pack, WHERE)
    expect(calls.some((args) => args[0] === 'release' && args[1] === 'create')).toBe(false)

    // Absent: `release view` fails, so it has to be made first.
    calls = []
    behave = (args) => {
      if (args[0] === 'release' && args[1] === 'view') return { fail: true, out: 'release not found' }
      if (args[0] === '--version' || args[0] === 'auth') {
        return { out: "account someone\nToken scopes: 'repo'" }
      }
      return { out: '' }
    }

    const sent = await uploadPack(pack, WHERE)

    expect(calls.some((args) => args[0] === 'release' && args[1] === 'create')).toBe(true)
    expect(sent.created).toBe(true)
  })

  it('reports when the uploaded file cannot be fetched back', async () => {
    /*
     * A private repository takes the upload without complaint and then answers
     * every player with a 404. Reporting the upload as a success there would
     * be reporting the exact failure this feature exists to end.
     */
    fetchable = false

    expect((await uploadPack(pack, WHERE)).reachable).toBe(false)
  })

  it('will not start when GitHub cannot be used at all', async () => {
    behave = () => ({ fail: true, out: 'not found' })

    await expect(uploadPack(pack, WHERE)).rejects.toThrow()

    // And nothing was uploaded on the way to finding out.
    expect(calls.some((args) => args[0] === 'release' && args[1] === 'upload')).toBe(false)
  })

  it('says so rather than uploading nothing when the pack is missing', async () => {
    await expect(uploadPack(join(directory, 'no-such-pack.zip'), WHERE)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
