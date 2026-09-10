import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import {
  packHostStatus,
  packUrl,
  servePack,
  startPackHost,
  stopPackHost
} from '../../src/main/services/content/packHost'

/**
 * The listener that hands the pack out.
 *
 * This is the one part of the launcher that answers requests from outside the
 * machine, so what it will and will not serve is worth pinning down: one file,
 * one path, and nothing else - not a folder, and not a path built from what
 * the caller asked for.
 */

/*
 * A fresh port for every test rather than one for the file.
 *
 * Closing a listener and immediately binding the same port again can fail with
 * EADDRINUSE while the old socket sits in TIME_WAIT, which made this file fail
 * roughly one run in twenty - and an intermittent test is worse than no test,
 * because the next person to see it red assumes it always lies.
 */
let PORT = 0

let root: string
let file: string
let sha1: string

async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`)
  return { status: response.status, body: await response.text() }
}

beforeEach(async () => {
  // Below 49152 on purpose: Windows reserves blocks above it for Hyper-V and
  // WSL, and binding into one fails with EACCES rather than EADDRINUSE.
  PORT = 20000 + Math.floor(Math.random() * 20000)
  root = mkdtempSync(join(tmpdir(), 'packhost-'))
  file = join(root, 'pack.zip')

  writeFileSync(file, 'pretend this is a zip')
  sha1 = createHash('sha1').update('pretend this is a zip').digest('hex')

  await servePack({ file, sha1 })
  await startPackHost(PORT)
})

afterEach(() => {
  stopPackHost()
  rmSync(root, { recursive: true, force: true })
})

describe('serving the pack', () => {
  it('hands over the file at its own hash', async () => {
    const result = await get(`/${sha1}.zip`)

    expect(result.status).toBe(200)
    expect(result.body).toBe('pretend this is a zip')
  })

  it('builds a url from the address it is given', () => {
    // Not from this machine's idea of itself: a url of 127.0.0.1 works for
    // exactly one player, which is the wrong one.
    expect(packUrl('203.0.113.5', PORT)).toBe(`http://203.0.113.5:${PORT}/${sha1}.zip`)
  })

  it('names the path after the contents, so a rebuild is a new url', async () => {
    const before = packHostStatus().path

    writeFileSync(file, 'different bytes entirely')
    await servePack({
      file,
      sha1: createHash('sha1').update('different bytes entirely').digest('hex')
    })

    // Clients cache a pack by url. The same url for new bytes leaves everyone
    // who already joined on the old pack forever.
    expect(packHostStatus().path).not.toBe(before)
  })
})

describe('what it refuses', () => {
  it('404s any other path', async () => {
    expect((await get('/pack.zip')).status).toBe(404)
    expect((await get('/')).status).toBe(404)
    expect((await get(`/${'0'.repeat(40)}.zip`)).status).toBe(404)
  })

  it('does not serve files next to the pack', async () => {
    writeFileSync(join(root, 'secret.txt'), 'not for anyone')

    // The path is never used to build a file name, so there is nothing to
    // traverse out of - but it is worth a test that says so.
    expect((await get('/secret.txt')).status).toBe(404)
    expect((await get('/../secret.txt')).status).toBe(404)
    expect((await get('/%2e%2e/secret.txt')).status).toBe(404)
  })

  it('answers a query string on the right path anyway', async () => {
    expect((await get(`/${sha1}.zip?v=2`)).status).toBe(200)
  })

  it('refuses a method that is not a read', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/${sha1}.zip`, { method: 'DELETE' })
    expect(response.status).toBe(405)
  })
})

describe('the port', () => {
  it('will not take one outside the usable range', async () => {
    await expect(startPackHost(80)).rejects.toThrow()
    await expect(startPackHost(70000)).rejects.toThrow()
  })

  it('reports what it is doing', () => {
    const status = packHostStatus()

    expect(status.running).toBe(true)
    expect(status.port).toBe(PORT)
    expect(status.sha1).toBe(sha1)
  })

  it('stops when told to', async () => {
    stopPackHost()

    expect(packHostStatus().running).toBe(false)
    await expect(get(`/${sha1}.zip`)).rejects.toThrow()
  })
})

describe('checking whether the url actually answers', () => {
  it('says yes for one that does', async () => {
    const { canFetch } = await import('../../src/main/services/content/packHost')
    expect(await canFetch(`http://127.0.0.1:${PORT}/${sha1}.zip`)).toBe(true)
  })

  it('says no for a path that is not served', async () => {
    const { canFetch } = await import('../../src/main/services/content/packHost')
    expect(await canFetch(`http://127.0.0.1:${PORT}/nothing.zip`)).toBe(false)
  })

  it('says no rather than hanging when nothing answers at all', async () => {
    const { canFetch } = await import('../../src/main/services/content/packHost')

    // 203.0.113.0/24 is reserved for documentation and routes nowhere, which
    // is the same shape of failure as a router that will not hairpin.
    expect(await canFetch('http://203.0.113.1:9/x.zip', 1200)).toBe(false)
  }, 8000)
})
