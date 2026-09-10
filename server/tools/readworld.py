#!/usr/bin/env python3
"""Reads a Minecraft world off disk and draws it, so the lobby can be seen.

Written because the obvious route did not work. A mineflayer bot could have
joined the server and looked around, but mineflayer's protocol data stops at
26.1 and this server is 26.2, so it cannot connect at all — and a Minecraft
client is not something available here either.

The world files do not care about any of that. A region file is chunks of
compressed NBT, and the block data inside it is a per-section palette plus an
array of packed indices into it. All of which is a couple of hundred lines to
read, and none of which depends on a protocol version, an account, or the
server even being switched on.

    python readworld.py <dimension folder> map <x> <z> [radius] [y-top] [y-bottom]
    python readworld.py <dimension folder> column <x> <z>
    python readworld.py <dimension folder> open <x> <z> [radius]
"""

import gzip
import io
import math
import os
import struct
import sys
import zlib

# --- NBT ---------------------------------------------------------------------

TAG_END, TAG_BYTE, TAG_SHORT, TAG_INT, TAG_LONG = 0, 1, 2, 3, 4
TAG_FLOAT, TAG_DOUBLE, TAG_BYTE_ARRAY, TAG_STRING = 5, 6, 7, 8
TAG_LIST, TAG_COMPOUND, TAG_INT_ARRAY, TAG_LONG_ARRAY = 9, 10, 11, 12


class Reader:
    """A cursor over NBT bytes.

    Written by hand rather than pulled from a library because the whole need
    here is one file with no dependencies that can be run against a world
    folder, and NBT is a small enough format that a reader is shorter than the
    instructions for installing one.
    """

    def __init__(self, data):
        self.data = data
        self.at = 0

    def take(self, n):
        out = self.data[self.at:self.at + n]
        self.at += n
        return out

    def u1(self):
        return struct.unpack('>B', self.take(1))[0]

    def i1(self):
        return struct.unpack('>b', self.take(1))[0]

    def i2(self):
        return struct.unpack('>h', self.take(2))[0]

    def u2(self):
        return struct.unpack('>H', self.take(2))[0]

    def i4(self):
        return struct.unpack('>i', self.take(4))[0]

    def i8(self):
        return struct.unpack('>q', self.take(8))[0]

    def f4(self):
        return struct.unpack('>f', self.take(4))[0]

    def f8(self):
        return struct.unpack('>d', self.take(8))[0]

    def string(self):
        return self.take(self.u2()).decode('utf-8', 'replace')

    def payload(self, kind):
        if kind == TAG_BYTE:
            return self.i1()
        if kind == TAG_SHORT:
            return self.i2()
        if kind == TAG_INT:
            return self.i4()
        if kind == TAG_LONG:
            return self.i8()
        if kind == TAG_FLOAT:
            return self.f4()
        if kind == TAG_DOUBLE:
            return self.f8()
        if kind == TAG_BYTE_ARRAY:
            return self.take(self.i4())
        if kind == TAG_STRING:
            return self.string()
        if kind == TAG_LIST:
            inner = self.u1()
            count = self.i4()
            return [self.payload(inner) for _ in range(max(0, count))]
        if kind == TAG_COMPOUND:
            out = {}
            while True:
                tag = self.u1()
                if tag == TAG_END:
                    return out
                name = self.string()
                out[name] = self.payload(tag)
        if kind == TAG_INT_ARRAY:
            return [self.i4() for _ in range(self.i4())]
        if kind == TAG_LONG_ARRAY:
            return [self.i8() for _ in range(self.i4())]
        raise ValueError('unknown nbt tag %d' % kind)


def parse_nbt(raw):
    reader = Reader(raw)
    kind = reader.u1()
    if kind == TAG_END:
        return {}
    reader.string()
    return reader.payload(kind)


# --- region files ------------------------------------------------------------

