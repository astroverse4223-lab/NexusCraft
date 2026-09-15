#!/usr/bin/env python3
"""Paints Hollow.

Two textures, and the split between them is the design.

hollow.png is the body: near-black, everywhere, with only enough variation that
it does not look like a hole cut out of the screen. There is no detail on it on
purpose — he is a silhouette, and any pattern at all would compete with the one
place you are meant to be looking.

hollow_glow.png is transparent except for the eyes and the mouth, and gets drawn
a second time at full brightness. That is what lets him stand in an unlit cave
as nothing but two lit eyes at head height.

The mask is a shade lighter than the body rather than a different colour. At
this size a coloured mask reads as a hat; a lighter black reads as a different
material, which is what it is.

Run:  python tools/paint.py
"""

from PIL import Image
import os
import random

W, H = 64, 64

# The body. Not pure black — pure black loses its edges against a night sky and
# reads as a rendering fault rather than as a figure.
BODY = (14, 14, 17)

# The mask. A shade lighter and very slightly warm, so it separates from the
# body without announcing itself as a separate object.
MASK = (26, 25, 29)

# The lit edge along the top of the head, which is all the shape it gets.
EDGE = (38, 37, 43)

# What burns in the eyes and the mouth. Warm white, and hot in the middle, so
# it reads as light rather than as paint.
GLOW = (236, 214, 160)
GLOW_CORE = (255, 243, 206)

random.seed(3)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(
    HERE, "..", "src", "main", "resources", "assets", "hollow", "textures", "entity"))

# Where the model puts each face. Kept here rather than derived, because these
# have to agree with MaskModel by hand anyway and a wrong guess is invisible
# until you look at the thing in game.
EYE_LEFT = (0, 34, 8, 38)
EYE_RIGHT = (8, 34, 16, 38)
MOUTH = (16, 34, 30, 38)


def box(image, area, colour):
    x0, y0, x1, y1 = area
    for y in range(y0, y1):
        for x in range(x0, x1):
            if 0 <= x < W and 0 <= y < H:
                image.putpixel((x, y), colour)


def grain(image, amount=3):
    pixels = image.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            n = random.randint(-amount, amount)
            pixels[x, y] = (max(0, min(255, r + n)),
                            max(0, min(255, g + n)),
                            max(0, min(255, b + n)), a)


def body_texture():
    image = Image.new("RGBA", (W, H), BODY + (255,))

    # The head, which is the mask: the top-left 32x16 block of a player layout.
    box(image, (0, 0, 32, 16), MASK + (255,))

    # One lit edge along the top of the skull, so the head has a silhouette
    # against a dark wall instead of merging into it.
    for x in range(8, 24):
        image.putpixel((x, 0), EDGE + (255,))

    grain(image, 3)

    # The eyes and mouth are dark on this texture — they are holes, and the
    # light behind them is the *other* texture's job.
    for area in [EYE_LEFT, EYE_RIGHT, MOUTH]:
        box(image, area, (6, 6, 8, 255))

    return image


# What his eyes can be lit with.
#
# Ordered, and the order is the wire format — the entity sends an index and the
# client picks a texture, so inserting a colour in the middle changes what
# every existing save is wearing. Add to the end.
#
# Each is a pair: the edge, and the hotter centre. Uniform light looks like a
# sticker; a two-tone one looks like something burning behind a hole.
# Saturated, and the cores only a little hotter than the edge.
#
# There was a version of this washed almost to white, on the theory that a
# brighter colour survives being dimmed. It does — and it survives as white, so
# red and violet and cyan all became the same pale smudge and the whole point of
# choosing a colour went with them. The dark is dealt with elsewhere now
# (EyeShine), so these can simply be the colours they are.
COLOURS = [
    ("amber", (255, 186, 64), (255, 232, 158)),
    ("white", (226, 234, 255), (255, 255, 255)),
    ("red", (255, 38, 24), (255, 132, 96)),
    ("green", (56, 255, 66), (168, 255, 150)),
    ("cyan", (40, 232, 255), (170, 248, 255)),
    ("violet", (176, 74, 255), (222, 168, 255)),
    ("pink", (255, 62, 168), (255, 168, 220)),
    ("gold", (255, 190, 20), (255, 232, 130)),
]


def glow_texture(edge, core):
    """Transparent everywhere except the two eyes and the mouth."""
    image = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    for area in [EYE_LEFT, EYE_RIGHT, MOUTH]:
        box(image, area, edge + (255,))

        x0, y0, x1, y1 = area
        for y in range(y0 + 1, y1 - 1):
            for x in range(x0 + 1, x1 - 1):
                if 0 <= x < W and 0 <= y < H:
                    image.putpixel((x, y), core + (255,))

    return image


