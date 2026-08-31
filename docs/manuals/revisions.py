#!/usr/bin/env python3
"""
Revision + capture provenance for the role guides.

── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
The guides are generated from JSON and illustrated with screenshots cropped out of a live run.
Two things could drift independently and neither left a trace:

  · the PROSE, when the product changed and nobody re-read the words
  · the SHOTS, when the product changed and nobody re-captured them

Both had happened. The rendered HTML carried no version, no date and no statement of which run its
pictures came from, so "is this guide current?" could only be answered by reading the whole thing
against the product — which is the work the guide exists to save.

A revision is therefore two facts, not one:

  revision N        what the words say, and when a person last stood behind them
  capture <runId>   which run the pictures came from, against which commit, at which base URL

Holding them together is the point. A guide whose prose was revised today and whose shots are from
June is not current, and the footer now says so out loud rather than looking finished.

── THE CONTRACT ─────────────────────────────────────────────────────────────────────────────────
`_revisions.json` is the record. `build_guides.py` reads it and renders the badge, the provenance
line and the "What changed" list. `capture-admin.mjs` / `capture-tenant.mjs` write the capture half
when they run. Neither invents a value: a guide with no recorded capture renders "capture: not
recorded", which is the truth and is visibly worse than a date.

  python3 docs/manuals/revisions.py show
  python3 docs/manuals/revisions.py bump <slug> "what changed"    # new revision, today, HEAD commit
  python3 docs/manuals/revisions.py stale                          # shots older than the code they show
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GUIDES = os.path.join(ROOT, "docs/manuals/guides")
REV_PATH = os.path.join(GUIDES, "_revisions.json")

# Which source paths each guide DOCUMENTS. Staleness is "the code moved after the pictures were
# taken", and that question needs to know which code. Kept here rather than in the content JSON
# because it is a property of the guide's subject, not of its prose.
COVERS = {
    "rfp-admin": [
        "frontend/app/admin",
        "frontend/components/admin",
        "frontend/components/rfp-curation",
        "frontend/lib/tools/solicitation-push.ts",
        "frontend/lib/opportunity-bridge.ts",
    ],
    "customer-admin": [
        "frontend/app/portal",
        "frontend/components/portal",
        "frontend/components/canvas",
        "frontend/lib/bucket-scoring.ts",
        "frontend/lib/opportunity-pin.ts",
    ],
    "collaborator": [
        "frontend/app/portal",
        "frontend/components/portal",
    ],
}


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:
        return ""


def load() -> dict:
    if not os.path.exists(REV_PATH):
        return {"guides": {}}
    with open(REV_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def save(data: dict) -> None:
    with open(REV_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def entry(slug: str) -> dict:
    """One guide's revision record, with every field present so a renderer never guesses."""
    g = load().get("guides", {}).get(slug, {})
    return {
        "revision": g.get("revision", 0),
        "revised": g.get("revised"),
        "commit": g.get("commit"),
        "summary": g.get("summary"),
        "capture": g.get("capture"),          # None until a capture run records one
        "history": g.get("history", []),
    }


def bump(slug: str, summary: str) -> dict:
    """Record a new prose revision. Does NOT touch the capture half — a words-only change is a
    real and common thing, and pretending it refreshed the pictures is the drift this prevents."""
    data = load()
    g = data.setdefault("guides", {}).setdefault(slug, {})
    rev = int(g.get("revision", 0)) + 1
    g["revision"] = rev
    g["revised"] = date.today().isoformat()
    g["commit"] = _git("rev-parse", "--short", "HEAD")
    g["summary"] = summary
    g.setdefault("history", []).insert(0, {
        "revision": rev, "date": g["revised"], "commit": g["commit"], "summary": summary,
    })
    save(data)
    return g


def record_capture(slug: str, run: dict) -> dict:
    """Called by the capture scripts. `run` carries runId, at, base, commit, shots, crops."""
    data = load()
    g = data.setdefault("guides", {}).setdefault(slug, {})
    g["capture"] = run
    save(data)
    return g


def stale() -> list[tuple[str, str, str]]:
    """Guides whose SHOTS predate the last change to the code they document.

    Returns (slug, capturedAt, lastCodeChange). An empty list is the only clean answer; a guide
    with no recorded capture is reported too, because "never measured" is not "current".
    """
    out = []
    data = load().get("guides", {})
    for slug, paths in COVERS.items():
        cap = (data.get(slug) or {}).get("capture") or {}
        at = cap.get("at")
        last = max((_git("log", "-1", "--format=%cI", "--", p) for p in paths), default="")
        if not at:
            out.append((slug, "not recorded", last))
        elif last and last > at:
            out.append((slug, at, last))
    return out


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "show"
    if cmd == "show":
        data = load().get("guides", {})
        if not data:
            print("no revisions recorded yet")
            return 0
        for slug, g in sorted(data.items()):
            cap = g.get("capture") or {}
            print(f"{slug:16} rev {g.get('revision', 0):<3} {g.get('revised', '—'):12} "
                  f"{(g.get('commit') or '—'):10} shots: {cap.get('at', 'not recorded')}")
            if g.get("summary"):
                print(f"{'':16} {g['summary']}")
        return 0
    if cmd == "bump":
        if len(sys.argv) < 4:
            print("usage: revisions.py bump <slug> \"what changed\"", file=sys.stderr)
            return 2
        g = bump(sys.argv[2], sys.argv[3])
        print(f"{sys.argv[2]} → revision {g['revision']} ({g['revised']}, {g['commit']})")
        return 0
    if cmd == "stale":
        rows = stale()
        if not rows:
            print("✓ every guide's screenshots are newer than the code they document")
            return 0
        print("STALE — the code moved after the pictures were taken:\n")
        for slug, at, last in rows:
            print(f"  {slug:16} shots {at}   code {last or 'unknown'}")
        print("\nRe-capture:  node frontend/scripts/capture-admin.mjs   (and capture-tenant.mjs)")
        return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