def chunk_from(folder, cx, cz):
    """One chunk's NBT, or None if it has never been generated."""
    path = os.path.join(folder, 'region', 'r.%d.%d.mca' % (cx >> 5, cz >> 5))
    if not os.path.isfile(path):
        return None

    with open(path, 'rb') as handle:
        index = ((cx & 31) + (cz & 31) * 32) * 4
        handle.seek(index)
        entry = handle.read(4)
        if len(entry) < 4:
            return None

        offset = int.from_bytes(entry[0:3], 'big')
        if offset == 0:
            return None

        handle.seek(offset * 4096)
        length = int.from_bytes(handle.read(4), 'big')
        compression = handle.read(1)[0]
        body = handle.read(length - 1)

    if compression == 1:
        body = gzip.decompress(body)
    elif compression == 2:
        body = zlib.decompress(body)
    # 3 is uncompressed; anything else is a format we do not handle.
    elif compression != 3:
        return None

    return parse_nbt(body)


def section_blocks(section):
    """A function giving the block name at x,y,z inside one 16-cube section.

    The packing is the fiddly part. Indices into the palette are stored in a
    long array, tightly packed but never straddling a long — so each long holds
    floor(64 / bits) of them, and the tail of each long is wasted. Reading it as
    a continuous bit stream, which is the obvious thing, produces garbage that
    looks almost right, which is worse than garbage that does not.
    """
    states = section.get('block_states') or {}
    palette = states.get('palette') or []
    if not palette:
        return None

    names = [entry.get('Name', 'minecraft:air') for entry in palette]
    data = states.get('data')

    if not data or len(names) == 1:
        only = names[0]
        return lambda x, y, z: only

    bits = max(4, (len(names) - 1).bit_length())
    per_long = 64 // bits
    mask = (1 << bits) - 1

    def at(x, y, z):
        index = y * 256 + z * 16 + x
        which = index // per_long
        if which >= len(data):
            return 'minecraft:air'
        shift = (index % per_long) * bits
        value = (data[which] >> shift) & mask
        return names[value] if value < len(names) else 'minecraft:air'

    return at


class World:
    """Reads blocks, caching each chunk it has had to decompress."""

    def __init__(self, folder):
        self.folder = folder
        self.cache = {}

    def sections(self, cx, cz):
        if (cx, cz) in self.cache:
            return self.cache[(cx, cz)]

        chunk = chunk_from(self.folder, cx, cz)
        built = {}

        if chunk:
            for section in chunk.get('sections', []):
                reader = section_blocks(section)
                if reader:
                    built[section.get('Y', 0)] = reader

        self.cache[(cx, cz)] = built
        return built

    def block(self, x, y, z):
        sections = self.sections(x >> 4, z >> 4)
        reader = sections.get(y >> 4)
        if not reader:
            return 'minecraft:air'
        return reader(x & 15, y & 15, z & 15)


# --- drawing -----------------------------------------------------------------

SYMBOLS = [
    ('air', ' '), ('water', '~'), ('lava', '!'),
    ('leaves', '*'), ('log', 'T'), ('stem', 'T'),
    ('glass', 'o'), ('stairs', '/'), ('slab', '_'),
    ('wall', '|'), ('fence', '|'), ('pane', 'o'),
    ('grass_block', ','), ('moss', ','), ('dirt', ','), ('podzol', ','),
    ('sand', ':'), ('gravel', ':'),
    ('gold', '$'), ('diamond', '$'), ('emerald', '$'), ('lantern', '*'),
    ('quartz', '#'), ('white', '#'), ('snow', '#'), ('calcite', '#'),
    ('deepslate', '%'), ('black', '%'), ('blackstone', '%'), ('obsidian', '%'),
    ('stone', '='), ('brick', '='), ('andesite', '='), ('granite', '='),
    ('diorite', '='), ('cobble', '='), ('tuff', '='), ('copper', '='),
    ('planks', '+'), ('wood', '+'), ('concrete', '+'), ('terracotta', '+'),
    ('wool', '+'), ('carpet', '.'),
]


