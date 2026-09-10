import { describe, expect, it } from 'vitest'
import { IpcRequestSchemas } from '../../src/shared/ipc'

/**
 * What the site settings will and will not accept.
 *
 * These fields save when you click away from them, so the schema sees rows
 * mid-typing as a matter of course. Demanding a finished row meant adding a
 * vote site and then touching anything else was rejected outright, and the
 * launcher reported "that request was not valid" at somebody who had done
 * nothing wrong. Half-typed has to be allowed; unsafe still must not be.
 */

const schema = IpcRequestSchemas['site:save']

function payload(votes: { name: string; url: string }[], extra = {}) {
  return {
    config: {
      serverId: 'abc',
      title: 'Nexus',
      blurb: '',
      joinAddress: '',
      votes,
      accent: '#7c5cff',
      ...extra
    }
  }
}

describe('a row being typed', () => {
  it('accepts the empty row the Add button makes', () => {
    // Exactly what the button creates, which used to be refused.
    expect(schema.safeParse(payload([{ name: '', url: 'https://' }])).success).toBe(true)
  })

  it('accepts a name with no link yet', () => {
    expect(schema.safeParse(payload([{ name: 'Minecraft-MP', url: '' }])).success).toBe(true)
  })

  it('accepts a title that has been cleared', () => {
    expect(schema.safeParse(payload([], { title: '' })).success).toBe(true)
  })

  it('accepts a finished row', () => {
    expect(
      schema.safeParse(payload([{ name: 'TopG', url: 'https://topg.org/vote' }])).success
    ).toBe(true)
  })
})

describe('what is still refused', () => {
  it('refuses a javascript link', () => {
    // These render straight into an anchor on a page handed to strangers.
    expect(
      schema.safeParse(payload([{ name: 'x', url: 'javascript:alert(1)' }])).success
    ).toBe(false)
  })

  it('refuses a scheme that merely starts with http', () => {
    // The old check was startsWith('http'), which this walked straight through.
    expect(schema.safeParse(payload([{ name: 'x', url: 'httpevil://x' }])).success).toBe(false)
  })

  it('refuses a data url', () => {
    expect(
      schema.safeParse(payload([{ name: 'x', url: 'data:text/html,<script>' }])).success
    ).toBe(false)
  })

  it('refuses an accent that is not a colour', () => {
    expect(schema.safeParse(payload([], { accent: 'red' })).success).toBe(false)
  })

  it('refuses more vote sites than anyone would list', () => {
    const many = Array.from({ length: 13 }, () => ({ name: 'x', url: 'https://x.test' }))
    expect(schema.safeParse(payload(many)).success).toBe(false)
  })
})
