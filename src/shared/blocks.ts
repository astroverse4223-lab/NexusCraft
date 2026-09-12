/**
 * A block the studio can place, and the faces the game draws it with.
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
  /**
   * A png data url of the block's side, and the one face the flat grid draws.
   *
   * Every block has this. The rest below are only set where the game actually
   * uses a different texture there, which is 36 of the 188 on offer - almost
   * all of them logs, whose ends show rings.
   */
  texture: string
  /** The top, where it differs from the side. */
  top?: string
  /** The underside, where it differs from the top. */
  bottom?: string
  /**
   * Whether the top is a greyscale mask the game colours by biome.
   *
   * Grass is stored grey and tinted as it is drawn, so a renderer that takes
   * the texture at face value draws a grey lid on a green block. Tinting is
   * left to whoever draws it, because that is where a canvas is.
   */
  tintTop?: boolean
  /** A greyscale mask laid over the side and coloured the same way. */
  overlay?: string
}

/**
 * The colour the game tints grass with in a plains biome.
 *
 * Biome colouring is a whole lookup table in the game, keyed by temperature
 * and rainfall. A build in the studio is not in a biome, so it gets the one
 * everybody pictures when they picture grass.
 */
export const GRASS_TINT = '#91bd59'
