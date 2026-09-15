#!/usr/bin/env python3
"""Paints the follower's texture.

Written rather than drawn because the whole design is one colour and a grain,
and a 64x64 sheet of near-black is far easier to tune as six numbers than as a
file somebody has to open in an editor.

The only real decision here is that it is not black. Pure black is invisible in
a dark cave, which sounds thematically perfect and in practice means the mod has
no content: you never see the thing, so you never learn there is a thing. A very
dark grey with a slightly lighter edge reads as a silhouette from light level
four upward, which is a torch two corridors away.

Run:  python tools/paint.py
"""

from PIL import Image
import random

SIZE = 64

# The body. Cold and desaturated — a blue-grey rather than a brown-grey, which
# separates it from stone, from dirt and from every mob in the game.
BASE = (16, 18, 23)

# Where a face would be. Half a shade darker than the body, so the plate reads
# as a hole in the silhouette rather than as a head.
PLATE = (11, 12, 16)

# The edge light. Just enough to find the outline against a cave wall.
EDGE = (39, 43, 52)

random.seed(7)


def grain(image, box, amount=6):
    """A little value noise, so large flat parts do not look like plastic."""
    x0, y0, x1, y1 = box
    pixels = image.load()
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            n = random.randint(-amount, amount)
            pixels[x, y] = (
                max(0, min(255, r + n)),
                max(0, min(255, g + n)),
                max(0, min(255, b + n)),
                a,
            )


def fill(image, box, colour):
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            image.putpixel((x, y), colour + (255,))


def rim(image, box, colour):
    """One pixel of lighter colour along the top and left of a region."""
    x0, y0, x1, y1 = box
    for x in range(x0, x1):
        image.putpixel((x, y0), colour + (255,))
    for y in range(y0, y1):
        image.putpixel((x0, y), colour + (255,))


def main():
    image = Image.new("RGBA", (SIZE, SIZE), BASE + (255,))
    grain(image, (0, 0, SIZE, SIZE))

    # torso, upper — the widest part, so it gets the strongest edge light
    rim(image, (0, 0, 22, 11), EDGE)
    # torso, lower
    rim(image, (20, 40, 36, 50), EDGE)

    # the head plate: flat, featureless, and darker than everything around it
    fill(image, (24, 0, 40, 9), PLATE)
    grain(image, (24, 0, 40, 9), 3)
    # one pale line along the crown, which is all the definition it gets
    for x in range(24, 40):
        image.putpixel((x, 0), EDGE + (255,))

    # arms and legs get a rim down one side so they read as limbs, not sticks
    for box in [(40, 20, 48, 41), (50, 20, 58, 41), (0, 40, 8, 58), (10, 40, 18, 58)]:
        rim(image, box, EDGE)

    out = "src/main/resources/assets/vigil/textures/entity/follower.png"
    image.save(out)
    print("wrote " + out)


if __name__ == "__main__":
    main()