# --- the crate -----------------------------------------------------------
#
# Old, dry, roughly nailed together. Warm brown so it reads as wood rather than
# as another dark shape, because the player has to notice it sitting there
# before it ever moves.
WOOD = (94, 66, 41)
PLANK = (78, 54, 33)
NAIL = (52, 50, 55)

CRATE_W, CRATE_H = 64, 48
CRATE_EYE_LEFT = (0, 44, 8, 48)
CRATE_EYE_RIGHT = (8, 44, 16, 48)


def crate_texture():
    image = Image.new("RGBA", (CRATE_W, CRATE_H), WOOD + (255,))

    # Plank lines every four pixels, so the sides have a grain direction.
    for y in range(CRATE_H):
        if y % 4 == 0:
            for x in range(CRATE_W):
                image.putpixel((x, y), PLANK + (255,))

    pixels = image.load()
    for y in range(CRATE_H):
        for x in range(CRATE_W):
            r, g, b, a = pixels[x, y]
            n = random.randint(-7, 7)
            pixels[x, y] = (max(0, min(255, r + n)),
                            max(0, min(255, g + n)),
                            max(0, min(255, b + n)), a)

    # A few nail heads, irregularly placed.
    for _ in range(26):
        x = random.randint(1, CRATE_W - 2)
        y = random.randint(1, CRATE_H - 2)
        image.putpixel((x, y), NAIL + (255,))

    # The eyes are dark on the crate texture; the glow layer lights them.
    for area in [CRATE_EYE_LEFT, CRATE_EYE_RIGHT]:
        x0, y0, x1, y1 = area
        for y in range(y0, y1):
            for x in range(x0, x1):
                if 0 <= x < CRATE_W and 0 <= y < CRATE_H:
                    image.putpixel((x, y), (8, 8, 10, 255))

    return image


def crate_glow_texture():
    image = Image.new("RGBA", (CRATE_W, CRATE_H), (0, 0, 0, 0))
    edge, core = COLOURS[0][1], COLOURS[0][2]
    for area in [CRATE_EYE_LEFT, CRATE_EYE_RIGHT]:
        x0, y0, x1, y1 = area
        for y in range(y0, y1):
            for x in range(x0, x1):
                if 0 <= x < CRATE_W and 0 <= y < CRATE_H:
                    image.putpixel((x, y), edge + (255,))
        for y in range(y0 + 1, y1 - 1):
            for x in range(x0 + 1, x1 - 1):
                if 0 <= x < CRATE_W and 0 <= y < CRATE_H:
                    image.putpixel((x, y), core + (255,))
    return image


# --- the figure you carry ------------------------------------------------
#
# What he looks like in an inventory slot. A small carved figure of him: the
# same black, the same two lit eyes, standing with its arms at its sides.
#
# It was a magma cream — a vanilla item, so the mod's own texture for it was
# never used and could not be, because a vanilla item takes its model from
# vanilla. A flat orange ball is not what you have been walking around with.

ITEM_OUT = os.path.normpath(os.path.join(
    HERE, "..", "src", "main", "resources", "assets", "hollow", "textures", "item"))


def figure_texture():
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))

    def put(x, y, colour):
        if 0 <= x < 16 and 0 <= y < 16:
            image.putpixel((x, y), colour + (255,))

    def fill(x0, y0, x1, y1, colour):
        for y in range(y0, y1):
            for x in range(x0, x1):
                put(x, y, colour)

    # A plinth, so it reads as a carving rather than as a person in the slot.
    fill(4, 14, 12, 16, (34, 33, 38))
    fill(5, 13, 11, 14, (26, 25, 29))

    # Body, tapering upward.
    fill(6, 8, 10, 14, MASK)
    fill(5, 9, 11, 13, MASK)

    # Arms held against the sides.
    fill(4, 9, 5, 13, (20, 20, 24))
    fill(11, 9, 12, 13, (20, 20, 24))

    # Head.
    fill(5, 3, 11, 9, MASK)
    fill(6, 2, 10, 3, MASK)

    # The lit edge along the crown and one shoulder.
    for x in range(6, 10):
        put(x, 2, EDGE)
    put(5, 9, EDGE)

    # Two eyes, the same amber as his.
    fill(6, 5, 8, 6, COLOURS[0][2])
    fill(9, 5, 11, 6, COLOURS[0][2])

    return image


