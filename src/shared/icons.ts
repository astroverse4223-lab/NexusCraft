/**
 * Server icons: 64x64, which is what Minecraft insists on.
 *
 * An icon can be drawn by hand a pixel at a time, stamped from a picture, or
 * described to a language model. The third needed measuring before it was
 * built, because the obvious approach does not work: asked for a grid of
 * palette letters, GLM spent four thousand tokens thinking and returned
 * nothing, and a local model produced thirty-three rows where thirty-two were
 * asked for, using palette letters it never defined. Counting to sixteen,
 * sixteen times, is a poor use of a language model.
 *
 * Describing shapes is not. "A dark circle in the middle, a yellow diamond over
 * it" needs no counting, is what most server icons actually are, and produced a
 * usable icon on every attempt across both providers. So that is the shape of
 * the request, and the canvas does the drawing.
 */

export const ICON_SIZE = 64

/** The canvas an icon is described on, top left at 0,0. */
export type IconShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; colour: string }
  | { kind: 'circle'; x: number; y: number; r: number; colour: string }
  | { kind: 'triangle'; points: [number, number][]; colour: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; colour: string }
  | { kind: 'text'; text: string; x: number; y: number; size: number; colour: string }

export interface IconArt {
  name: string
  background: string
  shapes: IconShape[]
}

/** How many shapes a description may have. Beyond this it stops reading as an icon. */
export const MAX_SHAPES = 12

const isColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * What a model is told before it is asked for an icon.
 *
 * Lives beside the reader below so the vocabulary described and the vocabulary
 * accepted cannot drift apart.
 */
export function iconPrompt(): string {
  return [
    'You design 64x64 Minecraft server icons as simple shapes.',
    'Answer with one JSON object and nothing else.',
    '',
    'Shape:',
    '{"name":"<short name>","background":"#rrggbb","shapes":[ ... ]}',
    '',
    'Each entry in shapes is one of:',
    '  {"kind":"rect","x":0,"y":0,"w":64,"h":64,"colour":"#rrggbb"}',
    '  {"kind":"circle","x":32,"y":32,"r":20,"colour":"#rrggbb"}',
    '  {"kind":"triangle","points":[[32,8],[56,52],[8,52]],"colour":"#rrggbb"}',
    '  {"kind":"line","x1":8,"y1":8,"x2":56,"y2":56,"w":4,"colour":"#rrggbb"}',
    '  {"kind":"text","text":"N","x":32,"y":34,"size":38,"colour":"#rrggbb"}',
    '',
    'The canvas is 64x64 with 0,0 at the top left. Shapes draw in order.',
    `Use 2 to ${MAX_SHAPES} shapes. Bold and simple reads far better at this size.`,
    'Text must be one or two characters. No commentary, no code fences.'
  ].join('\n')
}

/**
 * Turns whatever a model returned into shapes that can be drawn.
 *
 * Malformed shapes are dropped and counted rather than repaired: a rectangle
 * missing its height is not a rectangle whose height can be guessed, and
 * inventing one puts a block of colour somewhere nobody asked for. If nothing
 * survives, that is a failure worth reporting rather than a blank square.
 */
export function readIconArt(raw: unknown): { art: IconArt; dropped: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const background = isColour(source.background) ? source.background : '#1d1d21'
  const listed = Array.isArray(source.shapes) ? source.shapes : []

  const shapes: IconShape[] = []
  let dropped = 0

  for (const entry of listed) {
    if (shapes.length >= MAX_SHAPES) break

    const s = entry as Record<string, unknown>
    if (!s || typeof s !== 'object' || !isColour(s.colour)) {
      dropped++
      continue
    }
    const colour = s.colour

    if (s.kind === 'rect' && isNum(s.x) && isNum(s.y) && isNum(s.w) && isNum(s.h)) {
      shapes.push({ kind: 'rect', x: s.x, y: s.y, w: s.w, h: s.h, colour })
    } else if (s.kind === 'circle' && isNum(s.x) && isNum(s.y) && isNum(s.r)) {
      shapes.push({ kind: 'circle', x: s.x, y: s.y, r: s.r, colour })
    } else if (
      s.kind === 'triangle' &&
      Array.isArray(s.points) &&
      s.points.length === 3 &&
      s.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum))
    ) {
      shapes.push({ kind: 'triangle', points: s.points as [number, number][], colour })
    } else if (s.kind === 'line' && isNum(s.x1) && isNum(s.y1) && isNum(s.x2) && isNum(s.y2)) {
      shapes.push({
        kind: 'line',
        x1: s.x1,
        y1: s.y1,
        x2: s.x2,
        y2: s.y2,
        w: isNum(s.w) ? s.w : 3,
        colour
      })
    } else if (s.kind === 'text' && typeof s.text === 'string' && isNum(s.x) && isNum(s.y)) {
      shapes.push({
        kind: 'text',
        text: s.text.slice(0, 2),
        x: s.x,
        y: s.y,
        size: isNum(s.size) ? s.size : 32,
        colour
      })
    } else {
      dropped++
    }
  }

  if (shapes.length === 0) return null

  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim().slice(0, 48)
      : 'Server icon'

  return { art: { name, background, shapes }, dropped }
}

/** The colours an icon editor offers, being the sixteen Minecraft dyes plus grey steps. */
export const ICON_PALETTE = [
  '#FFFFFF', '#D9D9D9', '#9D9D97', '#6B6B6B', '#474F52', '#1D1D21', '#000000',
  '#B02E26', '#F9801D', '#FED83D', '#80C71F', '#5E7C16', '#169C9C', '#3AB3DA',
  '#3C44AA', '#8932B8', '#C74EBD', '#F38BAA', '#835432', '#4F3520'
]
