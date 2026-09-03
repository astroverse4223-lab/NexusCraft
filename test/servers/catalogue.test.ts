import { describe, expect, it } from 'vitest'
import {
  BUNDLED_DIRECTORY,
  DIRECTORY_CATEGORIES
} from '../../src/main/services/servers/serverCatalogue'

/**
 * The catalogue is hand-written, so it is exactly the kind of list that grows a
 * duplicate id or a stray category the day someone adds ten entries at once.
 * None of this can tell you a server is still alive — `catalogueLive.check.ts`
 * pings them for that — but it does keep the list well-formed.
 */

describe('bundled server catalogue', () => {
  it('has enough servers to be worth browsing', () => {
    expect(BUNDLED_DIRECTORY.length).toBeGreaterThanOrEqual(40)
  })

  it('gives every server a unique id', () => {
    const ids = BUNDLED_DIRECTORY.map((server) => server.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists no server twice', () => {
    // Case-insensitive: the same host in different case is still one server.
    const addresses = BUNDLED_DIRECTORY.map((server) => `${server.address.toLowerCase()}:${server.port}`)
    expect(new Set(addresses).size).toBe(addresses.length)
  })

  it('only uses categories the screen can show', () => {
    const known = new Set(DIRECTORY_CATEGORIES.map((category) => category.id))
    for (const server of BUNDLED_DIRECTORY) {
      expect(known, `${server.name} has category "${server.category}"`).toContain(server.category)
    }
  })

  it('fills in every category, so no filter lands on an empty screen', () => {
    for (const category of DIRECTORY_CATEGORIES) {
      const count = BUNDLED_DIRECTORY.filter((server) => server.category === category.id).length
      expect(count, `no servers in "${category.id}"`).toBeGreaterThan(0)
    }
  })

  it('gives every server something to read', () => {
    for (const server of BUNDLED_DIRECTORY) {
      expect(server.name.trim().length, `${server.id} has no name`).toBeGreaterThan(0)
      expect(server.description.trim().length, `${server.id} has no description`).toBeGreaterThan(20)
      expect(server.tags.length, `${server.id} has no tags`).toBeGreaterThan(0)
    }
  })

  it('uses plausible addresses and ports', () => {
    for (const server of BUNDLED_DIRECTORY) {
      // A host, not a url and not something with a port stuck on the end.
      expect(server.address, `${server.id}`).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/i)
      expect(server.port).toBeGreaterThan(0)
      expect(server.port).toBeLessThanOrEqual(65535)
    }
  })
})
