#!/usr/bin/env python3
"""Build a placeholder spray WAD (WAD3, one 64x64 '{LOGO' miptex with mips).

Design: magenta/black checkerboard with a transparent 4px border - instantly
recognisable in-game as 'the placeholder rendered', which is all item 7's
test needs before any effort goes into a real image.
"""
import struct, sys

W = H = 64
TRANSPARENT = 255  # '{' convention: palette index 255 is transparent
MAGENTA, BLACK = 0, 1

def base_pixels():
    px = bytearray(W * H)
    for y in range(H):
        for x in range(W):
            if x < 4 or y < 4 or x >= W - 4 or y >= H - 4:
                px[y * W + x] = TRANSPARENT
            else:
                px[y * W + x] = MAGENTA if ((x // 8 + y // 8) % 2 == 0) else BLACK
    return bytes(px)

def downsample(px, w, h):
    out = bytearray((w // 2) * (h // 2))
    for y in range(h // 2):
        for x in range(w // 2):
            out[y * (w // 2) + x] = px[(y * 2) * w + (x * 2)]
    return bytes(out)

mips = [base_pixels()]
w = W
for _ in range(3):
    mips.append(downsample(mips[-1], w, w))
    w //= 2

palette = bytearray(256 * 3)
palette[MAGENTA*3:MAGENTA*3+3] = bytes((255, 0, 255))
palette[BLACK*3:BLACK*3+3] = bytes((20, 20, 20))
palette[TRANSPARENT*3:TRANSPARENT*3+3] = bytes((0, 0, 255))  # blue = transparent

name = b'{LOGO'
miptex = bytearray()
miptex += name.ljust(16, b'\0')
miptex += struct.pack('<II', W, H)
ofs = 40
offsets = []
for m in mips:
    offsets.append(ofs)
    ofs += len(m)
miptex += struct.pack('<4I', *offsets)
for m in mips:
    miptex += m
miptex += struct.pack('<H', 256) + palette + b'\0\0'

lump_ofs = 12
data = bytearray(b'WAD3')
data += struct.pack('<ii', 1, lump_ofs + len(miptex))
data += miptex
# directory entry: filepos, disksize, size, type 0x43 (miptex), compression, pad
data += struct.pack('<iiiBBH', lump_ofs, len(miptex), len(miptex), 0x43, 0, 0)
data += name.ljust(16, b'\0')

out = sys.argv[1]
open(out, 'wb').write(data)
print(f'{out}: {len(data)} bytes, {len(mips)} mips, 64x64 {{LOGO}}'.replace('{{LOGO}}', '{LOGO'))
