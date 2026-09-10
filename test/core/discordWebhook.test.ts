import { describe, expect, it } from 'vitest'

import { IpcRequestSchemas } from '../../src/shared/ipc'

/**
 * The webhook url, checked before it reaches a config file.
 *
 * Worth checking here because the failure is silent at every later step. The
 * plugin posts to whatever string it is given, logs one line when that fails
 * and then gives up deliberately - so a url with a character missing looks
 * exactly like a feed nobody ever turned on, and the only evidence is a line
 * in a server log written once, hours ago.
 */

const check = (url: string): boolean =>
  IpcRequestSchemas['host:discordWebhook'].safeParse({
    serverId: '2db55584-1555-46e9-8cdc-cd60f5b64347',
    url
  }).success

const real = 'https://discord.com/api/webhooks/1234567890123456789/AbCdEf-gh_IJ12345'

describe('the Discord webhook a server is given', () => {
  it('takes the url Discord hands you', () => {
    expect(check(real)).toBe(true)
  })

  it('takes the older and the test-build hosts', () => {
    expect(check(real.replace('discord.com', 'discordapp.com'))).toBe(true)
    expect(check(real.replace('discord.com', 'canary.discord.com'))).toBe(true)
    expect(check(real.replace('discord.com', 'ptb.discord.com'))).toBe(true)
  })

  it('takes an empty one, which is how the feed is turned off', () => {
    expect(check('')).toBe(true)
  })

  it('refuses the near misses', () => {
    // http rather than https - Discord does not serve it and the post fails.
    expect(check(real.replace('https://', 'http://'))).toBe(false)

    // The channel page rather than the webhook, which is the easy mistake.
    expect(check('https://discord.com/channels/123456789/987654321')).toBe(false)

    // An invite, which is what somebody reaches for when told "the link".
    expect(check('https://discord.gg/abc123')).toBe(false)

    expect(check('https://discord.com/api/webhooks/')).toBe(false)
    expect(check('not a url at all')).toBe(false)
  })

  it('refuses somebody else pretending to be Discord', () => {
    expect(check('https://discord.com.evil.example/api/webhooks/1/aaaa')).toBe(false)
    expect(check('https://notdiscord.com/api/webhooks/1/aaaa')).toBe(false)
  })
})
