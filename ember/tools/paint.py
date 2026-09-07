"""Paints Ember's texture.

The first version filled each face with one colour and scattered a little noise
over it. That reads as plastic: real metal has light coming from a direction,
wear where it has been handled, and — for copper left outside — patina that
forms in patches rather than as even static.

So this is built the way a texture artist works rather than the way a program
does: a light ramp down each face, verdigris grown from value noise so it
blotches, exposed copper on the corners where a lantern gets knocked, and a
glow that falls off from its own centre.

Kept in the repository rather than in a scratch folder because it *is* the
source of the texture — the PNG is the build output.

    python tools/paint.py
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'src', 'main', 'resources', 'assets', 'ember', 'textures')
OUT_ENTITY = os.path.join(ASSETS, 'entity', 'ember.png')
OUT_ITEM = os.path.join(ASSETS, 'item', 'ember_lantern.png')

random.seed(0xE43E)

# ----------------------------------------------------------------- palette
#
# Oxidised copper wants more than three tones to read as metal. These run from
# the shadow inside a crease to the highlight on a struck edge, and the warm
# values are the only saturated thing on the model so the light is what the eye
# goes to.
COPPER = [(74, 40, 24), (108, 60, 34), (146, 84, 48), (178, 108, 66), (206, 138, 92)]
VERD = [(34, 78, 68), (48, 104, 90), (66, 134, 116), (88, 162, 140), (112, 186, 164)]
GLOW = [(180, 92, 28), (226, 132, 48), (250, 178, 84), (255, 214, 140), (255, 244, 214)]
IRON = [(28, 28, 34), (44, 44, 52), (62, 62, 72)]


def ramp(colours, t):
    """A colour from a ramp, 0 dark to 1 light, with a soft interpolation."""
    t = max(0.0, min(1.0, t))
    span = (len(colours) - 1) * t
    low = int(span)
    high = min(low + 1, len(colours) - 1)
    mix = span - low
    a, b = colours[low], colours[high]
    return tuple(round(a[i] + (b[i] - a[i]) * mix) for i in range(3))


# ------------------------------------------------------------- value noise
#
# Patina grows in patches. Per-pixel randomness gives static instead, which at
# 16 pixels reads as dirt rather than corrosion, so the noise is smoothed first
# and thresholded second.
_NOISE = Image.effect_noise((64, 64), 42).filter(ImageFilter.GaussianBlur(1.6))
_NOISE = _NOISE.point(lambda v: max(0, min(255, int((v - 100) * 2.4 + 128))))


def patina(x, y):
    """0 to 1: how corroded this pixel is."""
    return _NOISE.getpixel((x % 64, y % 64)) / 255.0


img = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
px = img.load()


def faces(u, v, w, h, dep):
    """The six rectangles Minecraft samples for a box, in its own order."""
    return {
        'top': (u + dep, v, w, dep),
        'bottom': (u + dep + w, v, w, dep),
        'right': (u, v + dep, dep, h),
        'front': (u + dep, v + dep, w, h),
        'left': (u + dep + w, v + dep, dep, h),
        'back': (u + dep + w + dep, v + dep, w, h),
    }


def metal(box, base, lit=0.55, wear=True, patinated=True):
    """A metal face: lit from above, worn at the edges, corroded in patches."""
    x0, y0, w, h = box
    for iy in range(h):
        # Light from above, and a little bounce off whatever is below.
        down = iy / max(h - 1, 1)
        shade = lit + 0.34 * (1.0 - down) - 0.16 * down

        for ix in range(w):
            across = ix / max(w - 1, 1)
            edge = min(across, 1 - across, down, 1 - down)

            tone = shade
            if wear:
                # Corners and edges catch the light; they are what gets knocked.
                if edge < 0.16:
                    tone += 0.22
                tone += (random.random() - 0.5) * 0.06

            colour = ramp(base, tone)

            if patinated and base is COPPER:
                blotch = patina(x0 + ix, y0 + iy)
                if blotch > 0.62:
                    strength = min(0.85, (blotch - 0.62) * 2.2)
                    green = ramp(VERD, tone)
                    colour = tuple(
                        round(colour[i] + (green[i] - colour[i]) * strength) for i in range(3)
                    )

            px[x0 + ix, y0 + iy] = colour + (255,)


def opening(box):
    """The lit window: brightest at the middle, with a grille across it.

    A small opening gets no falloff and no grille. On a six-wide face the window
    is two pixels across, and a radial falloff over two pixels puts every one of
    them at the dark end of the ramp — the first pass came out muddy brown where
    it should have been the brightest thing on the model. Below four pixels
    there is no middle to fall off from, so it is simply lit.
    """
    x0, y0, w, h = box
    if w < 4 or h < 4:
        for iy in range(h):
            for ix in range(w):
                edge = min(ix, w - 1 - ix, iy, h - 1 - iy)
                px[x0 + ix, y0 + iy] = ramp(GLOW, 0.95 if edge > 0 else 0.72) + (255,)
        return

    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    reach = math.hypot(cx, cy) or 1.0

    for iy in range(h):
        for ix in range(w):
            fall = 1.0 - math.hypot(ix - cx, iy - cy) / reach
            px[x0 + ix, y0 + iy] = ramp(GLOW, 0.45 + fall * 0.7) + (255,)

    # Bars, so it reads as a lantern rather than a hole. Never every row.
    for iy in {max(1, h // 3), min(h - 2, 2 * h // 3)}:
        if iy <= 0 or iy >= h - 1:
            continue
        for ix in range(w):
            r, g, b, _ = px[x0 + ix, y0 + iy]
            px[x0 + ix, y0 + iy] = (int(r * 0.62), int(g * 0.58), int(b * 0.55), 255)


def framed(box):
    """A panel: copper frame, verdigris inner, lit opening in the middle."""
    x0, y0, w, h = box
    metal(box, COPPER, lit=0.5)

    if w > 2 and h > 2:
        metal((x0 + 1, y0 + 1, w - 2, h - 2), VERD, lit=0.5, patinated=False)
    if w >= 4 and h >= 4:
        opening((x0 + 2, y0 + 2, w - 4, h - 4))


# ---------------------------------------------------------------- the body
body = faces(0, 0, 6, 6, 6)
metal(body['top'], COPPER, lit=0.78)
metal(body['bottom'], COPPER, lit=0.28)
for side in ('front', 'back', 'left', 'right'):
    framed(body[side])

# --------------------------------------------------------------- the cap
cap = faces(0, 12, 7, 2, 7)
metal(cap['top'], COPPER, lit=0.86)
metal(cap['bottom'], COPPER, lit=0.24)
for side in ('front', 'back', 'left', 'right'):
    metal(cap[side], COPPER, lit=0.62)

# Rivets around the crown, dark then a highlight above each.
tx, ty, tw, th = cap['top']
for rx in range(tx + 1, tx + tw, 2):
    px[rx, ty] = ramp(COPPER, 0.18) + (255,)
    px[rx, ty + th - 1] = ramp(COPPER, 0.18) + (255,)

# ---------------------------------------------------------------- the foot
foot = faces(0, 21, 5, 1, 5)
metal(foot['top'], COPPER, lit=0.34)
metal(foot['bottom'], IRON, lit=0.4, wear=False, patinated=False)
for side in ('front', 'back', 'left', 'right'):
    metal(foot[side], COPPER, lit=0.5)

# ---------------------------------------------------------------- the core
core = faces(28, 0, 3, 3, 3)
for box in core.values():
    opening(box)

# --------------------------------------------------------------- the hands
for v in (8, 12):
    hand = faces(28, v, 2, 2, 2)
    for side, box in hand.items():
        metal(box, COPPER, lit=0.6)
    metal(hand['top'], COPPER, lit=0.86)
    metal(hand['bottom'], COPPER, lit=0.3)

# ------------------------------------------------------------- the shutters
for v in (0, 12):
    shutter = faces(40, v, 1, 6, 6)
    for side, box in shutter.items():
        metal(box, VERD, lit=0.42, patinated=False)

    # Outside: slatted verdigris. Inside: the light it has been hiding.
    metal(shutter['left'], VERD, lit=0.66, patinated=False)
    opening(shutter['right'])

    x0, y0, w, h = shutter['front']
    for iy in range(y0, y0 + h, 2):
        for ix in range(x0, x0 + w):
            r, g, b, _ = px[ix, iy]
            px[ix, iy] = (max(0, r - 18), max(0, g - 24), max(0, b - 20), 255)

img.save(OUT_ENTITY)
print('entity texture ->', os.path.relpath(OUT_ENTITY, HERE), img.size)

# ------------------------------------------------------------- the item icon
icon = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
ip = icon.load()


def bar(x, y, w, h, colours, lit=0.55):
    for iy in range(h):
        down = iy / max(h - 1, 1)
        for ix in range(w):
            across = ix / max(w - 1, 1)
            edge = min(across, 1 - across)
            tone = lit + 0.3 * (1 - down) - 0.14 * down + (0.2 if edge < 0.2 else 0)
            ip[x + ix, y + iy] = ramp(colours, tone) + (255,)


# A lantern seen straight on, lit from the upper left.
bar(7, 0, 2, 1, IRON, 0.5)          # hanging ring
bar(6, 1, 4, 1, COPPER, 0.62)       # neck
bar(4, 2, 8, 2, COPPER, 0.8)        # cap
bar(4, 4, 8, 8, COPPER, 0.5)        # body frame
bar(5, 5, 6, 6, VERD, 0.52)         # verdigris inner

for iy in range(6, 10):             # the opening, falling off from its middle
    for ix in range(6, 10):
        fall = 1.0 - math.hypot(ix - 7.5, iy - 7.5) / 2.6
        ip[ix, iy] = ramp(GLOW, 0.3 + fall * 0.8) + (255,)

for ix in range(6, 10):             # one grille bar
    r, g, b, _ = ip[ix, 8]
    ip[ix, 8] = (r // 2, g // 2, b // 2, 255)

bar(4, 12, 8, 2, COPPER, 0.32)      # foot
bar(5, 14, 6, 1, IRON, 0.3)         # shadow

icon.save(OUT_ITEM)
print('item icon    ->', os.path.relpath(OUT_ITEM, HERE), icon.size)