# --- him, on the title screen --------------------------------------------
#
# A flat sprite rather than the real model, and deliberately so: the title
# screen has no world, and an entity cannot exist without one. Rendering the
# model directly is possible and fragile; a painted figure is neither.
#
# Drawn to be *almost* invisible against the panorama. He is a shape you are
# not sure about until the eyes resolve, which is the whole effect — a clearly
# lit monster on the menu is a poster, not a haunting.

GUI_OUT = os.path.normpath(os.path.join(
    HERE, "..", "src", "main", "resources", "assets", "hollow", "textures", "gui"))

MENU_W, MENU_H = 64, 128
EYE_RED = (255, 42, 34)
EYE_RED_CORE = (255, 150, 130)


def shine_texture():
    """A soft round glow, drawn over the dark where his eyes are.

    White, because it is tinted to whatever colour his eyes are set to at the
    moment it is drawn. Falls off as the square of the distance from the middle,
    which reads as light in air rather than as a circle someone has pasted on.
    """
    size = 32
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    middle = (size - 1) / 2.0

    for y in range(size):
        for x in range(size):
            dx = (x - middle) / middle
            dy = (y - middle) / middle
            away = min(1.0, (dx * dx + dy * dy) ** 0.5)

            # A flat hot centre with a short haze around it.
            #
            # It was a smooth falloff over the whole sprite, and that is a ball
            # of light — stretched across a face it looked like a glowing orb
            # had been parked in the middle of his head. An eye is mostly solid
            # with a little bleed at its edge, so most of the sprite is opaque
            # and only the last third fades.
            if away < 0.34:
                strength = 1.0
            else:
                strength = max(0.0, (1.0 - away) / 0.66) ** 1.8

            image.putpixel((x, y), (255, 255, 255, int(strength * 255)))

    return image


def menu_texture():
    image = Image.new("RGBA", (MENU_W, MENU_H), (0, 0, 0, 0))

    def fill(x0, y0, x1, y1, colour):
        for y in range(y0, y1):
            for x in range(x0, x1):
                if 0 <= x < MENU_W and 0 <= y < MENU_H:
                    image.putpixel((x, y), colour)

    body = (9, 9, 12, 255)
    edge = (26, 26, 32, 255)

    # Head, square like the mask.
    fill(22, 10, 42, 30, body)
    for x in range(22, 42):
        image.putpixel((x, 10), edge)

    # Neck and shoulders.
    fill(28, 30, 36, 34, body)
    fill(18, 34, 46, 42, body)

    # Torso, tapering.
    fill(21, 42, 43, 76, body)
    fill(23, 76, 41, 84, body)

    # Arms, hanging long.
    fill(14, 36, 21, 82, body)
    fill(43, 36, 50, 82, body)

    # Legs.
    fill(24, 84, 31, 122, body)
    fill(33, 84, 40, 122, body)

    # A faint rim down one side, so he separates from a dark panorama.
    for y in range(10, 122):
        for x in range(MENU_W):
            if image.getpixel((x, y))[3] and x > 0 and not image.getpixel((x - 1, y))[3]:
                image.putpixel((x, y), edge)
                break

    # And the eyes. The only thing on him with any light in it.
    fill(26, 18, 31, 21, EYE_RED)
    fill(33, 18, 38, 21, EYE_RED)
    fill(27, 19, 30, 20, EYE_RED_CORE)
    fill(34, 19, 37, 20, EYE_RED_CORE)

    return image


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(ITEM_OUT, exist_ok=True)
    os.makedirs(GUI_OUT, exist_ok=True)

    shine = os.path.join(GUI_OUT, "eyeshine.png")
    shine_texture().save(shine)
    print("wrote " + shine)

    menu = os.path.join(GUI_OUT, "menu_hollow.png")
    menu_texture().save(menu)
    print("wrote " + menu)

    figure = os.path.join(ITEM_OUT, "hollow_figure.png")
    figure_texture().save(figure)
    print("wrote " + figure)

    body = os.path.join(OUT, "hollow.png")
    body_texture().save(body)
    print("wrote " + body)

    for index, (name, edge, core) in enumerate(COLOURS):
        glow = os.path.join(OUT, "hollow_glow_%d.png" % index)
        glow_texture(edge, core).save(glow)
        print("wrote %s (%s)" % (glow, name))

    crate = os.path.join(OUT, "crate.png")
    crate_texture().save(crate)
    print("wrote " + crate)

    crate_glow = os.path.join(OUT, "crate_glow.png")
    crate_glow_texture().save(crate_glow)
    print("wrote " + crate_glow)


if __name__ == "__main__":
    main()
