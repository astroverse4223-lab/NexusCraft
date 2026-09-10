import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { THEMES } from '../../src/shared/types'

/**
 * Every theme has to restate every colour it changes.
 *
 * A theme is a handful of tokens redefined under `[data-theme]`, and anything
 * it leaves out falls back to the one in `:root` - which is the dark theme. So
 * a theme that forgets `--text` gets pale grey text, and on the light theme
 * that is pale grey on white: invisible, and invisible only for whoever picked
 * that theme, which is nobody testing it.
 *
 * The whole point of the token system is that a theme is cheap. This is what
 * stops cheap becoming careless.
 */

const css = readFileSync(join(__dirname, '..', '..', 'src/renderer/src/styles/global.css'), 'utf8')

/** Tokens that carry colour, and therefore must be restated by every theme. */
const REQUIRED = [
  '--bg-0',
  '--bg-1',
  '--bg-2',
  '--bg-3',
  '--text',
  '--text-muted',
  '--text-dim',
  '--accent',
  '--accent-deep',
  '--accent-dim',
  '--accent-glow',
  '--accent-far'
]

function blockFor(theme: string): string | null {
  const at = css.indexOf(`[data-theme='${theme}']`)
  if (at === -1) return null

  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open, close)
}

describe('the themes the app ships', () => {
  it('has a stylesheet block for every theme but the default', () => {
    for (const theme of THEMES) {
      // Nexus is the `:root` palette itself, so it carries no attribute - that
      // is what makes a fresh install and a themeless stylesheet look alike.
      if (theme.id === 'nexus') {
        expect(blockFor(theme.id)).toBeNull()
        continue
      }

      expect(blockFor(theme.id), `${theme.id} has no [data-theme] block`).not.toBeNull()
    }
  })

  it('restates every colour token in every theme', () => {
    const missing: Record<string, string[]> = {}

    for (const theme of THEMES) {
      if (theme.id === 'nexus') continue

      const block = blockFor(theme.id) ?? ''
      const absent = REQUIRED.filter((token) => !block.includes(`${token}:`))

      if (absent.length > 0) missing[theme.id] = absent
    }

    expect(missing).toEqual({})
  })

  it('agrees with the stylesheet about each accent', () => {
    for (const theme of THEMES) {
      if (theme.id === 'nexus') continue

      // The list in types.ts sets the accent when a theme is picked, and the
      // stylesheet sets it when the attribute lands. Two sources for one colour
      // is fine only while they say the same thing.
      const block = blockFor(theme.id) ?? ''
      expect(block, `${theme.id}`).toContain(`--accent: ${theme.accent};`)
    }
  })

  it('flips the overlay direction for the light theme', () => {
    // Every panel and hairline is a translucent `--wash` over the ground. Left
    // white on a white theme they vanish, taking every panel edge with them.
    expect(blockFor('daylight')).toContain('--wash:')
    expect(blockFor('ember')).not.toContain('--wash:')
  })

  it('draws every overlay through the token, so a theme can flip them', () => {
    const themesAt = css.indexOf('/* ---')
    const body = css.slice(0, css.indexOf("[data-theme='ember']"))

    expect(themesAt).toBeGreaterThan(-1)
    expect(body.match(/rgba\(255, 255, 255/g) ?? []).toHaveLength(0)
  })
})
