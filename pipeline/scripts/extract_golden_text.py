"""Regenerate `extracted.md` for every golden fixture from its source PDF.

Run from the `pipeline/` directory:
    python scripts/extract_golden_text.py

Useful when:
  - pymupdf4llm is upgraded (output formatting may shift)
  - A source PDF is updated (e.g. a revision of the same BAA)
  - Adding a new fixture

The output is capped at shredder.extractor.MAX_CHARS_PER_DOCUMENT
(200K), matching what the runner sees in production.
"""
from __future__ import annotations

import pathlib
import sys

# Add src/ to sys.path so this script can be run from `pipeline/`
REPO_ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from shredder.extractor import extract_text_from_pdf  # noqa: E402


# Fixture → source PDF (relative to repo root)
FIXTURES: dict[str, str] = {
    "dod_25_1_sbir_baa":  "docs/DoD 25.1 SBIR BAA FULL_02032025.pdf",
    "dod_25_2_sbir_baa":  "docs/DoD 25.2 SBIR BAA FULL_04212025.pdf",
    "dod_25_a_sttr_baa":  "docs/DoD 25.A STTR BAA FULL_12202024.pdf",
    "af_x24_5_cso":       "docs/AF_X24.5_CSO.pdf",
    "dow_2026_sbir_baa":  "docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf",
}


def main() -> int:
    repo_root = REPO_ROOT.parent
    fixtures_dir = REPO_ROOT / "src" / "shredder" / "golden_fixtures"

    for fid, rel_pdf in FIXTURES.items():
        pdf_path = repo_root / rel_pdf
        if not pdf_path.exists():
            print(f"[skip] {fid}: source PDF not found at {pdf_path}")
            continue

        outdir = fixtures_dir / fid
        outdir.mkdir(parents=True, exist_ok=True)
        out_path = outdir / "extracted.md"

        with pdf_path.open("rb") as f:
            pdf_bytes = f.read()
        md = extract_text_from_pdf(pdf_bytes)
        out_path.write_text(md, encoding="utf-8")

        print(f"[ok] {fid}: {len(md):,} chars → {out_path.relative_to(repo_root)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
