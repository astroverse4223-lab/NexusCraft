import { describe, expect, it } from 'vitest'
import { speakable } from '../../src/renderer/src/components/companionVoice'

/**
 * What is worth reading aloud.
 *
 * A companion feed is full of text written for a screen: colour codes, item
 * ids, coordinates. Spoken verbatim it stops sounding like a character and
 * starts sounding like a screen reader working through a log, which is the
 * failure this cleanup exists to prevent.
 */
describe('speakable', () => {
  it('drops Minecraft colour codes', () => {
    expect(speakable('§aHello §cthere')).toBe('Hello there')
  })

  it('drops the speaker prefix, since we already know who is talking', () => {
    expect(speakable('<Error420s> found it')).toBe('found it')
  })

  it('says item ids as words', () => {
    expect(speakable('I found minecraft:iron_ingot')).toBe('I found iron ingot')
    expect(speakable('mining deepslate_diamond_ore')).toBe('mining deepslate diamond ore')
  })

  it('replaces coordinates, which are unlistenable read out', () => {
    expect(speakable('it is at 128, 64, -302 now')).toBe('it is at over there now')
  })

  it('collapses whitespace left behind by the stripping', () => {
    expect(speakable('§a  <Bot>   hello   world ')).toBe('hello world')
  })

  it('leaves ordinary dialogue alone', () => {
    const line = "There you go, 32 oak logs. Anything else?"
    expect(speakable(line)).toBe(line)
  })

  it('returns nothing for a line that was only machinery', () => {
    expect(speakable('§a§c§e')).toBe('')
    expect(speakable('   ')).toBe('')
  })
})