def symbol(name):
    short = name.replace('minecraft:', '')
    if short in ('air', 'cave_air', 'void_air'):
        return ' '
    for needle, mark in SYMBOLS:
        if needle in short:
            return mark
    return '?'


def top_at(world, x, z, high, low):
    for y in range(high, low - 1, -1):
        name = world.block(x, y, z)
        if name.replace('minecraft:', '') not in ('air', 'cave_air', 'void_air'):
            return y, name
    return None, None


def draw_map(world, cx, cz, radius, high, low):
    print('centred on %d, %d   scanning y %d down to %d' % (cx, cz, high, low))
    print('legend: = stone  # light  %% dark  + wood/wool  , ground  o glass'
          '  | wall  / stairs  _ slab  T log  * leaves/light  ~ water  $ metal'
          '  ? other  (blank = air)')
    print('')

    # A ruler, so a position in the picture can be turned back into coordinates.
    header = '     '
    for dx in range(-radius, radius + 1):
        header += '|' if (cx + dx) % 10 == 0 else ' '
    print(header)

    for dz in range(-radius, radius + 1):
        row = '%4d ' % (cz + dz)
        for dx in range(-radius, radius + 1):
            x, z = cx + dx, cz + dz
            if dx == 0 and dz == 0:
                row += '@'
                continue
            _, name = top_at(world, x, z, high, low)
            row += symbol(name) if name else ' '
        print(row)

    print('')
    print('rows are z, columns are x from %d to %d' % (cx - radius, cx + radius))


def draw_column(world, x, z, high, low):
    print('column %d, %d:' % (x, z))
    for y in range(high, low - 1, -1):
        name = world.block(x, y, z)
        if name.replace('minecraft:', '') in ('air', 'cave_air', 'void_air'):
            continue
        print('  y=%-4d %s' % (y, name.replace('minecraft:', '')))


def find_open(world, cx, cz, radius, high, low):
    """Every spot something could stand on, as coordinates.

    This is the answer the whole exercise is for: somewhere with solid ground,
    two blocks of air over it, and no roof immediately above — which is what a
    plaza is and what a doorway or a staircase is not.
    """
    found = []
    for dz in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            x, z = cx + dx, cz + dz
            y, name = top_at(world, x, z, high, low)
            if y is None:
                continue

            above = [world.block(x, y + h, z).replace('minecraft:', '')
                     for h in (1, 2, 3)]
            if any(a not in ('air', 'cave_air', 'void_air') for a in above):
                continue

            found.append((x, y + 1, z, name.replace('minecraft:', '')))
    return found


def main():
    folder = sys.argv[1]
    action = sys.argv[2]

    world = World(folder)

    if action == 'map':
        x, z = int(sys.argv[3]), int(sys.argv[4])
        radius = int(sys.argv[5]) if len(sys.argv) > 5 else 30
        high = int(sys.argv[6]) if len(sys.argv) > 6 else 140
        low = int(sys.argv[7]) if len(sys.argv) > 7 else 60
        draw_map(world, x, z, radius, high, low)

    elif action == 'column':
        x, z = int(sys.argv[3]), int(sys.argv[4])
        draw_column(world, x, z, 200, 0)

    elif action == 'open':
        x, z = int(sys.argv[3]), int(sys.argv[4])
        radius = int(sys.argv[5]) if len(sys.argv) > 5 else 30
        spots = find_open(world, x, z, radius, 140, 60)

        print('%d standable spots' % len(spots))
        levels = {}
        for _, y, _, _ in spots:
            levels[y] = levels.get(y, 0) + 1
        for y in sorted(levels, key=lambda k: -levels[k])[:8]:
            print('  y=%-4d %d spots' % (y, levels[y]))

    else:
        print(__doc__)


if __name__ == '__main__':
    main()
