import { describe, expect, it } from 'vitest'
import { isForMe } from '../../src/main/companion/chatGate'

/**
 * Who a line of chat is for.
 *
 * The reported fault: "when I command something it shows it on all the
 * companions, and if I stop it they all go idle". Every bot heard every
 * message, including the other bots' own announcements, so one instruction
 * became four — and four local-model requests at once froze the launcher.
 */
const crew = { me: 'GLM', siblings: ['Andy', 'LumberJack', 'Miner'], owner: 'Error420s' }

describe('deciding whether chat is for this companion', () => {
  it('takes an instruction from its owner', () => {
    expect(isForMe('Error420s', 'build a cottage', crew)).toBe(true)
  })

  it('ignores an instruction addressed to another companion', () => {
    expect(isForMe('Error420s', 'Andy build a cottage', crew)).toBe(false)
  })

  it('takes an instruction addressed to it by name', () => {
    expect(isForMe('Error420s', 'GLM build a cottage', crew)).toBe(true)
  })

  it('ignores another companion announcing its work', () => {
    // The exact shape of the bug: one bot says this, three others start building.
    expect(isForMe('Andy', 'building Stone Watchtower...', crew)).toBe(false)
  })

  it('still listens when another companion names it', () => {
    expect(isForMe('Andy', 'GLM can you pass me some planks', crew)).toBe(true)
  })

  it('ignores its own name appearing inside a message to someone else', () => {
    // Named last, but the message is plainly Andy's.
    expect(isForMe('Error420s', 'Andy go and help', crew)).toBe(false)
  })

  it('answers a stranger when no owner is set', () => {
    const open = { me: 'GLM', siblings: ['Andy'], owner: null }
    expect(isForMe('SomeoneElse', 'hello there', open)).toBe(true)
  })

  it('ignores a stranger when an owner is set', () => {
    expect(isForMe('SomeoneElse', 'hello there', crew)).toBe(false)
  })

  it('answers anything from the owner when it is the only companion', () => {
    const alone = { me: 'GLM', siblings: [], owner: 'Error420s' }
    expect(isForMe('Error420s', 'build a cottage', alone)).toBe(true)
  })

  it('is not fooled by capitals', () => {
    expect(isForMe('ERROR420S', 'glm build a cottage', crew)).toBe(true)
    expect(isForMe('Error420s', 'ANDY build a cottage', crew)).toBe(false)
  })

  it('ignores another companion even when it is the only one running', () => {
    const pair = { me: 'GLM', siblings: ['Andy'], owner: null }
    expect(isForMe('Andy', 'I found some iron over there', pair)).toBe(false)
  })
})
