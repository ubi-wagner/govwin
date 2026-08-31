"""Python half of the scorer parity check.

Reads frontend/scripts/fixtures/scorer-parity.json, runs the SHIPPING `score_card` over every case,
and writes the results to stdout as JSON.

Deliberately dumb, for the same reason as its TS twin: it imports the real function and prints.
No DB, no asyncpg, no event bus — `score_card` is pure, which is what makes this checkable at all.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from workflows.actions.rescore import score_card, build_affinity_profile  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "fixtures" / "scorer-parity.json"


def main() -> int:
    fx = json.loads(FIXTURES.read_text())
    out = []
    for c in fx["cases"]:
        # The profile is built by the SHIPPING builder from the fixture's judged cards, never read
        # from the fixture directly — a hand-written profile would let the two sides agree on a
        # shape the product never produces.
        inputs = {"affinity": build_affinity_profile(c["voted"])} if c.get("voted") else None
        r = score_card(c["card"], c["criteria"], fx["nowMs"], inputs)
        out.append({"name": c["name"], "score": r["score"], "factors": r["factors"]})
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
