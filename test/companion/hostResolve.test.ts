import { describe, expect, it } from 'vitest'
import {
  isLoopback,
  isPrivateAddress,
  resolveHost,
  unreachableAdvice
} from '../../src/main/companion/hostResolve'

/**
 * A companion saved `192.168.22.12` while the machine was on one network. The
 * machine later joined another, became `192.168.1.202`, and every companion
 * timed out against an address that no longer existed — while the server sat
 * there listening. The error blamed the port and the firewall.
 */
describe('resolving a companion host', () => {
  const own = ['192.168.1.202', '10.14.0.2', '172.24.128.1', '127.0.0.1']

  it('redirects a saved address from an old network to loopback', () => {
    const resolved = resolveHost({
      host: '192.168.22.12',
      port: 25565,
      own,
      hostedPorts: [25565]
    })

    expect(resolved.host).toBe('127.0.0.1')
    expect(resolved.persist).toBe(true)
    expect(resolved.note).toContain('192.168.22.12')
  })

  it('prefers loopback even when the saved address is currently correct', () => {
    // Correct today, stale the moment the machine changes network. Loopback is
    // right on both days, so there is no reason to keep the LAN address.
    const resolved = resolveHost({
      host: '192.168.1.202',
      port: 25565,
      own,
      hostedPorts: [25565]
    })

    expect(resolved.host).toBe('127.0.0.1')
    expect(resolved.persist).toBe(true)
  })

  it("leaves a friend's server on the same LAN alone", () => {
    // Nothing of ours is on that port, so the address is a real other machine.
    const resolved = resolveHost({
      host: '192.168.1.55',
      port: 25565,
      own,
      hostedPorts: []
    })

    expect(resolved.host).toBe('192.168.1.55')
    expect(resolved.persist).toBe(false)
    expect(resolved.note).toBeNull()
  })

  it('leaves a public address alone even when we host that port', () => {
    const resolved = resolveHost({
      host: 'play.example.com',
      port: 25565,
      own,
      hostedPorts: [25565]
    })

    expect(resolved.host).toBe('play.example.com')
    expect(resolved.persist).toBe(false)
  })

  it('does not rewrite a stale address when the port is not one we host', () => {
    // Our server is on 25565; this companion wants 25570 somewhere else.
    const resolved = resolveHost({
      host: '192.168.22.12',
      port: 25570,
      own,
      hostedPorts: [25565]
    })

    expect(resolved.host).toBe('192.168.22.12')
    expect(resolved.persist).toBe(false)
  })

  it('passes loopback and localhost straight through', () => {
    for (const host of ['localhost', '127.0.0.1']) {
      const resolved = resolveHost({ host, port: 25565, own, hostedPorts: [25565] })
      expect(resolved.host).toBe(host)
      expect(resolved.note).toBeNull()
    }
  })

  it('falls back to localhost when the host is blank', () => {
    expect(resolveHost({ host: '   ', port: 25565, own, hostedPorts: [] }).host).toBe('localhost')
  })

  it('ignores surrounding whitespace', () => {
    const resolved = resolveHost({
      host: '  192.168.22.12  ',
      port: 25565,
      own,
      hostedPorts: [25565]
    })
    expect(resolved.host).toBe('127.0.0.1')
  })
})

describe('the advice given when nothing answers', () => {
  const own = ['192.168.1.202', '127.0.0.1']

  it('names the stale address and the real one', () => {
    const advice = unreachableAdvice('192.168.22.12', 25565, own)

    expect(advice).toContain('does not belong to this machine any more')
    expect(advice).toContain('192.168.1.202')
    expect(advice).not.toContain('firewall')
  })

  it('still blames the firewall for a genuine remote server', () => {
    const advice = unreachableAdvice('play.example.com', 25565, own)
    expect(advice).toContain('firewall')
  })

  it('does not accuse an address this machine actually holds', () => {
    const advice = unreachableAdvice('192.168.1.202', 25565, own)
    expect(advice).toContain('firewall')
    expect(advice).not.toContain('does not belong')
  })
})

describe('address classification', () => {
  it('knows the private ranges', () => {
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
    expect(isPrivateAddress('10.14.0.2')).toBe(true)
    expect(isPrivateAddress('172.24.128.1')).toBe(true)
    expect(isPrivateAddress('172.15.0.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('play.example.com')).toBe(false)
  })

  it('knows what means this machine', () => {
    expect(isLoopback('localhost')).toBe(true)
    expect(isLoopback('LOCALHOST')).toBe(true)
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('192.168.1.1')).toBe(false)
  })
})
