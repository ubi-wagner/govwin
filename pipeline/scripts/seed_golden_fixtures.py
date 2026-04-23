"""Seed 5 real DoD solicitation fixtures into the triage queue.

Loads the golden fixtures from pipeline/src/shredder/golden_fixtures/
and inserts them as opportunities + curated_solicitations rows so
the /admin/rfp-curation queue has real content to test against.

Usage:
    cd pipeline
    DATABASE_URL=... python scripts/seed_golden_fixtures.py

Or from Railway:
    railway run --service pipeline python scripts/seed_golden_fixtures.py

Idempotent — uses ON CONFLICT (source, source_id) DO NOTHING on
opportunities and WHERE NOT EXISTS on curated_solicitations.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

import asyncpg  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from shredder.namespace import compute_namespace_key  # noqa: E402

FIXTURES_DIR = REPO_ROOT / "src" / "shredder" / "golden_fixtures"

FIXTURES = [
    {
        "fixture_id": "dod_25_1_sbir_baa",
        "source_id": "golden-dod-25-1-sbir-baa",
        "title": "DoD SBIR 25.1 Annual Program BAA",
        "source": "sam_gov",
        "agency": "Department of Defense",
        "office": None,
        "program_type": "sbir_phase_1",
        "solicitation_number": "DoD-SBIR-25.1",
        "close_date": "2025-02-05T17:00:00Z",
        "posted_date": "2025-01-08T00:00:00Z",
        "description": "DoD SBIR 25.1 Annual Program BAA. Topics Open 8 Jan 2025, Close 5 Feb 2025.",
    },
    {
        "fixture_id": "dod_25_2_sbir_baa",
        "source_id": "golden-dod-25-2-sbir-baa",
        "title": "DoD SBIR 25.2 Annual Program BAA",
        "source": "sam_gov",
        "agency": "Department of Defense",
        "office": None,
        "program_type": "sbir_phase_1",
        "solicitation_number": "DoD-SBIR-25.2",
        "close_date": "2025-05-21T17:00:00Z",
        "posted_date": "2025-04-23T00:00:00Z",
        "description": "DoD SBIR 25.2 Annual Program BAA. Cross-cycle pair with 25.1.",
    },
    {
        "fixture_id": "dod_25_a_sttr_baa",
        "source_id": "golden-dod-25-a-sttr-baa",
        "title": "DoD STTR 25.A Annual Program BAA",
        "source": "sam_gov",
        "agency": "Department of Defense",
        "office": None,
        "program_type": "sttr_phase_1",
        "solicitation_number": "DoD-STTR-25.A",
        "close_date": "2025-03-15T17:00:00Z",
        "posted_date": "2024-12-20T00:00:00Z",
        "description": "DoD STTR 25.A Annual Program BAA. STTR archetype.",
    },
    {
        "fixture_id": "af_x24_5_cso",
        "source_id": "golden-af-x24-5-cso",
        "title": "DAF SBIR X24.5 Commercial Solutions Opening (CSO) Phase I",
        "source": "sam_gov",
        "agency": "Department of the Air Force",
        "office": None,
        "program_type": "cso",
        "solicitation_number": "AFX245-PCSO",
        "close_date": "2024-03-07T17:00:00Z",
        "posted_date": "2024-02-07T00:00:00Z",
        "description": "DAF SBIR X24.5 CSO. Slide deck format (25 slides max). Phase I, $75K max.",
    },
    {
        "fixture_id": "dow_2026_sbir_baa",
        "source_id": "golden-dow-2026-sbir-baa",
        "title": "DoW 2026 SBIR Annual Program BAA (R1)",
        "source": "sam_gov",
        "agency": "Department of War",
        "office": None,
        "program_type": "sbir_phase_1",
        "solicitation_number": "DoW-SBIR-2026-R1",
        "close_date": "2026-06-15T17:00:00Z",
        "posted_date": "2026-04-13T00:00:00Z",
        "description": "DoW (formerly DoD) 2026 SBIR BAA Revision 1. Tests DoW→DOD namespace alias.",
    },
]


async def main() -> int:
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres@/postgres?host=/tmp/pgtest&port=55432",
    )

    conn = await asyncpg.connect(database_url)
    try:
        inserted = 0
        skipped = 0

        for fx in FIXTURES:
            # Load extracted.md as full_text
            extracted_path = FIXTURES_DIR / fx["fixture_id"] / "extracted.md"
            if not extracted_path.exists():
                print(f"[skip] {fx['fixture_id']}: extracted.md not found")
                skipped += 1
                continue

            full_text = extracted_path.read_text(encoding="utf-8")
            namespace = compute_namespace_key(
                fx["agency"], fx["office"], fx["program_type"]
            ) or "pending"

            # Parse dates
            def parse_dt(s: str | None) -> datetime | None:
                if not s:
                    return None
                return datetime.fromisoformat(s.replace("Z", "+00:00"))

            close_dt = parse_dt(fx.get("close_date"))
            posted_dt = parse_dt(fx.get("posted_date"))

            # Insert opportunity (idempotent via ON CONFLICT)
            opp_id = await conn.fetchval(
                """
                INSERT INTO opportunities
                  (source, source_id, title, agency, office,
                   solicitation_number, program_type,
                   close_date, posted_date, description,
                   content_hash, is_active)
                VALUES
                  ($1, $2, $3, $4, $5, $6, $7,
                   $8, $9, $10,
                   md5($3 || $10), true)
                ON CONFLICT (source, source_id) DO UPDATE SET
                  title = EXCLUDED.title
                RETURNING id
                """,
                fx["source"],
                fx["source_id"],
                fx["title"],
                fx["agency"],
                fx["office"],
                fx["solicitation_number"],
                fx["program_type"],
                close_dt,
                posted_dt,
                fx["description"],
            )

            # Insert curated_solicitations (idempotent)
            sol_id = await conn.fetchval(
                """
                INSERT INTO curated_solicitations
                  (opportunity_id, namespace, status, full_text)
                SELECT $1, $2, 'new', $3
                WHERE NOT EXISTS (
                    SELECT 1 FROM curated_solicitations WHERE opportunity_id = $1
                )
                RETURNING id
                """,
                opp_id,
                namespace,
                full_text,
            )

            if sol_id:
                inserted += 1
                print(f"[ok] {fx['fixture_id']}: opp={opp_id} sol={sol_id} ns={namespace}")
                print(f"     full_text: {len(full_text):,} chars")
            else:
                skipped += 1
                print(f"[skip] {fx['fixture_id']}: already seeded (opp={opp_id})")

        print(f"\nDone: {inserted} inserted, {skipped} skipped")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
