#!/usr/bin/env python3
"""Build the shared spray WAD (WAD3, one '{LOGO' miptex with 4 mips).

Usage:
  make-spray-wad.py out.wad                 # placeholder magenta checkerboard
  make-spray-wad.py out.wad image.png       # quantise an image (needs Pillow)
  make-spray-wad.py out.wad image.png 48 64 # explicit spray size (default 48x64,
                                            # must be multiples of 16)

The wad ships to every client inside valve.zip as both cstrike/tempdecal.wad
and cstrike/pldecal.wad (see docs/backlog.md item 7) - everyone shares the
one spray. Index 255 renders transparent ('{' texture convention); image
mode reserves it, placeholder mode uses it for the border.
"""
import struct, sys

TRANSPARENT = 255

def log(msg):
    print(f'[spraywad] {msg}')

def placeholder(w, h):
    """Magenta/black checkerboard, transparent 4px border, 3-colour palette."""
    px = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            if x < 4 or y < 4 or x >= w - 4 or y >= h - 4:
                px[y * w + x] = TRANSPARENT
            else:
                px[y * w + x] = 0 if ((x // 8 + y // 8) % 2 == 0) else 1
    palette = bytearray(256 * 3)
    palette[0:3] = bytes((255, 0, 255))
    palette[3:6] = bytes((20, 20, 20))
    mips = [bytes(px)]
    for i in range(3):
        pw = w >> i
        mips.append(bytes(mips[-1][(y * 2) * pw + (x * 2)]
                          for y in range(pw >> 1) for x in range(pw >> 1)))
    return mips, palette

def from_image(path, w, h):
    from PIL import Image
    src = Image.open(path).convert('RGB')
    log(f'source {src.size[0]}x{src.size[1]} -> spray {w}x{h}')
    # centre-crop to the spray aspect, then build each mip from the ORIGINAL
    # so small mips aren't quantisation-of-quantisation mush
    target = w / h
    sw, sh = src.size
    if sw / sh > target:
        nw = int(sh * target); box = ((sw - nw) // 2, 0, (sw + nw) // 2, sh)
    else:
        nh = int(sw / target); box = (0, (sh - nh) // 2, sw, (sh + nh) // 2)
    src = src.crop(box)
    base = src.resize((w, h), Image.LANCZOS).quantize(colors=255, dither=Image.FLOYDSTEINBERG)
    pal = base.getpalette()  # 255 colours -> indices 0..254, 255 stays free
    palette = bytearray(256 * 3)
    palette[:len(pal)] = pal
    palette[TRANSPARENT * 3:TRANSPARENT * 3 + 3] = bytes((0, 0, 255))
    mips = []
    for i in range(4):
        mip = src.resize((w >> i, h >> i), Image.LANCZOS).quantize(
            palette=base, dither=Image.FLOYDSTEINBERG)
        mips.append(mip.tobytes())
    log(f'quantised to 255 colours, mips: {", ".join(f"{w>>i}x{h>>i}" for i in range(4))}')
    return mips, palette

def build(mips, palette, w, h):
    name = b'{LOGO'
    mt = bytearray(name.ljust(16, b'\0'))
    mt += struct.pack('<II', w, h)
    ofs, offsets = 40, []
    for m in mips:
        offsets.append(ofs); ofs += len(m)
    mt += struct.pack('<4I', *offsets)
    for m in mips:
        mt += m
    mt += struct.pack('<H', 256) + palette + b'\0\0'
    wad = bytearray(b'WAD3') + struct.pack('<ii', 1, 12 + len(mt)) + mt
    wad += struct.pack('<iiiBBH', 12, len(mt), len(mt), 0x43, 0, 0) + name.ljust(16, b'\0')
    return wad

def save_bmp(out, mips, palette, w, h):
    """8-bit indexed BMP - what Xash3D-FWGS actually reads as the custom
    spray (logos/remapped.bmp); the wads only serve GoldSrc-protocol
    clients. Engine ref: cl_main.c CL_CheckLogoFile -> 'logos/remapped.%s'."""
    from PIL import Image
    im = Image.frombytes('P', (w, h), mips[0])
    im.putpalette(bytes(palette))
    im.save(out, 'BMP')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    img = sys.argv[2] if len(sys.argv) > 2 else None
    w = int(sys.argv[3]) if len(sys.argv) > 4 else (48 if img else 64)
    h = int(sys.argv[4]) if len(sys.argv) > 4 else 64
    assert w % 16 == 0 and h % 16 == 0, 'spray dimensions must be multiples of 16'
    mips, palette = from_image(img, w, h) if img else placeholder(w, h)
    if out.endswith('.bmp'):
        save_bmp(out, mips, palette, w, h)
        log(f'{out}: 8-bit BMP {w}x{h}')
    else:
        wad = build(mips, palette, w, h)
        open(out, 'wb').write(wad)
        log(f'{out}: {len(wad)} bytes ({"image: " + img if img else "placeholder"})')
