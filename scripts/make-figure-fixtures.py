#!/usr/bin/env python3
"""Generate the image fixtures the midterm arc inserts into proposal sections.

WHY A REAL PNG AND NOT A 1x1 STUB. The export path for an image node is
storage_key → S3 fetch → sharp rasterize → embedded picture, and every stage of
it degrades QUIETLY: a missing key, an unreadable byte stream or a storage
misconfig all fall back to a grey "[Image: …]" text stub rather than throwing.
A 1x1 transparent pixel survives that pipeline and proves nothing, because it
looks identical whether the bytes made it or not. These are real images with
real dimensions and legible content, so an export that lost them is obvious on
sight — in the file and in the byte count.

    python3 scripts/make-figure-fixtures.py
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "e2e", "fixtures", "figures")
os.makedirs(OUT, exist_ok=True)

NAVY = (18, 35, 66)
STEEL = (94, 116, 148)
CONCRETE = (203, 206, 199)
ACCENT = (196, 122, 58)
PAPER = (247, 246, 243)


def print_bed(path: str, w: int = 1000, h: int = 620) -> None:
    """A gantry print bed mid-deposit — the photo a 3DCP company puts in Volume 2."""
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)

    # ground plane
    d.rectangle([0, int(h * 0.62), w, h], fill=(226, 224, 218))
    for x in range(0, w, 40):                                    # floor grid
        d.line([(x, int(h * 0.62)), (x - 60, h)], fill=(214, 212, 205), width=1)

    # gantry frame
    rail_y = int(h * 0.16)
    d.rectangle([60, rail_y, w - 60, rail_y + 16], fill=NAVY)
    d.rectangle([70, rail_y, 92, int(h * 0.66)], fill=STEEL)
    d.rectangle([w - 92, rail_y, w - 70, int(h * 0.66)], fill=STEEL)

    # print head on its carriage
    hx = int(w * 0.54)
    d.rectangle([hx - 46, rail_y + 16, hx + 46, rail_y + 58], fill=NAVY)
    d.polygon([(hx - 16, rail_y + 58), (hx + 16, rail_y + 58), (hx + 6, rail_y + 96), (hx - 6, rail_y + 96)], fill=ACCENT)

    # deposited wall — stacked beads, the top course still short (mid-print)
    base_y = int(h * 0.62)
    courses = 11
    for i in range(courses):
        y = base_y - (i + 1) * 26
        right = w - 150 if i < courses - 1 else hx + 10
        d.rounded_rectangle([150, y, right, y + 22], radius=10,
                            fill=CONCRETE if i % 2 == 0 else (194, 197, 190),
                            outline=(176, 179, 172))

    # extruded bead falling from the nozzle
    d.line([(hx, rail_y + 96), (hx, base_y - courses * 26 + 22)], fill=CONCRETE, width=9)

    # scale bar
    d.line([(150, h - 34), (150 + 300, h - 34)], fill=NAVY, width=4)
    for tick in (150, 150 + 150, 150 + 300):
        d.line([(tick, h - 42), (tick, h - 26)], fill=NAVY, width=4)
    d.text((150, h - 22), "0                1.5 m                3.0 m", fill=NAVY)
    d.text((60, 24), "Northwind Additive - gantry print bed, course 11 of 14", fill=NAVY)

    img.save(path, "PNG", optimize=True)
    print(f"  {os.path.basename(path)}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path):,} bytes")


def site_plan(path: str, w: int = 900, h: int = 560) -> None:
    """A basing layout — the site diagram that belongs beside the technical approach."""
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, w - 40, h - 40], outline=STEEL, width=2)

    # printed structures, staged in three rows
    for row, count in enumerate((4, 3, 4)):
        for col in range(count):
            x = 90 + col * 190 + (60 if count == 3 else 0)
            y = 90 + row * 145
            d.rounded_rectangle([x, y, x + 130, y + 95], radius=6, fill=CONCRETE, outline=NAVY, width=2)
            d.line([(x, y + 95), (x + 130, y + 95)], fill=NAVY, width=3)   # slab edge

    # access route
    d.line([(60, h - 70), (w - 60, h - 70)], fill=ACCENT, width=6)
    d.text((60, 52), "Expeditionary basing layout - 11 printed shelters, single gantry pass", fill=NAVY)
    d.text((60, h - 62), "Access route / materials corridor", fill=ACCENT)

    img.save(path, "PNG", optimize=True)
    print(f"  {os.path.basename(path)}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path):,} bytes")


if __name__ == "__main__":
    print("figures →", os.path.normpath(OUT))
    print_bed(os.path.join(OUT, "northwind-print-bed.png"))
    site_plan(os.path.join(OUT, "northwind-site-plan.png"))
