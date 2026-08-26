#!/usr/bin/env python3
"""Crop a region out of a screenshot so it can be READ at native resolution.

A full-page capture of a busy admin surface is 6000+ px tall; downscaled to fit a
view it becomes unreadable, which defeats the purpose of screenshotting at all.
Cropping keeps 1:1 pixels for the region that matters.

  crop-shot.py <src.png> <out.png> <x> <y> <w> <h> [--scale N]
  crop-shot.py <src.png> --info
"""
import sys
from PIL import Image


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src = sys.argv[1]
    im = Image.open(src)
    if sys.argv[2] == '--info':
        print(f"{src}: {im.width}x{im.height}")
        return 0
    out = sys.argv[2]
    x, y, w, h = (int(v) for v in sys.argv[3:7])
    # Clamp to the image so an over-long region yields the tail rather than an error.
    box = (max(0, x), max(0, y), min(im.width, x + w), min(im.height, y + h))
    crop = im.crop(box)
    scale = 1.0
    if '--scale' in sys.argv:
        scale = float(sys.argv[sys.argv.index('--scale') + 1])
    if scale != 1.0:
        crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    crop.save(out)
    print(f"{out}: {crop.width}x{crop.height}  (from {src} @ {box})")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
