#!/usr/bin/env python3
"""Build a multi-resolution Windows .ico from the Android launcher icons.

    tools/render-win-icon.py <largest ic_launcher.png> <out.ico>

PNG-compressed ICO entries (valid since Vista) keep this dependency-light; only
Pillow is needed, for the downscales. The Android mipmap set tops out at 192 px,
so the largest entry here is 128 px — Explorer scales that up for its biggest
views rather than us shipping a blurry 256.
"""

from __future__ import annotations

import io
import os
import struct
import sys

SIZES = (16, 20, 24, 32, 40, 48, 64, 128)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    src, dst = sys.argv[1], sys.argv[2]
    if not os.path.isfile(src):
        print(f"error: no such file: {src}", file=sys.stderr)
        return 1

    try:
        from PIL import Image
    except ImportError:
        print("error: Pillow is required (pip install pillow)", file=sys.stderr)
        return 1

    base = Image.open(src).convert("RGBA")
    if base.width != base.height:
        print(f"error: {src} is {base.width}x{base.height}, expected square", file=sys.stderr)
        return 1

    images: list[tuple[int, bytes]] = []
    for size in SIZES:
        if size > base.width:
            continue
        img = base.resize((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        images.append((size, buf.getvalue()))

    if not images:
        print("error: source image is smaller than the smallest icon size", file=sys.stderr)
        return 1

    # ICONDIR + one ICONDIRENTRY per image, then the PNG payloads.
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    payload = b""
    offset = len(header) + 16 * len(images)
    for size, data in images:
        dim = size if size < 256 else 0
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)

    os.makedirs(os.path.dirname(os.path.abspath(dst)) or ".", exist_ok=True)
    with open(dst, "wb") as fh:
        fh.write(header + entries + payload)

    sizes = ", ".join(f"{s}px" for s, _ in images)
    print(f"{dst}: {len(images)} image(s) ({sizes}), {os.path.getsize(dst):,} B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
