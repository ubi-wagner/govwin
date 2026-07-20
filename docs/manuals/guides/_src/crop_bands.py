#!/usr/bin/env python3
"""Slice focused feature-crops out of the full-page screenshots (the 'crop images to
create new ones' pass). Each full-page portal/admin screen stacks its panels vertically,
so horizontal bands right of the sidebar map to real UI regions. Emits into
docs/manuals/img/crops/<role>/<name>.png."""
import os
from PIL import Image

ROOT = "/home/user/govwin"
def cropf(src, dst, x0, y0, x1, y1):
    """Fractional box (0..1) of the source image → dst PNG."""
    p = os.path.join(ROOT, src)
    if not os.path.exists(p):
        print("  ⚠ missing", src); return
    im = Image.open(p); W, H = im.size
    box = (int(x0*W), int(y0*H), int(x1*W), int(y1*H))
    im.crop(box).save(os.path.join(ROOT, dst))
    print("  ✓", dst, box)

# Sidebar occupies ~0.20 of width; content is x>0.205. Bands are vertical fractions.
SB = 0.205
A = "docs/manuals/img/shots/admin/"
T = "docs/manuals/img/shots/tenant/"
AC = "docs/manuals/img/crops/admin/"
TC = "docs/manuals/img/crops/tenant/"

JOBS = [
  # admin — richest pages sliced into feature bands
  (A+"curation-detail.png", AC+"cur-summary.png", SB, 0.02, 1.0, 0.20),
  (A+"curation-detail.png", AC+"cur-docs.png",    SB, 0.20, 1.0, 0.46),
  (A+"workflows.png",       AC+"wf-launch.png",   SB, 0.02, 1.0, 0.26),
  (A+"workflows.png",       AC+"wf-active.png",   SB, 0.42, 1.0, 0.74),
  (A+"agents.png",          AC+"agents-usage.png",SB, 0.55, 1.0, 0.82),
  (A+"system-state.png",    AC+"sys-healthbar.png",SB, 0.06, 1.0, 0.22),
  (A+"events.png",          AC+"events-filters.png",SB, 0.06, 1.0, 0.24),
  (A+"tenant-detail.png",   AC+"tenant-aiconfig.png",SB, 0.30, 1.0, 0.62),
  (A+"applications.png",    AC+"app-row.png",     SB, 0.14, 1.0, 0.44),
  (A+"analytics.png",       AC+"analytics-tiles.png",SB, 0.06, 1.0, 0.30),
  # tenant — richest pages
  (T+"matrix.png",          TC+"matrix-volumes.png", SB, 0.16, 1.0, 0.56),
  (T+"canvas.png",          TC+"canvas-page.png",    SB, 0.10, 0.74, 0.60),
  (T+"canvas.png",          TC+"canvas-toolboxtab.png", 0.74, 0.10, 1.0, 0.62),
  (T+"atoms.png",           TC+"atoms-rows.png",     SB, 0.34, 1.0, 0.72),
  (T+"canvas-cost.png",     TC+"sheet-grid.png",     SB, 0.14, 1.0, 0.56),
  (T+"documents.png",       TC+"docs-tables.png",    SB, 0.14, 1.0, 0.50),
  (T+"card-detail.png",     TC+"card-detail-tabs.png", SB, 0.10, 1.0, 0.44),
  (T+"dashboard.png",       TC+"dash-getstarted.png",SB, 0.42, 1.0, 0.72),
]

for src, dst, *box in JOBS:
    cropf(src, dst, *box)
print("done")
