/**
 * A block the studio can place, and the face the game draws it with.
 *
 * Shared because the renderer needs the shape and the main process reads it
 * out of the version jar - and a studio showing coloured squares instead of
 * real faces is one you cannot judge a build in.
 */
export interface PaletteBlock {
  /** What gets placed. */
  id: string
  label: string
  group: string
  /** A png data url of the block's own face. */
  texture: string
}
